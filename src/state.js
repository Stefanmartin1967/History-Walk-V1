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
