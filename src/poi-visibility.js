// poi-visibility.js — un lieu est-il MONTRÉ à l'utilisateur courant ?
// Source unique pour la carte (passesUserFilters, data.js), la recherche
// (search.js, catégories de la recherche mobile) et les compteurs qu'il lit
// (menu mobile, Carnet) : un lieu que la carte cache ne doit ni ressortir par
// une recherche, ni compter dans un total. Module feuille (state + utils).
import { state } from './state.js';
import { getPoiId, getPoiProp } from './utils.js';

/**
 * Lieu supprimé par l'utilisateur. `deletePoi` (data.js) l'inscrit dans
 * `hiddenPoiIds` SANS le retirer de `state.loadedFeatures` : toute liste ou tout
 * compteur qui parcourt les lieux chargés doit donc l'écarter lui-même.
 * @param {object} feature
 * @returns {boolean}
 */
export function isDeletedPoi(feature) {
    return (state.hiddenPoiIds || []).includes(getPoiId(feature));
}

/**
 * Lieu « Existence à confirmer » masqué par le filtre du même nom : toujours
 * pour un visiteur (défaut 'hide', resynchronisé par setIsAdmin — state.js),
 * pour l'admin seulement s'il choisit « Masquer ». 'only' (« Afficher ») ne
 * concerne que la carte — la recherche continue de tout trouver (note de test
 * 19, 03/10/2026).
 * @param {object} feature
 * @returns {boolean}
 */
export function isHiddenUnconfirmed(feature) {
    return state.activeFilters?.introuvableCarte === 'hide' && !!getPoiProp(feature, 'introuvableCarte');
}

/**
 * Lieu montré à l'utilisateur : ni supprimé, ni masqué comme « Existence à
 * confirmer ». Ne tient PAS compte des filtres choisis (zone, catégorie,
 * visités…) : c'est l'ensemble de ce qu'il peut trouver.
 * @param {object} feature
 * @returns {boolean}
 */
export function isShownToUser(feature) {
    return !isDeletedPoi(feature) && !isHiddenUnconfirmed(feature);
}
