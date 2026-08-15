// data.js
// --- 1. IMPORTS ---
import { state, setCurrentMap, setLoadedFeatures, setCustomFeatures, setHiddenPoiIds, setUserData, setActiveFilter } from './state.js';
import { eventBus } from './events.js';
import {
    getAllPoiDataForMap,
    getAllCircuitsForMap,
    savePoiData,
    getAppState,
    saveAppState,
    saveCircuit,
    normalizeDescriptionCaseInPoiData,
    renameDescriptionCourteToInfoGpxInPoiData
} from './database.js';
import { logModification } from './logger.js';
import { schedulePush } from './gist-sync.js';
import { showToast } from './toast.js';
import { getPoiId, getPoiName, getPoiProp, generateHWID, getDerivedZone, isCandidate, isOsmChecked, isMapsChecked } from './utils.js';
import { addRejected, rejectedData } from './rejected.js';
import { deleteZoneCacheEntry } from './zones.js';
import { addToDraft, getMigrationId, getAdminDraft } from './admin-control-center.js';
import { getDomainFromUrl } from './url-utils.js';
import { PERSONAL_KEYS } from './config.js';
import { recordModification } from './backup-auto-local.js';
import { getCurrentPatrimonialLang } from './patrimonial-names.js';

// --- UTILITAIRES ---

export { getPoiId, getPoiName, checkAndApplyMigrations, getDomainFromUrl };

// Nom patrimonial AFFICHÉ selon la préférence de langue (FR ⇄ AR). En AR : renvoie
// le nom arabe du lieu s'il existe (repli FR sinon) ; un renommage explicite
// (custom_title) prime toujours. Pour la RECHERCHE, ne PAS utiliser ça (chercher
// ≠ afficher) → getSearchableNames, qui matche toutes les variantes. Pour la DÉDUP
// et les clés stables, rester sur getPoiName (FR stable).
export function getPatrimonialName(feature, lang) {
    const resolved = lang || getCurrentPatrimonialLang();
    if (resolved === 'ar' && feature && feature.properties) {
        const props = feature.properties;
        const userData = props.userData || {};
        if (!userData.custom_title) {
            const ar = userData['Nom du site arabe'] || props['Nom du site arabe']
                || userData['Nom du site AR'] || props['Nom du site AR'];
            if (ar && ar.trim()) return ar;
        }
    }
    return getPoiName(feature);
}

// Toutes les variantes de nom d'un POI (custom + FR + arabe + AR + brut), non vides,
// pour une recherche AGNOSTIQUE à la langue : on doit retrouver un lieu en tapant
// son nom FR OU arabe, quel que soit le réglage d'affichage (chercher ≠ afficher).
// À utiliser pour le MATCHING uniquement, jamais pour l'affichage.
export function getSearchableNames(feature) {
    if (!feature || !feature.properties) return [];
    const props = feature.properties;
    const userData = props.userData || {};
    return [
        userData.custom_title,
        userData['Nom du site FR'], props['Nom du site FR'],
        userData['Nom du site arabe'], props['Nom du site arabe'],
        userData['Nom du site AR'], props['Nom du site AR'],
        props.name,
    ].filter(n => typeof n === 'string' && n.trim());
}

// Vrai si le libellé de catégorie apparaît DÉJÀ dans une variante de nom du POI
// (FR/arabe, insensible casse + accents) → la catégorie est redondante avec le nom
// (ex. « Mosquée » sur « Mosquée Ben Hadid » / « جامع … ») et se masque dans les
// listes d'étapes. Sous-chaîne simple, pas de synonymes (« Café » ≠ « Restaurant »
// l'afficherait — voulu). Réutilise getSearchableNames → couvre les deux langues.
export function isCategoryInName(feature, categoryLabel) {
    if (!categoryLabel) return false;
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const cat = norm(categoryLabel);
    if (!cat) return false;
    return getSearchableNames(feature).some((n) => norm(n).includes(cat));
}

// --- GESTION DES MIGRATIONS D'ID (ADMIN) ---

