// web-search.js — termes du bouton « Rechercher sur Google » de la fiche.
//
// Le nom seul ramène des homonymes ailleurs (« Mosquée Sidi Yati » existe dans tout
// le monde arabe) : on ajoute un mot de contexte.
//   - Destination ordinaire (Djerba, Hammamet) : son nom. « … Djerba » suffit.
//   - Destination à TERRITOIRE (`territoryOsmId`, la Wallonie) : le quartier du
//     lieu, qui est alors sa commune (Aiseau-Presles, Jumet…). « Chapelle Saint-Roch
//     Wallonie » est trop vague : des chapelles du même nom, il y en a partout.
// Quartier inutilisable (« Hors zone », « A définir », vide) → repli sur le nom de
// la destination. Contexte inconnu → le nom seul : mieux vaut une recherche large
// qu'une requête polluée par un mot parasite.
// Fonction pure (pas d'état, pas de DOM) pour être testable.

const NO_ZONE = new Set(['', 'Hors zone', 'A définir']);

/**
 * @param {object} p
 * @param {string} p.name - nom de la fiche (getPatrimonialName)
 * @param {string} [p.zone] - quartier effectif du lieu (getDerivedZone)
 * @param {string} [p.destinationName] - nom de la destination active
 * @param {boolean} [p.territory] - la destination a-t-elle un territoire ?
 * @returns {string} termes de recherche, séparés par une espace
 */
export function webSearchTerms({ name, zone, destinationName, territory }) {
    const z = (zone || '').trim();
    const context = territory && !NO_ZONE.has(z) ? z : destinationName;
    return [name, context].filter(Boolean).join(' ');
}
