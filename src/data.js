// data.js
// --- 1. IMPORTS ---
import { state } from './state.js';
import { eventBus } from './events.js';
import { 
    getAllPoiDataForMap, 
    getAllCircuitsForMap, 
    savePoiData, 
    getAppState, 
    saveAppState 
} from './database.js';
import { logModification } from './logger.js';
import { showToast } from './toast.js';
import { getPoiId, getPoiName } from './utils.js';
import { addToDraft } from './admin-control-center.js';

// --- UTILITAIRES ---

export { getPoiId, getPoiName };

export function getDomainFromUrl(url) {
    if (!url) return '';
    try {
        const hostname = new URL(url).hostname;
        return hostname.replace(/^www\./, '');
    } catch (e) {
        return url;
    }
}

// --- CŒUR DU SYSTÈME : Chargement de la Carte ---

export async function displayGeoJSON(geoJSON, mapId) {
    state.currentMapId = mapId;

    // 0. Mise à jour de l'Identité (Titre de la page)
    if (mapId) {
        const formattedName = mapId.charAt(0).toUpperCase() + mapId.slice(1);
        document.title = `History Walk - ${formattedName}`;
    }
    
    // 1. Récupération des données sauvegardées (Cachés, Notes, Ajouts manuels)
    state.hiddenPoiIds = (await getAppState(`hiddenPois_${mapId}`)) || [];
    const storedUserData = await getAppState('userData') || {}; 
    const storedCustomFeatures = (await getAppState(`customPois_${mapId}`)) || [];
    
    state.customFeatures = storedCustomFeatures || [];

    // 2. FUSION : Carte Officielle + Lieux Ajoutés (Post-its)
    // Utilisation d'un Map pour garantir l'unicité des IDs (évite l'effet fantôme)
    const uniqueFeaturesMap = new Map();

    // A. On charge le GeoJSON (même s'il est "pollué" par le cache, on récupère tout)
    geoJSON.features.forEach(feature => {
        const id = getPoiId(feature);
        uniqueFeaturesMap.set(id, feature);
    });

    // B. On fusionne les lieux personnalisés
    if (state.customFeatures.length > 0) {
        console.log(`[Data] Fusion de ${state.customFeatures.length} lieux personnalisés.`);
        state.customFeatures.forEach(feature => {
            const id = getPoiId(feature);
            // .set() va écraser l'ancien POI s'il existe déjà, empêchant tout doublon !
            uniqueFeaturesMap.set(id, feature); 
        });
    }

    // On reconvertit le Map en tableau pour la suite du traitement
    let allFeatures = Array.from(uniqueFeaturesMap.values());

    // 3. Préparation des données (Injection des notes/statuts utilisateur)
    state.loadedFeatures = allFeatures.map((feature, index) => {
        // Sécurité : On s'assure que chaque feature a un ID stable
        if (!feature.properties.HW_ID) {
            feature.properties.HW_ID = feature.id || `gen_${index}_${Date.now()}`; 
        }
        
        const pId = getPoiId(feature);
        
        // On injecte les données utilisateur (Notes, Visité, etc.)
        state.userData[pId] = state.userData[pId] || storedUserData[pId] || {};
        feature.properties.userData = state.userData[pId];

        // --- GESTION OVERRIDE GEOMETRY (DÉPLACEMENT DE POINT) ---
        if (state.userData[pId].lat && state.userData[pId].lng) {
            feature.geometry.coordinates = [state.userData[pId].lng, state.userData[pId].lat];
        }

        return feature;
    });

    // 4. Lancement de l'affichage
    applyFilters();
}

// --- FILTRES & AFFICHAGE ---

// --- 1. LE TAMIS PUR (Le Cerveau) ---
// Il ne fait que du tri mathématique en mémoire. Il ne touche pas à la carte.
export function getFilteredFeatures() {
    if (!state.loadedFeatures) return [];

    return state.loadedFeatures.filter(feature => {
        const props = { ...feature.properties, ...feature.properties.userData };
        const poiId = getPoiId(feature);
        
        // A. Lieux cachés par l'utilisateur
        if (state.hiddenPoiIds && state.hiddenPoiIds.includes(poiId)) return false; 
        
        // B. Les Filtres Structurels (Zone, Catégorie)
        // Ceux-ci s'appliquent TOUT LE TEMPS, même aux VIPs
        if (state.activeFilters.zone && props.Zone !== state.activeFilters.zone) return false;

        // Filtre Catégories (Multi-sélection)
        if (state.activeFilters.categories && state.activeFilters.categories.length > 0) {
            if (!state.activeFilters.categories.includes(props['Catégorie'])) return false;
        }

        // C. Les incontournables passent TOUJOURS (Exception Majeure pour le statut)
        if (props.incontournable) return true;

        // C.bis. Les lieux du circuit ACTIF passent TOUJOURS (Même si visités ou planifiés ailleurs)
        // Cela permet de voir tout le tracé d'un circuit en cours de consultation, indépendamment des filtres.
        if (state.activeCircuitId && state.currentCircuit && state.currentCircuit.some(f => getPoiId(f) === poiId)) {
            return true;
        }

        // D. Gestion Visité / Planifié (Différente selon le mode)
        if (state.isSelectionModeActive) {
             // MODE SÉLECTION : Filtres stricts définis par le Wizard
             if (state.selectionModeFilters?.hideVisited && props.vu) return false;
             if (state.selectionModeFilters?.hidePlanned && (props.planifieCounter || 0) > 0) return false;
        } else {
             // MODE STANDARD : Filtres toggles de la barre
             if (state.activeFilters.vus && props.vu) return false;
             if (state.activeFilters.planifies && (props.planifieCounter || 0) > 0) return false;
        }
        
        return true;
    });
}

