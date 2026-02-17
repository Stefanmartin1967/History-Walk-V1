// fileManager.js
import { state } from './state.js';
import { getPoiId, displayGeoJSON } from './data.js';
import { DOM, closeDetailsPanel, updateExportButtonLabel } from './ui.js'; // Note: DOM is mostly used in ui.js, but keeping import if needed
import { showToast } from './toast.js';
import { saveAppState, savePoiData, saveCircuit, clearStore } from './database.js';
import { processImportedGpx } from './gpx.js';
// Import pour contrôler la vue mobile
import { isMobileView, switchMobileView } from './mobile.js';
import { downloadFile } from './utils.js';

// --- IMPORTATION GÉNÉRIQUE ---

export function handleFileLoad(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const json = JSON.parse(e.target.result);
            
            // Cas 1 : GeoJSON (Carte)
            if (json.type === 'FeatureCollection') {
                const mapName = file.name.replace('.geojson', '').replace('.json', '');
                
                if (isMobileView()) {
                    // Mobile: Chargement mémoire uniquement
                    state.loadedFeatures = json.features || [];
                    state.currentMapId = mapName;
                    await saveAppState('lastMapId', mapName);
                    await saveAppState('lastGeoJSON', json);
                    updateExportButtonLabel(mapName);
                    switchMobileView('circuits');
                } else {
                    // Desktop: Rendu Carte
                    await displayGeoJSON(json, mapName);
                    updateExportButtonLabel(mapName);
                    // On cadre la vue sur la nouvelle carte
                    import('./map.js').then(m => m.fitMapToContent());
                }
            } 
            // Cas 2 : Backup
            else if (json.backupVersion && (json.baseGeoJSON || json.userData)) {
                await restoreBackup(json);
            }
            else {
                showToast("Format de fichier non reconnu.", "error");
            }
        } catch (error) {
            console.error("Erreur lecture fichier:", error);
            showToast("Erreur lors de la lecture du fichier.", "error");
        }
    };
    reader.readAsText(file);
    event.target.value = ''; 
}

// --- SAUVEGARDE (EXPORT) - INCHANGÉ ---
export async function saveUserData(forceFullMode = false) {
    if (!state.currentMapId) return showToast("Aucune carte chargée.", "error");

    const includePhotos = forceFullMode;

    const exportData = {
        backupVersion: state.appVersion || "3.0",
        date: new Date().toISOString(),
        mapId: state.currentMapId,
        baseGeoJSON: {
            type: "FeatureCollection",
            features: state.loadedFeatures.map(f => {
                const featureClone = JSON.parse(JSON.stringify(f));
                const poiId = getPoiId(f);
                if (state.userData[poiId]) {
                    featureClone.properties.userData = JSON.parse(JSON.stringify(state.userData[poiId]));
                }
                if (!includePhotos && featureClone.properties.userData && featureClone.properties.userData.photos) {
                    featureClone.properties.userData.photos = [];
                }
                return featureClone;
            })
        },
        userData: JSON.parse(JSON.stringify(state.userData)), 
        myCircuits: state.myCircuits,
        hiddenPoiIds: state.hiddenPoiIds
    };

    if (!includePhotos) {
        for (const key in exportData.userData) {
            if (exportData.userData[key].photos) {
                exportData.userData[key].photos = [];
            }
        }
    }

    const mode = includePhotos ? 'FULL_MASTER' : 'LITE_Mobile';
    const now = new Date();
    const localDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    const dateStr = localDate.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
    const fileName = `HistoryWalk_Backup_${state.currentMapId}_${mode}_${dateStr}.json`;
    
    downloadJSON(exportData, fileName);
}

async function downloadJSON(data, filename) {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    
    // 1. Création d'un objet File pour le partage
    const safeFileName = filename.replace('.json', '.txt');
    const file = new File([blob], safeFileName, { type: 'text/plain' });

    // 2. Vérification : Est-ce qu'on peut utiliser le menu Partager natif ?
    // (Fonctionne sur Android et iOS modernes)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({
    files: [file],
    title: safeFileName, // <-- ON REMPLACE LE TEXTE EN DUR PAR LE VRAI NOM DU FICHIER
    text: `Backup du ${new Date().toLocaleDateString()}`
});
            // Si le partage a réussi, on s'arrête là (pas besoin de télécharger en double)
            return; 
        } catch (error) {
            // Si l'utilisateur annule le partage ou s'il y a une erreur,
            // on continue vers la méthode classique ci-dessous (fallback).
            if (error.name !== 'AbortError') {
                console.warn("Erreur partage, bascule vers téléchargement classique:", error);
            } else {
                return; // L'utilisateur a annulé volontairement
            }
        }
    }

    // 3. Méthode Classique (PC ou vieux téléphones)
    // C'est le code que tu avais avant, qui sert de roue de secours
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Petit message différent selon le contexte
}

// --- RESTAURATION (Modifiée pour Mobile) ---

