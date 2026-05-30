// Phase 2 — Modal plein écran avec drag-drop et extraction vers Hors POI.
// Reprend la logique Photo-Manager : Sortable.js pour le drag inter-clusters,
// bouton "Extraire vers Hors POI" pour isoler une photo (split si milieu).
// Les phases suivantes ajouteront la publication, le ZIP et le nouveau lieu.

import Sortable from 'sortablejs';
import { resizeImage, calculateDistance } from './utils.js';
import { getPoiName, getPoiId } from './data.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { state } from './state.js';
import {
    savePoiPhotos,
    setPendingAdminPhotos,
    getPoiPhotos,
    getPendingAdminPhotos,
} from './database.js';
import { showToast } from './toast.js';
import { showPrompt, openHwModal, closeHwModal, suspendHwModal, resumeHwModal } from './modal.js';
import { createZipBlob } from './zip-store.js';
import { applyWatermark, ADMIN_WATERMARK_TEXT } from './photo-service.js';

let activeResolve = null;
let activeObjectUrls = [];
let keydownHandler = null;

// État mutable du modal (recréé à chaque ouverture)
let modalState = null;

function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 10);
}

function releaseObjectUrls() {
    activeObjectUrls.forEach(u => {
        try { URL.revokeObjectURL(u); } catch (_) {}
    });
    activeObjectUrls = [];
}

function closeModal(result = null) {
    // Migration V2 : on délègue à closeHwModal. Le cleanup (objectURLs,
    // keydown handler, modalState reset, resolve(result)) se fait dans le
    // .then() de openPhotoBatchModal. closeHwModal passe la valeur au resolve.
    closeHwModal(result);
}

// Normalise les clusters entrants : ajoute id, type, et id sur chaque photo
// Sémantique unifiée :
//   type: 'POI'     → au moins un POI dans 100m du barycentre (nearbyPois non vide)
//   type: 'OUT_POI' → aucun POI dans 100m (orphelin à l'import OU split manuel)
// Avant : tous les clusters naissaient 'POI', OUT_POI n'existait que via "Détacher" →
// sémantique incohérente (un orphelin import auto ≠ un orphelin split, alors qu'ils ont
// le même statut : aucun POI cible).
function normalizeClusters(enriched) {
    return enriched.map(c => {
        const hasPoi = c.nearbyPois && c.nearbyPois.length > 0;
        return {
            id: uid('c'),
            type: hasPoi ? 'POI' : 'OUT_POI',
            photos: c.photos.map(p => ({ ...p, id: uid('p') })),
            center: c.center,
            nearbyPois: c.nearbyPois,
            absoluteNearest: c.absoluteNearest,
        };
    });
}

// Flag partagé : Sortable.js passe à true pendant un drag pour ignorer le click final
let ignoreNextClick = false;

function findPhotoLocation(photoId) {
    for (const cluster of modalState.clusters) {
        const idx = cluster.photos.findIndex(p => p.id === photoId);
        if (idx !== -1) return { cluster, idx };
    }
    return null;
}

// Nom auto d'un cluster selon son type et ses POI proches
function resolveAutoName(cluster) {
    if (cluster.type === 'OUT_POI') return 'Hors POI';
    if (cluster.nearbyPois && cluster.nearbyPois.length > 0) {
        return getPoiName(cluster.nearbyPois[0].feature) || 'Lieu sans nom';
    }
    return 'Aucun POI à proximité';
}

// Nom auto d'une photo : "NN - base - PP" (identique à Photo-Manager)
// NN = index cluster (1-based, padStart 2) / PP = index photo dans le cluster (1-based, padStart 2)
// base = cluster.customName sinon nom auto du cluster
function resolvePhotoAutoName(cluster, photo) {
    if (!modalState) return photo?.file?.name || 'Photo';
    const gIndex = modalState.clusters.indexOf(cluster);
    const pIndex = cluster.photos.indexOf(photo);
    if (gIndex < 0 || pIndex < 0) return photo?.file?.name || 'Photo';
    const groupNum = String(gIndex + 1).padStart(2, '0');
    const photoNum = String(pIndex + 1).padStart(2, '0');
    const base = cluster.customName || resolveAutoName(cluster);
    return `${groupNum} - ${base} - ${photoNum}`;
}

