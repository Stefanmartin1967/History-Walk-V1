import L from 'leaflet';
import { applyFilters } from './data.js';
import { clearCircuit, cancelPendingCircuitLoad } from './circuit.js';
import { toggleCircuitCreationMode } from './ui-circuit-editor.js';
import { map } from './map.js';
import { addPoiFeature, getPoiId, getPoiName, updatePoiData } from './data.js';
import { state } from './state.js';
import { saveAppState, savePoiData, getPoiPhotos, savePoiPhotos, getPendingAdminPhotos, setPendingAdminPhotos, getAllPoiPhotoHashes, getAllPendingAdminPhotoHashes } from './database.js';
import { compressImage, generatePhotoId } from './photo-service.js';
import { logModification } from './logger.js';
import { closeAllDropdowns } from './ui-utils.js';
import { closeDetailsPanel, openDetailsPanel } from './ui-details.js';
import { getExifLocation, resizeImage, sha256OfFile, openCoordsOnMap } from './utils.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { clusterPhotos } from './photo-clustering.js';
import { isHeicFile, convertHeicToJpeg } from './heic.js';
import { showToast } from './toast.js';
import { showPhotoSelectionModal } from './photo-import-ui.js';
import { openPhotoGrid } from './ui-photo-grid.js';
import { openPhotoBatchModal } from './ui-photo-batch.js';
import { RichEditor } from './richEditor.js';
import { eventBus } from './events.js';
import { recordModification } from './backup-auto-local.js';

let desktopDraftMarker = null;

// Écoute émise par richEditor.executeCreate : découplage event-bus pour casser
// le cycle richEditor ↔ desktopMode (addPhotosToPoi vit ici).
eventBus.on('photos:attach-after-create', async ({ feature, photos, done }) => {
    try {
        await addPhotosToPoi(feature, photos);
    } finally {
        if (typeof done === 'function') done();
    }
});

export function enableDesktopCreationMode() {
    if (!map) return;
    RichEditor.init(); // Initialisation des écouteurs de la modale riche
    map.on('contextmenu', (e) => {
        const { lat, lng } = e.latlng;
        if (desktopDraftMarker) {
            desktopDraftMarker.setLatLng(e.latlng);
        } else {
            createDraftMarker(lat, lng, map);
        }
    });
}

