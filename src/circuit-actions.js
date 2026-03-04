
// circuit-actions.js
import { state, addMyCircuit } from './state.js';
import { deleteCircuitById, softDeleteCircuit } from './database.js';
import { clearCircuit, setCircuitVisitedState } from './circuit.js';
import { applyFilters, getPoiId } from './data.js';
import { isMobileView } from './mobile.js';
import { showConfirm } from './modal.js';

/**
 * Logique métier pour supprimer un circuit
 * Gère la base de données, l'état mémoire et les calculs GPX
 */
export async function performCircuitDeletion(id) {
    try {
        // 0. Gestion suppression (Officiel vs Local)
        const isOfficial = state.officialCircuits && state.officialCircuits.some(c => c.id === id);

        if (isOfficial) {
            if (!state.isAdmin) {
                return { success: false, message: "Impossible de supprimer un circuit officiel." };
            }
            // ADMIN : Suppression Mémoire Uniquement (Pour Export)
            state.officialCircuits = state.officialCircuits.filter(c => c.id !== id);
            // On ne touche pas à softDeleteCircuit (DB) car ils n'y sont pas.
        } else {
            // STANDARD : Suppression logique (Corbeille)
            await softDeleteCircuit(id);

            // Mise à jour de la mémoire (state) pour les locaux
            const circuit = state.myCircuits.find(c => c.id === id);
            if (circuit) circuit.isDeleted = true;
        }
        
        // FLAG CHANGEMENT
        state.hasUnexportedChanges = true;

        // 3. Si c'était le circuit actif, on nettoie l'affichage
        if (state.activeCircuitId === id) {
            await clearCircuit(false);
        }
        
        // 4. Recalcul technique des compteurs pour les marqueurs de la carte
        await recalculatePlannedCountersForMap(state.currentMapId);
        
        // 5. Mise à jour des filtres (uniquement sur Desktop)
        if (!isMobileView()) {
            applyFilters();
        }
        
        // 6. Succès : On renvoie l'info ET le texte à afficher
        return { 
            success: true, 
            message: "Le circuit a été déplacé dans la corbeille."
        };

    } catch (error) {
        // En cas de panne technique (ex: base de données verrouillée)
        console.error("Erreur technique lors de la suppression:", error);
        return { 
            success: false, 
            message: "Erreur technique : impossible de supprimer le circuit." 
        };
    }
}

/**
 * Change le statut visité d'un circuit sans confirmation (Low-level).
 * @deprecated Utilisez handleCircuitVisitedToggle pour l'action utilisateur avec UI.
 */
export async function toggleCircuitVisitedStatus(circuitId, isChecked) {
    try {
        await setCircuitVisitedState(circuitId, isChecked);
        return { success: true };
    } catch (error) {
        console.error("Erreur lors du changement de statut visité:", error);
        return { success: false };
    }
}

/**
 * Gère l'action utilisateur de bascule du statut "Fait" d'un circuit avec dialogues de confirmation.
 * @param {string} circuitId
 * @param {boolean} currentStatus - Le statut actuel (avant le clic) : true = Déjà fait (on veut décocher), false = Pas fait (on veut cocher)
 * @returns {Promise<{success: boolean, newState?: boolean}>}
 */
export async function handleCircuitVisitedToggle(circuitId, currentStatus) {
    try {
        if (currentStatus) {
             // Il est coché, on veut le décocher
             if (await showConfirm("Réinitialisation", "Voulez-vous vraiment décocher tous les lieux (remettre à 'Non visité') ?", "Tout décocher", "Annuler", true)) {
                 await setCircuitVisitedState(circuitId, false);
                 return { success: true, newState: false };
             }
        } else {
             // Il n'est pas coché, on veut le cocher
             if (await showConfirm("Circuit Terminé", "Bravo ! Marquer tous les lieux de ce circuit comme visités ?", "Tout cocher", "Annuler")) {
                 await setCircuitVisitedState(circuitId, true);
                 return { success: true, newState: true };
             }
        }
        // Annulation par l'utilisateur
        return { success: false };

    } catch (error) {
        console.error("Erreur toggle circuit visited:", error);
        return { success: false };
    }
}


