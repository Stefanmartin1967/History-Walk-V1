// circuit-deletion-state.js
//
// [ADMIN] Intentions de suppression de circuits OFFICIELS, en attente de
// publication.
//
// Module volontairement MINUSCULE et sans dépendance lourde (state + database
// uniquement) : il est importé à la fois par circuit-actions.js (qui pose
// l'intention) et par admin-control-center.js (qui la purge après publication
// ou la lève sur « Restaurer »). Passer par circuit-actions.js depuis le CC
// tirerait toute la chaîne data.js → patrimonial-names.js, qui touche `document`
// au chargement du module — ce qui casse les tests hors DOM et alourdit le
// graphe pour une liste de chaînes.
import { state, setDeletedOfficialCircuitIds } from './state.js';
import { saveAppState } from './database.js';

/**
 * Marque (ou démarque) un circuit officiel comme supprimé, en attente de
 * publication.
 *
 * Pourquoi persister : `state.officialCircuits` est reconstruit à chaque
 * démarrage depuis l'index distant (app-startup.js). Une suppression gardée
 * seulement en mémoire disparaissait donc au premier F5, silencieusement —
 * d'autant plus gênant sur une campagne de nettoyage où l'admin en enchaîne
 * plusieurs avant de publier une seule fois.
 *
 * @param {string|number} id - ID du circuit officiel
 * @param {boolean} deleted - true = marquer supprimé, false = restaurer
 * @returns {Promise<string[]>} la nouvelle liste d'ids
 */
export async function setOfficialCircuitDeleted(id, deleted) {
    const sid = String(id);
    const current = (state.deletedOfficialCircuitIds || []).map(String);
    const next = deleted
        ? (current.includes(sid) ? current : [...current, sid])
        : current.filter(x => x !== sid);
    setDeletedOfficialCircuitIds(next);
    try {
        await saveAppState('deletedOfficialCircuitIds', next);
    } catch (err) {
        console.error('[circuit-deletion-state] saveAppState a échoué', err);
    }
    return next;
}

/**
 * @param {string|number} id
 * @returns {boolean} true si une suppression est en attente pour ce circuit
 */
export function isOfficialCircuitDeleted(id) {
    return (state.deletedOfficialCircuitIds || []).map(String).includes(String(id));
}

// ============================================================================
// Suppressions serveur CONFIRMÉES pendant cette session
// ============================================================================
//
// Distinct de `deletedOfficialCircuitIds` ci-dessus : là c'était une INTENTION
// en attente de publication ; ici l'écriture est FAITE (GPX + entrée d'index
// retirés via l'API Contents, appels attendus et réussis — onglet Nettoyage).
//
// Pourquoi ce filtre existe (05/09/2026) : l'index se relit via
// raw.githubusercontent, qui peut encore servir la version d'AVANT l'écriture
// pendant quelques secondes. Tout code qui compare l'index distant à l'état
// local juste après une suppression voyait donc le circuit ressusciter —
// symptômes observés : liste Nettoyage inchangée après suppression (04-05/09),
// « SUPPRESSION » fantôme au Tableau de bord, commits vides à la publication.
//
// Règle : on fait confiance à notre propre écriture confirmée plutôt qu'à une
// lecture qui peut retarder. Session-scopé — vidé au rechargement de la page,
// quand le CDN a rattrapé depuis longtemps.
//
// ⚠️ TOUT nouveau lecteur de `circuits/<map>.json` doit passer par
// `withoutServerDeletedCircuits()`. Les cinq actuels sont : le moteur de diff,
// la liste Nettoyage, la publication, la restauration d'une suppression, et la
// détection de doublon à la création.
const _serverDeletedCircuitIds = new Set();

/** @param {string|number} id Circuit dont la suppression serveur est confirmée. */
export function noteServerDeletedCircuit(id) {
    _serverDeletedCircuitIds.add(String(id));
}

/**
 * Retire d'un index relu les circuits que l'app a déjà supprimés du serveur.
 * @param {Array} list Index tel que relu (peut être périmé).
 * @returns {Array} Index débarrassé des circuits déjà supprimés.
 */
export function withoutServerDeletedCircuits(list) {
    if (!Array.isArray(list)) return [];
    if (_serverDeletedCircuitIds.size === 0) return list;
    return list.filter(c => !_serverDeletedCircuitIds.has(String(c && c.id)));
}

/** Test-only : remet le filtre à zéro entre deux cas. */
export function _resetServerDeletedCircuits() {
    _serverDeletedCircuitIds.clear();
}
