// Phase 2 — Modal plein écran avec drag-drop et extraction vers Hors POI.
// Reprend la logique Photo-Manager : Sortable.js pour le drag inter-clusters,
// bouton "Extraire vers Hors POI" pour isoler une photo (split si milieu).
// Les phases suivantes ajouteront la publication, le ZIP et le nouveau lieu.

import Sortable from 'sortablejs';
import { resizeImage, calculateDistance, openPoiOnMap, openCoordsOnMap, getPoiProp, isPoiMalCategorized, sha256OfFile } from './utils.js';
import { getPoiName, getPoiId } from './data.js';
import { getSearchResults } from './search.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { state } from './state.js';
import {
    savePoiPhotos,
    setPendingAdminPhotos,
    getPoiPhotos,
    getPendingAdminPhotos,
    savePoiData,
} from './database.js';
import { showToast } from './toast.js';
import { showPrompt, openHwModal, closeHwModal, suspendHwModal, resumeHwModal, hwConfirm } from './modal.js';
import { createZipBlob } from './zip-store.js';
import { compressImage, PUBLISH_COMPRESSION } from './photo-service.js';
import { getCategoryLabels, getSubtypes, getStates, getAccessValues } from './taxonomy.js';
import { eventBus } from './events.js';
import { configureHelp, helpButton, helpInline, closeHelp } from './help-popover.js';
import { isHeicFile } from './heic.js';
import { GUIDE_IMPORT, HELP_FORMAT, HELP_DISTANCE, HELP_HORS_POI, HELP_CREATE, HELP_NAMING, HELP_COMPARE } from './help-content.js';

// Patron d'aide « ? » (réutilisable) : on branche le rendu d'icônes sur le
// système Lucide de l'app, une seule fois. L'icône « ? » = circle-help (déjà
// dans appIcons). configureHelp est idempotent.
configureHelp({ renderIcons: (root) => createIcons({ icons: appIcons, root }) });

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

// --- GARDE-FOU FERMETURE (#A : ne pas perdre un tri en silence) ---
// Y a-t-il du tri non enregistré dans l'app ? (≥ 1 photo pas encore alreadySaved).
// Le ZIP ne compte PAS comme « enregistré » : c'est un backup disque, l'organisation
// en cours reste transitoire tant qu'on n'a pas « Enregistré » dans l'app.
function hasUnsavedSession() {
    return !!(modalState && modalState.clusters
        && modalState.clusters.some(c => c.photos.some(p => !p.alreadySaved)));
}

// beforeunload dédié à la modale d'import (≠ flag global state.hasUnexportedChanges :
// on évite d'écraser un « non publié » applicatif réel). Couvre rafraîchir /
// fermer l'onglet pendant un tri. Retiré à la fermeture de la modale.
function importBeforeUnload(e) {
    if (hasUnsavedSession()) { e.preventDefault(); e.returnValue = ''; }
}