/**
 * Prépare les données des zones : filtre les POI et compte les occurrences par zone
 */
export function getZonesData() {
    if (!state.loadedFeatures || state.loadedFeatures.length === 0) return null;

    // 1. Filtrage (La logique "Métier")
    const preFilteredFeatures = state.loadedFeatures.filter(feature => {
        const poiId = getPoiId(feature);

        // Filtre Liste Noire
        if (state.hiddenPoiIds && state.hiddenPoiIds.includes(poiId)) return false;

        const props = { ...feature.properties, ...feature.properties.userData };
        
        // Filtres d'état (Restaurants, Vus, Planifiés)
        if (state.activeFilters.restaurants && props.Catégorie !== 'Restaurant') return false;
        if (state.activeFilters.vus && props.vu && !props.incontournable) return false;
        
        const isPlanned = (props.planifieCounter || 0) > 0;
        if (state.activeFilters.planifies && isPlanned && !props.incontournable) return false;
        
        return true;
    });

    // 2. Comptage par zone
    const zoneCounts = preFilteredFeatures.reduce((acc, feature) => {
        const zone = feature.properties.Zone;
        if (zone) acc[zone] = (acc[zone] || 0) + 1;
        return acc;
    }, {});

    return {
        totalVisible: preFilteredFeatures.length,
        zoneCounts: zoneCounts,
        sortedZones: Object.keys(zoneCounts).sort()
    };
}








/**
 * Calcule les compteurs "Planifié" pour chaque POI de manière optimisée.
 * @param {Array} features - La liste des POIs chargés (state.loadedFeatures)
 * @param {Array} circuits - La liste des circuits à analyser
 * @returns {Object} Un objet { poiId: count }
 */
export function computeCircuitCounters(features, circuits) {
    const counters = {};

    // OPTIMISATION V2 : Création d'une Map pour accès O(1)
    // Au lieu de features.find() dans la boucle (O(N*M)), on prépare l'index (O(N)).
    const featureMap = new Map();
    features.forEach(f => {
        const id = getPoiId(f);
        featureMap.set(id, f);
        counters[id] = 0; // Init à 0
    });

    const activeCircuits = circuits.filter(c => !c.isDeleted);

    activeCircuits.forEach(circuit => {
        const poiIds = circuit.poiIds || [];
        // Set pour éviter de compter 2 fois le même POI dans un même circuit
        [...new Set(poiIds)].forEach(poiId => {
            if (counters.hasOwnProperty(poiId)) {
                // Recherche O(1) grâce à la Map
                const feature = featureMap.get(poiId);

                // CORRECTION : On ne compte QUE si le POI n'est pas marqué supprimé
                const isDeleted = feature && feature.properties.userData && feature.properties.userData.deleted;

                if (!isDeleted) {
                    counters[poiId]++;
                }
            }
        });
    });

    return counters;
}

export async function recalculatePlannedCountersForMap(mapId) {
    if (!mapId) return;
    try {
        const poiDataForMap = await getAllPoiDataForMap(mapId);
        const circuitsForMap = await getAllCircuitsForMap(mapId);

        // FIX: On ne prend que les circuits NON supprimés
        const activeLocalCircuits = circuitsForMap.filter(c => !c.isDeleted);

        // FIX: On inclut aussi les circuits officiels (qui ne sont pas en base)
        const officialCircuits = state.officialCircuits || [];

        const allCircuits = [...activeLocalCircuits, ...officialCircuits];

        // APPEL DE LA FONCTION OPTIMISÉE
        const counters = computeCircuitCounters(state.loadedFeatures, allCircuits);

        const updatesToBatch = [];
        for (const [poiId, count] of Object.entries(counters)) {
            const currentCount = (poiDataForMap[poiId] && poiDataForMap[poiId].planifieCounter) || 0;
            if (currentCount !== count) {
                updatesToBatch.push({ poiId: poiId, data: { planifieCounter: count } });
            }
        }

        if (updatesToBatch.length > 0) {
            await batchSavePoiData(mapId, updatesToBatch);
        }

        // ... Mise à jour de l'état local ...
        setUserData(await getAllPoiDataForMap(mapId));
        state.loadedFeatures.forEach(feature => {
            const poiId = getPoiId(feature);
            if (state.userData[poiId]) {
                feature.properties.userData = { ...feature.properties.userData, ...state.userData[poiId] };
            }
        });
    } catch (error) {
        console.error("Erreur lors du recalcul des compteurs:", error);
    }
}



