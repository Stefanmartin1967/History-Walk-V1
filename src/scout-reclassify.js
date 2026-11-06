// scout-reclassify.js — reclassement, à la moisson, des candidats restés « A définir ».
//
// Un candidat déjà enregistré n'est jamais re-capturé : la moisson le reconnaît à
// son osm_ref (scout-dedup, règle 1) et le saute. Quand getHwCategory apprend à
// classer un tag (Potale, 06/11/2026 : 275 potales de Wallonie en « A définir »),
// les candidats déjà capturés restaient donc non classés pour toujours. La moisson
// a pourtant leurs tags sous la main : on en profite pour les classer.
//
// Garde-fous : seulement un CANDIDAT (jamais une fiche validée), seulement s'il est
// encore « A définir » ou sans catégorie (une catégorie choisie à la curation n'est
// jamais remplacée), et seulement par l'identité OSM (jamais par proximité).
// Module pur (lecture seule) : l'écriture passe par persistPoiEdit, dans scout.js.
import { getPoiId, getPoiProp, normalizeOsmRef, isCandidate } from './utils.js';

/**
 * Candidats chargés que la moisson sait maintenant classer.
 *
 * @param {Array} features  POI chargés (state.loadedFeatures)
 * @param {Map<string,string>} scannedCats  osm_ref canonique « node/123 » → catégorie
 *   donnée par getHwCategory pour les objets de cette moisson (catégories non nulles)
 * @returns {Array<{id:string, cat:string}>}
 */
export function findReclassifiableCandidates(features = [], scannedCats) {
    const out = [];
    if (!scannedCats || scannedCats.size === 0) return out;
    for (const f of features) {
        if (!isCandidate(f)) continue;
        const current = getPoiProp(f, 'Catégorie');
        if (current && current !== 'A définir') continue;
        const ref = normalizeOsmRef(getPoiProp(f, 'osm_ref') || '');
        const cat = ref ? scannedCats.get(ref) : null;
        if (cat) out.push({ id: getPoiId(f), cat });
    }
    return out;
}