// Fermeture demandée (croix, bouton Fermer, Échap) : confirme si du tri serait
// perdu. suspend/resume autour de hwConfirm (sinon openHwModal fermerait la
// modale d'import par sa garde anti-empilement — cf. correctif ZIP).
let closeGuardBusy = false;
async function requestClose() {
    if (closeGuardBusy) return;
    if (!hasUnsavedSession()) { closeModal(null); return; }
    closeGuardBusy = true;
    suspendHwModal();
    let ok = false;
    try {
        ok = await hwConfirm({
            title: 'Fermer sans enregistrer ?',
            body: "Des photos de ce tri ne sont pas encore enregistrées dans l'application. "
                + "Si vous fermez, ce tri sera perdu. (Un ZIP déjà téléchargé reste, lui, sur votre disque.)",
            confirmLabel: 'Fermer sans enregistrer',
            cancelLabel: 'Continuer le tri',
            danger: true,
        });
    } finally {
        resumeHwModal();
        closeGuardBusy = false;
    }
    if (ok) closeModal(null);
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
            noGps: !!c.noGps,
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
    if (cluster.noGps) return 'Sans position';
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
        // double-save (un re-encodage produirait un blob non identique — la dédup par
        // taille dans addPhotosToPoi ne le détecterait pas).
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

// === Catégorisation au batch (chantier enrichissement photo 01/06/2026) ===
// Deux boutons sur la barre cluster pour les POIs rattachés :
//   - « Catégoriser » → popover compacte 4 selects (cf. openCategorizationPopover)
//   - « Éditer la fiche » → ouvre le RichEditor complet (cf. handleEditPoi)
// Photos sous les yeux = bon moment pour catégoriser ET pour décrire les POIs
// marquants. Deux rythmes assumés : batch rapide vs édition riche, au choix
// pour chaque POI.

// (isPoiMalCategorized vit dans utils.js pour rester testable sans jsdom.)

// Tooltip du bouton « Catégoriser » : montre la cat courante (ou un appel à
// catégoriser) — repérable au survol même sans cliquer.
function categorizeTooltip(feature) {
    if (isPoiMalCategorized(feature)) return 'Non catégorisé — cliquer pour définir';
    const parts = ['Catégorie : ' + getPoiProp(feature, 'Catégorie')];
    const st = getPoiProp(feature, 'Sous-type');
    if (st) parts.push(st);
    return parts.join(' · ');
}

// Persiste un batch de champs taxonomie sur un POI (Catégorie / Sous-type /
// État / Accès). Pattern atomique réutilisé de executeEdit (richEditor.js) :
// userData merge → savePoiData unique → event admin:poi-edited unique →
// schedulePush unique → applyFilters + refresh markers. Évite les 4 toasts
// successifs de updatePoiData(key,value) appelée en série.
async function saveTaxonomyBatch(poiId, fields) {
    if (!state.userData[poiId]) state.userData[poiId] = {};
    Object.assign(state.userData[poiId], fields);

    // Rebind invariant : feature.properties.userData === state.userData[poiId]
    // (cf. architecture_decisions invariant userData).
    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    if (feature) feature.properties.userData = state.userData[poiId];

    await savePoiData(state.currentMapId, poiId, state.userData[poiId]);

    if (state.isAdmin) {
        // Notifie le CC Admin (alimente la diff) — découplage par eventBus.
        eventBus.emit('admin:poi-edited', { id: poiId, type: 'update' });
    }

    // Sync Gist debounced + refresh affichage carte (catégorie change → icône
    // change → la passe markers doit redessiner). Import dynamique anti-cycle.
    const dataMod = await import('./data.js');
    if (typeof dataMod.schedulePush === 'function') dataMod.schedulePush();
    dataMod.applyFilters();
    const mapMod = await import('./map.js');
    mapMod.refreshMapMarkers(dataMod.getFilteredFeatures());
}

// Ouvre une popover compacte ancrée sur `anchorEl` avec 4 selects (Catégorie,
// Sous-type, État, Accès). Préremplie avec les valeurs actuelles du POI (y
// compris déjà catégorisé — pour permettre une correction). Enregistre via
// saveTaxonomyBatch puis appelle onSaved() pour rafraîchir le badge du bouton.
function openCategorizationPopover(feature, anchorEl, onSaved) {
    // Ferme une popover éventuellement déjà ouverte (toggle si rebouton).
    const existing = document.querySelector('.pb-cat-popover');
    if (existing) {
        existing.remove();
        document.removeEventListener('keydown', existing._escHandler);
        document.removeEventListener('mousedown', existing._outsideHandler);
        return;
    }

    const poiId = getPoiId(feature);
    const initial = {
        cat: getPoiProp(feature, 'Catégorie') || '',
        sub: getPoiProp(feature, 'Sous-type') || '',
        etat: getPoiProp(feature, 'État') || '',
        acces: getPoiProp(feature, 'Accès') || '',
    };

    const pop = document.createElement('div');
    pop.className = 'pb-cat-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Catégoriser le lieu');
    pop.innerHTML = `
        <div class="pb-cat-pop-head">
            <span class="pb-cat-pop-title">Catégoriser</span>
            <button type="button" class="pb-cat-pop-close" aria-label="Fermer"><i data-lucide="x"></i></button>
        </div>
        <div class="pb-cat-pop-body">
            <label class="pb-cat-field">
                <span>Catégorie</span>
                <select data-field="cat"></select>
            </label>
            <label class="pb-cat-field" data-group="sub">
                <span>Sous-type</span>
                <select data-field="sub"></select>
            </label>
            <label class="pb-cat-field" data-group="etat">
                <span>État</span>
                <select data-field="etat"></select>
            </label>
            <label class="pb-cat-field" data-group="acces">
                <span>Accès</span>
                <select data-field="acces"></select>
            </label>
        </div>
        <div class="pb-cat-pop-footer">
            <button type="button" class="pb-act" data-action="cancel">Annuler</button>
            <button type="button" class="pb-act is-primary" data-action="save"><i data-lucide="save"></i><span>Enregistrer</span></button>
        </div>
    `;
    document.body.appendChild(pop);

    const selCat = pop.querySelector('[data-field="cat"]');
    const selSub = pop.querySelector('[data-field="sub"]');
    const selEtat = pop.querySelector('[data-field="etat"]');
    const selAcces = pop.querySelector('[data-field="acces"]');

    // Peuple la catégorie (toutes sauf « Autre » non standard ; on garde « A définir »
    // pour permettre de revenir en arrière si besoin admin).
    selCat.innerHTML = '<option value="">— Choisir —</option>';
    getCategoryLabels().filter(c => c !== 'Autre').forEach(c => {
        const o = document.createElement('option');
        o.value = c; o.textContent = c;
        if (c === initial.cat) o.selected = true;
        selCat.appendChild(o);
    });

    function fillContextual(cat) {
        // Sous-type
        const subs = cat ? getSubtypes(cat) : [];
        const groupSub = pop.querySelector('[data-group="sub"]');
        groupSub.style.display = subs.length ? '' : 'none';
        selSub.innerHTML = '<option value="">—</option>';
        subs.forEach(v => {
            const o = document.createElement('option');
            o.value = v; o.textContent = v;
            if (v === initial.sub) o.selected = true;
            selSub.appendChild(o);
        });
        // État
        const etats = cat ? getStates(cat) : [];
        const groupEtat = pop.querySelector('[data-group="etat"]');
        groupEtat.style.display = etats.length ? '' : 'none';
        selEtat.innerHTML = '<option value="">—</option>';
        etats.forEach(v => {
            const o = document.createElement('option');
            o.value = v; o.textContent = v;
            if (v === initial.etat) o.selected = true;
            selEtat.appendChild(o);
        });
        // Accès
        const accs = cat ? getAccessValues(cat) : [];
        const groupAcc = pop.querySelector('[data-group="acces"]');
        groupAcc.style.display = accs.length ? '' : 'none';
        selAcces.innerHTML = '<option value="">—</option>';
        accs.forEach(v => {
            const o = document.createElement('option');
            o.value = v; o.textContent = v;
            if (v === initial.acces) o.selected = true;
            selAcces.appendChild(o);
        });
    }
    fillContextual(initial.cat);

    // Changement de catégorie → reset l'état du POI (les sous-types changent).
    // On efface la sélection initiale des contextuels au changement de cat.
    selCat.addEventListener('change', () => {
        initial.sub = ''; initial.etat = ''; initial.acces = '';
        fillContextual(selCat.value);
    });

    // Position : sous l'ancre, aligné à droite si la popover dépasse.
    const rect = anchorEl.getBoundingClientRect();
    const POP_W = 280;
    let left = rect.left;
    if (left + POP_W > window.innerWidth - 12) left = Math.max(12, window.innerWidth - POP_W - 12);
    pop.style.left = left + 'px';
    pop.style.top = (rect.bottom + 6) + 'px';

    function close() {
        pop.remove();
        document.removeEventListener('keydown', escHandler);
        document.removeEventListener('mousedown', outsideHandler);
    }
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    const outsideHandler = (e) => {
        if (!pop.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) close();
    };
    pop._escHandler = escHandler;
    pop._outsideHandler = outsideHandler;
    document.addEventListener('keydown', escHandler);
    document.addEventListener('mousedown', outsideHandler);

    pop.querySelector('[data-action=cancel]').addEventListener('click', close);
    pop.querySelector('.pb-cat-pop-close').addEventListener('click', close);

    pop.querySelector('[data-action=save]').addEventListener('click', async () => {
        const next = {
            'Catégorie': selCat.value || '',
            'Sous-type': selSub.value || '',
            'État': selEtat.value || '',
            'Accès': selAcces.value || '',
        };
        // Diff : ne persister que les champs qui ont VRAIMENT changé (évite de
        // polluer la diff CC Admin avec des « non-changements »).
        const before = {
            'Catégorie': getPoiProp(feature, 'Catégorie') || '',
            'Sous-type': getPoiProp(feature, 'Sous-type') || '',
            'État': getPoiProp(feature, 'État') || '',
            'Accès': getPoiProp(feature, 'Accès') || '',
        };
        const diff = {};
        Object.keys(next).forEach(k => {
            if (next[k] !== before[k]) diff[k] = next[k];
        });
        if (Object.keys(diff).length === 0) {
            close();
            return;
        }
        try {
            await saveTaxonomyBatch(poiId, diff);
            showToast('Catégorisé', 'success', 1500);
            close();
            if (typeof onSaved === 'function') onSaved();
        } catch (e) {
            console.error('[photo-batch] save catégorisation échoué', e);
            showToast('Échec de l\'enregistrement', 'error');
        }
    });

    createIcons({ icons: appIcons });
}

// Ouvre le RichEditor sur un POI existant depuis la modale photo-batch. Suspend
// la modale (cf. handleCreatePoi : openHwModal du RichEditor détruirait
// l'activeHwOverlay sinon), écoute richEditor:closed, restaure. À la fermeture
// on rafraîchit la modale pour MAJ le badge orange du bouton « Catégoriser »
// (si l'utilisateur a catégorisé via le RichEditor).
async function handleEditPoi(feature) {
    const poiId = getPoiId(feature);
    if (!poiId) {
        showToast('POI introuvable', 'error');
        return;
    }
    suspendHwModal();

    await new Promise((resolve) => {
        const onClose = () => {
            window.removeEventListener('richEditor:closed', onClose);
            resolve();
        };
        window.addEventListener('richEditor:closed', onClose);

        import('./richEditor.js').then(({ RichEditor }) => {
            RichEditor.openForEdit(poiId);
        }).catch((err) => {
            console.error('[photo-batch] échec import RichEditor', err);
            window.removeEventListener('richEditor:closed', onClose);
            resolve();
        });
    });

    resumeHwModal();
    // Rafraîchit la modale (badge orange du bouton Catégoriser, libellé du
    // tooltip si la cat a changé).
    renderBody();
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
        cluster.noGps = false; // rattaché à un lieu → ce n'est plus un groupe « Sans GPS »
    }

    renderBody();
    updateHeaderCounts();
}

// Rattache un groupe « Sans GPS » à un POI existant choisi via une recherche.
// Sans coordonnées, c'est la seule voie de rattachement. On suspend la modale
// photo-batch le temps du picker (même garde anti-empilement que « Créer un
// lieu » / le RichEditor), puis on la restaure et on rattache.
async function handleAttachViaSearch(cluster) {
    suspendHwModal();
    let feature = null;
    try {
        feature = await openPoiPickerModal();
    } finally {
        resumeHwModal();
    }
    if (feature) {
        // dist:0 — rattachement manuel (la distance n'a pas de sens sans coords).
        attachClusterToPoi(cluster, { feature, dist: 0 });
    }
}