// Sélectionne tout le texte d'un élément contentEditable (au focus)
function selectAllText(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

// Suppression d'une photo : retire du cluster, vide → supprime le cluster
function deletePhoto(photoId) {
    const loc = findPhotoLocation(photoId);
    if (!loc) return;

    loc.cluster.photos.splice(loc.idx, 1);
    modalState.clusters = modalState.clusters.filter(c => c.photos.length > 0);

    renderBody();
    updateHeaderCounts();
}

// Calcule le barycentre d'un cluster depuis les coords EXIF de ses photos.
// Utile pour les OUT_POI issus de "Détacher" (center=null) ou pour revalider
// un center potentiellement obsolète après des drags inter-clusters.
function getClusterCenter(cluster) {
    if (cluster.center && typeof cluster.center.lat === 'number') return cluster.center;
    const pts = cluster.photos.map(p => p.coords).filter(c => c && typeof c.lat === 'number');
    if (pts.length === 0) return null;
    const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    return { lat, lng };
}

// Création d'un nouveau POI à partir d'un cluster sans POI proche.
// Flow :
//   1. Masque photo-batch (z-index 10060 > rich-poi-modal 4000, sinon RichEditor invisible)
//   2. Ouvre RichEditor.openForCreate(lat, lng, photos) avec les File originaux (pas la base64
//      thumbnail 200px — cf. fix addPhotosToPoi dans desktopMode.js)
//   3. Écoute `richEditor:closed` une seule fois :
//        created: true → bascule le cluster type='POI' + flag photos alreadySaved
//                        (cluster GARDÉ dans modalState pour que le ZIP global les inclue)
//        created: false (annulation) → restaure photo-batch tel quel, cluster inchangé
async function handleCreatePoi(cluster) {
    const center = getClusterCenter(cluster);
    if (!center) {
        showToast("Coordonnées GPS introuvables pour ce cluster.", 'error');
        return;
    }

    // Récupère les File originaux. On exclut `base64` volontairement : addPhotosToPoi
    // privilégie file > base64, mais inutile de transporter la thumbnail pour rien.
    const photos = cluster.photos
        .filter(p => p.file)
        .map(p => ({ file: p.file, date: p.date }));

    if (photos.length === 0) {
        showToast("Aucune photo valide pour créer un POI.", 'error');
        return;
    }

    // Suspend la modale photo-batch le temps du RichEditor. On NE peut PAS
    // juste la masquer (display:none) : l'openHwModal du RichEditor applique sa
    // garde anti-empilement (closeHwModal sur l'activeHwOverlay) et DÉTRUIRAIT
    // la modale photo (cluster perdu, fenêtre fermée). suspendHwModal la détache
    // du système V2 → openHwModal ne la touche plus ; resumeHwModal la restaure.
    suspendHwModal();

    // Promise qui résout à la fermeture du RichEditor (succès OU annulation)
    const result = await new Promise((resolve) => {
        const onClose = (e) => {
            window.removeEventListener('richEditor:closed', onClose);
            resolve(e.detail || {});
        };
        window.addEventListener('richEditor:closed', onClose);

        // Import dynamique : richEditor → data → desktopMode → ui-photo-batch
        // cycle potentiel si statique ici.
        import('./richEditor.js').then(({ RichEditor }) => {
            RichEditor.openForCreate(center.lat, center.lng, photos);
        }).catch((err) => {
            console.error('[photo-batch] échec import RichEditor', err);
            window.removeEventListener('richEditor:closed', onClose);
            resolve({});
        });
    });

    // Restaure photo-batch (succès OU annulation — on ne ferme plus automatiquement :
    // le cluster reste visible, l'utilisateur décide de ZIPer / Save / Fermer à son rythme).
    resumeHwModal();

    if (result.created) {
        // Le POI et ses photos viennent d'être persistés par RichEditor.executeCreate
        // (via addPhotosToPoi → compressImage + savePoiPhotos). On GARDE le cluster dans
        // modalState pour deux raisons :
        //   1. Export ZIP : buildZipEntries itère sur tous les clusters. Retirer priverait
        //      l'utilisateur de ses photos dans l'archive finale — or il a probablement
        //      cliqué "Créer un lieu" *en attendant* de les exporter aussi localement.
        //   2. Feedback visuel : l'utilisateur voit que son action a pris effet (le cluster
        //      bascule de "Hors POI" à "Groupe N", subtitle "Nouveau lieu créé — …").
        // On flag chaque photo `alreadySaved: true` pour que handleSave ne tente pas un
        // double-save (compressImage vs compressFileToBlob produisent des blobs légèrement
        // différents — la dédup par taille dans addPhotosToPoi ne les détecterait pas).
        const newFeature = state.loadedFeatures.find(f => getPoiId(f) === result.poiId);
        if (newFeature) {
            cluster.type = 'POI';
            cluster.nearbyPois = [{ feature: newFeature, dist: 0 }];
            cluster.absoluteNearest = null;
            cluster.customName = null;
            cluster.savedAsNewPoi = true;
            cluster.photos.forEach(p => { p.alreadySaved = true; });
        }
        renderBody();
        updateHeaderCounts();
        updateFooterButtons();
    }
}

// Rattache un cluster à un POI donné ({ feature, dist }).
// Si un autre cluster porte déjà ce POI comme cible, on fusionne les deux.
function attachClusterToPoi(cluster, poi) {
    if (!poi || !poi.feature) return;
    const newPoiId = getPoiId(poi.feature);

    // Cherche un cluster existant portant déjà ce POI
    const existing = modalState.clusters.find(c => {
        if (c === cluster || c.type === 'OUT_POI') return false;
        const best = c.nearbyPois?.[0];
        return best && getPoiId(best.feature) === newPoiId;
    });

    if (existing) {
        existing.photos = existing.photos.concat(cluster.photos);
        existing.photos.sort((a, b) => (a.date || 0) - (b.date || 0));
        modalState.clusters = modalState.clusters.filter(c => c !== cluster);
    } else {
        // Bascule OUT_POI → POI : le cluster a désormais un POI cible, il doit pouvoir
        // être enregistré (handleSave filtre sur type === 'POI' && nearbyPois non vide).
        cluster.type = 'POI';
        cluster.nearbyPois = [poi];
        cluster.absoluteNearest = null;
        cluster.customName = null;
    }

    renderBody();
    updateHeaderCounts();
}

// Rattache un cluster au POI le plus proche connu (absoluteNearest).
function handleAttachToNearest(cluster) {
    if (!cluster.absoluteNearest) return;
    attachClusterToPoi(cluster, cluster.absoluteNearest);
}

// Candidats de rattachement calculés EN DIRECT depuis state.loadedFeatures :
// tous les POIs visibles dans `radius` m du centre du cluster, triés par distance.
// Recalculé au render → inclut les POIs créés APRÈS l'import (« Créer un lieu »
// pour un voisin), contrairement à nearbyPois qui est figé à l'import.
function getNearbyPoiCandidates(cluster, radius = 150) {
    const center = getClusterCenter(cluster);
    if (!center) return [];
    const out = [];
    state.loadedFeatures.forEach(feature => {
        const pId = getPoiId(feature);
        if (state.hiddenPoiIds && state.hiddenPoiIds.includes(pId)) return;
        if (!feature.geometry || !feature.geometry.coordinates) return;
        const [fLng, fLat] = feature.geometry.coordinates;
        const dist = calculateDistance(center.lat, center.lng, fLat, fLng);
        if (dist <= radius) out.push({ feature, dist });
    });
    out.sort((a, b) => a.dist - b.dist);
    return out;
}

// ============================================================
// MODE FOCUS / COMPARER (remplace l'ancienne lightbox plein écran noire)
// Clic « Comparer » sur un groupe → la modale bascule en mode focus : les
// autres groupes sont masqués, ce groupe passe en grand (2-4 emplacements +
// pellicule). In-place, sur surface/tokens HW — aucun overlay noir.
// ============================================================
let focusObjectUrls = [];

function releaseFocusUrls() {
    focusObjectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
    focusObjectUrls = [];
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function getFocusedCluster() {
    if (!modalState || !modalState.focus) return null;
    return modalState.clusters.find(c => c.id === modalState.focus.clusterId) || null;
}

// Bascule le header (icône + titre + hint) entre overview et focus.
function setHeaderMode(mode, cluster) {
    const overlay = document.getElementById('photo-batch-overlay');
    if (!overlay) return;
    const iconEl = overlay.querySelector('.hw-modal-icon');
    const titleEl = overlay.querySelector('.hw-modal-title');
    const hintEl = overlay.querySelector('.pb-header-hint');
    if (mode === 'focus' && cluster) {
        const name = cluster.customName || resolveAutoName(cluster);
        if (iconEl) iconEl.innerHTML = '<i data-lucide="layout-grid"></i>';
        if (titleEl) titleEl.innerHTML = `Comparer <em>· ${escapeHtml(name)}</em>`;
        if (hintEl) hintEl.textContent = "Tapez une vignette pour l'ajouter à la comparaison (jusqu'à 4)";
    } else {
        if (iconEl) iconEl.innerHTML = '<i data-lucide="images"></i>';
        if (titleEl) titleEl.textContent = 'Traitement photos';
        if (hintEl) hintEl.textContent = state.isAdmin
            ? 'Mode admin — enregistrement en attente de publication CC'
            : 'Enregistrer rattache les photos aux POI ; le ZIP inclut tout';
    }
    if (iconEl) createIcons({ icons: appIcons, root: iconEl });
    updateHeaderCounts();
}

// Nombre max d'emplacements côte à côte (sélecteur + auto). Au-delà, les photos
// deviennent trop petites pour comparer utilement.
const MAX_COMPARE_SLOTS = 6;

// Défaut adaptatif à l'entrée : on remplit ce que la largeur d'écran permet
// d'afficher confortablement (cellule cible ~600 px), borné par MAX et par le
// nombre réel de photos. Demi-écran ≈ 2, 3440 plein écran ≈ 5. Sur écran large
// on montre donc directement plusieurs photos au lieu d'en étirer 2 (cf. retour
// Stefan : « garder la taille de photo + plus de photos côte à côte »).
function defaultCompareSlots(photoCount) {
    const w = window.innerWidth || 1280;
    const byWidth = Math.max(2, Math.min(MAX_COMPARE_SLOTS, Math.floor(w / 600)));
    return Math.min(byWidth, Math.max(1, photoCount));
}

// Disposition cols × rows pour n emplacements : une seule rangée jusqu'à 4, puis
// 2 rangées (5→3×2, 6→3×2). Plus de rangées = photos plus hautes donc plus
// grandes pour les ratios paysage, plutôt qu'une longue file qui les rétrécit.
function gridForSlots(n) {
    if (n <= 4) return { cols: Math.max(1, n), rows: 1 };
    const cols = Math.ceil(n / 2);
    return { cols, rows: 2 };
}

// Remplit les emplacements null avec les premières photos du cluster non encore
// affichées (dans l'ordre de la pellicule). Évite les emplacements vides quand
// on agrandit le nombre de colonnes (bug : cliquer 3/4 ajoutait des cases vides).
function fillEmptySlots(cluster, f) {
    const shown = new Set(f.slots.filter(Boolean));
    for (let i = 0; i < f.slots.length; i++) {
        if (f.slots[i]) continue;
        const next = cluster.photos.find(p => !shown.has(p.id));
        if (next) { f.slots[i] = next.id; shown.add(next.id); }
    }
}

// Entre en mode focus pour un cluster : nb d'emplacements adaptatif (rempli).
function enterFocus(cluster) {
    const slotCount = defaultCompareSlots(cluster.photos.length);
    const slots = [];
    for (let i = 0; i < slotCount; i++) slots.push(cluster.photos[i] ? cluster.photos[i].id : null);
    modalState.focus = { clusterId: cluster.id, slotCount, slots, activeSlot: 0 };
    const overlay = document.getElementById('photo-batch-overlay');
    if (overlay) overlay.classList.add('is-focus');
    setHeaderMode('focus', cluster);
    renderBody();
}

// Quitte le focus → retour à la vue d'ensemble.
function exitFocus() {
    if (!modalState || !modalState.focus) return;
    releaseFocusUrls();
    modalState.focus = null;
    const overlay = document.getElementById('photo-batch-overlay');
    if (overlay) overlay.classList.remove('is-focus');
    setHeaderMode('overview');
    renderBody();
}

// Change le nombre d'emplacements (2 → MAX_COMPARE_SLOTS). En AGRANDISSANT, on
// remplit les nouveaux emplacements avec des photos non affichées (au lieu de
// laisser des cases vides) ; en réduisant, on tronque.
function setSlotCount(n) {
    if (!modalState || !modalState.focus) return;
    const f = modalState.focus;
    const cluster = getFocusedCluster();
    f.slotCount = n;
    f.slots = f.slots.slice(0, n);
    while (f.slots.length < n) f.slots.push(null);
    if (cluster) fillEmptySlots(cluster, f);
    if (f.activeSlot >= n) f.activeSlot = n - 1;
    renderBody();
}

// Tap d'une vignette de la pellicule → remplit l'emplacement actif (ou
// rend actif l'emplacement qui contient déjà cette photo).
function focusPelliculeTap(pid) {
    const f = modalState.focus;
    if (!f) return;
    const existing = f.slots.indexOf(pid);
    if (existing !== -1) {
        // Déjà affichée → on rend simplement son emplacement actif.
        f.activeSlot = existing;
    } else {
        // Pas encore affichée : on l'AJOUTE (jusqu'à 4 emplacements) au lieu de
        // remplacer. 1) un emplacement vide → on le remplit ; 2) sinon, si on
        // peut agrandir (< 4) → nouvel emplacement ; 3) sinon (4 pleins) →
        // remplace l'emplacement actif.
        const emptyIdx = f.slots.findIndex(s => !s);
        if (emptyIdx !== -1) {
            f.slots[emptyIdx] = pid;
            f.activeSlot = emptyIdx;
        } else if (f.slotCount < MAX_COMPARE_SLOTS) {
            f.slotCount += 1;
            f.slots.push(pid);
            f.activeSlot = f.slotCount - 1;
        } else {
            f.slots[f.activeSlot] = pid;
        }
    }
    renderBody();
}

// Première photo du cluster non affichée (hors `excludePid`), dans l'ordre de
// la pellicule. Sert à l'auto-avance : remplir un emplacement libéré.
function nextPhotoForSlot(cluster, excludePid) {
    const shown = new Set(modalState.focus.slots.filter(Boolean));
    for (const p of cluster.photos) {
        if (p.id === excludePid) continue;
        if (!shown.has(p.id)) return p.id;
    }
    return null;
}

// Réduit l'emplacement `slotIndex` (collapse) : la place est libérée, les
// cellules restantes reflowent. Plancher à 1 emplacement.
function collapseSlot(slotIndex) {
    const f = modalState.focus;
    f.slots.splice(slotIndex, 1);
    f.slotCount = Math.max(1, f.slotCount - 1);
    if (f.activeSlot > slotIndex) f.activeSlot -= 1;
    if (f.activeSlot >= f.slotCount) f.activeSlot = f.slotCount - 1;
    if (f.activeSlot < 0) f.activeSlot = 0;
}

// Retire la photo de l'emplacement `slotIndex`. `mode` décide du sort de la photo :
//   'delete' → supprimée du cluster ; 'detach' → déplacée vers « Hors POI » ;
//   'hide'   → conservée (retirée de l'affichage, re-cliquable en pellicule).
// delete / hide : AUTO-AVANCE → la photo suivante non affichée glisse dans
// l'emplacement (garde le même nombre de vignettes pour un tri rapide) ; s'il
// n'y a plus de suivante, l'emplacement est réduit (collapse).
// detach : collapse direct (le détachement peut scinder le groupe → pas d'avance).
function removeFromComparison(slotIndex, mode) {
    const f = modalState.focus;
    if (!f) return;
    const cluster = getFocusedCluster();
    if (!cluster) return;
    const pid = f.slots[slotIndex];

    if (mode === 'detach') {
        collapseSlot(slotIndex);
        if (pid) { extractToOutPoi(pid); return; } // re-render interne
        renderBody();
        return;
    }

    const next = nextPhotoForSlot(cluster, pid);
    if (next) f.slots[slotIndex] = next;
    else collapseSlot(slotIndex);

    if (mode === 'delete' && pid) { deletePhoto(pid); return; } // re-render interne
    renderBody(); // 'hide' : la photo reste dans le cluster
}

// Construit une cellule de comparaison (emplacement i).
function buildCompareCell(cluster, i) {
    const f = modalState.focus;
    const pid = f.slots[i];
    const photo = pid ? cluster.photos.find(p => p.id === pid) : null;

    const cell = document.createElement('article');
    cell.className = 'pb-compare-cell' + (i === f.activeSlot ? ' is-active' : '') + (photo ? '' : ' is-empty');
    cell.dataset.slot = String(i);
    if (photo) cell.dataset.photoId = photo.id;

    const idx = document.createElement('span');
    idx.className = 'pb-compare-idx';
    idx.textContent = `${i + 1} / ${f.slotCount}`;
    cell.appendChild(idx);

    const flag = document.createElement('span');
    flag.className = 'pb-compare-flag';
    flag.innerHTML = '<i data-lucide="crosshair"></i><span>Emplacement actif</span>';
    cell.appendChild(flag);

    const photoZone = document.createElement('div');
    photoZone.className = 'pb-compare-photo';
    if (photo) {
        const img = document.createElement('img');
        img.alt = photo.customName || resolvePhotoAutoName(cluster, photo);
        if (photo.file) {
            const url = URL.createObjectURL(photo.file);
            focusObjectUrls.push(url);
            img.src = url;
        } else if (photo.base64) {
            img.src = photo.base64;
        }
        photoZone.appendChild(img);
    } else {
        photoZone.innerHTML = '<i data-lucide="image"></i><span>Choisissez une photo dans la pellicule</span>';
    }
    cell.appendChild(photoZone);

    const toolbar = document.createElement('div');
    toolbar.className = 'pb-compare-toolbar';
    const name = document.createElement('span');
    name.className = 'pb-compare-name';
    if (photo) {
        name.contentEditable = 'true';
        name.spellcheck = false;
        name.textContent = photo.customName || resolvePhotoAutoName(cluster, photo);
        name.addEventListener('mousedown', (e) => e.stopPropagation());
        name.addEventListener('click', (e) => e.stopPropagation());
        name.addEventListener('focus', () => selectAllText(name));
        name.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); name.blur(); }
        });
        name.addEventListener('blur', () => {
            const text = name.textContent.trim();
            const base = resolvePhotoAutoName(cluster, photo);
            photo.customName = (text && text !== base) ? text : null;
            if (!text) name.textContent = base;
        });
    } else {
        name.textContent = '— vide —';
        name.style.color = 'var(--ink-soft)';
    }
    toolbar.appendChild(name);

    const acts = document.createElement('div');
    acts.className = 'pb-compare-acts';
    // Retirer de l'affichage (non destructif) : libère l'emplacement, garde la photo.
    if (photo) {
        const hide = document.createElement('button');
        hide.className = 'pb-compare-btn';
        hide.type = 'button';
        hide.title = "Retirer de l'affichage (sans supprimer la photo)";
        hide.setAttribute('aria-label', "Retirer de l'affichage");
        hide.innerHTML = '<i data-lucide="eye-off"></i>';
        hide.addEventListener('click', (e) => { e.stopPropagation(); removeFromComparison(i, 'hide'); });
        acts.appendChild(hide);
    }
    if (photo && cluster.type !== 'OUT_POI') {
        const ex = document.createElement('button');
        ex.className = 'pb-compare-btn';
        ex.type = 'button';
        ex.title = 'Détacher cette photo vers « Hors POI »';
        ex.setAttribute('aria-label', 'Détacher');
        ex.innerHTML = '<i data-lucide="route"></i>';
        ex.addEventListener('click', (e) => { e.stopPropagation(); removeFromComparison(i, 'detach'); });
        acts.appendChild(ex);
    }
    const del = document.createElement('button');
    del.className = 'pb-compare-btn is-danger';
    del.type = 'button';
    del.title = 'Supprimer cette photo';
    del.setAttribute('aria-label', 'Supprimer');
    del.innerHTML = '<i data-lucide="trash-2"></i>';
    del.disabled = !photo;
    del.addEventListener('click', (e) => { e.stopPropagation(); if (photo) removeFromComparison(i, 'delete'); });
    acts.appendChild(del);
    toolbar.appendChild(acts);
    cell.appendChild(toolbar);

    // Clic sur la cellule → emplacement actif (hors boutons / nom éditable)
    cell.addEventListener('click', (e) => {
        if (e.target.closest('.pb-compare-btn, [contenteditable]')) return;
        f.activeSlot = i;
        renderBody();
    });

    return cell;
}

