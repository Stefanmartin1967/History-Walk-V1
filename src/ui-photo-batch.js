// Phase 2 — Modal plein écran avec drag-drop et extraction vers Hors POI.
// Reprend la logique Photo-Manager : Sortable.js pour le drag inter-clusters,
// bouton "Extraire vers Hors POI" pour isoler une photo (split si milieu).
// Les phases suivantes ajouteront la publication, le ZIP et le nouveau lieu.

import Sortable from 'sortablejs';
import { resizeImage } from './utils.js';
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
import { showPrompt } from './modal.js';
import { createZipBlob } from './zip-store.js';

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
    const overlay = document.getElementById('photo-batch-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 200);
    }
    if (keydownHandler) {
        document.removeEventListener('keydown', keydownHandler);
        keydownHandler = null;
    }
    releaseObjectUrls();
    modalState = null;
    if (activeResolve) {
        const resolve = activeResolve;
        activeResolve = null;
        resolve(result);
    }
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
            selectedPhotoIds: new Set()
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
    loc.cluster.selectedPhotoIds?.delete(photoId);
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
//        created: true → retire le cluster de modalState ; ferme photo-batch si vide
//        created: false (annulation) → restaure photo-batch tel quel
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

    // Masque la modale photo-batch le temps du RichEditor
    const overlay = document.getElementById('photo-batch-overlay');
    const prevDisplay = overlay?.style.display;
    if (overlay) overlay.style.display = 'none';

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

    if (result.created) {
        // POI créé : retire le cluster, photos déjà attachées par executeCreate → addPhotosToPoi
        modalState.clusters = modalState.clusters.filter(c => c !== cluster);

        if (modalState.clusters.length === 0) {
            // Plus rien à traiter → ferme photo-batch, pas besoin de la restaurer
            closeModal({ completed: true, createdPoiId: result.poiId });
            return;
        }
    }

    // Restaure photo-batch (annulation OU création avec d'autres clusters restants)
    if (overlay) overlay.style.display = prevDisplay || 'flex';

    if (result.created) {
        renderBody();
        updateHeaderCounts();
        updateFooterButtons();
    }
}

// Rattache un cluster au POI le plus proche connu (absoluteNearest).
// Si un autre cluster porte déjà ce POI, on fusionne les deux.
function handleAttachToNearest(cluster) {
    if (!cluster.absoluteNearest) return;
    const newPoi = cluster.absoluteNearest;
    const newPoiId = getPoiId(newPoi.feature);

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
        cluster.nearbyPois = [newPoi];
        cluster.absoluteNearest = null;
        cluster.customName = null;
    }

    renderBody();
    updateHeaderCounts();
}

// Toggle sélection d'une photo au sein de son cluster (max 4 par cluster)
function togglePhotoSelection(cluster, photoId) {
    if (cluster.selectedPhotoIds.has(photoId)) {
        cluster.selectedPhotoIds.delete(photoId);
    } else {
        if (cluster.selectedPhotoIds.size >= 4) {
            // Max atteint : on ne peut pas en cocher plus
            return false;
        }
        cluster.selectedPhotoIds.add(photoId);
    }
    return true;
}

// Ouvre la lightbox "Voir / Comparer" pour les photos sélectionnées d'un cluster.
// 1 photo → plein écran single ; 2-4 photos → grid adaptative.
let lightboxKeydown = null;
function closeLightbox() {
    const lb = document.getElementById('photo-batch-lightbox');
    if (lb) {
        lb.classList.remove('active');
        setTimeout(() => lb.remove(), 200);
    }
    if (lightboxKeydown) {
        document.removeEventListener('keydown', lightboxKeydown);
        lightboxKeydown = null;
    }
}