// Petite modale de recherche de POI (réutilise le style .sp-* de start-point).
// Résout avec la feature choisie, ou null si annulé/fermé. À ouvrir entre
// suspendHwModal()/resumeHwModal() — elle passe par openHwModal (stacking interdit).
function openPoiPickerModal() {
    const body = document.createElement('div');
    body.className = 'sp-modal';
    body.innerHTML = `
        <label class="sp-search">
            <i data-lucide="search"></i>
            <input type="search" class="sp-search-input" placeholder="Rechercher un lieu…" autocomplete="off">
        </label>
        <div class="sp-results"></div>
    `;
    const input = body.querySelector('.sp-search-input');
    const results = body.querySelector('.sp-results');

    const renderResults = (query) => {
        results.innerHTML = '';
        const found = getSearchResults(query);
        if (found.length === 0) {
            if (query.trim().length > 0) {
                const empty = document.createElement('p');
                empty.className = 'sp-empty';
                empty.textContent = 'Aucun lieu ne correspond.';
                results.appendChild(empty);
            }
            return;
        }
        const frag = document.createDocumentFragment();
        found.slice(0, 30).forEach(f => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sp-result';
            btn.textContent = getPoiName(f) || '(sans nom)';
            btn.addEventListener('click', () => closeHwModal({ feature: f }));
            frag.appendChild(btn);
        });
        results.appendChild(frag);
    };

    input.addEventListener('input', () => renderResults(input.value));

    const p = openHwModal({
        size: 'sm',
        icon: 'link',
        title: 'Rattacher à un lieu',
        body,
        footer: false,
    });
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 50);
    return p.then(result => (result && result.feature) ? result.feature : null);
}

// Candidats de rattachement calculés EN DIRECT depuis state.loadedFeatures :
// tous les POIs visibles dans `radius` m du centre du cluster, triés par distance.
// Recalculé au render → inclut les POIs créés APRÈS l'import (« Créer un lieu »
// pour un voisin), contrairement à nearbyPois qui est figé à l'import.
function getNearbyPoiCandidates(cluster, radius = 300) {
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
        if (hintEl) hintEl.textContent = "Cliquez une vignette pour la placer dans l'emplacement actif";
    } else {
        if (iconEl) iconEl.innerHTML = '<i data-lucide="images"></i>';
        if (titleEl) titleEl.textContent = 'Organiser les photos';
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
        // Les masquées de la session ne remplissent pas non plus les cases vides.
        const next = cluster.photos.find(p => !shown.has(p.id) && !(f.hidden && f.hidden.has(p.id)));
        if (next) { f.slots[i] = next.id; shown.add(next.id); }
    }
}

// Entre en mode focus pour un cluster : nb d'emplacements adaptatif (rempli).
function enterFocus(cluster) {
    const slotCount = defaultCompareSlots(cluster.photos.length);
    const slots = [];
    for (let i = 0; i < slotCount; i++) slots.push(cluster.photos[i] ? cluster.photos[i].id : null);
    // `hidden` : photos masquées (œil barré) PENDANT cette session de comparaison.
    // Elles sont exclues de l'auto-avance et du remplissage auto (ne « reviennent »
    // plus toutes seules), mais restent dans le cluster et re-cliquables dans la
    // pellicule (grisées). Réinitialisé à chaque entrée en focus → réouvrir la
    // comparaison réaffiche toutes les photos.
    modalState.focus = { clusterId: cluster.id, slotCount, slots, activeSlot: 0, hidden: new Set() };
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
    // Taper une vignette masquée la « réveille » : on l'enlève des masquées de la
    // session (clic = action explicite de l'utilisateur, on respecte son intention).
    if (f.hidden) f.hidden.delete(pid);
    const existing = f.slots.indexOf(pid);
    if (existing !== -1) {
        // Déjà affichée → on rend simplement son emplacement actif (pas de doublon).
        f.activeSlot = existing;
    } else {
        // Place la photo dans l'emplacement ACTIF (remplace son contenu), puis fait
        // avancer l'emplacement actif au suivant (cyclique). Le nombre d'emplacements
        // est fixé par le sélecteur 2..6 — taper n'agrandit plus la grille.
        if (f.activeSlot < 0 || f.activeSlot >= f.slotCount) f.activeSlot = 0;
        f.slots[f.activeSlot] = pid;
        f.activeSlot = (f.activeSlot + 1) % f.slotCount;
    }
    renderBody();
}

// Première photo du cluster non affichée (hors `excludePid`), dans l'ordre de
// la pellicule. Sert à l'auto-avance : remplir un emplacement libéré.
function nextPhotoForSlot(cluster, excludePid) {
    const f = modalState.focus;
    const shown = new Set(f.slots.filter(Boolean));
    for (const p of cluster.photos) {
        if (p.id === excludePid) continue;
        if (f.hidden && f.hidden.has(p.id)) continue; // masquée → ne revient pas seule
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

    // Œil barré : on mémorise la photo comme masquée pour cette session → elle
    // ne sera plus rappelée par l'auto-avance ni le remplissage auto (cf. #6).
    if (mode === 'hide' && pid) f.hidden.add(pid);

    const next = nextPhotoForSlot(cluster, pid);
    if (next) f.slots[slotIndex] = next;
    else collapseSlot(slotIndex);

    if (mode === 'delete' && pid) { deletePhoto(pid); return; } // re-render interne
    renderBody(); // 'hide' : la photo reste dans le cluster (masquée)
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
    // Rogner : recadrage libre (remplace la copie de travail, original disque intact).
    if (photo) {
        const crop = document.createElement('button');
        crop.className = 'pb-compare-btn';
        crop.type = 'button';
        crop.title = 'Rogner cette photo';
        crop.setAttribute('aria-label', 'Rogner');
        crop.innerHTML = '<i data-lucide="crop"></i>';
        crop.addEventListener('click', (e) => { e.stopPropagation(); openCropPhoto(photo.id); });
        acts.appendChild(crop);
    }
    // Détacher : vers « Hors POI » depuis un groupe POI ; OU scinder un groupe
    // « Hors POI » en un nouveau groupe Hors POI (≥ 2 photos requises, sinon
    // no-op) → permet d'avoir plusieurs groupes Hors POI consécutifs (#3).
    if (photo && (cluster.type !== 'OUT_POI' || cluster.photos.length > 1)) {
        const isOut = cluster.type === 'OUT_POI';
        const ex = document.createElement('button');
        ex.className = 'pb-compare-btn';
        ex.type = 'button';
        ex.title = isOut ? 'Séparer dans un nouveau groupe « Hors POI »' : 'Détacher cette photo vers « Hors POI »';
        ex.setAttribute('aria-label', isOut ? 'Séparer' : 'Détacher');
        ex.innerHTML = isOut ? '<i data-lucide="split"></i>' : '<i data-lucide="route"></i>';
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

    const hiddenCount = f.hidden ? f.hidden.size : 0;
    const head = document.createElement('div');
    head.className = 'pb-pellicule-head';
    head.innerHTML = `<span>Pellicule</span><span class="sep">·</span><span><b>${cluster.photos.length}</b> photo(s)</span>`
        + (hiddenCount ? `<span class="sep">·</span><span class="pb-pellicule-hidden"><b>${hiddenCount}</b> masquée(s)</span>` : '')
        + `<span class="sep">·</span><span class="pb-pellicule-hint">Cliquez une vignette pour la placer dans l'emplacement actif · glissez pour réordonner</span>`;
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
        const slot = slotByPid[p.id];
        if (slot) thumb.classList.add('is-in-slot');
        const isHidden = f.hidden && f.hidden.has(p.id);
        if (isHidden) thumb.classList.add('is-hidden');
        thumb.title = isHidden
            ? 'Masquée — cliquer pour la réafficher dans la comparaison'
            : (p.customName || resolvePhotoAutoName(cluster, p));

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

        // Guard ignoreNextClick : après un drag (réordonnancement), Sortable émet
        // un click synthétique qu'on ne veut pas interpréter comme un tap.
        thumb.addEventListener('click', () => { if (ignoreNextClick) return; focusPelliculeTap(p.id); });
        track.appendChild(thumb);
    });

    // Réordonnancement des vignettes par glisser-déposer (#2). Reordonne
    // cluster.photos → met à jour l'ordre de la pellicule et la numérotation PP.
    new Sortable(track, {
        animation: 150,
        draggable: '.pb-pellicule-thumb',
        ghostClass: 'is-ghost',
        chosenClass: 'is-chosen',
        delay: 80,
        delayOnTouchOnly: true,
        onStart: () => { ignoreNextClick = true; },
        onEnd: (evt) => {
            handlePelliculeReorder(evt);
            setTimeout(() => { ignoreNextClick = false; }, 0);
        }
    });

    wrap.appendChild(track);
    return wrap;
}