// Construit la pellicule (toutes les photos du cluster, claire).
function buildPellicule(cluster) {
    const f = modalState.focus;
    const wrap = document.createElement('div');
    wrap.className = 'pb-pellicule';

    const head = document.createElement('div');
    head.className = 'pb-pellicule-head';
    head.innerHTML = `<span>Pellicule</span><span class="sep">·</span><span><b>${cluster.photos.length}</b> photo(s)</span>`
        + `<span class="sep">·</span><span class="pb-pellicule-hint">Taper une vignette l'ajoute (jusqu'à 4) ; au-delà, remplace l'emplacement actif</span>`;
    wrap.appendChild(head);

    const track = document.createElement('div');
    track.className = 'pb-pellicule-track';

    const slotByPid = {};
    f.slots.forEach((pid, i) => { if (pid) slotByPid[pid] = i + 1; });

    cluster.photos.forEach(p => {
        const thumb = document.createElement('button');
        thumb.className = 'pb-pellicule-thumb';
        thumb.type = 'button';
        thumb.dataset.photoId = p.id;
        thumb.title = p.customName || resolvePhotoAutoName(cluster, p);
        const slot = slotByPid[p.id];
        if (slot) thumb.classList.add('is-in-slot');

        const img = document.createElement('img');
        img.alt = '';
        if (p.base64) img.src = p.base64;
        else if (p.file) resizeImage(p.file, 160).then(d => { img.src = d; }).catch(() => {});
        thumb.appendChild(img);

        if (slot) {
            const num = document.createElement('span');
            num.className = 'slot-num';
            num.textContent = String(slot);
            thumb.appendChild(num);
        }

        thumb.addEventListener('click', () => focusPelliculeTap(p.id));
        track.appendChild(thumb);
    });

    wrap.appendChild(track);
    return wrap;
}

