// circuit-sort.js
//
// Règle unique du tri de « Mes Circuits », PC et mobile.

import { state } from './state.js';

/**
 * Tri réellement appliqué pour un tri choisi.
 *
 * « Proximité » sans point de départ se lit « Court » (dist_asc) : sans point
 * de départ, aucune distance n'est calculable et la liste garderait son ordre
 * d'entrée (officiels d'abord, circuits de l'utilisateur tout en bas).
 *
 * Résolu à la lecture, jamais écrit dans le tri choisi : au démarrage, la liste
 * s'affiche avant que main.js relise le point de départ (IndexedDB). L'écrire à
 * ce moment figeait « Court » et allumait la pastille des filtres une fois le
 * point de départ relu (constaté le 20/10/2026).
 *
 * @param {string} sort Tri choisi (proximity_asc | dist_asc | dist_desc | verified_first).
 * @returns {string} Tri à appliquer.
 */
export function getEffectiveCircuitSort(sort) {
    return sort === 'proximity_asc' && !state.homeLocation ? 'dist_asc' : sort;
}

/**
 * Tri de base à demander au service pour un tri choisi : « Vérifiés d'abord »
 * part du tri par défaut (proximité, ou court sans point de départ), puis la
 * liste remonte les vérifiés.
 *
 * @param {string} sort Tri choisi.
 * @returns {string} Tri à passer à getProcessedCircuits.
 */
export function getBaseCircuitSort(sort) {
    const effective = getEffectiveCircuitSort(sort);
    return effective === 'verified_first' ? getEffectiveCircuitSort('proximity_asc') : effective;
}