// Réordonnancement de la pellicule (drag d'une vignette) : réaligne
// cluster.photos sur l'ordre du DOM puis re-render (slots reconciliés par id,
// numérotation PP mise à jour).
function handlePelliculeReorder(evt) {
    if (evt.oldIndex === evt.newIndex) return;
    const cluster = getFocusedCluster();
    if (!cluster) return;
    const order = [...evt.to.querySelectorAll(':scope > .pb-pellicule-thumb')].map(el => el.dataset.photoId);
    const byId = new Map(cluster.photos.map(p => [p.id, p]));
    const reordered = order.map(id => byId.get(id)).filter(Boolean);
    if (reordered.length !== cluster.photos.length) { renderBody(); return; }
    cluster.photos = reordered;
    renderBody();
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

    // --- HEAD : titre + sélecteur 2..6 ---
    // (Le retour à la vue d'ensemble passe par le footer « Fermer la comparaison »
    //  et Échap ; le ZIP du groupe par le footer « Télécharger ce groupe ».)
    const head = document.createElement('div');
    head.className = 'pb-cluster-head';

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
    // Titre + « ? » « Choisir les meilleures photos » (aide de la fenêtre Comparer).
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex; align-items:center; gap:6px; min-width:0;';
    titleRow.append(title, helpInline(HELP_COMPARE, { size: 'sm' }));
    headBlock.append(titleRow, sub);
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

    // Le ZIP de CE groupe vit désormais dans le footer (« Télécharger ce
    // groupe »), comme l'enregistrement par lieu → actions groupées au même
    // endroit en mode Comparer (cf. point #8 : footer scopé au groupe).
    section.appendChild(head);

    // --- FOCUS BODY : compare + pellicule ---
    const fbody = document.createElement('div');
    fbody.className = 'pb-focus-body';

    // Grille cols × rows : rangées CSS `1fr` (posées via --pb-cols/--pb-rows) →
    // chaque photo bornée par la HAUTEUR de sa cellule (fix « photo coupée /
    // grille qui scrolle » : sans --pb-rows, les cellules au-delà de la 1re
    // rangée tombaient en rangées auto-height → débordement + pellicule
    // repoussée sous la ligne de flottaison).
    const compare = document.createElement('div');
    compare.className = 'pb-compare';
    compare.dataset.count = String(f.slotCount);
    const grid = gridForSlots(f.slotCount);
    compare.style.setProperty('--pb-cols', String(grid.cols));
    compare.style.setProperty('--pb-rows', String(grid.rows));
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

// Rognage d'une photo (recadrage libre via cropperjs). La version rognée
// REMPLACE la copie de travail (fichier + aperçu + hash) ; le fichier original
// sur le disque de l'utilisateur n'est pas touché, et le GPS est déjà lu à
// l'import (stocké sur la photo) donc préservé. Disponible en grille ET en
// Comparer. cropperjs (JS + CSS) est importé DYNAMIQUEMENT → aucun surpoids de
// bundle si on ne rogne jamais. La modale photo-batch est suspendue le temps du
// rognage (anti-empilement V2, cf. handleCreatePoi).
async function openCropPhoto(photoId) {
    const loc = findPhotoLocation(photoId);
    if (!loc) return;
    const photo = loc.cluster.photos.find(p => p.id === photoId);
    if (!photo || !photo.file) {
        showToast("Cette photo n'est pas disponible pour le rognage.", 'error');
        return;
    }

    let Cropper;
    try {
        const [mod] = await Promise.all([
            import('cropperjs'),
            import('cropperjs/dist/cropper.css'),
        ]);
        Cropper = mod.default;
    } catch (e) {
        console.error('[photo-batch] chargement cropperjs', e);
        showToast("Impossible de charger l'outil de rognage.", 'error');
        return;
    }

    const objectUrl = URL.createObjectURL(photo.file);
    const bodyEl = document.createElement('div');
    bodyEl.className = 'pb-crop-wrap';
    const img = document.createElement('img');
    img.id = 'pb-crop-img';
    img.src = objectUrl;
    img.alt = '';
    bodyEl.appendChild(img);

    const footer = `
        <button class="btn btn-ghost" data-hw-modal-action="close" type="button">Annuler</button>
        <button class="btn btn-primary" id="pb-crop-apply" type="button"><i data-lucide="crop"></i><span>Rogner</span></button>
    `;

    let cropper = null;
    let resultBlob = null;

    suspendHwModal();
    const closed = openHwModal({
        size: 'xl',
        icon: 'crop',
        title: 'Rogner la photo',
        body: bodyEl,
        footer,
        closeOnBackdrop: false,
    });

    // Init du cropper + câblage « Valider » après injection du DOM de la modale.
    setTimeout(() => {
        const imgEl = document.getElementById('pb-crop-img');
        if (!imgEl) return;
        cropper = new Cropper(imgEl, {
            viewMode: 1,
            autoCropArea: 1,
            background: false,
            movable: false,
            zoomable: false,
            zoomOnWheel: false,
            rotatable: false,
            scalable: false,
        });
        const applyBtn = document.getElementById('pb-crop-apply');
        if (applyBtn) applyBtn.addEventListener('click', () => {
            const canvas = cropper.getCroppedCanvas({ maxWidth: 4096, maxHeight: 4096, imageSmoothingQuality: 'high' });
            if (!canvas) { closeHwModal(); return; }
            canvas.toBlob((blob) => { resultBlob = blob; closeHwModal(); }, 'image/jpeg', 0.92);
        });
    }, 50);

    await closed;

    if (cropper) cropper.destroy();
    URL.revokeObjectURL(objectUrl);
    resumeHwModal();

    if (!resultBlob) return; // annulé

    // Remplace la copie de travail (l'original disque reste intact).
    const name = (photo.file && photo.file.name) || 'photo.jpg';
    const cropped = new File([resultBlob], name, { type: 'image/jpeg' });
    photo.file = cropped;
    photo.cropped = true;
    try { photo.base64 = await resizeImage(cropped, 320); }
    catch (e) { console.error('[photo-batch] aperçu post-rognage', e); }
    try { photo.srcHash = await sha256OfFile(cropped); }
    catch (e) { /* dédup best-effort */ }

    renderBody();
    showToast('Photo rognée.', 'success');
}

// --- ENREGISTREMENT ---

// (compressFileToBlob supprimée le 11/06/2026 : l'import GPS passe désormais par
// compressImage (photo-service) avec PUBLISH_COMPRESSION — un seul encodeur, un
// seul profil de publication, watermark inclus. Son filet anti-blocage 15 s a
// été transféré dans compressImage à la fusion.)

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
    if (!modalState) return;
    const saveBtn = document.getElementById('photo-batch-btn-save');
    const zipBtn = document.getElementById('photo-batch-btn-zip');
    const closeBtn = document.getElementById('photo-batch-btn-close');
    const addBtn = document.getElementById('photo-batch-btn-add');
    const saveLabel = saveBtn ? saveBtn.querySelector('span') : null;
    const zipLabel = zipBtn ? zipBtn.querySelector('span') : null;

    // « Ajouter des photos » = action globale → masquée en mode Comparer.
    if (addBtn) addBtn.style.display = modalState.focus ? 'none' : '';

    // --- Mode Comparer : footer scopé au GROUPE focalisé ---
    if (modalState.focus) {
        const cluster = getFocusedCluster();
        if (closeBtn) {
            closeBtn.textContent = 'Fermer la comparaison';
            closeBtn.title = "Revenir à la vue d'ensemble (les photos ne sont pas perdues)";
        }
        if (zipBtn && zipLabel) {
            zipLabel.textContent = 'Télécharger ce groupe';
            zipBtn.title = `Télécharger ce groupe en ZIP (${cluster ? cluster.photos.length : 0} photo(s))`;
        }
        if (saveBtn && saveLabel) {
            const attached = !!(cluster && cluster.type !== 'OUT_POI'
                && cluster.nearbyPois && cluster.nearbyPois.length > 0);
            const hasUnsaved = attached && cluster.photos.some(p => p.file && !p.alreadySaved);
            saveLabel.textContent = 'Enregistrer ce lieu';
            saveBtn.disabled = !hasUnsaved;
            saveBtn.title = hasUnsaved
                ? 'Enregistrer les photos de ce lieu (sans fermer la fenêtre)'
                : (attached ? 'Photos de ce lieu déjà enregistrées'
                            : 'Rattache ce groupe à un POI pour activer');
        }
        return;
    }

    // --- Vue d'ensemble : footer global ---
    if (closeBtn) {
        closeBtn.textContent = 'Fermer';
        closeBtn.title = '';
    }
    if (zipBtn && zipLabel) {
        zipLabel.textContent = 'Télécharger ZIP';
        zipBtn.title = 'Exporter toutes les photos en archive ZIP sur le disque';
    }
    if (saveBtn && saveLabel) {
        const hasAttached = modalState.clusters.some(c =>
            c.type !== 'OUT_POI' &&
            c.nearbyPois && c.nearbyPois.length > 0 &&
            c.photos.some(p => !p.alreadySaved)
        );
        saveLabel.textContent = 'Enregistrer';
        saveBtn.disabled = !hasAttached;
        saveBtn.title = hasAttached
            ? 'Enregistrer les photos rattachées à un POI'
            : 'Rattache au moins un cluster à un POI pour activer';
    }
}