// Construit la section d'un cluster en mode focus (compare + pellicule).
function renderFocus(cluster) {
    releaseFocusUrls();  // révoque les objectURL du rendu focus précédent
    const f = modalState.focus;

    // Réconcilie les emplacements avec les photos actuelles du cluster.
    const byId = new Map(cluster.photos.map(p => [p.id, p]));
    f.slots = f.slots.slice(0, f.slotCount);
    while (f.slots.length < f.slotCount) f.slots.push(null);
    f.slots = f.slots.map(pid => (pid && byId.has(pid)) ? pid : null);
    if (f.activeSlot >= f.slotCount) f.activeSlot = f.slotCount - 1;
    if (f.activeSlot < 0) f.activeSlot = 0;

    const section = document.createElement('section');
    section.className = 'pb-cluster is-focused';
    section.dataset.clusterId = cluster.id;

    // --- HEAD : retour + titre + sélecteur 2/3/4 + ZIP ---
    const head = document.createElement('div');
    head.className = 'pb-cluster-head';

    const back = document.createElement('button');
    back.className = 'pb-focus-back';
    back.type = 'button';
    back.title = "Revenir à la vue d'ensemble (Échap)";
    back.innerHTML = '<i data-lucide="arrow-left"></i><span>Vue d\'ensemble</span>';
    back.addEventListener('click', () => exitFocus());
    head.appendChild(back);

    const headBlock = document.createElement('div');
    headBlock.className = 'pb-cluster-head-block';
    const title = document.createElement('h2');
    title.className = 'pb-cluster-title';
    title.contentEditable = 'true';
    title.spellcheck = false;
    title.textContent = cluster.customName || resolveAutoName(cluster);
    title.addEventListener('focus', () => selectAllText(title));
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
    title.addEventListener('blur', () => {
        const text = title.textContent.trim();
        const base = resolveAutoName(cluster);
        cluster.customName = (text && text !== base) ? text : null;
        if (!text) title.textContent = base;
        setHeaderMode('focus', cluster);
    });
    const sub = document.createElement('div');
    sub.className = 'pb-cluster-sub';
    const filled = f.slots.filter(Boolean).length;
    const dot = document.createElement('span'); dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true');
    const s1 = document.createElement('span'); s1.textContent = `${cluster.photos.length} photo(s)`;
    const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '·';
    const s2 = document.createElement('span'); s2.textContent = `${filled} affichée(s)`;
    sub.append(dot, s1, sep, s2);
    headBlock.append(title, sub);
    head.appendChild(headBlock);

    // Sélecteur 2 → min(6, nb photos). Masqué si ≤ 2 photos (rien à choisir).
    const maxOpt = Math.min(MAX_COMPARE_SLOTS, cluster.photos.length);
    if (maxOpt >= 3) {
        const slotsCtl = document.createElement('div');
        slotsCtl.className = 'pb-slots';
        for (let n = 2; n <= maxOpt; n++) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = String(n);
            if (n === f.slotCount) b.classList.add('is-on');
            b.title = `${n} photos côte à côte`;
            b.addEventListener('click', () => { if (n !== f.slotCount) setSlotCount(n); });
            slotsCtl.appendChild(b);
        }
        head.appendChild(slotsCtl);
    }

    const zipBtn = document.createElement('button');
    zipBtn.className = 'pb-act is-icon';
    zipBtn.type = 'button';
    zipBtn.innerHTML = '<i data-lucide="download"></i>';
    zipBtn.title = `Télécharger ce groupe en ZIP (${cluster.photos.length} photo(s))`;
    zipBtn.setAttribute('aria-label', 'Télécharger ce groupe en ZIP');
    zipBtn.addEventListener('click', (e) => { e.stopPropagation(); handleExportClusterZip(cluster); });
    head.appendChild(zipBtn);

    section.appendChild(head);

    // --- FOCUS BODY : compare + pellicule ---
    const fbody = document.createElement('div');
    fbody.className = 'pb-focus-body';

    const compare = document.createElement('div');
    compare.className = 'pb-compare';
    compare.dataset.count = String(f.slotCount);
    for (let i = 0; i < f.slotCount; i++) compare.appendChild(buildCompareCell(cluster, i));
    fbody.appendChild(compare);

    fbody.appendChild(buildPellicule(cluster));
    section.appendChild(fbody);
    return section;
}

// Déplacement drag-drop : met à jour l'état à partir du DOM post-Sortable
function handleMoveEnd(evt) {
    if (!evt.to || (evt.from === evt.to && evt.oldIndex === evt.newIndex)) return;

    const photoId = evt.item.dataset.photoId;
    const targetClusterId = evt.to.dataset.clusterId;
    const newIndex = evt.newIndex;

    const loc = findPhotoLocation(photoId);
    if (!loc) return;
    const target = modalState.clusters.find(c => c.id === targetClusterId);
    if (!target) return;

    const [photo] = loc.cluster.photos.splice(loc.idx, 1);
    target.photos.splice(newIndex, 0, photo);

    // Les clusters POI vides disparaissent ; les clusters OUT_POI vides aussi
    modalState.clusters = modalState.clusters.filter(c => c.photos.length > 0);

    renderBody();
    updateHeaderCounts();
}