// Pipeline « fichiers → clusters enrichis » (EXIF → dédup hash → base64 →
// clustering par lieu + groupe « Sans GPS »). Pure (pas de loader / flyTo /
// toast / modale) → réutilisable pour l'import initial ET pour « Ajouter des
// photos » dans la modale ouverte (cf. ui-photo-batch).
// `extraHashes` : srcHash déjà présents (ex. photos actuellement dans la modale)
// à traiter comme doublons en plus de ceux stockés en base.
// `onProgress` : callback de progression — { phase:'photos', done, total } pendant
// le traitement photo par photo, puis { phase:'cluster' } au regroupement.
// Retourne { enrichedClusters, skippedDuplicates, noGpsCount }.
export async function buildEnrichedClustersFromFiles(files, { extraHashes = null, onProgress = null } = {}) {
    // Hash déjà connus (dédup 2-local) : base locale + éventuels extraHashes.
    const existingHashes = state.isAdmin
        ? await getAllPendingAdminPhotoHashes(state.currentMapId)
        : await getAllPoiPhotoHashes(state.currentMapId);
    if (extraHashes) extraHashes.forEach(h => { if (h) existingHashes.add(h); });

    // --- TRAITEMENT PHOTO PAR PHOTO (une seule passe → progression simple) ---
    // Pour chaque fichier : position (EXIF) → hash original (dédup) → aperçu base64.
    // Une seule boucle = un compteur de progression propre (1..N).
    const seenThisImport = new Set();
    const validItems = [];
    let skippedDuplicates = 0;
    const total = files.length;
    let i = 0;
    for (const file of files) {
        i++;
        if (onProgress) onProgress({ phase: 'photos', done: i, total });

        // 1) Position (EXIF) + date. Sans EXIF → photo « sans position ».
        let coords = null, date = null, hasGps = false;
        try {
            const meta = await getExifLocation(file);
            coords = { lat: meta.lat, lng: meta.lng };
            date = meta.date;
            hasGps = true;
        } catch (e) {
            console.warn(`[Import] Pas de position pour ${file.name}:`, e.message);
        }

        // 2) Hash du fichier ORIGINAL (dédup). Hash indisponible → on ne déduplique
        //    pas plutôt que de risquer d'écarter une photo unique.
        const srcHash = await sha256OfFile(file);
        if (srcHash && (seenThisImport.has(srcHash) || existingHashes.has(srcHash))) {
            skippedDuplicates++;
            continue; // doublon → pas d'aperçu inutile
        }
        if (srcHash) seenThisImport.add(srcHash);

        // 2b) HEIC/HEIF (iPhone) → JPEG AVANT tout traitement pixel : Chrome/
        //     Firefox/Edge ne décodent pas le HEIC en canvas (cf. heic.js).
        //     L'EXIF (1) et le hash (2) ont été pris sur l'ORIGINAL → GPS
        //     préservé + dédup stable. En cas d'échec : on garde l'original
        //     (vignette cassée parlante) plutôt que d'écarter la photo en
        //     silence.
        let workFile = file;
        if (isHeicFile(file)) {
            try { workFile = await convertHeicToJpeg(file); }
            catch (e) { console.error(`[Import] Conversion HEIC échouée pour ${file.name}:`, e); }
        }

        // 3) Aperçu base64 (320px) — vignettes nettes + pellicule lightbox.
        let base64;
        try { base64 = await resizeImage(workFile, 320); }
        catch (e) { console.error('Pré-calcul base64:', e); }

        validItems.push({ file: workFile, coords, date, hasGps, srcHash, base64 });
    }

    if (validItems.length === 0) {
        return { enrichedClusters: [], skippedDuplicates, noGpsCount: 0 };
    }

    // --- GROUPEMENT « par lieu » (cf. photo-clustering.js) ---
    if (onProgress) onProgress({ phase: 'cluster' });
    const gpsItems = validItems.filter(it => it.hasGps);
    const noGpsItems = validItems.filter(it => !it.hasGps);

    const enrichedClusters = clusterPhotos(gpsItems, state.loadedFeatures, state.hiddenPoiIds);

    // Photos SANS position : un seul groupe « Sans position » en bas, à rattacher.
    if (noGpsItems.length > 0) {
        enrichedClusters.push({
            photos: noGpsItems,
            center: null,
            nearbyPois: [],
            absoluteNearest: null,
            noGps: true,
        });
    }

    return { enrichedClusters, skippedDuplicates, noGpsCount: noGpsItems.length };
}