// Sauve UN cluster rattaché : compresse ses photos non encore sauvées, merge en
// DB (split admin/user), puis les flague `alreadySaved`. Retourne le nombre de
// photos écrites (0 si rien). Ne touche PAS au DOM ni à la modale — le caller
// (save global du footer OU save par groupe) décide du feedback. Source unique
// de la logique d'enregistrement → pas de divergence entre les deux chemins.
async function saveCluster(cluster, mapId) {
    const poiId = getPoiId(cluster.nearbyPois[0].feature);
    if (!poiId) return 0;

    // On exclut les photos alreadySaved (déjà persistées via "Créer un lieu" →
    // addPhotosToPoi, ou un précédent « Enregistrer ce lieu »). Évite de
    // recompresser ; la dédup par id couvrirait de toute façon.
    const toCompress = cluster.photos.filter(p => p.file && !p.alreadySaved);
    // P5 (audit) : compresser 20-30 photos de 12 Mpx toutes EN MÊME TEMPS
    // (Promise.all direct) créait un pic mémoire transitoire de plusieurs
    // centaines de Mo (un décodage + canvas plein format par photo) — risque
    // de fermeture d'onglet sur mobile modeste. Plafond : 3 simultanées, via
    // un mini-pool (3 workers qui piochent dans la file ; l'ordre est préservé
    // par l'écriture indexée).
    const MAX_PARALLEL_COMPRESSIONS = 3;
    const blobItems = new Array(toCompress.length);
    let nextIdx = 0;
    await Promise.all(Array.from(
        { length: Math.min(MAX_PARALLEL_COMPRESSIONS, toCompress.length) },
        async () => {
            while (nextIdx < toCompress.length) {
                const i = nextIdx++;
                const p = toCompress[i];
                blobItems[i] = {
                    id: p.id,
                    blob: await compressImage(p.file, PUBLISH_COMPRESSION.targetMinSize, PUBLISH_COMPRESSION.quality),
                    // srcHash = hash du fichier ORIGINAL (posé à l'import) →
                    // permet la dédup au prochain import (dédup 2-local).
                    srcHash: p.srcHash || undefined,
                };
            }
        }
    ));
    if (blobItems.length === 0) return 0;

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

    // Flague les photos écrites → le bouton « Enregistrer ce lieu » passe à
    // l'état « Enregistré » et un save global ultérieur ne les re-traite pas.
    cluster.photos.forEach(p => { if (p.file && !p.alreadySaved) p.alreadySaved = true; });
    return blobItems.length;
}

// Handler principal (footer) : enregistre TOUS les groupes rattachés puis ferme.
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
            totalPhotos += await saveCluster(cluster, mapId);
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

// Enregistre UN SEUL groupe (bouton « Enregistrer ce lieu ») SANS fermer la
// modale → permet de valider les lieux un par un en continuant le tri. Le
// re-render (finally) grise le bouton si sauvé, ou le restaure si erreur/rien.
async function handleSaveCluster(cluster) {
    const mapId = state.currentMapId;
    if (!mapId) { showToast('Aucune carte active.', 'error'); renderBody(); return; }
    if (!cluster.nearbyPois || cluster.nearbyPois.length === 0) { renderBody(); return; }

    try {
        const n = await saveCluster(cluster, mapId);
        if (n === 0) {
            showToast('Rien à enregistrer pour ce lieu.', 'info');
            return;
        }
        const name = getPoiName(cluster.nearbyPois[0].feature) || 'Lieu';
        const modeSuffix = state.isAdmin ? ' (en attente CC)' : '';
        showToast(`${name} — ${n} photo(s) enregistrée(s)${modeSuffix}.`, 'success');
        updateHeaderCounts();
        updateFooterButtons(); // le save global reflète qu'il reste moins à sauver
    } catch (e) {
        console.error('[photo-batch] handleSaveCluster error', e);
        showToast('Erreur enregistrement : ' + (e.message || e), 'error');
    } finally {
        renderBody();
    }
}

