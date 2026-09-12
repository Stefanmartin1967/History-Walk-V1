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

/**
 * Fusionne l'entrée d'index d'un circuit officiel avec sa copie locale (IDB).
 *
 * Le local prime — c'est ainsi qu'une édition admin pas encore publiée reste
 * visible (nom, poiIds, realTrack, ascend, description). DEUX EXCEPTIONS :
 * `file` et `distance` sont des **artefacts de publication**, recalculés par
 * `buildCircuitIndexEntry` à chaque publication. La copie locale n'en détient
 * qu'un instantané figé — `saveAndExportCircuit` persiste l'objet officiel
 * ENTIER, ces champs compris, sans jamais les rafraîchir. Les laisser gagner
 * produit deux dégâts, mesurés le 12/09/2026 :
 *  - `distance` périmée → la carte du circuit annonce 5,7 km là où l'index
 *    publié dit 7,7, le panneau affichant 7,7 puisqu'il recalcule depuis le
 *    tracé : deux chiffres contradictoires au même écran ;
 *  - `file` périmé après un renommage → le GPX est cherché sous l'ancien nom,
 *    404, donc aucun tracé chargé et repli silencieux en vol d'oiseau.
 *
 * @param {object} off Entrée telle que lue dans l'index publié.
 * @param {object|null} loc Copie locale (IndexedDB), ou null s'il n'y en a pas.
 * @returns {object} Le circuit officiel fusionné.
 */
export function mergeOfficialWithLocal(off, loc) {
    if (!loc) return off;
    return {
        ...off,
        ...loc,
        // L'index est la source de vérité ; repli sur le local s'il ne la porte pas.
        file: off.file ?? loc.file,
        distance: off.distance ?? loc.distance,
        isOfficial: true
    };
}
