// src/osm-ref.mjs
// ============================================================================
// Référence d'un objet OpenStreetMap (`osm_ref`) — règle partagée par les DEUX
// surfaces qui en font un lien :
//   • l'app          → bouton OSM de la fiche (utils.js : openPoiOnMap, qui
//                      réexporte ces fonctions pour tous ses appelants) ;
//   • les pages SEO  → lien « Voir sur OpenStreetMap »
//                      (scripts/generate-poi-pages.mjs, hook postbuild, Node).
//
// Même raison d'être que source-format.mjs : le script de build tourne sous
// Node et ne peut pas importer utils.js (package `type: "commonjs"`, et utils.js
// dépend de l'état de l'app). Une seule règle, deux consommateurs : garder ce
// fichier pur, sans DOM ni import d'état applicatif.
// ============================================================================

/**
 * Normalise une référence d'objet OSM vers la forme canonique « type/id ».
 * Accepte ce que l'admin colle naturellement : l'URL complète de la page OSM
 * (avec ou sans query/hash) ou déjà « way/123 ». Retourne '' si non
 * reconnaissable — on ne devine JAMAIS un id à partir d'un texte libre.
 * @param {string} value
 * @returns {string} « way/386328373 » ou ''
 */
export function normalizeOsmRef(value) {
    if (typeof value !== 'string') return '';
    const m = value.trim().match(/(node|way|relation)\/(\d+)/i);
    return m ? `${m[1].toLowerCase()}/${m[2]}` : '';
}

/**
 * URL de la page d'un objet OSM à partir de sa référence « type/id ».
 * @param {string} osmRef
 * @returns {string|null} null si la référence est absente/invalide
 */
export function osmObjectUrl(osmRef) {
    const ref = normalizeOsmRef(osmRef);
    return ref ? `https://www.openstreetmap.org/${ref}` : null;
}
