// scout-dedup.js — règles de dédup du Scout, isolées en module PUR (aucun import
// de map / leaflet / state) pour être testables sans booter l'app, comme
// scout-categories.js l'est déjà pour le mapping OSM→taxonomie.
//
// DEUX règles, dans cet ordre :
//
//   1. IDENTITÉ OSM (`osm_ref` « type/id ») — un objet OSM déjà porté par un POI
//      chargé n'est JAMAIS re-proposé, quelle que soit la distance. Indispensable
//      pour les sites ÉTENDUS : « Henchir Bourgou » (site archéologique d'environ
//      700 m de rayon) est pointé au mausolée côté data, alors que le nœud OSM
//      tombe ailleurs sur le site → la règle des 50 m ne peut PAS les rapprocher
//      et chaque re-scan recréait un candidat en doublon (constaté 10/08/2026).
//      Comparaison de CHAÎNES normalisées, jamais de noms : « Mosquée Fadhloun »
//      / « جامع فضلون » désignent le même lieu et diffèrent, tandis que deux
//      « Marabout Sidi Salem » distants de 3 km sont deux lieux.
//
//   2. PROXIMITÉ (< 50 m, règle #472 validée 07/05) — filet pour tout POI SANS
//      osm_ref (89 des 348 POI de Djerba au 10/08/2026). La règle 1 ne remplace
//      pas celle-ci : elle ne protège que les POI dont l'objet OSM est saisi.
//
// La règle 1 est ce qui donne sa valeur au report d'osm_ref fait pendant la
// curation (action « doublon d'un lieu existant » du RichEditor) : chaque
// doublon traité immunise définitivement le POI gardé contre les re-scans.
import { calculateDistance, getPoiProp, normalizeOsmRef } from './utils.js';

/** Rayon de la règle de proximité (règle #472). */
export const DEDUP_M = 50;

/**
 * Index des objets OSM déjà représentés dans le data chargé.
 * Reconstruit à chaque scan : l'admin peut avoir curé entre deux passes.
 * Lit via getPoiProp (overlay userData prioritaire) — un osm_ref reporté sur un
 * POI de base vit dans l'overlay tant que la destination n'est pas republiée.
 *
 * @param {Array} features  POI chargés (state.loadedFeatures)
 * @returns {Set<string>} refs canoniques « node/123 »
 */
export function collectKnownOsmRefs(features = []) {
    const set = new Set();
    for (const f of features) {
        const ref = normalizeOsmRef(getPoiProp(f, 'osm_ref') || '');
        if (ref) set.add(ref);
    }
    return set;
}

/**
 * Un candidat moissonné est-il un doublon ? (identité OSM, puis proximité)
 *
 * @param {{lat:number, lon:number, osmRef?:string}} cand
 * @param {Object}   ctx
 * @param {Set<string>} [ctx.knownOsmRefs]  index issu de collectKnownOsmRefs
 * @param {Array}    [ctx.features]  POI chargés (proximité)
 * @param {Array}    [ctx.retained]  candidats déjà retenus dans CE scan : OSM a
 *                                   parfois 2 entrées au même lieu (mosquée
 *                                   dédoublée) — on garde la 1ʳᵉ, on écarte la 2ᵉ
 * @returns {boolean}
 */
export function isDuplicateCandidate(cand, { knownOsmRefs, features = [], retained = [] } = {}) {
    if (!cand || !Number.isFinite(cand.lat) || !Number.isFinite(cand.lon)) return false;

    const ref = normalizeOsmRef(cand.osmRef || '');
    if (ref && knownOsmRefs?.has(ref)) return true;

    const near = (lat, lon) => calculateDistance(cand.lat, cand.lon, lat, lon) < DEDUP_M;

    const inData = features.some(f => {
        const c = f?.geometry?.coordinates;
        return Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && near(c[1], c[0]);
    });
    if (inData) return true;

    return retained.some(c => !c.dup && near(c.lat, c.lon));
}