// --- FONCTION D'IMPORT AVEC CLUSTERING ET DÉTECTION ---
export async function handleDesktopPhotoImport(filesList) {

    const files = Array.from(filesList);
    if (!files || files.length === 0) {
        showToast("Erreur : Aucun fichier reçu par le module.", "error");
        return;
    }

    // Overlay de progression. ⚠️ Toggle via la classe .is-hidden (et non
    // style.display) : .is-hidden porte `display:none !important`, qu'un inline
    // ne peut pas surcharger (bug : le loader ne s'affichait jamais à l'import).
    // .is-progress révèle libellé + compteur + barre (le spinner de boot reste seul).
    const loaderEl = document.getElementById('loader-overlay');
    const labelEl = document.getElementById('loader-label');
    const countEl = document.getElementById('loader-count');
    const barEl = document.getElementById('loader-bar-fill');
    const showLoader = () => {
        if (loaderEl) { loaderEl.classList.add('is-progress'); loaderEl.classList.remove('is-hidden'); }
    };
    const hideLoader = () => {
        if (loaderEl) { loaderEl.classList.add('is-hidden'); loaderEl.classList.remove('is-progress'); }
        if (barEl) barEl.style.width = '0%';
        if (countEl) countEl.textContent = '';
        if (labelEl) labelEl.textContent = '';
    };
    const onProgress = ({ phase, done, total }) => {
        if (phase === 'cluster') {
            if (labelEl) labelEl.textContent = 'Regroupement par lieu…';
            if (countEl) countEl.textContent = '';
            if (barEl) barEl.style.width = '100%';
            return;
        }
        if (labelEl) labelEl.textContent = 'Import des photos…';
        if (countEl) countEl.textContent = total ? `${done} / ${total}` : '';
        if (barEl && total) barEl.style.width = `${Math.round((done / total) * 100)}%`;
    };

    showLoader();

    try {
        const { enrichedClusters, skippedDuplicates, noGpsCount } =
            await buildEnrichedClustersFromFiles(files, { onProgress });

        if (enrichedClusters.length === 0) {
            hideLoader();
            return showToast(`${skippedDuplicates} doublon(s) ignoré(s) — rien de nouveau à importer.`, 'info', 5000);
        }

        // Centrage carte sur le 1er cluster (UX visuelle, non bloquant)
        if (map && enrichedClusters[0].center) {
            const firstCenter = enrichedClusters[0].center;
            map.flyTo([firstCenter.lat, firstCenter.lng], 14, { duration: 0.8 });
        }

        hideLoader();

        // Récap doublons écartés (option (a) : silencieux à l'unité, total annoncé).
        if (skippedDuplicates > 0) {
            showToast(`${skippedDuplicates} doublon(s) déjà importé(s) — ignoré(s).`, 'info', 5000);
        }
        // Photos sans GPS → on signale le groupe (placé en bas).
        if (noGpsCount > 0) {
            showToast(`${noGpsCount} photo(s) sans position — groupe « Sans position » en bas, à rattacher à un lieu.`, 'info', 6000);
        }

        // --- OUVERTURE DU MODAL BATCH ---
        await openPhotoBatchModal(enrichedClusters);

    } catch (error) {
        hideLoader();
        console.error(">>> ERREUR IMPORT :", error);
        showToast("Erreur lors du traitement : " + error.message, 'error');
    }
}