// Migration des IDs legacy (gen_*, custom_*, hors format HW-ULID) vers HW-ULID.
// Cascade le rename à travers 4 entités liées : features.HW_ID, state.userData,
// state.hiddenPoiIds, circuit.poiIds (myCircuits + officialCircuits).
//
// Pattern stage-then-commit : on calcule d'abord toutes les mutations dans des
// snapshots locaux (sans toucher state ni features), on persiste ensuite sous
// try/catch unique. Mutations mémoire appliquées UNIQUEMENT après succès complet
// → si une écriture échoue, l'état mémoire reste intact, l'admin peut retenter.
// (Note : IndexedDB n'offre pas de transaction multi-store via notre wrapper, donc
// une corruption DB partielle reste théoriquement possible, mais la mémoire ne
// dériverait jamais de l'état persisté.)
async function checkAndApplyMigrations() {
    if (!state.isAdmin || !state.loadedFeatures) return;

    // ─── 1. PHASE COMPUTE — détection des migrations, aucun side-effect ───
    const idMap = {}; // oldId -> newId

    const draft = getAdminDraft();
    Object.entries(draft.pendingPois).forEach(([newId, data]) => {
        if (data.type === 'migration' && data.oldId) {
            idMap[data.oldId] = newId;
        }
    });

    const featuresToMigrate = []; // { feature, oldId, newId }
    state.loadedFeatures.forEach(feature => {
        const pId = getPoiId(feature);
        const isLegacyId = !pId ||
                           pId.startsWith('gen_') ||
                           pId.startsWith('custom_') ||
                           !pId.startsWith('HW-') ||
                           pId.length !== 29; // HW- (3) + ULID (26)
        if (!isLegacyId) return;
        const oldId = pId;
        const newId = getMigrationId(oldId) || generateHWID();
        idMap[oldId] = newId;
        featuresToMigrate.push({ feature, oldId, newId });
    });

    if (featuresToMigrate.length === 0 && Object.keys(idMap).length === 0) return;

    // ─── 2. PHASE STAGE — snapshots prêts à persister, state encore intact ───

    // userData : ajout des nouveaux IDs (clones de l'ancien, sans HW_ID/id internes)
    const nextUserData = { ...state.userData };
    for (const { oldId, newId } of featuresToMigrate) {
        if (oldId && state.userData[oldId]) {
            const cleaned = { ...state.userData[oldId] };
            delete cleaned.HW_ID;
            delete cleaned.id;
            nextUserData[newId] = cleaned;
        }
    }

    // hiddenPois : remap des anciens IDs vers les nouveaux
    const nextHiddenPoiIds = state.hiddenPoiIds.map(id => idMap[id] || id);

    // customFeatures : clones des features migrées avec le nouveau HW_ID
    const nextCustomFeatures = (state.customFeatures || []).map(f => {
        const oldId = getPoiId(f);
        if (idMap[oldId]) {
            return { ...f, properties: { ...f.properties, HW_ID: idMap[oldId] } };
        }
        return f;
    });

    // Circuits : calcul des nouveaux poiIds, séparation perso/officiels
    const allCircuits = [...(state.myCircuits || []), ...(state.officialCircuits || [])];
    const circuitsToUpdate = []; // { circuit, newPoiIds, isMine }
    for (const circuit of allCircuits) {
        if (!circuit.poiIds) continue;
        let hasChanged = false;
        const newPoiIds = circuit.poiIds.map(pid => {
            if (idMap[pid]) { hasChanged = true; return idMap[pid]; }
            return pid;
        });
        if (hasChanged) {
            circuitsToUpdate.push({
                circuit,
                newPoiIds,
                isMine: !!(state.myCircuits && state.myCircuits.includes(circuit))
            });
        }
    }

    // ─── 3. PHASE PERSIST — try/catch unique, abort sur la moindre erreur ───
    try {
        await Promise.all([
            saveAppState('userData', nextUserData),
            saveAppState(`hiddenPois_${state.currentMapId}`, nextHiddenPoiIds),
            saveAppState(`customPois_${state.currentMapId}`, nextCustomFeatures),
            ...circuitsToUpdate
                .filter(c => c.isMine)
                .map(c => saveCircuit({ ...c.circuit, poiIds: c.newPoiIds }))
        ]);
    } catch (err) {
        console.error('[Migration] Échec de persistance, mémoire intacte :', err);
        showToast('Échec de la migration des IDs. Aucun changement appliqué, réessaie plus tard.', 'error');
        return;
    }

    // ─── 4. PHASE COMMIT — mutations mémoire après succès garanti ───
    for (const { feature, oldId, newId } of featuresToMigrate) {
        feature.properties.HW_ID = newId;
        if (oldId && state.userData[oldId]) {
            state.userData[newId] = state.userData[oldId];
            delete state.userData[newId].HW_ID;
            delete state.userData[newId].id;
            // L'ancien key reste pour la session courante (évite de casser les
            // refs déjà tenues par d'autres modules).
        }
        addToDraft('poi', newId, { type: 'migration', oldId });
    }
    setHiddenPoiIds(nextHiddenPoiIds);
    for (const { circuit, newPoiIds } of circuitsToUpdate) {
        circuit.poiIds = newPoiIds;
        addToDraft('circuit', circuit.id, { type: 'update' });
    }

    showToast(`${featuresToMigrate.length} IDs unifiés et ${circuitsToUpdate.length} circuits mis à jour.`, 'success');
    applyFilters();
}