// --- AJOUTER DES PHOTOS EN COURS (#7) ---
// Rejoue le pipeline d'import (EXIF → dédup → clustering) sur de nouveaux
// fichiers et AJOUTE les groupes obtenus à la fin, sans toucher au travail en
// cours (titres, rattachements, ordre…). Déclenché par le bouton « Ajouter des
// photos » ou un glisser-déposer de fichiers depuis l'explorateur.
async function handleAddMorePhotos(fileList) {
    // Un HEIC a souvent un MIME vide (Chrome) → on l'accepte aussi par
    // extension (isHeicFile), sinon il serait rejeté avant conversion.
    const files = Array.from(fileList || []).filter(f => f && ((f.type && f.type.startsWith('image/')) || isHeicFile(f)));
    if (!modalState || files.length === 0) {
        if (modalState && fileList && fileList.length) showToast('Seules des images peuvent être ajoutées.', 'info');
        return;
    }
    const addBtn = document.getElementById('photo-batch-btn-add');
    const addLabel = addBtn ? addBtn.querySelector('span') : null;
    const prevLabel = addLabel ? addLabel.textContent : null;
    if (addBtn) addBtn.disabled = true;
    if (addLabel) addLabel.textContent = 'Ajout…';
    try {
        // Dédup AUSSI contre les photos déjà ouvertes dans la modale (pas que la
        // base) → ré-importer un fichier déjà présent ne le duplique pas.
        const extraHashes = new Set();
        modalState.clusters.forEach(c => c.photos.forEach(p => { if (p.srcHash) extraHashes.add(p.srcHash); }));

        // Import dynamique : desktopMode importe ui-photo-batch en statique →
        // dynamique ici pour ne pas (re)créer le cycle. Module déjà chargé.
        const { buildEnrichedClustersFromFiles } = await import('./desktopMode.js');
        const { enrichedClusters, skippedDuplicates, noGpsCount } =
            await buildEnrichedClustersFromFiles(files, { extraHashes });

        if (enrichedClusters.length === 0) {
            showToast(skippedDuplicates > 0
                ? `${skippedDuplicates} doublon(s) déjà présent(s) — rien ajouté.`
                : 'Rien de nouveau à ajouter.', 'info', 5000);
            return;
        }

        const added = normalizeClusters(enrichedClusters);
        modalState.clusters.push(...added);
        // Si on était en Comparer, on revient à la vue d'ensemble pour voir les
        // nouveaux groupes (exitFocus re-render). Sinon on re-render directement.
        if (modalState.focus) exitFocus();
        else { renderBody(); updateHeaderCounts(); }

        const nNew = added.reduce((s, c) => s + c.photos.length, 0);
        let msg = `${nNew} photo(s) ajoutée(s) dans ${added.length} groupe(s).`;
        if (skippedDuplicates > 0) msg += ` ${skippedDuplicates} doublon(s) ignoré(s).`;
        showToast(msg, 'success', 5000);
        if (noGpsCount > 0) {
            showToast(`${noGpsCount} sans GPS — groupe « Sans GPS » en bas, à rattacher à un lieu.`, 'info', 6000);
        }
    } catch (e) {
        console.error('[photo-batch] handleAddMorePhotos', e);
        showToast("Erreur lors de l'ajout : " + (e.message || e), 'error');
    } finally {
        if (addBtn) addBtn.disabled = false;
        if (addLabel && prevLabel != null) addLabel.textContent = prevLabel;
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

// Demande le nom d'album via showPrompt SANS fermer la modale photo-batch.
// showPrompt ouvre une modale V2 ; sans précaution, openHwModal applique sa
// garde anti-empilement (closeHwModal sur l'overlay actif) et FERMERAIT la
// modale photo-batch → modalState nullifié, ZIP global en échec silencieux
// (bug : « Valider » ne faisait rien, alors que le ZIP d'un seul groupe
// marchait car il capturait son cluster avant l'await). On suspend la modale le
// temps du prompt puis on la restaure (même pattern que handleCreatePoi).
async function promptAlbumName(defaultName) {
    suspendHwModal();
    try {
        return await showPrompt("Nom d'album", "Nom d'album :", defaultName);
    } finally {
        resumeHwModal();
    }
}

// Handler global : ZIP de tous les clusters, nom d'album par défaut = generateCircuitName-like.
async function handleExportZip() {
    if (!modalState || !modalState.clusters || modalState.clusters.length === 0) {
        showToast('Aucune photo à exporter.', 'info');
        return;
    }
    const clusters = modalState.clusters; // capturé avant l'await (défensif)
    const defaultName = buildDefaultAlbumName(clusters);
    const album = await promptAlbumName(defaultName);
    if (!album) return; // Annulé → rien

    await generateAndDownloadZip(clusters, album);
}

// Handler par cluster : ZIP d'un seul groupe, nom d'album par défaut = nom du cluster.
async function handleExportClusterZip(cluster) {
    if (!cluster || !cluster.photos || cluster.photos.length === 0) {
        showToast('Ce groupe ne contient aucune photo.', 'info');
        return;
    }
    const defaultName = cluster.customName || resolveAutoName(cluster);
    const album = await promptAlbumName(defaultName);
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
    // Deux états « non rattaché » :
    //  - needsAttach (action requise → accent AMBRE, badge « À rattacher ») :
    //    soit Sans GPS (aucune position → rattacher à la main), soit un lieu
    //    connu est à portée raisonnable (≤ SUGGEST_RADIUS, cf. clustering).
    //  - isPlainOut (« Hors POI » neutre) : a une position mais aucun lieu connu
    //    à portée → vraie photo de trajet.
    // Candidats de rattachement (lieux ≤ 300 m), calculés EN DIRECT depuis les
    // coords des photos → marche aussi pour une photo détachée (center null).
    // Calculés une seule fois : réutilisés par le badge ET le menu déroulant.
    const attachCandidates = (isOutPoiType && !cluster.savedAsNewPoi && !cluster.noGps)
        ? getNearbyPoiCandidates(cluster) : [];
    const needsAttach = isOutPoiType && !cluster.savedAsNewPoi
        && (cluster.noGps || hasAbsoluteNearest || attachCandidates.length > 0);
    const isPlainOut = isOutPoiType && !cluster.savedAsNewPoi
        && !cluster.noGps && !hasAbsoluteNearest && attachCandidates.length === 0;
    if (needsAttach) section.classList.add('is-orphan');  // accent ambre = à traiter
    if (isPlainOut) section.classList.add('is-out-poi');

    // --- HEAD (sticky) ---
    const head = document.createElement('div');
    head.className = 'pb-cluster-head';

    // Poignée de réordonnancement (drag) — handle du Sortable de niveau groupe
    // (cf. renderBody). Réordonner les groupes renumérote les noms auto (NN - … - PP).
    const dragHandle = document.createElement('span');
    dragHandle.className = 'pb-cluster-drag';
    dragHandle.setAttribute('aria-label', 'Glisser pour réordonner ce groupe');
    dragHandle.title = 'Glisser pour réordonner ce groupe';
    dragHandle.innerHTML = '<i data-lucide="grip-vertical"></i>';
    head.appendChild(dragHandle);

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
        segs.push(cluster.noGps ? 'À rattacher à un lieu' : 'Sans POI cible', photoWord);
        section.dataset.suggestedPoiId = '';
    }
    // Aide « ? » 120 m : seulement sur le segment « POI rattaché · X m »
    // (cas hasNearbyPoi hors « Nouveau lieu créé »), porté par le 1er segment.
    const showDistHelp = hasNearbyPoi && !cluster.savedAsNewPoi;
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
        if (i === 0 && showDistHelp) s.append(' ', helpInline(HELP_DISTANCE, { size: 'sm' }));
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

    // Titre + « ? » « Nommer pour ordonner » sur une même ligne (le « ? » n'est
    // pas dans le titre éditable → pas capturé par contentEditable).
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex; align-items:center; gap:6px; min-width:0;';
    titleRow.appendChild(title);
    titleRow.appendChild(helpInline(HELP_NAMING, { size: 'sm' }));
    headBlock.appendChild(titleRow);
    headBlock.appendChild(sub);
    head.appendChild(headBlock);

    // Badge : « À rattacher » (ambre, action requise) ou « Hors POI » (neutre).
    if (needsAttach || isPlainOut) {
        const badge = document.createElement('span');
        badge.className = 'pb-cluster-badge';
        badge.textContent = needsAttach ? 'À rattacher' : 'Hors POI';
        // Aide « ? » : « Hors POI » / « À rattacher » (+ avertissement « non enregistré »).
        badge.append(' ', helpInline(HELP_HORS_POI, { size: 'sm' }));
        head.appendChild(badge);
    }

    // Barre d'actions (rattacher / créer / comparer / ZIP)
    const actions = document.createElement('div');
    actions.className = 'pb-cluster-actions';

    // Rattachement à un lieu existant — UN SEUL contrôle dynamique (groupes non
    // rattachés) :
    //  - s'il y a des lieux à portée (≤ 300 m) → menu déroulant : tous les lieux
    //    triés par distance + « Autre lieu (rechercher)… » ;
    //  - sinon → bouton recherche (Sans GPS, ou rien à proximité).
    // getNearbyPoiCandidates calcule le centre depuis les coords des photos →
    // marche aussi pour une photo DÉTACHÉE d'un POI (center=null mais coords
    // présentes) : elle retrouve donc ses suggestions de lieu.
    if (isOutPoiType && !cluster.savedAsNewPoi) {
        const candidates = attachCandidates; // déjà calculés (cf. needsAttach)
        if (candidates.length >= 1) {
            const select = document.createElement('select');
            select.className = 'pb-act pb-poi-select';
            select.title = 'Rattacher ces photos à un lieu';
            const ph = document.createElement('option');
            ph.value = ''; ph.disabled = true; ph.selected = true;
            ph.textContent = 'Rattacher à un lieu…';
            select.appendChild(ph);
            candidates.forEach(c => {
                const opt = document.createElement('option');
                opt.value = getPoiId(c.feature);
                opt.textContent = `${getPoiName(c.feature) || '(sans nom)'} · ${Math.round(c.dist)} m`;
                select.appendChild(opt);
            });
            const searchOpt = document.createElement('option');
            searchOpt.value = '__search';
            searchOpt.textContent = 'Autre lieu (rechercher)…';
            select.appendChild(searchOpt);
            select.addEventListener('click', (e) => e.stopPropagation());
            select.addEventListener('change', (e) => {
                e.stopPropagation();
                const val = select.value;
                select.selectedIndex = 0; // ré-arme le placeholder (si recherche annulée)
                if (val === '__search') { handleAttachViaSearch(cluster); return; }
                const chosen = candidates.find(c => getPoiId(c.feature) === val);
                if (chosen) attachClusterToPoi(cluster, chosen);
            });
            actions.appendChild(select);
        } else {
            const linkBtn = document.createElement('button');
            linkBtn.className = 'pb-act';
            linkBtn.type = 'button';
            linkBtn.innerHTML = '<i data-lucide="link"></i><span>Rattacher à un lieu…</span>';
            linkBtn.title = 'Choisir un lieu existant auquel rattacher ces photos';
            linkBtn.addEventListener('click', (e) => { e.stopPropagation(); handleAttachViaSearch(cluster); });
            actions.appendChild(linkBtn);
        }
    }

    // Créer un nouveau lieu (cluster sans POI rattaché ET avec des coordonnées —
    // un groupe « Sans GPS » n'a pas de position : on ne peut pas créer de POI).
    if (!hasNearbyPoi && !cluster.noGps) {
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
        actions.appendChild(helpInline(HELP_CREATE, { size: 'sm' }));
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

    // Maps / OSM (par COORDONNÉES — jamais par nom).
    //   - Rattaché : ouvre les coords du POI suggéré (vérifier/corriger le nom).
    //   - Orphelin / Hors POI : ouvre le BARYCENTRE des photos (= leurs EXIF) →
    //     répond à « où l'app pense que cette photo se trouve » (diagnostic
    //     quand le POI proposé est étrangement loin de la photo réelle).
    //   - Sans GPS : pas de coords → pas de boutons.
    const photoCenter = !hasNearbyPoi && !cluster.noGps ? getClusterCenter(cluster) : null;
    if (hasNearbyPoi || photoCenter) {
        const isPhotoPos = !hasNearbyPoi;
        const gmapsTitle = isPhotoPos
            ? 'Voir la position de la photo sur Google Maps'
            : 'Vérifier ce lieu sur Google Maps';
        const osmTitle = isPhotoPos
            ? 'Voir la position de la photo sur OpenStreetMap'
            : 'Vérifier ce lieu sur OpenStreetMap';
        const open = (provider) => {
            if (isPhotoPos) openCoordsOnMap(photoCenter.lat, photoCenter.lng, provider);
            else openPoiOnMap(cluster.nearbyPois[0].feature, provider);
        };

        const mapsBtn = document.createElement('button');
        mapsBtn.className = 'pb-act is-maplink';
        mapsBtn.type = 'button';
        mapsBtn.innerHTML = '<i data-lucide="map-pin"></i><span>Maps</span>';
        mapsBtn.title = gmapsTitle;
        mapsBtn.setAttribute('aria-label', gmapsTitle);
        mapsBtn.addEventListener('click', (e) => { e.stopPropagation(); open('gmaps'); });
        actions.appendChild(mapsBtn);

        const osmBtn = document.createElement('button');
        osmBtn.className = 'pb-act is-maplink';
        osmBtn.type = 'button';
        osmBtn.innerHTML = '<i data-lucide="map"></i><span>OSM</span>';
        osmBtn.title = osmTitle;
        osmBtn.setAttribute('aria-label', osmTitle);
        osmBtn.addEventListener('click', (e) => { e.stopPropagation(); open('osm'); });
        actions.appendChild(osmBtn);
    }

    // Catégoriser (popover compacte 4 selects) + Éditer la fiche (RichEditor
    // complet). Sur tout cluster rattaché à un POI existant — chantier
    // enrichissement 01/06/2026. Le bouton « Catégoriser » porte un badge orange
    // si le POI est mal catégorisé (cf. isPoiMalCategorized).
    if (hasNearbyPoi && cluster.type !== 'OUT_POI') {
        const poiFeature = cluster.nearbyPois[0].feature;

        const catBtn = document.createElement('button');
        catBtn.className = 'pb-act';
        catBtn.type = 'button';
        if (isPoiMalCategorized(poiFeature)) catBtn.classList.add('is-warn');
        catBtn.innerHTML = '<i data-lucide="tags"></i><span>Catégoriser</span>';
        catBtn.title = categorizeTooltip(poiFeature);
        catBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openCategorizationPopover(poiFeature, catBtn, () => {
                // Refresh badge + tooltip in-place (pas de full re-render).
                catBtn.classList.toggle('is-warn', isPoiMalCategorized(poiFeature));
                catBtn.title = categorizeTooltip(poiFeature);
            });
        });
        actions.appendChild(catBtn);

        const editBtn = document.createElement('button');
        editBtn.className = 'pb-act';
        editBtn.type = 'button';
        editBtn.innerHTML = '<i data-lucide="pencil"></i><span>Éditer la fiche</span>';
        editBtn.title = 'Ouvrir l\'éditeur complet (description, source, horaires…)';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleEditPoi(poiFeature);
        });
        actions.appendChild(editBtn);
    }

    // Enregistrer CE lieu (sans fermer la modale) → tri lieu par lieu. Seulement
    // sur un groupe rattaché à un POI ; un groupe « Créer un lieu » (savedAsNewPoi)
    // a déjà ses photos persistées. Quand tout est sauvé, le bouton passe à un
    // état vert inerte « Enregistré » (grisé, demande Stefan).
    if (hasNearbyPoi && cluster.type !== 'OUT_POI' && !cluster.savedAsNewPoi) {
        const hasUnsaved = cluster.photos.some(p => p.file && !p.alreadySaved);
        const saveOneBtn = document.createElement('button');
        saveOneBtn.type = 'button';
        if (hasUnsaved) {
            saveOneBtn.className = 'pb-act';
            saveOneBtn.innerHTML = '<i data-lucide="cloud-upload"></i><span>Enregistrer ce lieu</span>';
            saveOneBtn.title = 'Enregistrer les photos de ce lieu (sans fermer la fenêtre)';
            saveOneBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                saveOneBtn.disabled = true; // anti double-clic le temps du save
                handleSaveCluster(cluster);
            });
        } else {
            saveOneBtn.className = 'pb-act is-saved';
            saveOneBtn.disabled = true;
            saveOneBtn.innerHTML = '<i data-lucide="check"></i><span>Enregistré</span>';
            saveOneBtn.title = 'Photos de ce lieu déjà enregistrées';
        }
        actions.appendChild(saveOneBtn);
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

    // Actions par photo (top-right) : extraire/scinder + supprimer.
    // Groupe POI → extraire vers Hors POI. Groupe Hors POI (≥ 2 photos) →
    // scinder dans un nouveau groupe Hors POI (plusieurs Hors POI à la suite, #3).
    const acts = document.createElement('div');
    acts.className = 'pb-thumb-acts';
    if (cluster.type !== 'OUT_POI' || cluster.photos.length > 1) {
        const isOut = cluster.type === 'OUT_POI';
        const extractBtn = document.createElement('button');
        extractBtn.className = 'pb-thumb-btn';
        extractBtn.type = 'button';
        extractBtn.title = isOut ? 'Séparer dans un nouveau groupe Hors POI' : 'Extraire vers Hors POI';
        extractBtn.setAttribute('aria-label', extractBtn.title);
        extractBtn.innerHTML = isOut ? '<i data-lucide="split"></i>' : '<i data-lucide="route"></i>';
        extractBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            extractToOutPoi(item.id);
        });
        acts.appendChild(extractBtn);
    }
    const cropBtn = document.createElement('button');
    cropBtn.className = 'pb-thumb-btn';
    cropBtn.type = 'button';
    cropBtn.title = 'Rogner cette photo';
    cropBtn.setAttribute('aria-label', 'Rogner');
    cropBtn.innerHTML = '<i data-lucide="crop"></i>';
    cropBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCropPhoto(item.id);
    });
    acts.appendChild(cropBtn);

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

    // `#photo-batch-body` PERSISTE entre les rendus (créé une seule fois à
    // l'ouverture, on ne fait que vider son innerHTML). Or on (re)crée un
    // `new Sortable(body, …)` (réordonnancement des groupes) à CHAQUE rendu en
    // vue d'ensemble. SortableJS ne nettoie pas l'instance précédente
    // (`el[expando] = this` + ré-attache pointerdown/mousedown/touchstart sans
    // off()) → les écouteurs s'empilaient à chaque rendu (fuite). On détruit
    // donc l'instance du rendu précédent avant tout : un seul Sortable vivant
    // à la fois, plus d'accumulation. (Les Sortables des grilles/pellicule sont
    // sur des éléments recréés à chaque rendu → pas concernés.)
    Sortable.get(body)?.destroy();

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
        // Réordonnancement des GROUPES par glisser-déposer (handle = poignée du
        // head). Sortable distinct de celui des photos ('photo-batch-shared') →
        // pas d'interférence ; le drag ne démarre QUE depuis .pb-cluster-drag.
        new Sortable(body, {
            group: 'photo-batch-clusters',
            draggable: '.pb-cluster',
            handle: '.pb-cluster-drag',
            animation: 150,
            ghostClass: 'is-ghost',
            chosenClass: 'is-chosen',
            dragClass: 'is-dragging',
            onStart: () => { ignoreNextClick = true; },
            onEnd: (evt) => {
                handleClusterMoveEnd(evt);
                setTimeout(() => { ignoreNextClick = false; }, 0);
            }
        });
    }

    createIcons({ icons: appIcons, root: body });
}