// Fonction utilitaire pour l'ajout effectif avec détection de doublons (par taille)
export async function addPhotosToPoi(feature, clusterItems) {
    let poiId = getPoiId(feature);

    // Si c'est un POI "natif" sans ID user, on lui en crée un
    if (!poiId) {
        const [lng, lat] = feature.geometry.coordinates;
        poiId = `auto_${Math.round(lat*100000)}_${Math.round(lng*100000)}`;
        if (!feature.properties) feature.properties = {};
        feature.properties.HW_ID = poiId;
    }

    const mapId = state.currentMapId;
    // Admin : photos via workflow CC (pendingAdminPhotos). User : store perso (poiPhotos).
    const existingPhotos = state.isAdmin
        ? await getPendingAdminPhotos(mapId, poiId)
        : await getPoiPhotos(mapId, poiId);
    // Dédup par HASH du fichier ORIGINAL (srcHash) — remplace l'ancienne dédup
    // par taille de blob compressé, qui était approximative (tolérance ±1%).
    const existingHashes = new Set(existingPhotos.map(p => p.srcHash).filter(Boolean));

    let added = 0;
    let duplicates = 0;
    const newItems = [...existingPhotos];

    for (const item of clusterItems) {
        try {
            // srcHash de l'original : fourni par l'import, sinon calculé ici (cas
            // d'un appelant direct). Hash du File brut, jamais du blob compressé.
            const srcHash = item.srcHash || (item.file ? await sha256OfFile(item.file) : null);
            if (srcHash && existingHashes.has(srcHash)) {
                duplicates++;
                continue;
            }

            // Priorité : File original → compressImage (pleine qualité, ~1200px).
            // Fallback base64 uniquement si File absent (cas legacy/admin review).
            // ⚠️ Avant : on prenait base64 d'abord, mais ui-photo-batch pré-calcule
            // une thumbnail à 200px pour l'affichage — utiliser cette base64 donnait
            // des photos 200px sauvegardées en base (qualité dégradée).
            let blob;
            if (item.file) {
                blob = await compressImage(item.file);
            } else if (item.base64) {
                // Conversion manuelle : fetch(data:...) bloqué par CSP connect-src
                const [header, data] = item.base64.split(',');
                const mime = (header.match(/:(.*?);/) || [])[1] || 'image/jpeg';
                const binary = atob(data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const rawBlob = new Blob([bytes], { type: mime });
                // Admin : on repasse par compressImage pour appliquer le watermark
                // (parité avec le chemin item.file). Sans ça, ce fallback sortait
                // un Blob NON watermarké.
                blob = state.isAdmin ? await compressImage(rawBlob) : rawBlob;
            } else {
                continue;
            }

            if (srcHash) existingHashes.add(srcHash);
            newItems.push({ id: generatePhotoId(), blob, srcHash: srcHash || undefined });
            added++;
        } catch (err) {
            console.error("Erreur lors de l'ajout photo:", err);
        }
    }

    if (added > 0) {
        if (state.isAdmin) {
            await setPendingAdminPhotos(mapId, poiId, newItems);
        } else {
            await savePoiPhotos(mapId, poiId, newItems);
            // [USER] Photos ajoutées côté user → compte pour l'auto-backup local.
            void recordModification();
        }

        // Refresh UI
        closeDetailsPanel();
        setTimeout(() => {
            const index = state.loadedFeatures.indexOf(feature);
            if (index > -1) openDetailsPanel(index);
        }, 100);
    }

    return { added, duplicates };
}

export function createDraftMarker(lat, lng, mapInstance, photos = []) {
    if (desktopDraftMarker) {
        mapInstance.removeLayer(desktopDraftMarker);
    }

    desktopDraftMarker = L.marker([lat, lng], {
        draggable: true,
        title: "Déplacez-moi pour ajuster"
    }).addTo(mapInstance);

    const popupContent = document.createElement('div');
    popupContent.className = 'ghost-popup';
    popupContent.innerHTML = `
        <div class="ghost-popup-title">Nouveau Lieu ?</div>
        <div class="ghost-popup-links">
            <button type="button" class="ghost-popup-link" data-provider="gmaps">
                <i data-lucide="map-pin"></i><span>Maps</span>
            </button>
            <button type="button" class="ghost-popup-link" data-provider="osm">
                <i data-lucide="map"></i><span>OSM</span>
            </button>
        </div>
        <div class="ghost-popup-hint">Glissez pour ajuster.</div>
        <button id="btn-validate-desktop-poi" class="action-btn ghost-popup-btn">
            Valider cette position
        </button>
    `;
    // Les boutons lisent la position COURANTE du marqueur au moment du clic
    // (donc inutile de re-binder après drag : la coord est toujours fraîche).
    popupContent.querySelectorAll('.ghost-popup-link').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const { lat: cLat, lng: cLng } = desktopDraftMarker.getLatLng();
            openCoordsOnMap(cLat, cLng, btn.dataset.provider);
        });
    });

    const validateBtn = popupContent.querySelector('#btn-validate-desktop-poi');
    
    validateBtn.addEventListener('click', () => {
        const finalLatLng = desktopDraftMarker.getLatLng();
        // REMPLACEMENT PAR LA RICH EDITOR
        RichEditor.openForCreate(finalLatLng.lat, finalLatLng.lng, photos);
        
        if (mapInstance && desktopDraftMarker) {
            mapInstance.removeLayer(desktopDraftMarker);
        }
        desktopDraftMarker = null;
    });

    // Les <i data-lucide> du popup doivent être convertis en SVG avant que
    // Leaflet ne les enchâsse (ils ne reçoivent pas de scan global).
    createIcons({ icons: appIcons, root: popupContent });

    desktopDraftMarker.bindPopup(popupContent, { minWidth: 200, closeOnClick: false }).openPopup();

    // Gestion du drag pour ne pas fermer/supprimer le marqueur par erreur
    let isDragging = false;

    // IMPORTANT : On doit anticiper le drag dès le mousedown sur le marqueur
    // car Leaflet peut déclencher la fermeture de la popup avant dragstart
    desktopDraftMarker.on('mousedown', () => {
        isDragging = true;
    });

    // On réinitialise si ce n'était qu'un simple clic (sans drag)
    desktopDraftMarker.on('mouseup', () => {
        setTimeout(() => { isDragging = false; }, 50);
    });

    desktopDraftMarker.on('dragstart', () => {
        isDragging = true;
        desktopDraftMarker.closePopup(); // On ferme proprement pour éviter les artefacts
    });

    desktopDraftMarker.on('dragend', () => {
        isDragging = false;
        // Les boutons Maps/OSM lisent la position du marqueur à la volée
        // (handler ci-dessus), donc rien à rafraîchir ici. On rouvre juste
        // la popup à la nouvelle position.
        setTimeout(() => {
            if (desktopDraftMarker) desktopDraftMarker.openPopup();
        }, 100);
    });

    // Suppression du marqueur si la popup est fermée (X ou clic ailleurs),
    // SAUF si c'est à cause du drag (qui ferme temporairement la popup)
    desktopDraftMarker.on('popupclose', () => {
        if (!isDragging && mapInstance && desktopDraftMarker) {
            mapInstance.removeLayer(desktopDraftMarker);
            desktopDraftMarker = null;
        }
    });
}

