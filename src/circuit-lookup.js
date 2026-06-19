// circuit-lookup.js — résolution centralisée d'un circuit par id.
//
// AVANT ce module, une dizaine de sites ré-implémentaient « chercher un circuit
// dans state.myCircuits ET state.officialCircuits » (avec des variantes :
// ordre des listes, comparaison `===` vs `String()`). Le piège récurrent : un
// nouveau point d'usage qui oublie la liste officielle — fréquent puisque l'admin
// édite couramment des circuits officiels (re-scout). Source unique ici.
//
// Module FEUILLE : il n'importe QUE `state` → aucun risque de cycle d'import,
// quel que soit le module consommateur.
import { state } from './state.js';

/**
 * Cherche un circuit par son id dans les circuits perso PUIS officiels.
 * Comparaison en `String()` : les ids sont des chaînes (« HW-… ») mais on reste
 * robuste si un id arrive en nombre. Renvoie null si introuvable ou id nul.
 * @param {string|number|null|undefined} id
 * @returns {object|null}
 */
export function findCircuitById(id) {
    if (id == null) return null;
    const sid = String(id);
    return (state.myCircuits || []).find(c => String(c.id) === sid)
        || (state.officialCircuits || []).find(c => String(c.id) === sid)
        || null;
}

/**
 * Le circuit actuellement actif (consulté, ou en cours de création/édition),
 * d'après `state.activeCircuitId`. null si aucun n'est actif.
 * @returns {object|null}
 */
export function getActiveCircuit() {
    return findCircuitById(state.activeCircuitId);
}
