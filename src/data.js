// data.js
// --- 1. IMPORTS ---
import { state } from './state.js';
import { eventBus } from './events.js';
import { 
    getAllPoiDataForMap, 
    getAllCircuitsForMap, 
    savePoiData, 
    getAppState, 
    saveAppState,
    saveCircuit
} from './database.js';
import { logModification } from './logger.js';
import { showToast } from './toast.js';
import { getPoiId, getPoiName, generateHWID } from './utils.js';
import { addToDraft, getMigrationId, getAdminDraft } from './admin-control-center.js';
import { getDomainFromUrl } from './url-utils.js';

// --- UTILITAIRES ---

export { getPoiId, getPoiName, checkAndApplyMigrations, getDomainFromUrl };

// --- GESTION DES MIGRATIONS D'ID (ADMIN) ---

async function checkAndApplyMigrations() {
    if (!state.isAdmin || !state.loadedFeatures) return;

    let migrationsCount = 0;
    const idMap = {}; // oldId -> newId

    // On pré-remplit le map avec les migrations déjà présentes dans le brouillon
    const draft = getAdminDraft();
    Object.entries(draft.pendingPois).forEach(([newId, data]) => {
        if (data.type === 'migration' && data.oldId) {
            idMap[data.oldId] = newId;
        }
    });

    state.loadedFeatures.forEach((feature, index) => {
        const pId = getPoiId(feature);

        // Un ID est considéré comme "Legacy" s'il est absent, s'il vient de la génération auto (gen_, custom_)
        // ou s'il ne respecte pas le format strict HW-ULID (HW- suivi de 26 caractères)
        const isLegacyId = !pId ||
                           pId.startsWith('gen_') ||
                           pId.startsWith('custom_') ||
                           !pId.startsWith('HW-') ||
                           pId.length !== 29; // HW- (3 chars) + ULID (26 chars)

        if (isLegacyId) {
            const oldId = pId;
            const newId = getMigrationId(oldId) || generateHWID();

            console.log(`[Admin Migration] Unification ID : ${oldId || 'EMPTY'} -> ${newId}`);

            feature.properties.HW_ID = newId;
            idMap[oldId] = newId;

            // 1. Migration des données utilisateur associées (Carnet de Voyage)
            if (oldId && state.userData[oldId]) {
                state.userData[newId] = state.userData[oldId];
                // Sécurité : on s'assure que userData ne contient pas d'ID qui écraserait le nouveau
                delete state.userData[newId].HW_ID;
                delete state.userData[newId].id;
                // Note: On ne supprime pas l'ancien pour la session courante pour éviter de tout casser
            }

            // 2. Migration du statut "caché"
            if (oldId && state.hiddenPoiIds.includes(oldId)) {
                state.hiddenPoiIds = state.hiddenPoiIds.map(id => id === oldId ? newId : id);
            }

            // [ADMIN] Enregistrement dans le brouillon pour publication sur GitHub
            addToDraft('poi', newId, { type: 'migration', oldId: oldId });
            migrationsCount++;
        }
    });

    if (migrationsCount > 0 || Object.keys(idMap).length > 0) {
        // 3. Migration des CIRCUITS (Mise à jour des étapes)
        let circuitsUpdated = 0;
        const allCircuits = [...(state.myCircuits || []), ...(state.officialCircuits || [])];

        for (const circuit of allCircuits) {
            if (!circuit.poiIds) continue;

            let hasChanged = false;
            const newPoiIds = circuit.poiIds.map(pid => {
                if (idMap[pid]) {
                    hasChanged = true;
                    return idMap[pid];
                }
                return pid;
            });

            if (hasChanged) {
                circuit.poiIds = newPoiIds;
                circuitsUpdated++;

                // Sauvegarde immédiate si c'est un circuit perso (dans IndexedDB)
                if (state.myCircuits.includes(circuit)) {
                    await saveCircuit(circuit);
                }

                // Tracking admin pour le circuit
                addToDraft('circuit', circuit.id, { type: 'update' });
            }
        }

        // 4. Sauvegarde persistante de l'état (userData, hiddenPois et customFeatures)
        await saveAppState('userData', state.userData);
        await saveAppState(`hiddenPois_${state.currentMapId}`, state.hiddenPoiIds);
        await saveAppState(`customPois_${state.currentMapId}`, state.customFeatures);

        showToast(`${migrationsCount} IDs unifiés et ${circuitsUpdated} circuits mis à jour.`, "success");
        applyFilters(); // Rafraîchir pour appliquer les nouveaux IDs aux listeners
    }
}

// Écouteur pour déclencher la migration dès que le mode Admin est activé
eventBus.on('admin:mode-toggled', (isAdmin) => {
    if (isAdmin) checkAndApplyMigrations();
});

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

    // 1.5 Pré-chargement des données utilisateur pour la migration
    state.userData = Object.assign({}, storedUserData);

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

    // 3. Préparation des données (Injection des notes/statuts utilisateur + Migration IDs)
    state.loadedFeatures = allFeatures.map((feature, index) => {
        let pId = getPoiId(feature);

        // --- GESTION DES IDENTIFIANTS MANQUANTS ---
        // Pour les utilisateurs normaux, on assure un ID temporaire stable pour la session si HW_ID manque.
        // La migration réelle vers HW-ULID est gérée par checkAndApplyMigrations() en mode Admin.
        if (!pId) {
            pId = `gen_${index}`;
            feature.properties.HW_ID = pId;
        }
        
        // On injecte les données utilisateur (Notes, Visité, etc.)
        state.userData[pId] = state.userData[pId] || {};
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

    // Force le rafraîchissement des marqueurs Leaflet si la catégorie a changé
    if (key === 'Catégorie') {
        applyFilters();
    }

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

    // Sécurité : On s'assure que le POI a un ID au format HW-ULID avant traitement
    if (!feature.properties) feature.properties = {};
    const currentId = getPoiId(feature);
    if (!currentId || !currentId.startsWith('HW-') || currentId.length !== 29) {
        feature.properties.HW_ID = generateHWID();
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
