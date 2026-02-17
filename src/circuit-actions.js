// circuit-actions.js
import { state } from './state.js';
import { deleteCircuitById, softDeleteCircuit } from './database.js';
import { clearCircuit, setCircuitVisitedState } from './circuit.js';
import { recalculatePlannedCountersForMap } from './gpx.js';
import { applyFilters } from './data.js';
import { isMobileView } from './mobile.js';

/**
 * Logique métier pour supprimer un circuit
 * Gère la base de données, l'état mémoire et les calculs GPX
 */
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

export async function toggleCircuitVisitedStatus(circuitId, isChecked) {
    try {
        await setCircuitVisitedState(circuitId, isChecked);
        return { success: true };
    } catch (error) {
        console.error("Erreur lors du changement de statut visité:", error);
        return { success: false };
    }
}

import { getPoiId } from './data.js'; // Assurez-vous d'ajouter getPoiId aux imports en haut

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