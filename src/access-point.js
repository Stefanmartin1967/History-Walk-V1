// access-point.js
//
// Logique métier centrale du « point d'accès au tracé » v2 (PR 2/5).
// Décide si un POI doit porter un drapeau OSM pré-posé, et écrit le couple
// (accessPoint, accessPointStatus) en data via updatePoiData.
//
// Status (enum stocké sur le POI) :
//   - undefined   → legacy / jamais évalué (POI d'avant PR2, sans tentative).
//   - 'osm'       → drapeau pré-posé OSM, jamais touché (couleur orange).
//   - 'moved'     → drapeau déplacé manuellement par l'admin (couleur verte).
//   - 'on-track'  → évalué, POI sur voie (distance ≤ seuil) → pas de drapeau.
//   - 'failed'    → tentative Overpass échouée → à reprendre (pastille ambre).
//
// Cf. project_offroad_poi_track_snapping pour le rationale complet.
import { state } from './state.js';
import { getPoiId, updatePoiData } from './data.js';
import { getCachedNearestWay, setCachedNearestWay, savePoiData } from './database.js';
import { nearestHighway } from './osm-overpass.js';
import { schedulePush } from './gist-sync.js';

// Seuil de pose : POI à ≤ SEUIL m d'une voie OSM = « sur voie », pas de drapeau.
// Au-delà = drapeau pré-posé sur la voie. À ajuster empiriquement avec GPX
// Studio. Cf. décision Stefan 31/05/2026.
export const ACCESS_POINT_THRESHOLD_M = 10;

/**
 * Récupère le status du drapeau pour un POI (lit overlay userData puis
 * properties, comme getPoiProp).
 *
 * @param {object} feature - feature POI
 * @returns {'osm'|'moved'|'on-track'|'failed'|undefined}
 */
export function getAccessPointStatus(feature) {
    if (!feature) return undefined;
    const ud = feature.properties?.userData?.accessPointStatus;
    if (ud !== undefined) return ud;
    return feature.properties?.accessPointStatus;
}

// Écriture atomique (accessPoint + accessPointStatus) dans userData + IDB.
// Ne passe PAS par updatePoiData (qui showToast à chaque appel et serait
// appelé 2× ici). Pré-pose = silencieuse par design.
async function writeAccessPointSilent(poiId, coords, status) {
    if (!state.userData[poiId]) state.userData[poiId] = {};
    if (coords === null) {
        // 'on-track' / 'failed' → on retire un éventuel accessPoint legacy.
        // null (et pas undefined) pour primer sur le patrimoine publié, cf.
        // pattern existant dans onErase de access-point-editor.
        state.userData[poiId].accessPoint = null;
    } else {
        state.userData[poiId].accessPoint = coords;
    }
    state.userData[poiId].accessPointStatus = status;

    // Reflet dans le feature en mémoire (pour le rendu immédiat).
    const feature = state.loadedFeatures?.find(f => getPoiId(f) === poiId);
    if (feature) feature.properties.userData = state.userData[poiId];

    await savePoiData(state.currentMapId, poiId, state.userData[poiId]);
    // Sync Gist debounced (publication ultérieure côté admin via le CC).
    schedulePush();
}

/**
 * Pré-pose ou évalue le point d'accès d'un POI via Overpass.
 *
 * Comportement (silencieux par défaut — pas de toast en succès) :
 *  - Cache hit → utilise la donnée stockée, ne re-fetch pas.
 *  - Distance ≤ seuil → status='on-track', accessPoint=null (sur voie).
 *  - Distance > seuil → status='osm', accessPoint=[lon,lat] (pré-posé).
 *  - Échec Overpass → status='failed', accessPoint=null. Le caller décide
 *    s'il toast (création POI = toast 'à poser plus tard', clic bouton = err).
 *
 * @param {object} feature - feature POI (lit coords + ID)
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] - ignore le cache, force un re-fetch
 * @returns {Promise<{status: string, coords: [number,number]|null, distance: number|null}>}
 * @throws {Error} si Overpass échoue ET qu'on n'a pas pu écrire 'failed'.
 *                 Sinon retourne {status:'failed', ...} sans throw.
 */