export async function saveAndExportCircuit() {
    if (state.currentCircuit.length === 0) return;

    // 1. Détermination du nom : Priorité à l'interface (User) sur la génération auto
    let circuitName = generateCircuitName();
    if (DOM.circuitTitleText && DOM.circuitTitleText.textContent) {
        const uiTitle = DOM.circuitTitleText.textContent.trim();
        // Si le titre de l'UI n'est pas le placeholder par défaut, on le garde
        if (uiTitle && uiTitle !== "Nouveau Circuit") {
            circuitName = uiTitle;
        }
    }

    const draft = await getAppState(`circuitDraft_${state.currentMapId}`);
    let description = (draft && draft.description) ? draft.description : '';
    const transportData = (draft && draft.transport) ? draft.transport : {};

    // --- MODIFICATION V2 : AJOUT SIGNATURE AUTOMATIQUE ---
    const signature = "\n\n(Créé par History Walk)";
    if (!description.includes("History Walk")) {
        description += signature;
    }
    // ----------------------------------------------------

    const poiIds = state.currentCircuit.map(getPoiId);

    let circuitToSave;

    if (state.activeCircuitId) {
        const index = state.myCircuits.findIndex(c => c.id === state.activeCircuitId);
        if (index > -1) {
            circuitToSave = { ...state.myCircuits[index] };
            circuitToSave.name = circuitName;
            circuitToSave.description = description;
            circuitToSave.poiIds = poiIds;
            circuitToSave.transport = transportData;
            updateMyCircuit(circuitToSave);
        } else {
             // Recherche dans les circuits officiels (si on est en train d'éditer une version officielle)
             const offIndex = state.officialCircuits ? state.officialCircuits.findIndex(c => c.id === state.activeCircuitId) : -1;
             if (offIndex > -1) {
                 // On met à jour l'objet en mémoire
                 const offCircuit = state.officialCircuits[offIndex];
                 offCircuit.name = circuitName;
                 offCircuit.description = description;
                 offCircuit.poiIds = poiIds;
                 offCircuit.transport = transportData;
                 // On prépare l'objet pour la sauvegarde DB
                 circuitToSave = offCircuit;
             }
        }
    }

    if (!circuitToSave) {
        const newId = generateHWID();
        circuitToSave = {
            id: newId,
            mapId: state.currentMapId,
            name: circuitName,
            description: description,
            poiIds: poiIds,
            realTrack: null,
            transport: transportData
        };

        addMyCircuit(circuitToSave);
        setActiveCircuitId(newId);
    }

    try {
        await saveCircuit(circuitToSave);
        setHasUnexportedChanges(true); // FLAG CHANGEMENT
        await recalculatePlannedCountersForMap(state.currentMapId);
        applyFilters();
        generateAndDownloadGPX(state.currentCircuit, circuitToSave.id, circuitToSave.name, circuitToSave.description, circuitToSave.realTrack);
        showToast(`Circuit "${circuitToSave.name}" sauvegardé et exporté !`, 'success');
    } catch (error) {
        console.error("Erreur lors de la sauvegarde du circuit :", error);
        showToast("Erreur lors de la sauvegarde du circuit.", 'error');
    }
}
