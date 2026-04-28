import L from 'leaflet';
import { applyFilters } from './data.js';
import { clearCircuit } from './circuit.js';
import { toggleSelectionMode } from './ui-circuit-editor.js';
import { map } from './map.js';
import { addPoiFeature, getPoiId, getPoiName, updatePoiData } from './data.js';
import { state } from './state.js';
import { openFilterPanel } from './filter-panel.js';
import { saveAppState, savePoiData, getPoiPhotos, savePoiPhotos, getPendingAdminPhotos, setPendingAdminPhotos } from './database.js';
import { compressImage, generatePhotoId } from './photo-service.js';
import { logModification } from './logger.js';
import { DOM } from './ui-dom.js';
import { closeAllDropdowns } from './ui-utils.js';
import { closeDetailsPanel, openDetailsPanel } from './ui-details.js';
import { getExifLocation, calculateDistance, resizeImage, getZoneFromCoords, clusterByLocation, calculateBarycenter, filterOutliers } from './utils.js';
import { showToast } from './toast.js';
import { showPhotoSelectionModal } from './photo-import-ui.js';
import { openPhotoGrid } from './ui-photo-grid.js';
import { openPhotoBatchModal } from './ui-photo-batch.js';
import { RichEditor } from './richEditor.js';
import { eventBus } from './events.js';

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

// Fusionne les clusters qui ont le même POI proche (nearbyPois[0]) et pas encore de renommage.
// Le POI le plus proche "gagne" : on garde le plus petit dist, et on recalcule le barycentre.
function mergeClustersBySamePoi(clusters) {
    const byPoi = new Map(); // poiId -> cluster fusionné
    const result = [];

    for (const c of clusters) {
        const bestPoi = c.nearbyPois?.[0];
        if (!bestPoi) {
            // "Aucun POI proche" : on ne fusionne pas ces clusters
            result.push(c);
            continue;
        }
        const key = getPoiId(bestPoi.feature);
        if (!key) { result.push(c); continue; }

        if (byPoi.has(key)) {
            const prev = byPoi.get(key);
            prev.photos = prev.photos.concat(c.photos);
            // Garde le POI le plus proche
            if (bestPoi.dist < prev.nearbyPois[0].dist) {
                prev.nearbyPois = c.nearbyPois;
            }
        } else {
            byPoi.set(key, c);
            result.push(c);
        }
    }
    return result;
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

        // --- ETAPE 2 : CLUSTERING (80m) ---
        const clusters = clusterByLocation(validItems, 80);

        // --- ETAPE 3 : FILTER OUTLIERS (expansion des clusters) ---
        const expandedClusters = [];
        for (const c of clusters) {
            const { main, outliers } = filterOutliers(c);
            if (main.length > 0) expandedClusters.push(main);
            if (outliers.length > 0) expandedClusters.push(outliers);
        }

        // --- ETAPE 4 : PRÉ-CALCUL BASE64 (thumbnails) ---
        for (const cluster of expandedClusters) {
            for (const item of cluster) {
                if (!item.base64) {
                    try { item.base64 = await resizeImage(item.file, 200); }
                    catch (e) { console.error("Pré-calcul base64:", e); }
                }
            }
        }

        // --- ETAPE 5 : ENRICHISSEMENT (center + nearbyPois + absoluteNearest) ---
        let enrichedClusters = expandedClusters.map(cluster => {
            const center = calculateBarycenter(cluster.map(c => c.coords));

            const nearbyPois = [];
            let absoluteNearest = null;
            let minDist = Infinity;

            state.loadedFeatures.forEach(feature => {
                const pId = getPoiId(feature);
                if (state.hiddenPoiIds && state.hiddenPoiIds.includes(pId)) return;
                if (!feature.geometry || !feature.geometry.coordinates) return;

                const [fLng, fLat] = feature.geometry.coordinates;
                const dist = calculateDistance(center.lat, center.lng, fLat, fLng);

                if (dist < 100) nearbyPois.push({ feature, dist });
                if (dist < minDist) {
                    minDist = dist;
                    absoluteNearest = { feature, dist };
                }
            });

            nearbyPois.sort((a, b) => a.dist - b.dist);

            return {
                photos: cluster,
                center,
                nearbyPois,
                absoluteNearest: nearbyPois.length === 0 ? absoluteNearest : null
            };
        });

        // --- ETAPE 5.5 : FUSION de clusters avec le même POI le plus proche ---
        enrichedClusters = mergeClustersBySamePoi(enrichedClusters);

        // --- ETAPE 5.6 : TRI CHRONOLOGIQUE ---
        // À l'intérieur d'un cluster : photos par date croissante
        // Puis les clusters : par date la plus ancienne
        enrichedClusters.forEach(c => {
            c.photos.sort((a, b) => (a.date || 0) - (b.date || 0));
        });
        enrichedClusters.sort((a, b) => {
            const da = a.photos[0]?.date || 0;
            const db = b.photos[0]?.date || 0;
            return da - db;
        });

        // Centrage carte sur le 1er cluster (UX visuelle, non bloquant)
        if (map && enrichedClusters.length > 0) {
            const firstCenter = enrichedClusters[0].center;
            map.flyTo([firstCenter.lat, firstCenter.lng], 14, { duration: 0.8 });
        }

        if (loader) loader.style.display = 'none';

        // --- ETAPE 6 : OUVERTURE DU MODAL BATCH (Phase 1 : read-only) ---
        await openPhotoBatchModal(enrichedClusters);

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
                blob = new Blob([bytes], { type: mime });
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
    // Bouton "Mode Sélection" : toggle direct du mode création.
    // L'ancienne modale d'assistant (selection-wizard-modal) qui demandait zone +
    // hide-visited + hide-planned a été supprimée — point #5 audit Stefan : ses
    // options sont déjà couvertes par le filtre topbar (#hw-filter-panel) qui
    // gère catégories, zones, parcours (visités/à faire), incontournables.
    // L'utilisateur configure ses filtres via la topbar puis clique Sélection
    // pour activer le mode (les filtres actifs s'appliquent automatiquement aux
    // POIs cliquables sur la carte).
    const btnSelect = document.getElementById('btn-mode-selection');
    if (btnSelect) {
        // On clone le bouton pour supprimer les anciens écouteurs (toggle simple)
        const newBtn = btnSelect.cloneNode(true);
        btnSelect.parentNode.replaceChild(newBtn, btnSelect);

        newBtn.addEventListener('click', () => {
            if (state.isSelectionModeActive) {
                toggleSelectionMode(false);
            } else {
                // Lancement direct : reset circuit en cours + activation +
                // refresh des règles de filtrage.
                clearCircuit(false);
                toggleSelectionMode(true);
                applyFilters();
                // UX : ouvre le panneau Filtres topbar pour que l'utilisateur
                // configure ses filtres comme il faisait via l'ancien wizard
                // (zone, hide-visited, hide-planned, etc.). Sans ça, l'activation
                // du mode est silencieuse et l'utilisateur ne sait pas où trouver
                // les options de filtrage.
                openFilterPanel();
            }
        });
    }
}