// Réordonnancement des groupes (drag du head) : réaligne modalState.clusters sur
// l'ordre du DOM puis re-render. Les noms auto (NN - base - PP) suivent le nouvel
// ordre puisque NN = position du cluster.
function handleClusterMoveEnd(evt) {
    if (evt.oldIndex === evt.newIndex) return;
    const order = [...evt.to.querySelectorAll(':scope > .pb-cluster')].map(el => el.dataset.clusterId);
    const byId = new Map(modalState.clusters.map(c => [c.id, c]));
    const reordered = order.map(id => byId.get(id)).filter(Boolean);
    // Garde-fou : si le mapping perd des clusters, on n'écrase pas l'état.
    if (reordered.length !== modalState.clusters.length) { renderBody(); return; }
    modalState.clusters = reordered;
    renderBody();
    updateHeaderCounts();
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
                <button class="btn btn-ghost" id="photo-batch-btn-add" type="button" title="Ajouter d'autres photos sans fermer la fenêtre (ou glissez-les depuis l'explorateur)">
                    <i data-lucide="image-plus"></i><span>Ajouter des photos</span>
                </button>
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
            title: 'Organiser les photos',
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

                // Garde-fou sur la croix V2 : on intercepte le clic en phase de
                // CAPTURE (avant le handler par défaut de modal.js qui ferme) →
                // si du tri n'est pas enregistré, on passe par requestClose().
                overlayEl.addEventListener('click', (e) => {
                    const x = e.target.closest('.hw-modal-close, [data-hw-modal-action="close"]');
                    if (!x) return;
                    if (!hasUnsavedSession()) return; // rien à perdre → fermeture par défaut
                    e.preventDefault();
                    e.stopPropagation();
                    requestClose();
                }, true);

                // Extras du header (compteurs / pill sélection / hint) injectés dans le
                // .hw-modal-header rendu par openHwModal (icône + titre + croix), avant la croix.
                const headerEl = overlayEl.querySelector('.hw-modal-header');
                const closeBtn = headerEl ? headerEl.querySelector('.hw-modal-close') : null;
                if (headerEl && closeBtn) {
                    closeBtn.insertAdjacentHTML('beforebegin', `
                        <span id="photo-batch-help-global"></span>
                        <span class="pb-header-counts" id="photo-batch-header-subtitle"></span>
                        <span class="pb-header-spacer"></span>
                        <span class="pb-header-format"><b>JPEG · HEIC</b><span id="photo-batch-help-heic"></span></span>
                        <span class="pb-header-hint">${hintText}</span>
                    `);
                    // Aide « ? » : panneau global (guide d'import) + ancre HEIC (format).
                    const helpGlobalSlot = document.getElementById('photo-batch-help-global');
                    if (helpGlobalSlot) helpGlobalSlot.append(helpButton(GUIDE_IMPORT, { label: 'Aide : importer des photos' }));
                    const helpHeicSlot = document.getElementById('photo-batch-help-heic');
                    if (helpHeicSlot) helpHeicSlot.append(helpInline(HELP_FORMAT, { size: 'sm' }));
                    createIcons({ icons: appIcons, root: headerEl });
                }
            }

            const btnClose = document.getElementById('photo-batch-btn-close');
            const btnZip = document.getElementById('photo-batch-btn-zip');
            const btnSave = document.getElementById('photo-batch-btn-save');
            // En mode Comparer, les boutons du footer agissent sur le GROUPE
            // focalisé (jamais sur l'ensemble) → évite un « Enregistrer tout » ou
            // une fermeture de session par mégarde. updateFooterButtons() ajuste
            // libellés / titres / état disabled selon le mode.
            if (btnClose) btnClose.addEventListener('click', () => {
                if (modalState && modalState.focus) { exitFocus(); return; }
                requestClose();
            });
            if (btnZip) btnZip.addEventListener('click', () => {
                if (modalState && modalState.focus) {
                    const c = getFocusedCluster();
                    if (c) handleExportClusterZip(c);
                    return;
                }
                handleExportZip();
            });
            if (btnSave) btnSave.addEventListener('click', () => {
                if (modalState && modalState.focus) {
                    const c = getFocusedCluster();
                    if (c) handleSaveCluster(c);
                    return;
                }
                handleSave();
            });

            // « Ajouter des photos » (#7) : input fichier caché + glisser-déposer
            // de fichiers depuis l'explorateur. L'input et les écouteurs vivent sur
            // l'overlay → retirés automatiquement à la fermeture (overlay détruit).
            const btnAdd = document.getElementById('photo-batch-btn-add');
            if (btnAdd && overlayEl) {
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = 'image/*,.heic,.heif';
                fileInput.multiple = true;
                fileInput.style.display = 'none';
                fileInput.id = 'photo-batch-file-input';
                overlayEl.appendChild(fileInput);
                fileInput.addEventListener('change', () => {
                    handleAddMorePhotos(fileInput.files);
                    fileInput.value = ''; // permet de re-sélectionner les mêmes fichiers
                });
                btnAdd.addEventListener('click', () => fileInput.click());

                // Glisser-déposer de FICHIERS OS (≠ drag interne Sortable, qui ne
                // porte pas le type 'Files') → on n'intercepte que les fichiers.
                const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
                overlayEl.addEventListener('dragover', (e) => {
                    if (!hasFiles(e)) return;
                    e.preventDefault();
                    overlayEl.classList.add('is-drop-active');
                });
                overlayEl.addEventListener('dragleave', (e) => {
                    if (e.target === overlayEl) overlayEl.classList.remove('is-drop-active');
                });
                overlayEl.addEventListener('drop', (e) => {
                    if (!hasFiles(e)) return;
                    e.preventDefault();
                    overlayEl.classList.remove('is-drop-active');
                    handleAddMorePhotos(e.dataTransfer.files);
                });
            }

            updateHeaderCounts();
            renderBody();
        }, 30);

        // ESC : en mode focus → retour à la vue d'ensemble ; sinon → fermeture
        // gardée (confirme si tri non enregistré).
        keydownHandler = (e) => {
            if (e.key !== 'Escape') return;
            if (modalState && modalState.focus) { exitFocus(); return; }
            requestClose();
        };
        document.addEventListener('keydown', keydownHandler);
        window.addEventListener('beforeunload', importBeforeUnload);

        // Cleanup à la fermeture (peu importe : croix V2, bouton Fermer, ESC)
        promise.then((result) => {
            if (keydownHandler) {
                document.removeEventListener('keydown', keydownHandler);
                keydownHandler = null;
            }
            window.removeEventListener('beforeunload', importBeforeUnload);
            closeHelp(); // referme un éventuel panneau/popover d'aide resté ouvert
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