async function restoreBackup(json) {
    try {
        showToast("Restauration en cours...", "info");

        // 1. Restaurer la carte de base
        const mapId = json.mapId || 'RestoredMap';
        state.currentMapId = mapId;
        updateExportButtonLabel(mapId);
        await saveAppState('lastMapId', mapId);

        if (json.baseGeoJSON) {
            if (isMobileView()) {
                // Mobile: On stocke juste en mémoire
                state.loadedFeatures = json.baseGeoJSON.features || [];
                // IMPORTANT: Sauvegarder le geojson pour le prochain reload
                await saveAppState('lastGeoJSON', json.baseGeoJSON);
            } else {
                // Desktop: On affiche
                await displayGeoJSON(json.baseGeoJSON, mapId);
            }
        }

        // 2. Restaurer les données utilisateur
        if (json.userData) {
            state.userData = json.userData;
            for (const [id, data] of Object.entries(state.userData)) {
                await savePoiData(state.currentMapId, id, data);
            }

            state.loadedFeatures.forEach(feature => {
        const id = getPoiId(feature);
        if (state.userData[id]) {
            feature.properties.userData = state.userData[id];
        }
    });

        }

        // 3. Restaurer les circuits
        if (json.myCircuits && Array.isArray(json.myCircuits)) {
            state.myCircuits = json.myCircuits;
            state.activeCircuitId = null; 
            state.currentCircuit = [];
            
            await clearStore('circuits'); 
            for (const circuit of state.myCircuits) {
                await saveCircuit(circuit);
            }
        }
        
        // 4. Restaurer les suppressions
        if (json.hiddenPoiIds) {
            state.hiddenPoiIds = json.hiddenPoiIds;
            await saveAppState(`hiddenPois_${state.currentMapId}`, state.hiddenPoiIds);
        }

        // 5. Rafraîchissement UI
        if (closeDetailsPanel) closeDetailsPanel();

        if (isMobileView()) {
            // FORCE LE RAFRAÎCHISSEMENT MOBILE
            console.log("Restauration Mobile Terminée -> Refresh UI");
            switchMobileView('circuits');
        } else {
            // Desktop Refresh
            const { applyFilters } = await import('./data.js'); 
            if (applyFilters) applyFilters();
        }

    } catch (error) {
        console.error("Erreur restauration:", error);
        showToast("Erreur lors de la restauration.", "error");
    }
}

// --- IMPORTS SPÉCIFIQUES ---

export async function handleGpxFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (state.circuitIdToImportFor) {
        try {
            await processImportedGpx(file, state.circuitIdToImportFor);
        } catch (err) {
            console.error("Erreur import GPX:", err);
            showToast("Erreur lors de l'import du GPX.", "error");
        }
    } else {
        showToast("Veuillez sélectionner un circuit avant d'importer un GPX.", "warning");
    }
    event.target.value = '';
}

export function handlePhotoImport(event) {
    const files = Array.from(event.target.files);
    if (!files || files.length === 0) return;
    event.target.value = '';

    import('./desktopMode.js').then(module => {
        if (module.handleDesktopPhotoImport) {
            module.handleDesktopPhotoImport(files);
        } else {
            showToast("Import photos non disponible ici", "warning");
        }
    }).catch(err => {
        showToast("Erreur chargement module Photos", "error");
    });
}

export function handleRestoreFile(event) {
    const file = event.target.files[0];
    if(!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const json = JSON.parse(e.target.result);
            restoreBackup(json);
        } catch(err) {
            console.error(err);
            showToast("Fichier de sauvegarde invalide", "error");
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

/**
 * MOTEUR INTERNE : Prépare l'objet de sauvegarde avec le bon format
 */
async function prepareExportData(includePhotos = false) {
    const geojson = {
        type: 'FeatureCollection',
        features: state.loadedFeatures.map(f => {
            const poiId = getPoiId(f);
            const userData = state.userData[poiId] || {};
            const finalUserData = { ...userData };
            if (!includePhotos) delete finalUserData.photos;

            return {
                ...f,
                properties: { 
                    ...f.properties, 
                    userData: finalUserData 
                }
            };
        })
    };

    // On retourne le format "Carton avec étiquette" attendu par la Fusion
    return {
        backupVersion: "3.0",
        mapId: state.currentMapId || 'djerba',
        date: new Date().toISOString(),
        baseGeoJSON: geojson,
        userData: state.userData || {},
        myCircuits: state.myCircuits || [],
        hiddenPoiIds: state.hiddenPoiIds || [],
        officialCircuitsStatus: state.officialCircuitsStatus || {}
    };
}

/**
 * BOUTON : Sauvegarde Mobile / Lite (Sans photos)
 */
export async function exportDataForMobilePC() {
    try {
        const data = await prepareExportData(false);
        const jsonString = JSON.stringify(data, null, 2);
        
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 10) + '_' + 
                          now.getHours().toString().padStart(2, '0') + 'h' + 
                          now.getMinutes().toString().padStart(2, '0');
        
        // CHANGEMENT ICI : On force l'extension .txt pour le Mobile
        const fileName = `HistoryWalk_Backup_Mobile_${timestamp}.txt`;
        
        // CHANGEMENT ICI : On force le type 'text/plain'
        downloadFile(fileName, jsonString, 'text/plain');
        
        showToast("Sauvegarde légère (.txt) prête à être partagée !", "success");
    } catch (err) {
        console.error("Erreur Export Lite:", err);
        showToast("Erreur lors de l'export léger", "error");
    }
}

/**
 * BOUTON : Sauvegarde Full PC (Avec photos)
 */
export async function exportFullBackupPC() {
    try {
        const data = await prepareExportData(true);
        const jsonString = JSON.stringify(data, null, 2);
        
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 10) + '_' + 
                          now.getHours().toString().padStart(2, '0') + 'h' + 
                          now.getMinutes().toString().padStart(2, '0');
        
        const fileName = `HistoryWalk_FULL_PC_${timestamp}.json`;
        downloadFile(fileName, jsonString, 'application/json');
        showToast("Sauvegarde complète terminée", "success");
    } catch (err) {
        console.error("Erreur Export Full:", err);
        showToast("Erreur lors de l'export complet", "error");
    }
}

