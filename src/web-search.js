// web-search.js — bouton « Rechercher sur Google » (fiche, éditeur de fiche,
// import de photos).
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
// webSearchTerms est pure (pas d'état, pas de DOM) pour être testable ;
// openWebSearch lit la destination active et ouvre l'onglet.

import { state, getActiveDestinationName, getActiveMapId } from './state.js';
import { hasTerritory } from './scout-territory.js';

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

/**
 * Ouvre la recherche Google d'un lieu dans un nouvel onglet, avec le contexte de
 * la destination active (cf. webSearchTerms). Un seul chemin pour tous les boutons
 * « Google » : fiche (ui-details), éditeur de fiche (richEditor) et import de
 * photos (ui-photo-batch) — la même requête partout.
 * @param {object} p
 * @param {string} p.name - nom du lieu ; vide → rien n'est ouvert
 * @param {string} [p.zone] - quartier du lieu
 * @returns {boolean} false si le nom est vide (à l'appelant de prévenir)
 */
export function openWebSearch({ name, zone }) {
    const n = (name || '').trim();
    if (!n) return false;
    const terms = webSearchTerms({
        name: n,
        zone,
        destinationName: getActiveDestinationName(),
        territory: hasTerritory(state.destinations?.maps?.[getActiveMapId()]),
    });
    window.open(`https://www.google.com/search?q=${encodeURIComponent(terms)}`, '_blank', 'noopener,noreferrer');
    return true;
}
