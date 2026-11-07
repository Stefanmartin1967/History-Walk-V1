// scout-reclassify.js — reclassement, à la moisson, des candidats que le Scout
// avait classés avec une règle aujourd'hui dépassée.
//
// Un candidat déjà enregistré n'est jamais re-capturé : la moisson le reconnaît à
// son osm_ref (scout-dedup, règle 1) et le saute. Quand getHwCategory apprend à
// classer un tag (Potale, 06/11/2026 : 275 potales de Wallonie en « A définir »),
// ou change d'avis sur un tag (Château, 05/11/2026), les candidats déjà capturés
// gardaient leur ancienne catégorie pour toujours. La moisson a pourtant leurs tags
// sous la main : on en profite pour les classer.
//
// Garde-fous : seulement un CANDIDAT (jamais une fiche validée), seulement par
// l'identité OSM (jamais par proximité), et seulement depuis une catégorie que le
// Scout posait lui-même : « A définir » (ou vide), ou une ancienne catégorie
// automatique listée dans SUPERSEDED, vers la catégorie qui l'a remplacée.
// Module pur (lecture seule) : l'écriture passe par persistPoiEdit, dans scout.js.
import { getPoiId, getPoiProp, normalizeOsmRef, isCandidate } from './utils.js';

// Ancienne catégorie automatique → nouvelles catégories que la moisson peut lui
// substituer. Une transition par changement de règle dans scout-categories.js,
// et rien d'autre : un candidat « Église » dont l'objet est maintenant classé
// « Monument » n'est pas touché (ce n'est pas un changement de règle, c'est un
// changement de tags dans OSM, à regarder à la main).
//   - Fortification → Château (05/11/2026) : `historic=castle` / `manor` allaient en
//     Fortification avant la catégorie Château ; 309 candidats en Wallonie.
//   - Église → Chapelle : `building=chapel` (avec `amenity=place_of_worship`) donnait
//     Église avant que la règle Chapelle passe devant ; 24 candidats.
//   - Curiosité → Vestige industriel : moulins (`man_made=windmill` / `watermill`)
//     classés Curiosité avant la règle des moulins ; 44 candidats.
// Relevé du 07/11/2026 sur les 2 610 candidats de la Wallonie, tags OSM du jour.
export const SUPERSEDED = {
    'Fortification': ['Château'],
    'Église': ['Chapelle'],
    'Curiosité': ['Vestige industriel'],
};

/**
 * Candidats chargés que la moisson sait maintenant classer.
 *
 * @param {Array} features  POI chargés (state.loadedFeatures)
 * @param {Map<string,string>} scannedCats  osm_ref canonique « node/123 » → catégorie
 *   donnée par getHwCategory pour les objets de cette moisson (catégories non nulles)
 * @returns {Array<{id:string, cat:string, from:string}>}  from = catégorie remplacée
 */
export function findReclassifiableCandidates(features = [], scannedCats) {
    const out = [];
    if (!scannedCats || scannedCats.size === 0) return out;
    for (const f of features) {
        if (!isCandidate(f)) continue;
        const ref = normalizeOsmRef(getPoiProp(f, 'osm_ref') || '');
        const cat = ref ? scannedCats.get(ref) : null;
        if (!cat) continue;
        const current = getPoiProp(f, 'Catégorie') || 'A définir';
        if (current === cat) continue;
        if (current === 'A définir' || SUPERSEDED[current]?.includes(cat)) {
            out.push({ id: getPoiId(f), cat, from: current });
        }
    }
    return out;
}
