// src/recalc-zones.js
// PR C du chantier re-zonage — « Recalculer les zones » d'une destination DÉJÀ
// scoutée, SANS la re-scouter (curation préservée). Répare le Hammamet en place :
// 36 POIs « Hors zone » parce que les zones n'avaient été récupérées que pour la
// bbox (serrée) de la destination à la création (les POIs débordaient jusqu'à
// Korba/Zriba) — cf. PR A (MultiPolygon) et PR B (Scout étend les zones à la capture).
//
// Idée : la `Zone` d'un POI est une PROPRIÉTÉ stockée (figée à la capture via
// getZoneFromCoords), pas re-dérivée à l'affichage. Donc réparer = (1) compléter
// le jeu de zones OSM sur l'étendue RÉELLE des POIs, puis (2) ré-affecter la Zone
// de chaque POI dont elle change. Le push du fichier {id}-zones.geojson (appelant)
// garde le jeu complet pour les futures captures ; « Tout publier » cuit ensuite
// les nouvelles Zones des POIs dans le geojson public (sur tous les appareils).
import { state } from './state.js';
import { fetchZonesAuto } from './osm-zones.js';
import { zonesData, setZonesData } from './zones.js';
import { getZoneFromCoords, getPoiId, getPoiProp } from './utils.js';
import { applyFilters } from './data.js';
import { saveAppState, savePoiData } from './database.js';
import { eventBus } from './events.js';
import { saveDraftZones } from './local-destinations.js';

// Marge (deg, ~1 km) ajoutée à la bbox des POIs avant le fetch OSM. Overpass
// renvoie déjà toute relation INTERSECTANT la bbox (donc la délégation d'un POI
// au bord est ramenée), mais ce petit coussin couvre les arrondis flottants.
const BBOX_PAD = 0.01;

// Calcule [[s,w],[n,e]] à partir des géométries Point des features. Renvoie null
// si aucune coordonnée exploitable.
function poiBoundingBox(features) {
    let s = 90, w = 180, n = -90, e = -180, count = 0;
    for (const f of features) {
        const c = f?.geometry?.coordinates;
        if (!Array.isArray(c) || c.length < 2) continue;
        const [lng, lat] = c;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (lat < s) s = lat;
        if (lat > n) n = lat;
        if (lng < w) w = lng;
        if (lng > e) e = lng;
        count++;
    }
    if (!count) return null;
    return [[s - BBOX_PAD, w - BBOX_PAD], [n + BBOX_PAD, e + BBOX_PAD]];
}

/**
 * Recalcule les zones de la destination ACTIVE et ré-affecte la `Zone` des POIs.
 * NE pousse RIEN sur GitHub : l'appelant pousse {id}-zones.geojson (token) pour un
 * brouillon GitHub / une dest publiée ; un brouillon LOCAL persiste ses zones ici
 * (saveDraftZones). Les changements de Zone des POIs sont tracés (event
 * `admin:poi-edited`) → ils partent au prochain « Tout publier ».
 *
 * @returns {Promise<{mapId:string, name:string, rezoned:number, horsZoneBefore:number,
 *   resolvedHorsZone:number, zonesTotal:number, zonesAdded:number, isLocalDraft:boolean,
 *   zones:{type:string, features:Array}}>}
 */
export async function recalcActiveDestinationZones() {
    const mapId = state.currentMapId;
    const dest = state.destinations?.maps?.[mapId];
    if (!mapId || !dest) throw new Error('Aucune destination active.');

    const features = state.loadedFeatures || [];
    if (!features.length) throw new Error('Cette destination ne contient aucun lieu.');

    // 1. bbox RÉELLE des POIs (déborde souvent les bounds de la destination — c'est
    //    la cause des « Hors zone »).
    const bbox = poiBoundingBox(features);
    if (!bbox) throw new Error('Aucune coordonnée exploitable sur les lieux chargés.');

    // 2. Zones admin OSM sur cette bbox (niveau selon le pays : TN = délégations 6).
    const fc = await fetchZonesAuto(bbox, dest.country || '');

    // 3. MERGE dans le binding live zonesData (dedup osm_id) — on ne PERD jamais une
    //    zone déjà connue, on COMPLÈTE celles qui manquaient (miroir du Scout).
    const seen = new Set((zonesData.features || []).map(f => f.properties?.osm_id).filter(v => v != null));
    const added = (fc.features || []).filter(f => f.properties?.osm_id == null || !seen.has(f.properties.osm_id));
    const merged = { type: 'FeatureCollection', features: [...(zonesData.features || []), ...added] };
    setZonesData(merged);

    // 4. Ré-affecter la Zone — UNIQUEMENT si elle change (idempotent : un POI déjà
    //    bien zoné n'est pas touché → pas de faux diff, disruptionCheck OK).
    let rezoned = 0;
    let horsZoneBefore = 0;
    let resolvedHorsZone = 0;
    let customChanged = false;
    const customSet = new Set((state.customFeatures || []).map(getPoiId));

    for (const f of features) {
        const c = f?.geometry?.coordinates;
        if (!Array.isArray(c) || c.length < 2) continue;
        const [lng, lat] = c;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        const oldZone = getPoiProp(f, 'Zone');
        const newZone = getZoneFromCoords(lat, lng); // (lat, lng) — getZoneFromCoords inverse en interne
        if (oldZone === 'Hors zone') {
            horsZoneBefore++;
            if (newZone !== 'Hors zone') resolvedHorsZone++;
        }
        if (newZone === oldZone) continue;

        const poiId = getPoiId(f);
        if (customSet.has(poiId)) {
            // POI custom (capture Scout / créé local) : Zone dans properties + customPois
            // (JAMAIS userData — sinon l'overlay cuit puis effacé re-masque la base au
            // reload, cf. richEditor executeEdit).
            f.properties.Zone = newZone;
            const cIdx = (state.customFeatures || []).findIndex(x => getPoiId(x) === poiId);
            if (cIdx !== -1) state.customFeatures[cIdx].properties = f.properties;
            customChanged = true;
        } else {
            // POI de base / officiel : overlay userData (aplati au « Tout publier »).
            if (!state.userData[poiId]) state.userData[poiId] = {};
            state.userData[poiId].Zone = newZone;
            f.properties.userData = state.userData[poiId];
            await savePoiData(mapId, poiId, state.userData[poiId]);
        }
        // Trace pour le diff du CC (addToDraft par id) → part au prochain « Tout publier ».
        eventBus.emit('admin:poi-edited', { id: poiId, type: 'update' });
        rezoned++;
    }

    // 5. Persistance des POIs custom modifiés — une seule fois.
    if (customChanged) {
        await saveAppState(`customPois_${mapId}`, state.customFeatures);
        await saveAppState('lastGeoJSON', { type: 'FeatureCollection', features: state.loadedFeatures });
    }

    // 6. Zones : brouillon LOCAL → IndexedDB ici ; brouillon GitHub / publiée → le
    //    fichier {id}-zones.geojson est poussé par l'appelant (token requis).
    const isLocalDraft = dest.custom === true;
    if (isLocalDraft) await saveDraftZones(mapId, merged);

    // 7. Un seul refresh carte/liste (la Zone peut changer la visibilité si un
    //    filtre « Quartier » est actif).
    applyFilters();

    return {
        mapId,
        name: dest.name || mapId,
        rezoned,
        horsZoneBefore,
        resolvedHorsZone,
        zonesTotal: merged.features.length,
        zonesAdded: added.length,
        isLocalDraft,
        zones: merged,
    };
}
