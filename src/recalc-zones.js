// src/recalc-zones.js
// « Compléter les quartiers » — récupère les quartiers (délégations OSM) sur
// l'étendue RÉELLE des POIs de la destination active et complète le fichier
// {dest}-zones.geojson.
//
// DÉGEL DE ZONE (17/06/2026) : la `Zone` d'un POI n'est plus stockée/figée — elle
// se DÉRIVE à la volée de ce jeu de quartiers (getDerivedZone, utils.js). Donc
// compléter puis pousser ce fichier re-zone TOUT LE MONDE automatiquement au
// prochain chargement, sans toucher aux POIs ni faire « Tout publier ». Cette
// fonction ne mute AUCUNE propriété de POI : elle ne fait qu'étendre zonesData (le
// binding live) + persister le fichier (brouillon local → IndexedDB ; dest GitHub →
// l'appelant pousse via pushDestinationZones). setZonesData vide le cache de zones
// dérivées → un simple applyFilters suffit à rafraîchir carte/filtre/compteur.
//
// Héritage PR C (#856/#857) : la moitié « ré-affecter la Zone de chaque POI +
// overlay + Tout publier » a été RETIRÉE par le dégel — elle est devenue inutile.
import { state } from './state.js';
import { fetchZonesAuto } from './osm-zones.js';
import { zonesData, setZonesData } from './zones.js';
import { applyFilters } from './data.js';
import { saveDraftZones } from './local-destinations.js';

// Marge (deg, ~1 km) ajoutée à la bbox des POIs avant le fetch OSM. Overpass renvoie
// déjà toute relation INTERSECTANT la bbox (donc la délégation d'un POI au bord est
// ramenée), mais ce petit coussin couvre les arrondis flottants.
const BBOX_PAD = 0.01;

// Calcule [[s,w],[n,e]] à partir des géométries Point des features. Renvoie null si
// aucune coordonnée exploitable.
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
 * Complète le jeu de quartiers de la destination ACTIVE sur l'étendue réelle de ses
 * POIs. NE pousse RIEN sur GitHub : un brouillon LOCAL persiste ses zones ici
 * (saveDraftZones) ; pour une dest GitHub / publiée, l'appelant pousse
 * {dest}-zones.geojson (pushDestinationZones, token requis). Ne mute aucun POI.
 *
 * @returns {Promise<{mapId:string, name:string, zonesTotal:number, zonesAdded:number,
 *   isLocalDraft:boolean, zones:{type:string, features:Array}}>}
 */
export async function completeDestinationZones() {
    const mapId = state.currentMapId;
    const dest = state.destinations?.maps?.[mapId];
    if (!mapId || !dest) throw new Error('Aucune destination active.');

    const features = state.loadedFeatures || [];
    if (!features.length) throw new Error('Cette destination ne contient aucun lieu.');

    // bbox RÉELLE des POIs (déborde souvent les bounds de la destination — c'est la
    // cause des « Hors zone » : les zones n'avaient été récupérées que pour la bbox
    // serrée de la destination à la création).
    const bbox = poiBoundingBox(features);
    if (!bbox) throw new Error('Aucune coordonnée exploitable sur les lieux chargés.');

    // Quartiers admin OSM sur cette bbox (niveau selon le pays : TN = délégations 6).
    const fc = await fetchZonesAuto(bbox, dest.country || '');

    // MERGE dédupliqué par osm_id dans le binding live zonesData — on ne PERD jamais
    // un quartier déjà connu, on COMPLÈTE ceux qui manquaient (miroir du Scout).
    const seen = new Set((zonesData.features || []).map(f => f.properties?.osm_id).filter(v => v != null));
    const added = (fc.features || []).filter(f => f.properties?.osm_id == null || !seen.has(f.properties.osm_id));
    const merged = { type: 'FeatureCollection', features: [...(zonesData.features || []), ...added] };
    setZonesData(merged); // vide le cache de zones dérivées → les POIs se re-dérivent

    // Brouillon LOCAL → persister le fichier en IndexedDB ; dest GitHub / publiée → le
    // fichier {id}-zones.geojson est poussé par l'appelant (token requis).
    const isLocalDraft = dest.custom === true;
    if (isLocalDraft) await saveDraftZones(mapId, merged);

    // Un seul refresh : la Zone dérivée des POIs a changé (cache vidé) → carte / filtre
    // / compteur se mettent à jour.
    applyFilters();

    return {
        mapId,
        name: dest.name || mapId,
        zonesTotal: merged.features.length,
        zonesAdded: added.length,
        isLocalDraft,
        zones: merged,
    };
}