// Extraction vers un nouveau cluster "Hors POI" d'1 photo (split si milieu)
function extractToOutPoi(photoId) {
    const loc = findPhotoLocation(photoId);
    if (!loc) return;

    const { cluster, idx } = loc;
    const gIndex = modalState.clusters.indexOf(cluster);
    const [photo] = cluster.photos.splice(idx, 1);

    const newOut = {
        id: uid('c'),
        type: 'OUT_POI',
        photos: [photo],
        center: null,
        nearbyPois: [],
        absoluteNearest: null,
    };

    if (cluster.photos.length === 0) {
        // Cluster source vidé → on le remplace par le nouveau
        modalState.clusters.splice(gIndex, 1, newOut);
    } else if (idx === cluster.photos.length) {
        // Photo était la dernière → Hors POI inséré après
        modalState.clusters.splice(gIndex + 1, 0, newOut);
    } else if (idx === 0) {
        // Photo était la première → Hors POI inséré avant
        modalState.clusters.splice(gIndex, 0, newOut);
    } else {
        // Photo au milieu → split : partie restante après devient un nouveau cluster POI
        const remaining = cluster.photos.splice(idx);
        const splitCluster = { ...cluster, id: uid('c'), photos: remaining };
        modalState.clusters.splice(gIndex + 1, 0, newOut, splitCluster);
    }

    renderBody();
    updateHeaderCounts();
}

// --- ENREGISTREMENT ---

// Compression différée : File original → Blob JPEG (via canvas.toBlob, pas de fetch(dataURL)).
// NOTE : on utilise toBlob directement plutôt que resizeImage+fetch, car fetch() sur une
// data: URL échoue dans certains contextes (sandbox, CSP strict) avec "TypeError: Failed to fetch".
function compressFileToBlob(file, maxWidth = 1600, quality = 0.88) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout compression image')), 15000);
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                clearTimeout(timer);
                try {
                    const canvas = document.createElement('canvas');
                    let w = img.width, h = img.height;
                    if (w > maxWidth) {
                        h = Math.round(h * (maxWidth / w));
                        w = maxWidth;
                    }
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    // Watermark admin : même logique que compressImage (photo-service).
                    // Sans ça, l'import GPS — chemin de production principal de l'admin —
                    // publiait des photos SANS watermark, alors que la grille en mettait.
                    if (state.isAdmin) {
                        applyWatermark(ctx, w, h, ADMIN_WATERMARK_TEXT);
                    }
                    canvas.toBlob(
                        (blob) => {
                            if (blob) resolve(blob);
                            else reject(new Error('canvas.toBlob a renvoyé null'));
                        },
                        'image/jpeg',
                        quality
                    );
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = () => { clearTimeout(timer); reject(new Error('Image invalide')); };
            img.src = e.target.result;
        };
        reader.onerror = () => { clearTimeout(timer); reject(new Error('Erreur lecture fichier')); };
        reader.readAsDataURL(file);
    });
}

// Dédup par id dans un tableau d'items { id, blob } (garde la dernière occurrence)
function dedupById(items) {
    const map = new Map();
    for (const item of items) {
        if (item && item.id) map.set(item.id, item);
    }
    return [...map.values()];
}

// Met à jour l'état disabled du bouton Enregistrer selon la présence de clusters rattachés
// ayant au moins une photo PAS encore sauvée (un cluster savedAsNewPoi a toutes ses photos
// déjà persistées via addPhotosToPoi, inutile d'activer Enregistrer pour lui).
function updateFooterButtons() {
    const saveBtn = document.getElementById('photo-batch-btn-save');
    if (!saveBtn || !modalState) return;
    const hasAttached = modalState.clusters.some(c =>
        c.type !== 'OUT_POI' &&
        c.nearbyPois && c.nearbyPois.length > 0 &&
        c.photos.some(p => !p.alreadySaved)
    );
    saveBtn.disabled = !hasAttached;
    saveBtn.title = hasAttached
        ? 'Enregistrer les photos rattachées à un POI'
        : 'Rattache au moins un cluster à un POI pour activer';
}

// Handler principal : compresse, merge avec l'existant, écrit en DB (split admin/user).
async function handleSave() {
    if (!modalState || !modalState.clusters) return;
    const saveBtn = document.getElementById('photo-batch-btn-save');
    const zipBtn = document.getElementById('photo-batch-btn-zip');
    if (saveBtn) saveBtn.disabled = true;
    if (zipBtn) zipBtn.disabled = true;

    try {
        const mapId = state.currentMapId;
        if (!mapId) {
            showToast('Aucune carte active.', 'error');
            return;
        }

        // Sépare clusters éligibles vs Hors POI (ignorés) vs déjà-sauvés-via-Créer-un-lieu.
        // Un cluster savedAsNewPoi a ses photos déjà persistées par addPhotosToPoi : on ne
        // veut pas les re-traiter ici (double-save — cf. commentaire dans handleCreatePoi).
        const poiClusters = modalState.clusters.filter(c =>
            c.type !== 'OUT_POI' &&
            c.nearbyPois && c.nearbyPois.length > 0 &&
            c.photos.some(p => !p.alreadySaved)
        );
        const outPoiCount = modalState.clusters.filter(c => c.type === 'OUT_POI').length;

        if (poiClusters.length === 0) {
            showToast("Aucun cluster rattaché à un POI. Rattache au moins un lieu avant d'enregistrer.", 'warning');
            return;
        }

        let totalPhotos = 0;
        for (const cluster of poiClusters) {
            const poiId = getPoiId(cluster.nearbyPois[0].feature);
            if (!poiId) continue;

            // Compression en parallèle pour ce cluster.
            // On exclut les photos alreadySaved (déjà persistées via "Créer un lieu" →
            // addPhotosToPoi). Sinon double-save : les deux chemins de compression produisent
            // des tailles légèrement différentes → la dédup par taille dans addPhotosToPoi
            // ne les reconnaîtrait pas comme doublons.
            const blobItems = await Promise.all(
                cluster.photos
                    .filter(p => p.file && !p.alreadySaved)
                    .map(async (p) => ({
                        id: p.id,
                        blob: await compressFileToBlob(p.file)
                    }))
            );
            if (blobItems.length === 0) continue;

            // Merge avec l'existant en DB (dédup par id)
            if (state.isAdmin) {
                const existing = await getPendingAdminPhotos(mapId, poiId) || [];
                const merged = dedupById([...existing, ...blobItems]);
                await setPendingAdminPhotos(mapId, poiId, merged);
            } else {
                const existing = await getPoiPhotos(mapId, poiId) || [];
                const merged = dedupById([...existing, ...blobItems]);
                await savePoiPhotos(mapId, poiId, merged);
            }

            totalPhotos += blobItems.length;
        }

        const modeSuffix = state.isAdmin ? ' (en attente CC)' : '';
        showToast(
            `${poiClusters.length} POI mis à jour, ${totalPhotos} photo(s) ajoutée(s)${modeSuffix}.`,
            'success'
        );
        if (outPoiCount > 0) {
            showToast(`${outPoiCount} cluster(s) Hors POI ignoré(s) (pas de POI cible).`, 'warning');
        }

        closeModal({ saved: true, poiCount: poiClusters.length, photoCount: totalPhotos });

    } catch (e) {
        console.error('[photo-batch] handleSave error', e);
        showToast('Erreur enregistrement : ' + (e.message || e), 'error');
        if (saveBtn) saveBtn.disabled = false;
        if (zipBtn) zipBtn.disabled = false;
    }
}

// Stub : sera implémenté à l'étape ZIP
// --- EXPORT ZIP ---