/**
 * EXPORT CIRCUITS OFFICIELS (JSON uniquement)
 * Génère un fichier [mapId].json basé sur les circuits locaux actuels
 */
export async function exportOfficialCircuitsJSON() {
    try {
        const { getRealDistance, getOrthodromicDistance } = await import('./map.js');

        // On fusionne les circuits locaux (futurs officiels) ET les circuits officiels existants
        // (moins ceux qui ont été supprimés de la mémoire via God Mode)
        const localCircuits = state.myCircuits.filter(c => !c.isDeleted);
        const officialCircuits = state.officialCircuits || [];

        const sourceCircuits = [...officialCircuits, ...localCircuits];

        if (sourceCircuits.length === 0) {
            showToast("Aucun circuit à exporter.", "warning");
            return;
        }

        const exportArray = sourceCircuits.map((c, index) => {
            // Résolution des distances
            const circuitFeatures = c.poiIds
                .map(id => state.loadedFeatures.find(f => getPoiId(f) === id))
                .filter(Boolean);

            let distDisplay = "0 km";
            if (circuitFeatures.length > 0) {
                // Si distance déjà stockée et pas de trace chargée, on garde l'existant (précision)
                if (c.distance && !c.realTrack) {
                     distDisplay = c.distance;
                } else {
                    let d = 0;
                    if (c.realTrack) {
                        d = getRealDistance(c);
                    } else {
                        d = getOrthodromicDistance(circuitFeatures);
                    }
                    distDisplay = (d / 1000).toFixed(1) + ' km';
                }
            } else if (c.distance) {
                // Fallback si features pas chargés mais distance existe
                distDisplay = c.distance;
            }

            // Génération d'un nom de fichier GPX théorique si absent
            let fileName = c.file;
            if (!fileName) {
                const safeName = c.name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '_')
                    .replace(/^_+|_+$/g, '');
                fileName = `${safeName}.gpx`;
            }

            // Détection de la présence d'une trace réelle (Flag pour l'icône Bird/Foot)
            // Si c'est un officiel existant, il a déjà 'realTrack' en mémoire s'il a été chargé
            // Ou s'il vient d'être importé comme trace réelle.
            // Si on a simplement chargé la liste depuis le JSON, on peut avoir l'ancien flag.
            // Le but est d'être le plus précis possible.
            // Si un fichier GPX est défini ('file'), il y a probablement une trace.
            // Si realTrack est chargé et non vide, c'est sûr.
            // Si hasRealTrack était déjà là (importé du JSON), on le garde sauf preuve du contraire.
            const hasRealTrack = (c.realTrack && c.realTrack.length > 0) || c.hasRealTrack || !!c.file;

            return {
                id: c.id, // On garde l'ID original (HW-...) pour la robustesse
                name: c.name,
                file: fileName,
                description: c.description || "Pas de description.",
                distance: distDisplay,
                isOfficial: true,
                hasRealTrack: hasRealTrack, // NOUVEAU FLAG POUR L'ICÔNE
                poiIds: c.poiIds // On garde les IDs pour la reconstruction
            };
        });

        const jsonString = JSON.stringify(exportArray, null, 2);

        const fileName = `${state.currentMapId || 'circuits'}.json`;
        downloadFile(fileName, jsonString, 'application/json');

        // RESET FLAG
        state.hasUnexportedChanges = false;

        showToast(`${exportArray.length} circuits exportés pour le serveur.`, "success");
        showToast("N'oubliez pas d'exporter les GPX correspondants !", "info");

    } catch (err) {
        console.error("Erreur Export Circuits:", err);
        showToast("Erreur lors de l'export des circuits", "error");
    }
}