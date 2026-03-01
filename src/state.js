// state.js
export const APP_VERSION = '3.5.7'; // Version incrémentée (Icon Fix + UI Cleanup)
export const MAX_CIRCUIT_POINTS = 15;

export const POI_CATEGORIES = [
    "A définir", "Café", "Commerce", "Culture et tradition",
    "Curiosité", "Hôtel", "Mosquée", "Pâtisserie", "Photo", "Puits",
    "Restaurant", "Salon de thé", "Site historique", "Site religieux", "Taxi"
].sort();

import { getPoiName } from './utils.js';

// --- 1. LE FRIGO (L'État Global) ---
export const state = {
    isMobile: false,
    currentMapId: null,
    // Structure par défaut robuste pour éviter les crashs si le JSON manque
    destinations: {
        activeMapId: 'djerba',
        maps: {}
    },
    userData: {},
    myCircuits: [],
    officialCircuits: [],
    officialCircuitsStatus: {}, // Statut (Completed) des circuits officiels
    geojsonLayer: null,
    loadedFeatures: [],
    currentFeatureId: null,
    currentCircuitIndex: null,
    isSelectionModeActive: false,
    currentCircuit: [],
    customFeatures: [],
    hiddenPoiIds: [],
    customDraftName: null, // Titre personnalisé pour le brouillon
    activeCircuitId: null,
    circuitIdToImportFor: null,
    orthodromicPolyline: null,
    realTrackPolyline: null,
    ghostMarker: null, // Marqueur temporaire pour la recherche de coordonnées
    draggingMarkerId: null, // Marqueur en cours de déplacement (pour ignorer le clic)
    filterCompleted: false,
    isAdmin: false, // Activation du "God Mode"
    selectionModeFilters: {
        hideVisited: true,
        hidePlanned: true
    },
    activeFilters: {
        categories: [],
        restaurants: false,
        vus: false,
        planifies: false,
        zone: null
    }
};

// --- 2. LES MAJORDOMES (Les "Gardiens" de l'état) ---
// À partir de maintenant, les autres fichiers devront utiliser ces fonctions 
// pour modifier l'état, au lieu de le faire en cachette.

// Gardien pour activer/désactiver le mode Sélection
export function setSelectionMode(isActive) {
    state.isSelectionModeActive = isActive;
    console.log(`[State] Mode sélection est maintenant : ${isActive ? 'ACTIF' : 'INACTIF'}`);
}

// Gardien pour vider le brouillon de circuit
export function resetCurrentCircuit() {
    state.currentCircuit = [];
    console.log("[State] Brouillon de circuit vidé.");
}

// Gardien pour changer de carte/zone
export function setCurrentMap(mapId) {
    state.currentMapId = mapId;
    console.log(`[State] Changement de carte pour : ${mapId}`);
}

// Gardien pour définir les points d'intérêt chargés (features)
export function setLoadedFeatures(features) {
    state.loadedFeatures = features || [];
    console.log(`[State] ${state.loadedFeatures.length} POIs chargés en mémoire.`);
}

// Gardien pour remplacer toute la liste des circuits persos
export function setMyCircuits(circuits) {
    state.myCircuits = circuits || [];
    console.log(`[State] Liste complète de circuits persos mise à jour (${state.myCircuits.length} circuits).`);
}

// Gardien pour ajouter un circuit perso
export function addMyCircuit(circuit) {
    if (!circuit) return;
    state.myCircuits.push(circuit);
    console.log(`[State] Circuit perso ajouté : ${circuit.id} (${circuit.name || 'Sans nom'})`);
}

// Gardien pour mettre à jour un circuit perso existant
export function updateMyCircuit(updatedCircuit) {
    if (!updatedCircuit) return;
    const index = state.myCircuits.findIndex(c => String(c.id) === String(updatedCircuit.id));
    if (index !== -1) {
        state.myCircuits[index] = updatedCircuit;
        console.log(`[State] Circuit perso mis à jour : ${updatedCircuit.id}`);
    } else {
        console.warn(`[State] Impossible de mettre à jour le circuit ${updatedCircuit.id}, il n'existe pas.`);
    }
}

// Gardien pour supprimer un circuit perso
export function removeMyCircuit(circuitId) {
    const initialLength = state.myCircuits.length;
    state.myCircuits = state.myCircuits.filter(c => String(c.id) !== String(circuitId));
    if (state.myCircuits.length < initialLength) {
        console.log(`[State] Circuit perso retiré : ${circuitId}`);
    }
}

// Gardien pour ajouter un point au circuit
export function addPoiToCurrentCircuit(feature) {
    state.currentCircuit.push(feature);
    
    // Pour la console, on essaie de récupérer le nom du lieu
    const poiName = getPoiName(feature);
    console.log(`[State] +1 Point ajouté au circuit : ${poiName}. (Total : ${state.currentCircuit.length})`);
}

// --- NOUVEAU : Helper pour la devise ---
export function getCurrentCurrency() {
    if (!state.currentMapId || !state.destinations || !state.destinations.maps[state.currentMapId]) {
        return ''; // Pas de devise par défaut si non configuré
    }
    return state.destinations.maps[state.currentMapId].currency || '';
}