function openLightbox(cluster) {
    const photoIds = [...cluster.selectedPhotoIds];
    if (photoIds.length === 0 || photoIds.length > 4) return;

    // Résoudre les photo objects dans l'ordre du cluster (pas l'ordre de sélection)
    const photos = cluster.photos.filter(p => cluster.selectedPhotoIds.has(p.id));
    const count = photos.length;

    // Retirer lightbox précédente si besoin
    document.getElementById('photo-batch-lightbox')?.remove();

    const lb = document.createElement('div');
    lb.id = 'photo-batch-lightbox';
    lb.className = 'photo-batch-lightbox';

    const header = document.createElement('div');
    header.className = 'photo-batch-lightbox-header';
    const h = document.createElement('p');
    h.className = 'photo-batch-lightbox-title';
    h.textContent = count === 1 ? 'Voir' : `Comparer (${count})`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'photo-batch-lightbox-close';
    closeBtn.setAttribute('aria-label', 'Fermer');
    closeBtn.innerHTML = '<i data-lucide="x"></i>';
    closeBtn.addEventListener('click', closeLightbox);
    header.appendChild(h);
    header.appendChild(closeBtn);

    const grid = document.createElement('div');
    grid.className = 'photo-batch-lightbox-grid';
    grid.dataset.count = String(count);

    photos.forEach(item => {
        const cell = document.createElement('div');
        cell.className = 'photo-batch-lightbox-cell';

        const img = document.createElement('img');
        img.alt = item.file?.name || 'Photo';
        // Priorité : File original (pleine qualité) > base64 vignette (fallback admin review)
        // Le base64 pré-calculé à l'import est compressé à 200px pour la thumbnail,
        // donc inutilisable pour une vraie comparaison visuelle.
        if (item.file) {
            const url = URL.createObjectURL(item.file);
            activeObjectUrls.push(url);
            img.src = url;
        } else if (item.base64) {
            img.src = item.base64;
        }
        cell.appendChild(img);

        // Bandeau d'actions en overlay bas : [nom éditable] [✓ valider] [⇄ détacher] [🗑 supprimer]
        const actionBar = document.createElement('div');
        actionBar.className = 'photo-batch-lightbox-cell-bar';

        const nameInput = document.createElement('span');
        nameInput.className = 'photo-batch-lightbox-cell-name';
        nameInput.contentEditable = 'true';
        nameInput.spellcheck = false;
        nameInput.textContent = item.customName || resolvePhotoAutoName(cluster, item);
        nameInput.addEventListener('mousedown', (e) => e.stopPropagation());
        nameInput.addEventListener('focus', () => selectAllText(nameInput));
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); nameInput.blur(); }
        });
        nameInput.addEventListener('blur', () => {
            const text = nameInput.textContent.trim();
            const base = resolvePhotoAutoName(cluster, item);
            const newCustom = (text && text !== base) ? text : null;
            const changed = newCustom !== item.customName;
            item.customName = newCustom;
            if (!text) nameInput.textContent = base;
            // Re-render la modale en arrière-plan pour synchroniser le label miniature
            // (invisible car couvert par le lightbox, mais à jour à la fermeture).
            if (changed) renderBody();
        });
        actionBar.appendChild(nameInput);

        const btnGroup = document.createElement('div');
        btnGroup.className = 'photo-batch-lightbox-cell-actions';

        // ✓ Valider — retire de la sélection (la photo reste dans le cluster)
        const validateBtn = document.createElement('button');
        validateBtn.className = 'photo-batch-lightbox-cell-btn validate';
        validateBtn.title = 'Valider (retirer de la comparaison)';
        validateBtn.setAttribute('aria-label', 'Valider');
        validateBtn.innerHTML = '<i data-lucide="check"></i>';
        validateBtn.addEventListener('click', () => {
            cluster.selectedPhotoIds.delete(item.id);
            if (cluster.selectedPhotoIds.size === 0) {
                renderBody();
                updateHeaderCounts();
                closeLightbox();
            } else {
                renderBody();
                updateHeaderCounts();
                openLightbox(cluster);
            }
        });
        btnGroup.appendChild(validateBtn);

        // ⇄ Détacher — extrait vers nouveau OUT_POI, on reste dans le lightbox
        if (cluster.type !== 'OUT_POI') {
            const extractBtn = document.createElement('button');
            extractBtn.className = 'photo-batch-lightbox-cell-btn extract';
            extractBtn.title = 'Détacher vers Hors POI';
            extractBtn.setAttribute('aria-label', 'Détacher');
            extractBtn.innerHTML = '<i data-lucide="route"></i>';
            extractBtn.addEventListener('click', () => {
                cluster.selectedPhotoIds.delete(item.id);
                extractToOutPoi(item.id);
                if (cluster.selectedPhotoIds.size === 0 && cluster.photos.length === 0) {
                    closeLightbox();
                } else if (cluster.selectedPhotoIds.size === 0) {
                    closeLightbox();
                } else {
                    openLightbox(cluster);
                }
            });
            btnGroup.appendChild(extractBtn);
        }

        // 🗑 Supprimer — supprime la photo du cluster
        const delBtn = document.createElement('button');
        delBtn.className = 'photo-batch-lightbox-cell-btn delete';
        delBtn.title = 'Supprimer cette photo';
        delBtn.setAttribute('aria-label', 'Supprimer');
        delBtn.innerHTML = '<i data-lucide="trash-2"></i>';
        delBtn.addEventListener('click', () => {
            cluster.selectedPhotoIds.delete(item.id);
            deletePhoto(item.id);
            if (cluster.selectedPhotoIds.size === 0) {
                closeLightbox();
            } else {
                openLightbox(cluster);
            }
        });
        btnGroup.appendChild(delBtn);

        actionBar.appendChild(btnGroup);
        cell.appendChild(actionBar);

        grid.appendChild(cell);
    });

    lb.appendChild(header);
    lb.appendChild(grid);

    // Pellicule de pagination : si le cluster a plus de photos que la sélection affichée,
    // on propose une bande de vignettes pour swap sans revenir à la modale.
    if (cluster.photos.length > count) {
        const strip = document.createElement('div');
        strip.className = 'photo-batch-lightbox-strip';

        cluster.photos.forEach(p => {
            const thumb = document.createElement('button');
            thumb.className = 'photo-batch-lightbox-strip-thumb';
            if (cluster.selectedPhotoIds.has(p.id)) thumb.classList.add('selected');
            thumb.title = p.customName || resolvePhotoAutoName(cluster, p);

            const tImg = document.createElement('img');
            tImg.alt = '';
            if (p.base64) {
                tImg.src = p.base64;
            } else if (p.file) {
                resizeImage(p.file, 120)
                    .then(dataUrl => { tImg.src = dataUrl; })
                    .catch(() => {});
            }
            thumb.appendChild(tImg);

            thumb.addEventListener('click', () => {
                if (cluster.selectedPhotoIds.has(p.id)) {
                    // Déjà dans la comparaison → retirer (équivalent ✓ valider)
                    if (cluster.selectedPhotoIds.size <= 1) return; // garde au moins 1
                    cluster.selectedPhotoIds.delete(p.id);
                } else {
                    // Ajouter : si déjà 4, retirer la plus ancienne (FIFO)
                    if (cluster.selectedPhotoIds.size >= 4) {
                        const oldest = cluster.selectedPhotoIds.values().next().value;
                        cluster.selectedPhotoIds.delete(oldest);
                    }
                    cluster.selectedPhotoIds.add(p.id);
                }
                renderBody();
                updateHeaderCounts();
                openLightbox(cluster);
            });

            strip.appendChild(thumb);
        });

        lb.appendChild(strip);
    }

    document.body.appendChild(lb);

    lightboxKeydown = (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            closeLightbox();
        }
    };
    document.addEventListener('keydown', lightboxKeydown);

    requestAnimationFrame(() => {
        lb.classList.add('active');
        createIcons({ icons: appIcons });
    });
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

    // La photo change de cluster : purger la sélection du cluster source (si présente)
    loc.cluster.selectedPhotoIds?.delete(photoId);

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
    cluster.selectedPhotoIds?.delete(photoId);

    const newOut = {
        id: uid('c'),
        type: 'OUT_POI',
        photos: [photo],
        center: null,
        nearbyPois: [],
        absoluteNearest: null,
        selectedPhotoIds: new Set()
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
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
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

// Met à jour l'état disabled du bouton Enregistrer selon la présence de clusters rattachés.
function updateFooterButtons() {
    const saveBtn = document.getElementById('photo-batch-btn-save');
    if (!saveBtn || !modalState) return;
    const hasAttached = modalState.clusters.some(c =>
        c.type !== 'OUT_POI' && c.nearbyPois && c.nearbyPois.length > 0
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

        // Sépare clusters éligibles vs Hors POI (ignorés)
        const poiClusters = modalState.clusters.filter(c =>
            c.type !== 'OUT_POI' && c.nearbyPois && c.nearbyPois.length > 0
        );
        const outPoiCount = modalState.clusters.length - poiClusters.length;

        if (poiClusters.length === 0) {
            showToast("Aucun cluster rattaché à un POI. Rattache au moins un lieu avant d'enregistrer.", 'warning');
            return;
        }

        let totalPhotos = 0;
        for (const cluster of poiClusters) {
            const poiId = getPoiId(cluster.nearbyPois[0].feature);
            if (!poiId) continue;

            // Compression en parallèle pour ce cluster
            const blobItems = await Promise.all(
                cluster.photos
                    .filter(p => p.file)
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
    const attached = clusters.filter(c =>
        c.type !== 'OUT_POI' && c.nearbyPois && c.nearbyPois.length > 0
    );

    if (attached.length === 0) {
        const today = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `Photos Djerba ${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    }

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
    section.className = 'photo-batch-cluster';
    section.dataset.clusterId = cluster.id;
    section.dataset.clusterIndex = String(index);

    if (cluster.type === 'OUT_POI') section.classList.add('out-poi');

    // Header
    const header = document.createElement('div');
    header.className = 'photo-batch-cluster-header';

    const titleBlock = document.createElement('div');
    titleBlock.className = 'photo-batch-cluster-title-block';

    const title = document.createElement('h3');
    title.className = 'photo-batch-cluster-title';
    title.contentEditable = 'true';
    title.spellcheck = false;

    const subtitle = document.createElement('p');
    subtitle.className = 'photo-batch-cluster-subtitle';

    // Résout le nom affiché : customName prioritaire sur auto
    const autoName = resolveAutoName(cluster);
    title.textContent = cluster.customName || autoName;

    // Sous-titre contextuel
    // Priorité : nearbyPois (POI rattaché) > absoluteNearest (info "plus proche") > générique
    // Même sur OUT_POI, on veut afficher le POI le plus proche s'il existe — ça aide
    // l'utilisateur à décider s'il rattache ou s'il crée un nouveau lieu.
    if (cluster.nearbyPois && cluster.nearbyPois.length > 0) {
        const best = cluster.nearbyPois[0];
        subtitle.textContent = `POI proche à ${Math.round(best.dist)} m — ${cluster.photos.length} photo(s)`;
        section.dataset.suggestedPoiId = getPoiId(best.feature) || '';
    } else if (cluster.absoluteNearest) {
        const n = cluster.absoluteNearest;
        subtitle.textContent = `Plus proche : ${getPoiName(n.feature) || '(sans nom)'} à ${Math.round(n.dist)} m — ${cluster.photos.length} photo(s)`;
        section.dataset.suggestedPoiId = '';
    } else {
        subtitle.textContent = `${cluster.photos.length} photo(s) — aucun POI chargé à proximité`;
        section.dataset.suggestedPoiId = '';
    }

    // Handlers du renommage
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

    titleBlock.appendChild(title);
    titleBlock.appendChild(subtitle);

    // Barre d'actions (rattacher / créer / comparer)
    const actions = document.createElement('div');
    actions.className = 'photo-batch-cluster-actions';

    const hasNearbyPoi = cluster.nearbyPois && cluster.nearbyPois.length > 0;
    const hasAbsoluteNearest = !!cluster.absoluteNearest;

    // Rattacher au POI le plus proche : visible sur tout cluster sans POI rattaché
    // (POI orphelin OU OUT_POI) si un absoluteNearest existe. Utile pour POI à >100m.
    if (!hasNearbyPoi && hasAbsoluteNearest) {
        const nearestName = getPoiName(cluster.absoluteNearest.feature) || 'ce POI';
        const attachBtn = document.createElement('button');
        attachBtn.className = 'photo-batch-cluster-btn';
        attachBtn.innerHTML = `<i data-lucide="link"></i><span>Rattacher à ${nearestName}</span>`;
        attachBtn.title = `Rattacher ces photos au POI le plus proche (${Math.round(cluster.absoluteNearest.dist)} m)`;
        attachBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleAttachToNearest(cluster);
        });
        actions.appendChild(attachBtn);
    }

    // Créer un nouveau lieu : visible sur tout cluster sans POI rattaché.
    // OUT_POI couvre deux cas d'usage symétriques :
    //  - vraiment pas un POI (panorama, végétation) → l'utilisateur ignore le bouton
    //  - POI "à créer" découvert pendant la balade → l'utilisateur clique
    if (!hasNearbyPoi) {
        const createBtn = document.createElement('button');
        createBtn.className = 'photo-batch-cluster-btn photo-batch-cluster-create-btn';
        createBtn.innerHTML = '<i data-lucide="map-pin-plus"></i><span>Créer un lieu</span>';
        createBtn.title = 'Créer un nouveau POI avec ces photos';
        createBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleCreatePoi(cluster);
        });
        actions.appendChild(createBtn);
    }

    // Voir / Comparer (visible toujours, désactivé si 0 sélection)
    const compareBtn = document.createElement('button');
    compareBtn.className = 'photo-batch-cluster-btn photo-batch-cluster-compare-btn';
    const selCount = cluster.selectedPhotoIds.size;
    compareBtn.disabled = selCount === 0;
    const compareLabel = selCount === 1 ? 'Voir (1)'
        : selCount >= 2 ? `Comparer (${selCount})`
        : 'Voir / Comparer';
    const compareIcon = selCount === 1 ? 'maximize-2' : 'layout-grid';
    compareBtn.innerHTML = `<i data-lucide="${compareIcon}"></i><span>${compareLabel}</span>`;
    compareBtn.title = 'Sélectionnez 1 à 4 photos pour les voir en grand';
    compareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(cluster);
    });
    actions.appendChild(compareBtn);

    // Export ZIP de ce groupe (toujours visible si au moins 1 photo)
    const zipGroupBtn = document.createElement('button');
    zipGroupBtn.className = 'photo-batch-cluster-btn photo-batch-cluster-zip-btn';
    zipGroupBtn.disabled = cluster.photos.length === 0;
    zipGroupBtn.innerHTML = '<i data-lucide="save"></i>';
    zipGroupBtn.title = `Télécharger ce groupe en ZIP (${cluster.photos.length} photo(s))`;
    zipGroupBtn.setAttribute('aria-label', 'Télécharger ce groupe en ZIP');
    zipGroupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleExportClusterZip(cluster);
    });
    actions.appendChild(zipGroupBtn);

    titleBlock.appendChild(actions);

    const badge = document.createElement('span');
    badge.className = 'photo-batch-cluster-badge';
    if (cluster.type === 'OUT_POI') {
        badge.classList.add('out-poi');
        badge.textContent = 'Hors POI';
    } else {
        badge.textContent = `Groupe ${index + 1}`;
    }

    header.appendChild(titleBlock);
    header.appendChild(badge);
    section.appendChild(header);

    // Grid Sortable
    const grid = document.createElement('div');
    grid.className = 'photo-batch-thumb-grid';
    grid.dataset.clusterId = cluster.id;

    cluster.photos.forEach((item) => {
        grid.appendChild(buildPhotoCard(item, cluster));
    });

    // Sortable sur chaque grid (filter : on ne drag pas depuis les boutons ou le contenteditable)
    new Sortable(grid, {
        group: 'photo-batch-shared',
        animation: 150,
        ghostClass: 'photo-batch-thumb-ghost',
        chosenClass: 'photo-batch-thumb-chosen',
        dragClass: 'photo-batch-thumb-drag',
        delay: 80,
        delayOnTouchOnly: true,
        filter: '.photo-batch-thumb-action, .photo-batch-thumb-delete, .photo-batch-thumb-label',
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
    const thumb = document.createElement('div');
    thumb.className = 'photo-batch-thumb';
    thumb.dataset.photoId = item.id;
    if (cluster.selectedPhotoIds.has(item.id)) {
        thumb.classList.add('selected');
    }

    // Clic sur la vignette = toggle sélection (ignoré si drag Sortable vient de se terminer)
    thumb.addEventListener('click', (e) => {
        if (ignoreNextClick) return;
        // Ignorer les clics provenant des boutons/label (ils ont leur propre handler)
        if (e.target.closest('.photo-batch-thumb-action, .photo-batch-thumb-delete, .photo-batch-thumb-label')) return;
        const ok = togglePhotoSelection(cluster, item.id);
        if (!ok) {
            // Toast visuel léger : on flashe brièvement l'outline rouge via une classe
            thumb.animate([
                { outline: '3px solid #991B1B', outlineOffset: '-3px' },
                { outline: '0 solid transparent', outlineOffset: '0' }
            ], { duration: 400 });
            return;
        }
        // Mise à jour visuelle ciblée sans re-render complet (garde le scroll/focus)
        thumb.classList.toggle('selected', cluster.selectedPhotoIds.has(item.id));
        updateClusterCompareBtn(cluster);
    });

    const img = document.createElement('img');
    img.alt = item.file?.name || 'Photo';
    img.loading = 'lazy';
    img.draggable = false;

    if (item.base64) {
        img.src = item.base64;
    } else if (item.file) {
        resizeImage(item.file, 200)
            .then(dataUrl => { img.src = dataUrl; })
            .catch(() => { img.alt = 'Erreur miniature'; });
    }
    thumb.appendChild(img);

    // Badge check (visible uniquement via .selected)
    const checkBadge = document.createElement('span');
    checkBadge.className = 'photo-batch-thumb-check';
    checkBadge.innerHTML = '<i data-lucide="check"></i>';
    thumb.appendChild(checkBadge);

    // Bouton "Supprimer" (poubelle) — toujours visible
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'photo-batch-thumb-delete';
    deleteBtn.title = 'Supprimer cette photo';
    deleteBtn.setAttribute('aria-label', 'Supprimer');
    deleteBtn.innerHTML = '<i data-lucide="trash-2"></i>';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deletePhoto(item.id);
    });
    thumb.appendChild(deleteBtn);

    // Bouton "Extraire vers Hors POI" (sauf déjà dans OUT_POI)
    if (cluster.type !== 'OUT_POI') {
        const extractBtn = document.createElement('button');
        extractBtn.className = 'photo-batch-thumb-action';
        extractBtn.title = 'Extraire vers Hors POI';
        extractBtn.setAttribute('aria-label', 'Extraire vers Hors POI');
        extractBtn.innerHTML = '<i data-lucide="route"></i>';
        extractBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            extractToOutPoi(item.id);
        });
        thumb.appendChild(extractBtn);
    }

    // Nom fichier (label bas) — éditable pour personnaliser le nom ZIP
    const label = document.createElement('span');
    label.className = 'photo-batch-thumb-label';
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

    return thumb;
}

function renderBody() {
    const body = document.getElementById('photo-batch-body');
    if (!body) return;
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

    createIcons({ icons: appIcons });
}

function updateHeaderCounts() {
    const total = modalState.clusters.reduce((s, c) => s + c.photos.length, 0);
    const sub = document.getElementById('photo-batch-header-subtitle');
    if (sub) sub.textContent = `${total} photo(s) · ${modalState.clusters.length} groupe(s)`;
    // Le bouton "Enregistrer" dépend de la présence de clusters rattachés à un POI.
    updateFooterButtons();
}

// Met à jour le bouton "Voir / Comparer" d'un cluster sans re-render complet
function updateClusterCompareBtn(cluster) {
    const section = document.querySelector(`.photo-batch-cluster[data-cluster-id="${cluster.id}"]`);
    if (!section) return;
    const btn = section.querySelector('.photo-batch-cluster-compare-btn');
    if (!btn) return;
    const n = cluster.selectedPhotoIds.size;
    btn.disabled = n === 0;
    const label = n === 1 ? 'Voir (1)' : n >= 2 ? `Comparer (${n})` : 'Voir / Comparer';
    const icon = n === 1 ? 'maximize-2' : 'layout-grid';
    btn.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
    createIcons({ icons: appIcons });
}

/**
 * Ouvre le modal batch photos avec drag-drop (Phase 2).
 *
 * @param {Array} enrichedClusters — Array of { photos, center, nearbyPois, absoluteNearest }
 * @returns {Promise<null>} — resolve(null) à la fermeture
 */
export function openPhotoBatchModal(enrichedClusters) {
    return new Promise((resolve) => {
        const existing = document.getElementById('photo-batch-overlay');
        if (existing) existing.remove();

        activeResolve = resolve;
        modalState = { clusters: normalizeClusters(enrichedClusters) };

        const overlay = document.createElement('div');
        overlay.id = 'photo-batch-overlay';
        overlay.className = 'photo-batch-overlay';

        const container = document.createElement('div');
        container.className = 'photo-batch-container';

        // --- HEADER ---
        const header = document.createElement('header');
        header.className = 'photo-batch-header';

        const titleBlock = document.createElement('div');
        titleBlock.className = 'photo-batch-header-title-block';

        const title = document.createElement('h2');
        title.className = 'photo-batch-header-title';
        title.textContent = 'Traitement photos';

        const subtitle = document.createElement('p');
        subtitle.id = 'photo-batch-header-subtitle';
        subtitle.className = 'photo-batch-header-subtitle';

        titleBlock.appendChild(title);
        titleBlock.appendChild(subtitle);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'photo-batch-close-btn';
        closeBtn.setAttribute('aria-label', 'Fermer');
        closeBtn.innerHTML = '<i data-lucide="x"></i>';
        closeBtn.addEventListener('click', () => closeModal(null));

        header.appendChild(titleBlock);
        header.appendChild(closeBtn);
        container.appendChild(header);

        // --- BODY (scroll area) ---
        const body = document.createElement('div');
        body.id = 'photo-batch-body';
        body.className = 'photo-batch-body';
        container.appendChild(body);

        // --- FOOTER ---
        const footer = document.createElement('footer');
        footer.className = 'photo-batch-footer';

        const hint = document.createElement('span');
        hint.className = 'photo-batch-footer-hint';
        hint.textContent = state.isAdmin
            ? 'Mode admin — enregistrement en attente de publication CC'
            : 'Enregistrer rattache les photos aux POI ; le ZIP inclut tout';

        const btnGroup = document.createElement('div');
        btnGroup.className = 'photo-batch-footer-actions';

        const btnZip = document.createElement('button');
        btnZip.id = 'photo-batch-btn-zip';
        btnZip.className = 'photo-batch-btn photo-batch-btn-secondary';
        btnZip.textContent = 'ZIP';
        btnZip.title = 'Exporter toutes les photos en ZIP';
        btnZip.addEventListener('click', handleExportZip);

        const btnClose = document.createElement('button');
        btnClose.className = 'photo-batch-btn photo-batch-btn-secondary';
        btnClose.textContent = 'Fermer';
        btnClose.addEventListener('click', () => closeModal(null));

        const btnSave = document.createElement('button');
        btnSave.id = 'photo-batch-btn-save';
        btnSave.className = 'photo-batch-btn photo-batch-btn-primary';
        btnSave.textContent = 'Enregistrer';
        btnSave.addEventListener('click', handleSave);

        btnGroup.appendChild(btnClose);
        btnGroup.appendChild(btnZip);
        btnGroup.appendChild(btnSave);

        footer.appendChild(hint);
        footer.appendChild(btnGroup);
        container.appendChild(footer);

        overlay.appendChild(container);
        document.body.appendChild(overlay);

        // Render initial
        updateHeaderCounts();
        renderBody();

        keydownHandler = (e) => {
            if (e.key !== 'Escape') return;
            // Si la lightbox est ouverte, c'est elle qui doit se fermer d'abord
            if (document.getElementById('photo-batch-lightbox')) return;
            closeModal(null);
        };
        document.addEventListener('keydown', keydownHandler);

        requestAnimationFrame(() => {
            overlay.classList.add('active');
            if (window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
            }
        });
    });
}