// Écouteur pour déclencher la migration dès que le mode Admin est activé
eventBus.on('admin:mode-toggled', (isAdmin) => {
    if (isAdmin) checkAndApplyMigrations();
    // setIsAdmin() vient de resynchroniser le défaut « Existence à confirmer »
    // (state.js) — il faut re-filtrer pour que ça se voie immédiatement,
    // login ET logout (checkAndApplyMigrations peut sortir tôt sans réafficher).
    applyFilters();
});

// --- CŒUR DU SYSTÈME : Chargement de la Carte ---

export async function displayGeoJSON(geoJSON, mapId) {
    setCurrentMap(mapId);

    // 0. Mise à jour de l'Identité (Titre de la page)
    if (mapId) {
        const formattedName = mapId.charAt(0).toUpperCase() + mapId.slice(1);
        document.title = `Heripia - ${formattedName}`;
    }
    
    // 1. Récupération des données sauvegardées (Cachés, Notes, Ajouts manuels)
    setHiddenPoiIds((await getAppState(`hiddenPois_${mapId}`)) || []);

    // Migration one-shot : normalise toute clé `Description` (capital) en
    // `description` (lowercase) dans le store `poiUserData` AVANT lecture, pour
    // que la fusion en mémoire parte d'une base déjà normalisée. Idempotente
    // (no-op si déjà tout en lowercase). Cf. chantier unification description.
    try { await normalizeDescriptionCaseInPoiData(mapId); }
    catch (e) { console.warn('[data] normalizeDescriptionCaseInPoiData failed:', e); }

    // Migration one-shot : renomme `Description_courte` → `info_gpx` dans le
    // store `poiUserData`. Même pattern + même raison qu'au-dessus. Cf.
    // chantier renommage info_gpx (PR à venir).
    try { await renameDescriptionCourteToInfoGpxInPoiData(mapId); }
    catch (e) { console.warn('[data] renameDescriptionCourteToInfoGpxInPoiData failed:', e); }

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

    // Migration : normalise `Description` (capital) → `description` (lowercase)
    // ET renomme `Description_courte` → `info_gpx` sur les entrées issues
    // d'appState/backup (le store poiUserData a déjà été normalisé en amont).
    // Si quelque chose change, on persiste appState pour ne pas avoir à le
    // refaire au prochain boot.
    let appStateDirty = false;
    for (const data of Object.values(storedUserData)) {
        if (!data || typeof data !== 'object') continue;
        if ('Description' in data) {
            if (!('description' in data) || data.description == null) {
                data.description = data.Description;
            }
            delete data.Description;
            appStateDirty = true;
        }
        if ('Description_courte' in data) {
            if (!('info_gpx' in data) || data.info_gpx == null) {
                data.info_gpx = data.Description_courte;
            }
            delete data.Description_courte;
            appStateDirty = true;
        }
    }
    if (appStateDirty) {
        try { await saveAppState('userData', storedUserData); }
        catch (e) { console.warn('[data] saveAppState userData (post-normalize) failed:', e); }
    }

    const storedCustomFeatures = (await getAppState(`customPois_${mapId}`)) || [];

    // Migration : `customFeatures[i].properties.Description` → `.description`
    // ET `.Description_courte` → `.info_gpx` (POIs créés via richEditor
    // stockent déjà en lowercase, mais un backup restauré ou un POI venant
    // du DM/scout peut porter les anciennes clés). Persiste si touché — même
    // règle d'idempotence.
    let customDirty = false;
    for (const f of storedCustomFeatures) {
        const p = f?.properties;
        if (!p) continue;
        if ('Description' in p) {
            if (!('description' in p) || p.description == null) {
                p.description = p.Description;
            }
            delete p.Description;
            customDirty = true;
        }
        if ('Description_courte' in p) {
            if (!('info_gpx' in p) || p.info_gpx == null) {
                p.info_gpx = p.Description_courte;
            }
            delete p.Description_courte;
            customDirty = true;
        }
    }
    if (customDirty) {
        try { await saveAppState(`customPois_${mapId}`, storedCustomFeatures); }
        catch (e) { console.warn('[data] saveAppState customPois (post-normalize) failed:', e); }
    }
    
    setCustomFeatures(storedCustomFeatures || []);

    // 1.5 Pré-chargement des données utilisateur pour la migration
    setUserData(Object.assign({}, storedUserData));

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

/**
 * Calcule à la volée le nombre de circuits ACTIFS contenant ce POI.
 *
 * Définition métier (refonte Mon Espace V2, 14/05/2026) :
 * - Circuit ACTIF = circuit perso non supprimé ET non caché, OU circuit officiel non caché
 * - state.hiddenCircuitIds = []         → tous visibles (défaut)
 * - state.hiddenCircuitIds = [...ids]   → ces ids sont exclus (blacklist, officiels + perso)
 *
 * Placée ici (data.js) plutôt que circuit-actions.js pour éviter un cycle d'import :
 * data.js ne peut pas importer circuit-actions.js (qui importe déjà data.js).
 *
 * @param {string} poiId - HW_ID du POI
 * @returns {number} - Nombre de circuits actifs contenant ce POI
 */
// Circuits ACTIFS = officiels non cachés + perso non supprimés non cachés.
// Source unique pour computePlanifieCounter et buildPlannedPoiSet (P4).
function getActiveCircuits() {
    const hidden = state.hiddenCircuitIds || [];
    const isHidden = (c) => hidden.includes(String(c.id));
    const activeOfficial = (state.officialCircuits || []).filter(c => !isHidden(c));
    const activePerso = (state.myCircuits || []).filter(c => !c.isDeleted && !isHidden(c));
    return [...activeOfficial, ...activePerso];
}

export function computePlanifieCounter(poiId) {
    if (!poiId) return 0;
    return getActiveCircuits()
        .filter(c => Array.isArray(c.poiIds) && c.poiIds.includes(poiId))
        .length;
}

/**
 * Ensemble des POI présents dans AU MOINS un circuit actif. Construit UNE fois
 * par passe de filtrage (P4) : remplace l'appel computePlanifieCounter O(circuits)
 * par POI (→ O(N×M) par filtre, ×2 avec les zones) par une construction O(M) +
 * consultation O(1). À 1000 POI × dizaines de circuits, c'est le cœur du gain.
 * @returns {Set<string>} HW_IDs planifiés
 */
export function buildPlannedPoiSet() {
    const set = new Set();
    for (const c of getActiveCircuits()) {
        if (Array.isArray(c.poiIds)) for (const id of c.poiIds) set.add(id);
    }
    return set;
}

// --- 1. LE TAMIS PUR (Le Cerveau) ---
// Règles "personnelles" (état utilisateur) avec leurs exceptions :
//   - hidden → out
//   - incontournable → in (court-circuit)
//   - POI du circuit actif → in (court-circuit)
//   - non-vérifiés (admin) / vus / planifiés selon mode standard ou sélection
// Ne traite PAS les filtres structurels (zone, catégorie multi). Réutilisée par
// getFilteredFeatures et getZonesData pour garantir la cohérence du compteur de
// zones avec les POI réellement affichés.
export function passesUserFilters(feature, plannedSet = null) {
    if (!feature) return false;
    const props = { ...feature.properties, ...feature.properties.userData };
    const poiId = getPoiId(feature);
    const f = state.activeFilters;

    if (state.hiddenPoiIds && state.hiddenPoiIds.includes(poiId)) return false;

    // État de la fiche (s'applique avant le court-circuit incontournable :
    // un POI incontournable peut être "non vérifié" et l'admin veut le voir).
    // 3-states : 'all' (pas de filtre) | 'hide' (cache ceux qui ont la prop) | 'only' (n'affiche que ceux qui ont la prop).
    if (f.verified === 'hide' && props.verified) return false;
    if (f.verified === 'only' && !props.verified) return false;
    // P8 — « Introuvable sur la carte » (lieu non situable sur Maps/OSM). 'only' =
    // file de revue (n'affiche que ces lieux pour les retraiter).
    if (f.introuvableCarte === 'hide' && props.introuvableCarte) return false;
    if (f.introuvableCarte === 'only' && !props.introuvableCarte) return false;
    // Checklist de vérification (15/08/2026) : 'only' = file de travail par
    // source (n'affiche que ceux encore à checker, ou déjà checkés, selon le sens).
    // isOsmChecked/isMapsChecked (utils.js) et NON props.osmChecked en direct :
    // une référence renseignée vaut vérifié, sinon le filtre ignore les 280 POI
    // qui ont un osm_ref sans avoir été ré-enregistrés depuis l'ajout du flag.
    const osmOk = isOsmChecked(props);
    const mapsOk = isMapsChecked(props);
    if (f.osmChecked === 'hide' && osmOk) return false;
    if (f.osmChecked === 'only' && !osmOk) return false;
    if (f.mapsChecked === 'hide' && mapsOk) return false;
    if (f.mapsChecked === 'only' && !mapsOk) return false;
    if (f.mapsHasPhoto === 'hide' && props.mapsHasPhoto) return false;
    if (f.mapsHasPhoto === 'only' && !props.mapsHasPhoto) return false;
    if (f.jalelChecked === 'hide' && props.jalelChecked) return false;
    if (f.jalelChecked === 'only' && !props.jalelChecked) return false;
    // Candidat « à curer » (réunif C1) : 'only' = file de tri (n'affiche que les candidats).
    if (f.candidate === 'hide' && isCandidate(feature)) return false;
    if (f.candidate === 'only' && !isCandidate(feature)) return false;
    if (f.incontournablesOnly && !props.incontournable) return false;
    if (f.photo === 'hide' && hasPhotos(props)) return false;
    if (f.photo === 'only' && !hasPhotos(props)) return false;
    if (f.description === 'hide' && hasDescription(props)) return false;
    if (f.description === 'only' && !hasDescription(props)) return false;

    // Court-circuits (priment sur Visités/Planifiés)
    if (state.activeCircuitId && state.currentCircuit && state.currentCircuit.some(g => getPoiId(g) === poiId)) {
        return true;
    }
    if (props.incontournable) return true;

    // Filtres parcours (3-states 'all' | 'hide' | 'only') du panneau topbar.
    // Point #5 audit Stefan : on utilise UN SEUL système — l'ancien
    // selectionModeFilters (qui s'appliquait uniquement en mode sélection)
    // est supprimé. Le filtre topbar pilote le filtrage en mode normal ET
    // en mode création de circuit.
    if (f.vus === 'hide' && props.vu) return false;
    if (f.vus === 'only' && !props.vu) return false;
    // Filtre Planifiés — évalué SEULEMENT s'il est actif (P4 : sinon on balayait
    // tous les circuits pour CHAQUE POI, même filtre éteint = cas courant). Set
    // pré-construit par la passe de filtrage quand fourni ; sinon repli ponctuel.
    if (f.planifies === 'hide' || f.planifies === 'only') {
        const isPlanned = plannedSet ? plannedSet.has(poiId) : computePlanifieCounter(poiId) > 0;
        if (f.planifies === 'hide' && isPlanned) return false;
        if (f.planifies === 'only' && !isPlanned) return false;
    }

    return true;
}

function hasPhotos(props) {
    return Array.isArray(props.photos) && props.photos.length > 0;
}

function hasDescription(props) {
    const longDesc = (props.description || '').trim();
    if (longDesc === '') return false;
    // Cohérence avec le rendu de la fiche (templates.js) : par défaut une
    // description n'est PAS publiée (descriptionPublic doit être explicitement
    // vrai) et ne s'affiche donc pas côté visiteur — le filtre « Lieux avec
    // description » ne doit pas matcher pour lui non plus, sinon il
    // annoncerait un résultat que la fiche dément à l'ouverture.
    if (!props.descriptionPublic && !state.isAdmin) return false;
    return true;
}

// Filtres "structurels" (Zone, Catégorie multi) — s'appliquent TOUJOURS, même
// aux incontournables. L'option `skipZone` permet à getZonesData d'appliquer
// la catégorie sans appliquer la zone (sinon le menu Zone n'aurait qu'une
// entrée non-nulle).
export function passesStructuralFilters(feature, { skipZone = false } = {}) {
    if (!feature) return false;
    const props = { ...feature.properties, ...feature.properties.userData };

    if (!skipZone && state.activeFilters.zone && getDerivedZone(feature) !== state.activeFilters.zone) return false;
    if (state.activeFilters.categories && state.activeFilters.categories.length > 0) {
        if (!state.activeFilters.categories.includes(props['Catégorie'])) return false;
    }
    return true;
}

// Il ne fait que du tri mathématique en mémoire. Il ne touche pas à la carte.
// `skipZone` (P2) : applique tous les filtres SAUF la zone — sert à la sonde
// d'auto-reset (« sans la zone, y aurait-il des POI ? »).
export function getFilteredFeatures({ skipZone = false } = {}) {
    if (!state.loadedFeatures) return [];
    // Set planifiés construit UNE fois pour toute la passe (P4), uniquement si le
    // filtre Planifiés est actif.
    const pf = state.activeFilters.planifies;
    const plannedSet = (pf === 'hide' || pf === 'only') ? buildPlannedPoiSet() : null;
    return state.loadedFeatures.filter(feature =>
        passesStructuralFilters(feature, { skipZone }) && passesUserFilters(feature, plannedSet)
    );
}

// --- 2. LE DISTRIBUTEUR ---
// P2 — garde anti-récursion. setActiveFilter ne déclenche aucun listener réactif
// (état = objet nu), donc l'auto-reset ci-dessous ne reboucle pas ; ce flag est une
// ceinture+bretelles contre une régression future (ex. si applyFilters était un jour
// rappelé par un watcher d'état).
let _autoResettingZone = false;

export function applyFilters() {
    if (_autoResettingZone) return;

    // 1. On passe les données au Tamis
    let visibleFeatures = getFilteredFeatures();

    // P2 — Auto-reset du filtre Zone : si une zone est filtrée et qu'elle ne contient
    // plus AUCUN POI visible (dernier POI supprimé/déplacé/recatégorisé hors zone),
    // mais qu'il existe des POI ailleurs (la zone est bien le coupable, pas un autre
    // filtre), on revient à « Toutes les zones » — sinon l'utilisateur reste face à une
    // liste/carte vide sans comprendre. On ne touche QUE la zone. Le panneau Filtres se
    // réaffiche tout seul (« Toutes les zones ») via son propre listener data:filtered.
    if (state.activeFilters.zone && visibleFeatures.length === 0
        && getFilteredFeatures({ skipZone: true }).length > 0) {
        _autoResettingZone = true;
        try {
            setActiveFilter('zone', null);
        } finally {
            _autoResettingZone = false;
        }
        visibleFeatures = getFilteredFeatures();
    }

    // 2. On envoie le signal
    // On notifie le reste de l'application que les données filtrées sont prêtes
    eventBus.emit('data:filtered', visibleFeatures);
}

// --- MODIFICATION DES DONNÉES ---

// Recalcule le flag `vu` (dérivé) à partir de vuManual + visitedByCircuits.
// Utilisé par les call-sites qui modifient vuManual ou visitedByCircuits.
export function recomputeVu(userData) {
    if (!userData) return;
    const manual = userData.vuManual === true;
    const byCircuits = Array.isArray(userData.visitedByCircuits) && userData.visitedByCircuits.length > 0;
    userData.vu = manual || byCircuits;
}

// Clés dont la modification peut changer la visibilité d'un POI sur la carte
// ou la liste mobile (cf. passesUserFilters / passesStructuralFilters).
// Toute nouvelle prop influençant ces fonctions doit être ajoutée ici.
const FILTER_AFFECTING_KEYS = new Set([
    'Catégorie', 'Zone',
    'vu', 'vuManual',
    'incontournable', 'verified', 'candidate', 'introuvableCarte',
    // Filtres "État de la fiche" (refonte Claude Design) : photos absentes
    // / description absente. Modif d'une de ces props peut changer la
    // visibilité si filter photo / description est actif.
    'photos', 'description', 'Description', 'descriptionPublic',
    // Note : 'planifieCounter' retiré (03/05/2026) — plus stocké dans userData,
    // calculé à la volée par computePlanifieCounter().
]);

export async function updatePoiData(poiId, key, value) {
    // Initialisation si vide
    if (!state.userData[poiId]) state.userData[poiId] = {};

    // Le toggle "vu" du panneau détails représente une action MANUELLE de l'utilisateur.
    // On stocke donc dans vuManual ; `vu` reste dérivé (vuManual || visitedByCircuits > 0).
    if (key === 'vu') {
        state.userData[poiId].vuManual = value === true;
        recomputeVu(state.userData[poiId]);
    } else {
        state.userData[poiId][key] = value;
    }

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

    // Force le rafraîchissement carte/liste mobile si la clé modifiée affecte
    // la visibilité (passesUserFilters + passesStructuralFilters). Centralisé
    // ici pour que les call-sites n'aient pas à connaître la liste.
    if (FILTER_AFFECTING_KEYS.has(key)) {
        applyFilters();
    }

    // [ADMIN] Tracking (exclure champs personnels — restent dans le Gist perso)
    if (state.isAdmin && !PERSONAL_KEYS.includes(key)) {
        addToDraft('poi', poiId, { key: key, value: value });
    }

    // [USER] Compte la modif pour l'auto-backup local. No-op côté admin.
    void recordModification();
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
    if (!state.customFeatures) setCustomFeatures([]);
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
    await saveAppState(`lastGeoJSON_${state.currentMapId}`, {
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

export async function addPoiFeature(feature, { draft = true } = {}) {


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
    
    if (!state.customFeatures) setCustomFeatures([]);
    // ID déjà récupéré plus haut
    if (!state.customFeatures.find(f => getPoiId(f) === id)) {
        state.customFeatures.push(feature);
    }

    // 2. Sauvegarde SÉPARÉE des ajouts (ne touche pas au GeoJSON officiel)
    await saveAppState(`customPois_${state.currentMapId}`, state.customFeatures);

    // 3. Rafraîchissement de la carte pour afficher le nouveau point
    applyFilters();

    // [ADMIN] Tracking. draft:false pour les candidats Scout (réunif C1) : un
    // candidat « à curer » n'est pas publiable tant qu'il n'est pas validé →
    // on ne le met pas au brouillon de publication.
    if (state.isAdmin && draft) {
        addToDraft('poi', id, { type: 'creation' });
    }

    // [USER] Compte la modif pour l'auto-backup local. No-op côté admin.
    void recordModification();
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
        // Dégel de Zone : on ne FIGE plus la zone au déplacement — elle se dérive
        // désormais des coordonnées (getDerivedZone). On invalide juste le cache de
        // ce POI pour que la prochaine lecture recalcule depuis la nouvelle position.
        deleteZoneCacheEntry(poiId);
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

    // [USER] Compte la modif pour l'auto-backup local. No-op côté admin.
    void recordModification();
}

// --- SUPPRESSION DE LIEU (Soft Delete + Admin Draft) ---

/**
 * Retire un POI localement (soft delete) + intention de suppression côté admin.
 *
 * @param {string} poiId
 * @param {Object}  [opts]
 * @param {boolean} [opts.tombstone=true]  Poser le tombstone de rejet si le POI porte
 *   un osm_ref. `false` pour la fusion de doublon (poi-duplicate.js) : l'objet OSM
 *   n'est pas rejeté, il vient d'être reporté sur le POI gardé — le tombstoner
 *   l'afficherait à tort dans la corbeille des rejets et le ferait ressortir en
 *   candidat si on la vidait.
 */
export async function deletePoi(poiId, { tombstone = true } = {}) {
    // 1. Gestion Liste cachée (pour l'affichage local immédiat)
    if (!state.hiddenPoiIds) setHiddenPoiIds([]);
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
        const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);

        // Tombstone de curation (chantier rejets) : si le POI vient d'OSM (osm_ref
        // porté à la capture), on enregistre son REJET pour que le re-scan ne le
        // re-propose pas (sinon, plus dans les données, il revient comme neuf). Cas
        // courant = candidats supprimés en curation. Un POI créé à la main (sans
        // osm_ref) n'est pas tombstoné. On garde un instantané (nom/cat/coords) pour
        // afficher et restaurer depuis la corbeille (PR-2) sans re-scanner.
        // getPoiProp (overlay prioritaire) et non properties brut : un osm_ref saisi
        // dans le RichEditor — ou reporté par la fusion de doublon — vit dans userData
        // tant que la destination n'est pas republiée ; le lire brut ratait le
        // tombstone de ces POI-là.
        const osmRef = tombstone ? getPoiProp(feature, 'osm_ref') : null;
        if (osmRef) {
            const coords = feature.geometry?.coordinates || [];
            addRejected({
                osm_ref: osmRef,
                name: getPoiName(feature) || '',
                nameAr: feature.properties?.['Nom du site arabe'] || '',
                category: getPoiProp(feature, 'Catégorie') || '',
                lng: Number(coords[0]),
                lat: Number(coords[1]),
                rejectedAt: Date.now(),
            });
            // Push best-effort du fichier rejets (full-file idempotent). Token requis :
            // pushDestinationRejected le vérifie et jette sinon → .catch garde le rejet
            // EN MÉMOIRE (dédup de la session) ; il partira au prochain rejet/restauration
            // ou via la corbeille. Fire-and-forget : la suppression reste instantanée.
            import('./publish-destination.js')
                .then(({ pushDestinationRejected }) => pushDestinationRejected(state.currentMapId, rejectedData))
                .catch(e => console.warn('[data] push des rejets échoué (gardé en mémoire) :', e));
        }

        // Un CANDIDAT (scout non curé) n'est JAMAIS publié → il n'existe pas sur
        // GitHub : enregistrer une intention de suppression créerait une entrée
        // FANTÔME (« SUPPRESSION / Inconnu ») dans le Centre de Contrôle alors
        // qu'il n'y a rien à supprimer côté dépôt. On se contente du retrait local
        // (hiddenPoiIds + customFeatures ci-dessus). Filet côté diff : la garde
        // « pas d'original GitHub » d'admin-diff-engine (prepareDiffData).
        if (!(feature && isCandidate(feature))) {
            // On marque l'intention de suppression
            addToDraft('poi', poiId, { type: 'delete' });
            // On marque aussi l'objet en mémoire pour l'exporteur
            if (feature) {
                if (!feature.properties.userData) feature.properties.userData = {};
                feature.properties.userData._deleted = true;
            }
        }
    }

    // 4. Rafraîchissement UI
    applyFilters();

    // [USER] Compte la modif pour l'auto-backup local. No-op côté admin.
    void recordModification();
}
