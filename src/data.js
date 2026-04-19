// data.js
// --- 1. IMPORTS ---
import { state, setCurrentMap, setLoadedFeatures } from './state.js';
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
import { schedulePush } from './gist-sync.js';
import { showToast } from './toast.js';
import { getPoiId, getPoiName, generateHWID, getZoneFromCoords } from './utils.js';
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
    setCurrentMap(mapId);

    // 0. Mise à jour de l'Identité (Titre de la page)
    if (mapId) {
        const formattedName = mapId.charAt(0).toUpperCase() + mapId.slice(1);
        document.title = `History Walk - ${formattedName}`;
    }
    
    // 1. Récupération des données sauvegardées (Cachés, Notes, Ajouts manuels)
    state.hiddenPoiIds = (await getAppState(`hiddenPois_${mapId}`)) || [];

    // Récupération globale (legacy/backup) et spécifique à la carte
    const appStateUserData = await getAppState('userData') || {};
    const mapUserData = await getAllPoiDataForMap(mapId) || {};

    // SÉCURITÉ DES DONNÉES (Phase 1) :
    // Au lieu d'un écrasement brutal (...appStateUserData, ...mapUserData) qui remplace
    // tout l'objet d'un POI, on fait une fusion profonde (deep merge) pour chaque POI.
    // Cela garantit qu'une note enregistrée dans 'appState' n'est pas effacée par un
    // statut 'vu' enregistré dans 'mapUserData'.
    const storedUserData = { ...appStateUserData };
    for (const [poiId, data] of Object.entries(mapUserData)) {
        if (storedUserData[poiId]) {
            // Si le POI existe déjà, on fusionne les attributs
            storedUserData[poiId] = { ...storedUserData[poiId], ...data };
        } else {
            // Sinon on l'ajoute
            storedUserData[poiId] = data;
        }
    }

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
        state.customFeatures.forEach(feature => {
            const id = getPoiId(feature);
            // .set() va écraser l'ancien POI s'il existe déjà, empêchant tout doublon !
            uniqueFeaturesMap.set(id, feature); 
        });
    }

    // On reconvertit le Map en tableau pour la suite du traitement
    let allFeatures = Array.from(uniqueFeaturesMap.values());

    // 3. Préparation des données (Injection des notes/statuts utilisateur + Migration IDs)
    const newFeatures = allFeatures.map((feature, index) => {
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
    setLoadedFeatures(newFeatures);

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

        // D.bis. Filtre "Non vérifiés seulement" (admin/révision)
        if (state.activeFilters.nonVerifies && props.verified) return false;

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

    // On notifie le reste de l'application que les données filtrées sont prêtes
    eventBus.emit('data:filtered', visibleFeatures);
}

// --- MODIFICATION DES DONNÉES ---

export async function updatePoiData(poiId, key, value) {
    // Initialisation si vide
    if (!state.userData[poiId]) state.userData[poiId] = {};

    // Mise à jour locale
    state.userData[poiId][key] = value;

    // Si c'est un POI en attente (créé mobile, non encore persisté),
    // on finalise sa création dès qu'un champ est touché.
    await commitPendingPoiIfNeeded(poiId);

    // Mise à jour visuelle immédiate (sans recharger toute la carte)
    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    if (feature) {
        feature.properties.userData = state.userData[poiId];
    }

    // Sauvegarde en Base de Données
    await savePoiData(state.currentMapId, poiId, state.userData[poiId]);
    showToast('Enregistré', 'success', 1500);

    // Sync Gist (debounced 3s)
    schedulePush();

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

// --- POI EN ATTENTE (Option 1 : persistance différée) ---
// Usage : sur mobile, le bouton "+" crée un POI en mémoire uniquement.
// La persistance (customPois + lastGeoJSON) n'intervient qu'à la première édition réelle.
// Si l'utilisateur ferme le panneau sans rien éditer, le POI est jeté.

export function addPendingPoiFeature(feature) {
    if (!feature.properties) feature.properties = {};

    // Garantie ID HW-ULID
    const currentId = getPoiId(feature);
    if (!currentId || !currentId.startsWith('HW-') || currentId.length !== 29) {
        feature.properties.HW_ID = generateHWID();
    }

    // Marqueur pending
    feature.properties._pending = true;

    // Lien userData
    const id = getPoiId(feature);
    if (!state.userData[id]) state.userData[id] = {};
    feature.properties.userData = state.userData[id];

    // Ajout mémoire uniquement (pas de saveAppState)
    state.loadedFeatures.push(feature);
    if (!state.customFeatures) state.customFeatures = [];
    if (!state.customFeatures.find(f => getPoiId(f) === id)) {
        state.customFeatures.push(feature);
    }

    // Rafraîchissement carte (le POI apparaît visuellement)
    applyFilters();
}

export async function commitPendingPoiIfNeeded(poiId) {
    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    if (!feature || !feature.properties || !feature.properties._pending) return;

    // On retire le flag avant persistance pour que le GeoJSON sauvegardé soit propre
    delete feature.properties._pending;

    await saveAppState(`customPois_${state.currentMapId}`, state.customFeatures);
    await saveAppState('lastGeoJSON', {
        type: 'FeatureCollection',
        features: state.loadedFeatures
    });

    // [ADMIN] Tracking à la validation réelle (pas à la création volatile)
    if (state.isAdmin) {
        addToDraft('poi', poiId, { type: 'creation' });
    }
}

export function discardPendingPoi(poiId) {
    let changed = false;

    const idx = state.loadedFeatures.findIndex(f => getPoiId(f) === poiId);
    if (idx !== -1 && state.loadedFeatures[idx].properties?._pending) {
        state.loadedFeatures.splice(idx, 1);
        changed = true;
    }

    if (state.customFeatures) {
        const cIdx = state.customFeatures.findIndex(f => getPoiId(f) === poiId);
        if (cIdx !== -1 && state.customFeatures[cIdx].properties?._pending) {
            state.customFeatures.splice(cIdx, 1);
            changed = true;
        }
    }

    // Nettoyage userData éventuellement initialisé
    if (state.userData[poiId]) {
        // userData n'a pas encore été persistée via savePoiData tant que l'utilisateur
        // n'a rien édité, donc un simple delete mémoire suffit.
        const isEmpty = Object.keys(state.userData[poiId]).length === 0;
        if (isEmpty) delete state.userData[poiId];
    }

    if (changed) applyFilters();
}

export function isPendingPoi(poiId) {
    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    return !!(feature && feature.properties && feature.properties._pending);
}

export async function addPoiFeature(feature) {


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

    // [ADMIN] Capture des coordonnées ORIGINALES AVANT mutation, pour
    // permettre un revert propre en cas de "Ignorer" dans le CC.
    // Sans ça, la géométrie en mémoire reste mutée même après Ignorer
    // (jusqu'au F5). Stocké dans adminDraft pour être disponible dans
    // processDecision sans re-fetch réseau.
    let originalLat = null;
    let originalLng = null;
    if (state.isAdmin && feature) {
        const [curLng, curLat] = feature.geometry.coordinates;
        originalLat = curLat;
        originalLng = curLng;
    }

    if (feature) {
        feature.geometry.coordinates = [lng, lat];
        feature.properties.userData = state.userData[poiId];
        // Recalcul automatique de la zone
        const newZone = getZoneFromCoords(lat, lng);
        if (newZone) feature.properties.Zone = newZone;
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

    // [ADMIN] Tracking — on stocke aussi les coords d'origine pour le revert Ignorer.
    if (state.isAdmin) {
        addToDraft('poi', poiId, { type: 'coords', lat, lng, originalLat, originalLng });
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
