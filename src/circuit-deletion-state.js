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
