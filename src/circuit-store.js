// circuit-store.js — LE point d'écriture d'un circuit (mémoire + IndexedDB).
//
// Pourquoi ce module existe (audit du cycle circuits, 12/09/2026) : sept sites
// écrivaient un circuit chacun à sa façon — liste choisie à la main, ordre de
// recherche propre, `mapId` posé ou non. Deux défauts en sont nés :
//  - des COPIES d'un officiel dans `myCircuits` (lazy-load du tracé, import GPX).
//    L'édition allait dans la copie, la publication prenait l'original resté
//    ancien → commits « MAJ » à +0 −0 sous l'ancien nom ;
//  - des écritures sans `mapId`, stockées mais invisibles au rechargement.
//
// Règle : un id n'existe qu'UNE fois en mémoire, dans la liste officielle s'il y
// est, sinon dans la liste perso. Tout enregistrement passe par `persistCircuit`.
//
// Module FEUILLE (state + database) : importable partout sans cycle.
import { state, setOfficialCircuits, addMyCircuit, updateMyCircuit, removeMyCircuit } from './state.js';
import { saveCircuit, deleteCircuitById, getAppState, saveAppState } from './database.js';

/**
 * Écrit un circuit en IndexedDB PUIS le pose en mémoire, à sa place unique.
 * L'écriture passe d'abord : si elle échoue, l'état mémoire reste celui du
 * disque (jamais une version en avance qu'un F5 ferait disparaître).
 *
 * INVARIANT `mapId` : `savedCircuits` se relit par `index('mapId_index')`, et un
 * index IndexedDB IGNORE les enregistrements où la clé indexée est absente. Une
 * entrée d'index publié n'a pas de `mapId` → on pose celui de la carte courante
 * s'il manque (un `mapId` existant n'est jamais réécrit).
 *
 * ⚠️ N'appeler que pour une VRAIE modification. Enregistrer un officiel
 * simplement consulté figerait sa version chez l'utilisateur : au boot, la copie
 * locale prime sur l'index publié (mergeOfficialWithLocal), donc les
 * publications suivantes seraient masquées.
 *
 * @param {object} circuit Objet complet du circuit (remplace l'existant).
 * @returns {Promise<object>} Le circuit enregistré.
 */
export async function persistCircuit(circuit) {
    if (!circuit || circuit.id == null) throw new Error('persistCircuit : circuit sans id');
    if (!circuit.mapId) circuit.mapId = state.currentMapId;

    await saveCircuit(circuit);
    placeCircuitInState(circuit);
    return circuit;
}

/**
 * Pose un circuit en mémoire à sa place unique, sans écrire en base.
 * Officiel si son id figure dans `officialCircuits` (remplacé, et toute copie du
 * même id retirée de `myCircuits`) ; sinon perso (remplacé ou ajouté).
 * @param {object} circuit
 */
export function placeCircuitInState(circuit) {
    const sid = String(circuit.id);
    const officials = state.officialCircuits || [];
    const offIdx = officials.findIndex(c => String(c.id) === sid);

    if (offIdx > -1) {
        const next = [...officials];
        next[offIdx] = { ...circuit, isOfficial: true };
        setOfficialCircuits(next);
        if ((state.myCircuits || []).some(c => String(c.id) === sid)) removeMyCircuit(sid);
        return;
    }

    if ((state.myCircuits || []).some(c => String(c.id) === sid)) updateMyCircuit(circuit);
    else addMyCircuit(circuit);
}

/**
 * Oublie localement un circuit SUPPRIMÉ DU SERVEUR : sa copie IndexedDB, sa
 * présence éventuelle dans `myCircuits` et le brouillon qui le viserait.
 *
 * Pourquoi (13/09/2026) : éditer un officiel enregistre sa version modifiée en
 * base locale. Supprimer ensuite le circuit du serveur ne le retirait que de
 * `officialCircuits` en mémoire ; au F5, la copie locale, rattachée à aucune
 * entrée d'index, devenait un circuit orphelin — masqué de la liste (marqué
 * officiel) mais « NOUVEAU » au diff du CC, et republié au « Tout publier »
 * suivant.
 *
 * À n'appeler qu'une fois la suppression effective sur le serveur. Jamais au
 * boot par déduction : un index illisible (hors-ligne) ferait passer toutes les
 * copies d'officiels pour orphelines.
 * @param {string|number} id
 */
export async function forgetDeletedCircuit(id) {
    const sid = String(id);
    await deleteCircuitById(sid);
    if ((state.myCircuits || []).some(c => String(c.id) === sid)) removeMyCircuit(sid);

    const draftKey = `circuitDraft_${state.currentMapId}`;
    const draft = await getAppState(draftKey);
    if (draft && draft.circuitId != null && String(draft.circuitId) === sid) {
        await saveAppState(draftKey, null);
    }
}