// Déclenche le téléchargement d'un Blob sous un nom de fichier sanitisé.
function triggerBlobDownload(blob, filename) {
    const safeName = filename.replace(/[\\/:"*?<>|]/g, '-');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke différé pour laisser Firefox démarrer le téléchargement
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Construit le nom d'album par défaut pour un export global,
// en s'inspirant de generateCircuitName() (circuit.js).
// Utilise UNIQUEMENT les clusters rattachés à un POI (type !== 'OUT_POI' et nearbyPois.length > 0).
function buildDefaultAlbumName(clusters) {
    const attachedAll = clusters.filter(c =>
        c.type !== 'OUT_POI' && c.nearbyPois && c.nearbyPois.length > 0
    );

    if (attachedAll.length === 0) {
        const today = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `Photos Djerba ${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    }

    // App patrimoniale : on exclut les POIs Restaurant pour le nommage
    // (le resto reste un POI du circuit, juste pas dans le titre).
    const isResto = (cluster) => {
        const props = cluster.nearbyPois?.[0]?.feature?.properties;
        if (!props) return false;
        const cat = props['Catégorie'] || props.userData?.['Catégorie'];
        return cat === 'Restaurant';
    };
    const heritage = attachedAll.filter(c => !isResto(c));
    const attached = heritage.length >= 1 ? heritage : attachedAll;

    const firstName = attached[0].customName || getPoiName(attached[0].nearbyPois[0].feature) || 'Lieu';
    if (attached.length === 1) {
        return firstName;
    }
    const lastName = attached[attached.length - 1].customName
        || getPoiName(attached[attached.length - 1].nearbyPois[0].feature)
        || 'Lieu';

    if (attached.length > 2) {
        const midIdx = Math.floor((attached.length - 1) / 2);
        const midName = attached[midIdx].customName
            || getPoiName(attached[midIdx].nearbyPois[0].feature)
            || 'Lieu';
        if (midName !== firstName && midName !== lastName) {
            return `Circuit de ${firstName} à ${lastName} via ${midName}`;
        }
    }
    return `Circuit de ${firstName} à ${lastName}`;
}

// Construit les entrées ZIP pour une liste de clusters (photos pleine qualité).
// Utilise resolvePhotoAutoName pour respecter le nommage "NN - Nom - PP".
// Les clusters OUT_POI sont inclus dans le global (entrées "NN - Hors POI - PP").
function buildZipEntries(clusters) {
    const entries = [];
    for (const cluster of clusters) {
        for (const photo of cluster.photos) {
            if (!photo.file) continue;
            const name = resolvePhotoAutoName(cluster, photo) + '.jpg';
            entries.push({ name, data: photo.file, date: photo.date ? new Date(photo.date) : new Date() });
        }
    }
    return entries;
}

// Handler global : ZIP de tous les clusters, nom d'album par défaut = generateCircuitName-like.
async function handleExportZip() {
    if (!modalState || !modalState.clusters || modalState.clusters.length === 0) {
        showToast('Aucune photo à exporter.', 'info');
        return;
    }
    const defaultName = buildDefaultAlbumName(modalState.clusters);
    const album = await showPrompt("Nom d'album", "Nom d'album :", defaultName);
    if (!album) return; // Annulé → rien

    await generateAndDownloadZip(modalState.clusters, album);
}

// Handler par cluster : ZIP d'un seul groupe, nom d'album par défaut = nom du cluster.
async function handleExportClusterZip(cluster) {
    if (!cluster || !cluster.photos || cluster.photos.length === 0) {
        showToast('Ce groupe ne contient aucune photo.', 'info');
        return;
    }
    const defaultName = cluster.customName || resolveAutoName(cluster);
    const album = await showPrompt("Nom d'album", "Nom d'album :", defaultName);
    if (!album) return;

    await generateAndDownloadZip([cluster], album);
}

// Commun : construit et télécharge le ZIP, disable les boutons pendant la génération.
async function generateAndDownloadZip(clusters, albumName) {
    const zipBtn = document.getElementById('photo-batch-btn-zip');
    const saveBtn = document.getElementById('photo-batch-btn-save');
    const prevZipDisabled = zipBtn?.disabled;
    const prevSaveDisabled = saveBtn?.disabled;
    if (zipBtn) zipBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;

    try {
        const entries = buildZipEntries(clusters);
        if (entries.length === 0) {
            showToast('Aucune photo valide à zipper.', 'warn');
            return;
        }
        const zipBlob = await createZipBlob(entries);
        triggerBlobDownload(zipBlob, `${albumName}.zip`);
        showToast(`ZIP : ${entries.length} photo(s) — ${albumName}.zip`, 'success');
    } catch (e) {
        console.error('[photo-batch] handleExportZip error', e);
        showToast('Erreur lors de la génération du ZIP.', 'error');
    } finally {
        if (zipBtn) zipBtn.disabled = !!prevZipDisabled;
        if (saveBtn) saveBtn.disabled = !!prevSaveDisabled;
    }
}

function buildClusterSection(cluster, index) {
    const section = document.createElement('section');
    section.className = 'pb-cluster';
    section.dataset.clusterId = cluster.id;
    section.dataset.clusterIndex = String(index);

    const hasNearbyPoi = cluster.nearbyPois && cluster.nearbyPois.length > 0;
    const hasAbsoluteNearest = !!cluster.absoluteNearest;
    const isOutPoiType = cluster.type === 'OUT_POI';
    // Orphelin = pas de POI rattaché MAIS un POI proche connu (→ on peut Rattacher).
    // Hors POI pur = aucun POI cible (détaché manuellement / aucun POI chargé).
    const isOrphan = isOutPoiType && hasAbsoluteNearest && !cluster.savedAsNewPoi;
    const isPureOut = isOutPoiType && !hasAbsoluteNearest && !cluster.savedAsNewPoi;
    if (isOrphan) section.classList.add('is-orphan');
    if (isPureOut) section.classList.add('is-out-poi');

    // --- HEAD (sticky) ---
    const head = document.createElement('div');
    head.className = 'pb-cluster-head';

    const headBlock = document.createElement('div');
    headBlock.className = 'pb-cluster-head-block';

    // Titre éditable (customName prioritaire sur le nom auto)
    const title = document.createElement('h2');
    title.className = 'pb-cluster-title';
    title.contentEditable = 'true';
    title.spellcheck = false;
    const autoName = resolveAutoName(cluster);
    title.textContent = cluster.customName || autoName;

    // Sous-titre = métadonnées (dot + segments séparés par « · »).
    const sub = document.createElement('div');
    sub.className = 'pb-cluster-sub';
    const photoWord = `${cluster.photos.length} photo(s)`;
    const segs = [];
    if (cluster.savedAsNewPoi) {
        segs.push('Nouveau lieu créé', photoWord);
        section.dataset.suggestedPoiId = getPoiId(cluster.nearbyPois[0].feature) || '';
    } else if (hasNearbyPoi) {
        const best = cluster.nearbyPois[0];
        segs.push(`POI rattaché · ${Math.round(best.dist)} m`, photoWord);
        section.dataset.suggestedPoiId = getPoiId(best.feature) || '';
    } else if (hasAbsoluteNearest) {
        const n = cluster.absoluteNearest;
        segs.push(`Plus proche : ${getPoiName(n.feature) || '(sans nom)'} · ${Math.round(n.dist)} m`, photoWord);
        section.dataset.suggestedPoiId = '';
    } else {
        segs.push('Sans POI cible', photoWord);
        section.dataset.suggestedPoiId = '';
    }
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    sub.appendChild(dot);
    segs.forEach((seg, i) => {
        if (i > 0) {
            const sep = document.createElement('span');
            sep.className = 'sep';
            sep.textContent = '·';
            sub.appendChild(sep);
        }
        const s = document.createElement('span');
        s.textContent = seg;
        sub.appendChild(s);
    });

    // Handlers du renommage (inchangés)
    title.addEventListener('focus', () => selectAllText(title));
    title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
    });
    title.addEventListener('blur', () => {
        const text = title.textContent.trim();
        const base = resolveAutoName(cluster);
        const newCustom = (text && text !== base) ? text : null;
        const changed = newCustom !== cluster.customName;
        cluster.customName = newCustom;
        if (!text) title.textContent = base;
        // Si le nom du cluster a changé, les auto-noms des photos (NN - base - PP)
        // deviennent obsolètes : on re-render pour les mettre à jour live.
        if (changed) renderBody();
    });

    headBlock.appendChild(title);
    headBlock.appendChild(sub);
    head.appendChild(headBlock);

    // Badge Orphelin / Hors POI (pas sur un cluster rattaché)
    if (isOrphan || isPureOut) {
        const badge = document.createElement('span');
        badge.className = 'pb-cluster-badge';
        badge.textContent = isOrphan ? 'Orphelin' : 'Hors POI';
        head.appendChild(badge);
    }

    // Barre d'actions (rattacher / créer / comparer / ZIP)
    const actions = document.createElement('div');
    actions.className = 'pb-cluster-actions';

    // Rattacher au POI le plus proche (cluster sans POI rattaché mais avec absoluteNearest)
    if (!hasNearbyPoi && hasAbsoluteNearest) {
        const nearestName = getPoiName(cluster.absoluteNearest.feature) || 'ce POI';
        const attachBtn = document.createElement('button');
        attachBtn.className = 'pb-act';
        attachBtn.type = 'button';
        attachBtn.innerHTML = `<i data-lucide="link"></i><span>Rattacher à ${nearestName}</span>`;
        attachBtn.title = `Rattacher ces photos au POI le plus proche (${Math.round(cluster.absoluteNearest.dist)} m)`;
        attachBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleAttachToNearest(cluster);
        });
        actions.appendChild(attachBtn);
    }

    // Créer un nouveau lieu (tout cluster sans POI rattaché)
    if (!hasNearbyPoi) {
        const createBtn = document.createElement('button');
        createBtn.className = 'pb-act';
        createBtn.type = 'button';
        createBtn.innerHTML = '<i data-lucide="map-pin-plus"></i><span>Créer un lieu</span>';
        createBtn.title = 'Créer un nouveau POI avec ces photos';
        createBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleCreatePoi(cluster);
        });
        actions.appendChild(createBtn);
    }

    // Sélecteur de lieu : sur un groupe rattaché, permet de RÉASSIGNER le groupe
    // à un autre POI proche (le « plus proche » auto se trompe quand 2 POIs sont
    // collés — ex. mosquée/puits face à face). Candidats calculés en direct →
    // inclut les POIs créés après l'import. Affiché seulement s'il y a un choix.
    if (cluster.type !== 'OUT_POI' && hasNearbyPoi) {
        const candidates = getNearbyPoiCandidates(cluster);
        const currentId = getPoiId(cluster.nearbyPois[0].feature);
        // Garantit la présence du POI courant dans la liste (même hors rayon).
        if (!candidates.some(c => getPoiId(c.feature) === currentId)) {
            candidates.unshift(cluster.nearbyPois[0]);
        }
        if (candidates.length >= 2) {
            const select = document.createElement('select');
            select.className = 'pb-act pb-poi-select';
            select.title = 'Changer le lieu de rattachement de ce groupe';
            candidates.forEach(c => {
                const opt = document.createElement('option');
                opt.value = getPoiId(c.feature);
                opt.textContent = `${getPoiName(c.feature) || '(sans nom)'} · ${Math.round(c.dist)} m`;
                if (opt.value === currentId) opt.selected = true;
                select.appendChild(opt);
            });
            select.addEventListener('click', (e) => e.stopPropagation());
            select.addEventListener('change', (e) => {
                e.stopPropagation();
                if (select.value === currentId) return;
                const chosen = candidates.find(c => getPoiId(c.feature) === select.value);
                if (chosen) attachClusterToPoi(cluster, chosen);
            });
            actions.appendChild(select);
        }
    }

    // Comparer → ouvre le mode focus in-place (toujours actif si ≥ 1 photo)
    const compareBtn = document.createElement('button');
    compareBtn.className = 'pb-act is-primary';
    compareBtn.type = 'button';
    compareBtn.disabled = cluster.photos.length === 0;
    compareBtn.innerHTML = '<i data-lucide="layout-grid"></i><span>Comparer</span>';
    compareBtn.title = 'Comparer les photos de ce groupe';
    compareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        enterFocus(cluster);
    });
    actions.appendChild(compareBtn);

    // Export ZIP de ce groupe — icône download (= disque, ≠ « Enregistrer » dans l'app)
    const zipGroupBtn = document.createElement('button');
    zipGroupBtn.className = 'pb-act is-icon';
    zipGroupBtn.type = 'button';
    zipGroupBtn.disabled = cluster.photos.length === 0;
    zipGroupBtn.innerHTML = '<i data-lucide="download"></i>';
    zipGroupBtn.title = `Télécharger ce groupe en ZIP (${cluster.photos.length} photo(s))`;
    zipGroupBtn.setAttribute('aria-label', 'Télécharger ce groupe en ZIP');
    zipGroupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleExportClusterZip(cluster);
    });
    actions.appendChild(zipGroupBtn);

    head.appendChild(actions);
    section.appendChild(head);

    // --- GRID Sortable ---
    const grid = document.createElement('div');
    grid.className = 'pb-grid';
    grid.dataset.clusterId = cluster.id;

    cluster.photos.forEach((item) => {
        grid.appendChild(buildPhotoCard(item, cluster));
    });

    // Sortable (filter : on ne drag pas depuis les boutons, la pastille ou le label)
    new Sortable(grid, {
        group: 'photo-batch-shared',
        animation: 150,
        ghostClass: 'is-ghost',
        chosenClass: 'is-chosen',
        dragClass: 'is-dragging',
        delay: 80,
        delayOnTouchOnly: true,
        filter: '.pb-thumb-btn, .pb-thumb-label, .pb-thumb-pencil',
        preventOnFilter: false,
        onStart: () => { ignoreNextClick = true; },
        onEnd: (evt) => {
            handleMoveEnd(evt);
            // Laisser passer le click synthétique post-drag avant de réautoriser
            setTimeout(() => { ignoreNextClick = false; }, 0);
        }
    });

    section.appendChild(grid);
    return section;
}

function buildPhotoCard(item, cluster) {
    const thumb = document.createElement('article');
    thumb.className = 'pb-thumb';
    thumb.dataset.photoId = item.id;

    const img = document.createElement('img');
    img.className = 'pb-thumb-img';
    img.alt = item.file?.name || 'Photo';
    img.loading = 'lazy';
    img.draggable = false;
    if (item.base64) {
        img.src = item.base64;
    } else if (item.file) {
        resizeImage(item.file, 320)
            .then(dataUrl => { img.src = dataUrl; })
            .catch(() => { img.alt = 'Erreur miniature'; });
    }
    thumb.appendChild(img);

    // Actions par photo (top-right) : extraire + supprimer
    const acts = document.createElement('div');
    acts.className = 'pb-thumb-acts';
    if (cluster.type !== 'OUT_POI') {
        const extractBtn = document.createElement('button');
        extractBtn.className = 'pb-thumb-btn';
        extractBtn.type = 'button';
        extractBtn.title = 'Extraire vers Hors POI';
        extractBtn.setAttribute('aria-label', 'Extraire vers Hors POI');
        extractBtn.innerHTML = '<i data-lucide="route"></i>';
        extractBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            extractToOutPoi(item.id);
        });
        acts.appendChild(extractBtn);
    }
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'pb-thumb-btn is-danger';
    deleteBtn.type = 'button';
    deleteBtn.title = 'Supprimer cette photo';
    deleteBtn.setAttribute('aria-label', 'Supprimer');
    deleteBtn.innerHTML = '<i data-lucide="trash-2"></i>';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deletePhoto(item.id);
    });
    acts.appendChild(deleteBtn);
    thumb.appendChild(acts);

    // Label bas éditable — nom de fichier ZIP (feature préservée)
    const label = document.createElement('span');
    label.className = 'pb-thumb-label';
    label.contentEditable = 'true';
    label.spellcheck = false;
    label.textContent = item.customName || resolvePhotoAutoName(cluster, item);
    label.addEventListener('mousedown', (e) => e.stopPropagation());
    label.addEventListener('focus', () => selectAllText(label));
    label.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
    });
    label.addEventListener('blur', () => {
        const text = label.textContent.trim();
        const base = resolvePhotoAutoName(cluster, item);
        item.customName = (text && text !== base) ? text : null;
        if (!text) label.textContent = base;
    });
    thumb.appendChild(label);

    // Crayon décoratif (hint d'édition du nom) — hors flux du contenteditable
    const pencil = document.createElement('span');
    pencil.className = 'pb-thumb-pencil';
    pencil.setAttribute('aria-hidden', 'true');
    pencil.innerHTML = '<i data-lucide="pencil"></i>';
    thumb.appendChild(pencil);

    return thumb;
}

function renderBody() {
    const body = document.getElementById('photo-batch-body');
    if (!body) return;

    // Mode focus : ne rendre que le cluster focalisé. S'il a disparu (toutes
    // ses photos supprimées/détachées) → retour automatique à la vue d'ensemble.
    if (modalState.focus) {
        const fc = getFocusedCluster();
        if (!fc) { exitFocus(); return; }
        body.innerHTML = '';
        body.appendChild(renderFocus(fc));
        createIcons({ icons: appIcons, root: body });
        updateHeaderCounts();
        return;
    }

    body.innerHTML = '';
    if (modalState.clusters.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'photo-batch-empty';
        empty.innerHTML = '<i data-lucide="image-off"></i><p>Aucun cluster à afficher.</p>';
        body.appendChild(empty);
    } else {
        modalState.clusters.forEach((cluster, idx) => {
            body.appendChild(buildClusterSection(cluster, idx));
        });
    }

    createIcons({ icons: appIcons, root: body });
}

function updateHeaderCounts() {
    if (!modalState) return;
    const total = modalState.clusters.reduce((s, c) => s + c.photos.length, 0);
    const groups = modalState.clusters.length;
    const outPoi = modalState.clusters.filter(c => c.type === 'OUT_POI').length;

    const sub = document.getElementById('photo-batch-header-subtitle');
    if (sub) {
        if (modalState.focus) {
            const fc = getFocusedCluster();
            sub.textContent = `${modalState.focus.slotCount} emplacement(s) · ${fc ? fc.photos.length : 0} photo(s)`;
        } else {
            sub.textContent = `${total} photo(s) · ${groups} groupe(s)`;
        }
    }

    // Compteurs détaillés du footer (toujours le total global)
    const info = document.getElementById('photo-batch-footer-info');
    if (info) {
        info.innerHTML = `<b>${total}</b> photos · <b>${groups}</b> groupes`
            + (outPoi > 0 ? ` · <b>${outPoi}</b> hors POI` : '');
    }

    // Le bouton "Enregistrer" dépend de la présence de clusters rattachés à un POI.
    updateFooterButtons();
}

/**
 * Ouvre le modal batch photos avec drag-drop.
 * Refonte PLEIN ÉCRAN (handoff Claude Design) : openHwModal({ size: 'xl',
 * body, footer }) + classe `.is-photo-batch` posée sur l'overlay après
 * ouverture (cf. bind). Les compteurs / hint / pill sélection sont injectés
 * dans le header. La logique métier (Sortable, save, ZIP, créer POI, etc.) est
 * inchangée. Le « Comparer » d'un groupe bascule en mode focus in-place
 * (renderFocus). ESC : retour focus → overview, sinon fermeture.
 *
 * @param {Array} enrichedClusters — Array of { photos, center, nearbyPois, absoluteNearest }
 * @returns {Promise<null>} — resolve(null) à la fermeture
 */
export function openPhotoBatchModal(enrichedClusters) {
    return new Promise((resolve) => {
        activeResolve = resolve;
        modalState = { clusters: normalizeClusters(enrichedClusters) };

        const isAdmin = state.isAdmin;
        const hintText = isAdmin
            ? 'Mode admin — enregistrement en attente de publication CC'
            : 'Enregistrer rattache les photos aux POI ; le ZIP inclut tout';

        // Pas de subheader : les compteurs / hint / pill sont injectés dans le
        // header plein écran après ouverture (cf. bind ci-dessous).
        const body = `<div id="photo-batch-body" class="pb-body"></div>`;

        const footer = `
            <div class="pb-footer-info" id="photo-batch-footer-info"></div>
            <div class="pb-footer-actions">
                <button class="btn btn-ghost" id="photo-batch-btn-close" type="button">Fermer</button>
                <button class="btn btn-secondary" id="photo-batch-btn-zip" type="button" title="Exporter toutes les photos en archive ZIP sur le disque">
                    <i data-lucide="download"></i><span>Télécharger ZIP</span>
                </button>
                <button class="btn btn-primary" id="photo-batch-btn-save" type="button" title="Enregistrer les photos rattachées dans l'application">
                    <i data-lucide="cloud-upload"></i><span>Enregistrer</span>
                </button>
            </div>
        `;

        const promise = openHwModal({
            size: 'xl',
            icon: 'images',
            title: 'Traitement photos',
            body,
            footer,
            // Pas de fermeture spontanée : workflow long, beaucoup d'état mutable.
            closeOnBackdrop: false,
            // ESC géré manuellement : la lightbox doit pouvoir intercepter avant la modale.
            closeOnEscape: false,
        });

        // Bind après ouverture (DOM prêt)
        setTimeout(() => {
            // Marqueur sur l'overlay pour que handleCreatePoi puisse le masquer/restaurer
            // (RichEditor est en z-index 4000, < modale V2 100000 : il faut hide la modale).
            // + classe .is-photo-batch (plein écran) : ajoutée après openHwModal, comme
            // .is-photo-viewer (le moteur de modale ne prend pas de classe custom).
            const overlayEl = document.querySelector('.hw-modal-overlay.is-active');
            if (overlayEl) {
                overlayEl.id = 'photo-batch-overlay';
                overlayEl.classList.add('is-photo-batch');

                // Extras du header (compteurs / pill sélection / hint) injectés dans le
                // .hw-modal-header rendu par openHwModal (icône + titre + croix), avant la croix.
                const headerEl = overlayEl.querySelector('.hw-modal-header');
                const closeBtn = headerEl ? headerEl.querySelector('.hw-modal-close') : null;
                if (headerEl && closeBtn) {
                    closeBtn.insertAdjacentHTML('beforebegin', `
                        <span class="pb-header-counts" id="photo-batch-header-subtitle"></span>
                        <span class="pb-header-spacer"></span>
                        <span class="pb-header-hint">${hintText}</span>
                    `);
                    createIcons({ icons: appIcons, root: headerEl });
                }
            }

            const btnClose = document.getElementById('photo-batch-btn-close');
            const btnZip = document.getElementById('photo-batch-btn-zip');
            const btnSave = document.getElementById('photo-batch-btn-save');
            if (btnClose) btnClose.addEventListener('click', () => closeModal(null));
            if (btnZip) btnZip.addEventListener('click', handleExportZip);
            if (btnSave) btnSave.addEventListener('click', handleSave);

            updateHeaderCounts();
            renderBody();
        }, 30);

        // ESC : en mode focus → retour à la vue d'ensemble ; sinon → ferme la modale.
        keydownHandler = (e) => {
            if (e.key !== 'Escape') return;
            if (modalState && modalState.focus) { exitFocus(); return; }
            closeModal(null);
        };
        document.addEventListener('keydown', keydownHandler);

        // Cleanup à la fermeture (peu importe : croix V2, bouton Fermer, ESC)
        promise.then((result) => {
            if (keydownHandler) {
                document.removeEventListener('keydown', keydownHandler);
                keydownHandler = null;
            }
            releaseObjectUrls();
            releaseFocusUrls();
            modalState = null;
            if (activeResolve) {
                const r = activeResolve;
                activeResolve = null;
                r(result ?? null);
            }
        });
    });
}
