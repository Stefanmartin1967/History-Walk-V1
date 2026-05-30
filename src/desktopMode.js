import L from 'leaflet';
import { applyFilters } from './data.js';
import { clearCircuit } from './circuit.js';
import { toggleCircuitCreationMode } from './ui-circuit-editor.js';
import { map } from './map.js';
import { addPoiFeature, getPoiId, getPoiName, updatePoiData } from './data.js';
import { state } from './state.js';
import { saveAppState, savePoiData, getPoiPhotos, savePoiPhotos, getPendingAdminPhotos, setPendingAdminPhotos } from './database.js';
import { compressImage, generatePhotoId } from './photo-service.js';
import { logModification } from './logger.js';
import { DOM } from './ui-dom.js';
import { closeAllDropdowns } from './ui-utils.js';
import { closeDetailsPanel, openDetailsPanel } from './ui-details.js';
import { getExifLocation, resizeImage } from './utils.js';
import { clusterPhotos, DEFAULT_CLUSTER_METHOD } from './photo-clustering.js';
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

// --- FONCTION D'IMPORT AVEC CLUSTERING ET DÉTECTION ---
export async function handleDesktopPhotoImport(filesList) {

    const files = Array.from(filesList);
    if (!files || files.length === 0) {
        showToast("Erreur : Aucun fichier reçu par le module.", "error");
        return;
    }

    const loader = (DOM && DOM.loaderOverlay) ? DOM.loaderOverlay : null;
    if (loader) loader.style.display = 'flex';

    try {
        // --- ETAPE 1 : EXTRACTION GPS + DATE ---
        const filesData = [];

        for (let file of files) {
            try {
                const meta = await getExifLocation(file);
                filesData.push({ file, coords: { lat: meta.lat, lng: meta.lng }, date: meta.date, hasGps: true });
            } catch (e) {
                console.warn(`[Import] Pas de GPS pour ${file.name}:`, e.message);
                filesData.push({ file, coords: null, date: null, hasGps: false });
            }
        }

        const validItems = filesData.filter(f => f.hasGps);
        if (validItems.length === 0) {
             if (loader) loader.style.display = 'none';
             return showToast("Aucune coordonnée GPS trouvée dans ces photos.", 'error');
        }

        // --- ETAPE 2 : PRÉ-CALCUL BASE64 (thumbnails) ---
        // 320px (≥ ~225px d'affichage en grille plein écran) → vignettes nettes
        // sans alourdir l'import. Sert aussi la pellicule de la lightbox. Fait à
        // plat sur les items (les clusters référencent les mêmes objets).
        for (const item of validItems) {
            if (!item.base64) {
                try { item.base64 = await resizeImage(item.file, 320); }
                catch (e) { console.error("Pré-calcul base64:", e); }
            }
        }

        // --- ETAPE 3 : GROUPEMENT (cf. photo-clustering.js) ---
        // Méthode par défaut 'by-poi' (1 groupe = POI le plus proche). La modale
        // expose un switch admin pour comparer en direct avec 'proximity'
        // (transitif 80 m, historique) sur le MÊME import — d'où le passage de
        // validItems à la modale.
        const enrichedClusters = clusterPhotos(
            validItems, state.loadedFeatures, DEFAULT_CLUSTER_METHOD, state.hiddenPoiIds
        );

        // Centrage carte sur le 1er cluster (UX visuelle, non bloquant)
        if (map && enrichedClusters.length > 0 && enrichedClusters[0].center) {
            const firstCenter = enrichedClusters[0].center;
            map.flyTo([firstCenter.lat, firstCenter.lng], 14, { duration: 0.8 });
        }

        if (loader) loader.style.display = 'none';

        // --- ETAPE 4 : OUVERTURE DU MODAL BATCH ---
        await openPhotoBatchModal(enrichedClusters, validItems);

    } catch (error) {
        if (loader) loader.style.display = 'none';
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
    const existingSizes = new Set(existingPhotos.map(p => p.blob.size));

    let added = 0;
    let duplicates = 0;
    const newItems = [...existingPhotos];

    for (const item of clusterItems) {
        try {
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

            // Détection doublon par taille (approximation fiable après compression déterministe)
            const isDuplicate = [...existingSizes].some(
                s => Math.abs(s - blob.size) <= Math.max(s * 0.01, 512)
            );

            if (isDuplicate) {
                duplicates++;
            } else {
                existingSizes.add(blob.size);
                newItems.push({ id: generatePhotoId(), blob });
                added++;
            }
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
        <div id="desktop-draft-coords" class="ghost-popup-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
        <div class="ghost-popup-hint">Glissez pour ajuster.</div>
        <button id="btn-validate-desktop-poi" class="action-btn ghost-popup-btn">
            Valider cette position
        </button>
    `;

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

        // Update coords display
        const { lat, lng } = desktopDraftMarker.getLatLng();
        const coordsEl = popupContent.querySelector('#desktop-draft-coords');
        if (coordsEl) coordsEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

        // On rouvre la popup à la nouvelle position
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