// --- 2. LE DISTRIBUTEUR ---
export function applyFilters() {
    // 1. On passe les données au Tamis
    const visibleFeatures = getFilteredFeatures();

    // 2. On envoie le signal
    console.log(`[Filtre] ${visibleFeatures.length} lieux trouvés.`);

    // On notifie le reste de l'application que les données filtrées sont prêtes
    eventBus.emit('data:filtered', visibleFeatures);
}

// --- MODIFICATION DES DONNÉES ---

export async function updatePoiData(poiId, key, value) {
    // Initialisation si vide
    if (!state.userData[poiId]) state.userData[poiId] = {};
    
    // Mise à jour locale
    state.userData[poiId][key] = value;

    // Mise à jour visuelle immédiate (sans recharger toute la carte)
    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    if (feature) {
        feature.properties.userData = state.userData[poiId];
    }

    // Sauvegarde en Base de Données
    await savePoiData(state.currentMapId, poiId, state.userData[poiId]);

    // [ADMIN] Tracking
    if (state.isAdmin) {
        addToDraft('poi', poiId, { key: key, value: value });
    }
}

// --- AJOUT D'UN LIEU (Fonction Post-it) ---

export async function addPoiFeature(feature) {

    console.log("🧐 INSPECTION DU POI REÇU :", feature);
    console.log("[Data] Ajout d'un nouveau lieu (Post-it)...");

    // 1. Ajout à la liste en mémoire vive (pour affichage immédiat)

    // Sécurité : On s'assure que le POI a un ID avant traitement
    if (!feature.properties) feature.properties = {};
    if (!feature.properties.HW_ID && !feature.id) {
        feature.properties.HW_ID = `custom_${Date.now()}`;
    }

    // IMPORTANT : On s'assure que le lien userData est établi
    const id = getPoiId(feature);
    if (!state.userData[id]) state.userData[id] = {};
    feature.properties.userData = state.userData[id];

    state.loadedFeatures.push(feature);
    
    if (!state.customFeatures) state.customFeatures = [];
    // ID déjà récupéré plus haut
    if (!state.customFeatures.find(f => getPoiId(f) === id)) {
        state.customFeatures.push(feature);
    }

    // 2. Sauvegarde SÉPARÉE des ajouts (ne touche pas au GeoJSON officiel)
    await saveAppState(`customPois_${state.currentMapId}`, state.customFeatures);

    // 3. Rafraîchissement de la carte pour afficher le nouveau point
    applyFilters();

    // [ADMIN] Tracking
    if (state.isAdmin) {
        addToDraft('poi', id, { type: 'creation' });
    }
}

// --- MISE À JOUR DE LA POSITION (GEOMETRY) ---

export async function updatePoiCoordinates(poiId, lat, lng) {
    // Initialisation
    if (!state.userData[poiId]) state.userData[poiId] = {};

    // Mise à jour des données (lat/lng)
    state.userData[poiId].lat = lat;
    state.userData[poiId].lng = lng;

    // Mise à jour de la géométrie en mémoire vive
    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    if (feature) {
        feature.geometry.coordinates = [lng, lat];
        feature.properties.userData = state.userData[poiId];
    }

    // Gestion de la persistance (Custom vs Officiel)
    // Si c'est un POI custom, on doit aussi mettre à jour la liste des customFeatures
    // car elle est sauvegardée séparément dans customPois_mapId
    const customFeatureIndex = state.customFeatures.findIndex(f => getPoiId(f) === poiId);
    if (customFeatureIndex !== -1) {
        state.customFeatures[customFeatureIndex].geometry.coordinates = [lng, lat];
        // On sauvegarde la liste complète des customs
        await saveAppState(`customPois_${state.currentMapId}`, state.customFeatures);
    }

    // Dans tous les cas, on sauvegarde userData (pour les officiels, c'est la seule trace)
    await savePoiData(state.currentMapId, poiId, state.userData[poiId]);

    // Log
    await logModification(poiId, 'Deplacement', 'All', null, `Nouvelle position : ${lat.toFixed(5)}, ${lng.toFixed(5)}`);

    // [ADMIN] Tracking
    if (state.isAdmin) {
        addToDraft('poi', poiId, { type: 'coords', lat, lng });
    }
}

// --- SUPPRESSION DE LIEU (Soft Delete + Admin Draft) ---

export async function deletePoi(poiId) {
    // 1. Gestion Liste cachée (pour l'affichage local immédiat)
    if (!state.hiddenPoiIds) state.hiddenPoiIds = [];
    if (!state.hiddenPoiIds.includes(poiId)) {
        state.hiddenPoiIds.push(poiId);
    }
    await saveAppState(`hiddenPois_${state.currentMapId}`, state.hiddenPoiIds);

    // 2. Gestion de la persistance (Si c'est un POI Custom)
    // On le retire physiquement de la liste des customs pour ne pas le recharger au prochain démarrage
    if (state.customFeatures) {
        const idx = state.customFeatures.findIndex(f => getPoiId(f) === poiId);
        if (idx !== -1) {
            state.customFeatures.splice(idx, 1);
            await saveAppState(`customPois_${state.currentMapId}`, state.customFeatures);
        }
    }

    // 3. Admin Tracking (Pour suppression définitive sur le serveur)
    if (state.isAdmin) {
        // On marque l'intention de suppression
        addToDraft('poi', poiId, { type: 'delete' });

        // On marque aussi l'objet en mémoire pour l'exporteur
        const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
        if (feature) {
            if (!feature.properties.userData) feature.properties.userData = {};
            feature.properties.userData._deleted = true;
        }
    }

    // 4. Rafraîchissement UI
    applyFilters();
}
