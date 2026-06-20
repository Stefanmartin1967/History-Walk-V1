// src/rejected.js
// Tombstones de curation Scout — objets OSM REJETÉS d'une destination. Quand
// l'admin supprime un candidat (data.js deletePoi), on garde une trace de l'objet
// OSM rejeté ICI pour que le RE-SCAN ne le re-propose pas (sinon, n'étant plus dans
// les données, il revient comme neuf et l'admin doit le re-supprimer).
//
// Identité = `osm_ref` (« node/123 », « way/456 ») — porté de la moisson Overpass
// (scout.js) sur le candidat puis le POI capturé. Précis : un rejet ne masque pas un
// objet DISTINCT proche (ce que ferait un tombstone positionnel < 50 m).
//
// Chargé PAR destination au boot (app-startup → loadRejectedForActive) depuis
// {dest}-rejected.json ; persisté/poussé par pushDestinationRejected
// (publish-destination.js). Module FEUILLE (aucun import) comme zones.js : le binding
// `let` + setRejectedData fait que les lecteurs (scout dédup, future corbeille) voient
// toujours l'état courant (live binding ES module).
//
// Forme : objet indexé par osm_ref → instantané, pour un skip O(1) au scan ET de quoi
// afficher/restaurer la corbeille (PR-2) sans re-scanner :
//   { "node/123": { osm_ref, name, nameAr, category, lat, lng, rejectedAt } }
export let rejectedData = {};

// Réassigne le jeu de rejets de la destination active. Données invalides → objet vide
// (comportement sûr : aucun objet rejeté = rien n'est masqué au scan).
export function setRejectedData(data) {
    rejectedData = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
}

// True si l'objet OSM (osm_ref « type/id ») a été rejeté pour la destination courante.
export function isRejected(osmRef) {
    return !!osmRef && Object.prototype.hasOwnProperty.call(rejectedData, osmRef);
}

// Ajoute (ou écrase) un rejet. `record.osm_ref` requis ; sans lui on ignore (un POI
// sans identité OSM — créé à la main — ne peut pas être tombstoné par id).
export function addRejected(record) {
    if (record && record.osm_ref) rejectedData[record.osm_ref] = record;
}

// Retire un rejet (restauration depuis la corbeille). No-op si absent/référence vide.
export function removeRejected(osmRef) {
    if (osmRef) delete rejectedData[osmRef];
}

// Nombre de rejets de la destination courante (badge corbeille / soupape « Vider »).
export function rejectedCount() {
    return Object.keys(rejectedData).length;
}