// L'ancienne fonction openDesktopAddModal a été supprimée car remplacée par RichEditor.

// --- LOGIQUE WIZARD & OUTILS ---

export function setupDesktopTools() {
    // PR 6 : le bouton legacy #btn-mode-selection a été supprimé du header.
    // Le passage en mode création se fait désormais uniquement via :
    //   - le choix "Créer mon circuit" de la modale d'accueil (welcome-actions)
    //   - le bouton + (mc-btn-new) de l'onglet Mes Circuits (émet circuit:create-new)
    // Les filtres topbar restent appliqués automatiquement quand le mode est actif.
}

// Reset du circuit en cours + activation du mode sélection + refresh des règles
// de filtrage. Appelé via l'event `circuit:create-new` (émis par la sidebar V2)
// ou via welcome-actions au choix d'usage "Créer mon circuit".
function enterCircuitCreationMode() {
    // Invalide un loadCircuitById en cours (fetch GPX d'un circuit officiel) :
    // sans ça, sa fin écraserait le brouillon vierge avec le circuit consulté
    // (nom/POIs résiduels — bug 03/06/2026).
    cancelPendingCircuitLoad();
    clearCircuit(false);
    toggleCircuitCreationMode(true);
    applyFilters();
}

// La sidebar V2 (mc-btn-new) émet `circuit:create-new` pour entrer en mode
// création (couplage DOM-DOM évité). Listener enregistré au module-load pour
// qu'il soit toujours actif — no-op gratuit en mobile puisque mc-btn-new n'y
// est pas rendu.
// Fix PR1 (15/05/2026) : le guard « if (isSelectionModeActive) return » a été
// retiré. Il bloquait le bouton (+) quand le drapeau restait true à tort (cas
// vu en consultation : loadCircuitById met isSelectionModeActive=true comme
// drapeau « panneau circuit ouvert » détourné). enterCircuitCreationMode est
// désormais idempotent : clearCircuit(false) reset le brouillon courant puis
// toggleCircuitCreationMode(true) (re)pose le mode — re-cliquer (+) en mode déjà
// actif redémarre simplement une création vierge. Le polymorphisme du drapeau
// sera nettoyé dans une PR refactor dédiée.
eventBus.on('circuit:create-new', () => {
    enterCircuitCreationMode();
});