export async function prepoSeAccessPoint(feature, opts = {}) {
    const { force = false } = opts;
    const poiId = getPoiId(feature);
    const coords = feature?.geometry?.coordinates;
    if (!poiId || !Array.isArray(coords) || coords.length < 2) {
        throw new Error('Feature POI invalide');
    }
    const [poiLon, poiLat] = coords;
    const mapId = state.currentMapId;
    if (!mapId) {
        // Garde défensive : sans destination active, on ne peut ni écrire dans
        // poiUserData (clé composite [mapId, poiId]) ni cacher la réponse OSM.
        // No-op silencieux — un POI créé sans dest active est de toute façon
        // anormal ; la passe globale PR3 rattrapera quand la dest sera active.
        throw new Error('currentMapId absent — pas de pré-pose possible');
    }

    // 1. Cache hit (sauf si force).
    let response = null;
    if (!force) {
        const cached = await getCachedNearestWay(mapId, poiId);
        if (cached) response = { coords: cached.coords, distance: cached.distance };
    }

    // 2. Fetch Overpass si pas de cache (ou force).
    if (!response) {
        try {
            response = await nearestHighway(poiLat, poiLon);
            // response peut être null (= aucune voie dans le rayon).
            await setCachedNearestWay(mapId, poiId, {
                coords: response?.coords ?? null,
                distance: response?.distance ?? null,
            });
        } catch (e) {
            // Échec réseau / timeout → status='failed', toast côté caller.
            await writeAccessPointSilent(poiId, null, 'failed');
            return { status: 'failed', coords: null, distance: null, error: e };
        }
    }

    // 3. Décision sur la distance.
    if (response === null) {
        // Aucune voie dans le rayon (cas rare : POI vraiment isolé). Traité
        // comme 'failed' à reprendre (la passe globale pourra élargir).
        await writeAccessPointSilent(poiId, null, 'failed');
        return { status: 'failed', coords: null, distance: null };
    }

    if (response.distance <= ACCESS_POINT_THRESHOLD_M) {
        await writeAccessPointSilent(poiId, null, 'on-track');
        return { status: 'on-track', coords: null, distance: response.distance };
    }

    await writeAccessPointSilent(poiId, response.coords, 'osm');
    return { status: 'osm', coords: response.coords, distance: response.distance };
}

/**
 * « Effacer » le drapeau d'un POI (Option A, décision Stefan 19/06/2026) : retire
 * le drapeau et marque le POI « à reprendre ». Le statut 'failed' est le SEUL qui
 * (a) prime sur un accessPointStatus déjà publié dans le geojson, (b) garde le POI
 * dans la passe globale (shouldIncludeInPass), (c) ne ment pas en prétendant qu'un
 * drapeau existe (osm/moved). → le POI redevient RE-PROPOSABLE (la passe le
 * ré-évalue à sa prochaine ouverture). Source UNIQUE appelée par la fiche POI
 * (access-point-editor) ET la passe globale (osm-pass) : fin de leur divergence
 * (la fiche laissait un statut orphelin osm/moved, la passe forçait 'on-track').
 * @param {string} poiId
 */
export async function eraseAccessPoint(poiId) {
    if (!poiId) return;
    // Statut admin-local (PERSONAL_KEYS → ni tracking CC ni toast voulu) : posé en
    // direct dans userData, il sera sauvé EN MÊME TEMPS que accessPoint ci-dessous.
    if (!state.userData[poiId]) state.userData[poiId] = {};
    state.userData[poiId].accessPointStatus = 'failed';
    // accessPoint=null via updatePoiData : tracké pour le Centre de Contrôle (champ
    // publiable), prime sur le patrimoine, sauve TOUT le userData (donc aussi le
    // statut ci-dessus) et n'émet qu'UN toast « Enregistré ».
    await updatePoiData(poiId, 'accessPoint', null);
}

/**
 * Pose MANUELLE du drapeau à des coordonnées données (= statut 'moved', vert).
 * Utilisé par le geste mobile « Drapeau à ma position GPS ». Même écriture que
 * la pose éditeur/passe (accessPoint + statut), via le pattern d'eraseAccessPoint :
 * statut admin-local posé en direct + accessPoint par updatePoiData (tracké CC).
 * @param {string} poiId
 * @param {number} lon
 * @param {number} lat
 */
export async function setAccessPointAt(poiId, lon, lat) {
    if (!poiId || !Number.isFinite(lon) || !Number.isFinite(lat)) return;
    if (!state.userData[poiId]) state.userData[poiId] = {};
    state.userData[poiId].accessPointStatus = 'moved';
    await updatePoiData(poiId, 'accessPoint', [lon, lat]);
}
