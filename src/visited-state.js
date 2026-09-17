// visited-state.js — statut « Visité » d'un lieu : dérivation et synchronisation.
//
// Un lieu est visité si l'utilisateur l'a coché (`vuManual`) OU si un circuit
// marqué « fait » le contient (`visitedByCircuits`). Deux défauts constatés le
// 17/09/2026 en remettant ce statut en ordre sur Djerba :
//
//  1. Un circuit SUPPRIMÉ restait dans `visitedByCircuits` : ses lieux restaient
//     visités sans aucun geste possible (décocher la case ne touche que
//     `vuManual`). Cas réels : deux circuits de test jamais marchés, dix lieux.
//     → Une contribution ne compte que si son circuit existe encore
//       (`isVisitCircuitKnown`). Elle n'est PAS effacée : les circuits perso ne
//       sont pas synchronisés entre appareils, un autre appareil peut donc
//       légitimement porter une contribution que celui-ci ne connaît pas.
//
//  2. La synchro Gist faisait toujours gagner « visité » (`vuManual` : true
//     gagne ; `visitedByCircuits` : union ; statut de circuit : true gagne).
//     Un « non visité » posé sur le PC était ré-écrasé par le téléphone.
//     → Dernière modification gagnante, datée par `vuUpdatedAt` (lieu) et
//       `officialCircuitsStatusUpdatedAt[id]` (circuit). Sans date des deux
//       côtés (données d'avant ce correctif), l'ancienne règle s'applique.
//
// Module FEUILLE : il n'importe que `state`.
import { state } from './state.js';

/**
 * Une contribution de circuit compte-t-elle encore ?
 *
 * Tant qu'aucun circuit officiel n'est chargé (boot en cours, index illisible,
 * hors-ligne sans cache, destination sans circuit), on ne sait rien : aucune
 * contribution n'est écartée. Un circuit perso à la corbeille ne compte plus ;
 * le restaurer le fait compter de nouveau.
 * @param {string|number} id
 * @returns {boolean}
 */
export function isVisitCircuitKnown(id) {
    const officials = state.officialCircuits || [];
    if (officials.length === 0) return true;
    const sid = String(id);
    if (officials.some(c => String(c.id) === sid)) return true;
    return (state.myCircuits || []).some(c => String(c.id) === sid && !c.isDeleted);
}

/**
 * Valeur dérivée de `vu` pour un userData (sans le modifier).
 * @param {object|null|undefined} userData
 * @returns {boolean}
 */
export function computeVu(userData) {
    if (!userData) return false;
    if (userData.vuManual === true) return true;
    const list = Array.isArray(userData.visitedByCircuits) ? userData.visitedByCircuits : [];
    return list.some(isVisitCircuitKnown);
}

/**
 * Date la dernière modification du statut visité d'un lieu (pour la synchro).
 * @param {object} userData
 * @param {number} [now]
 */
export function stampVisited(userData, now = Date.now()) {
    if (userData) userData.vuUpdatedAt = now;
}

/**
 * Recalcule `vu` pour tous les lieux chargés, en mémoire. À appeler quand la
 * liste des circuits change (suppression, restauration, chargement) : c'est ce
 * qui fait disparaître — ou revenir — les contributions d'un circuit.
 * Rien n'est écrit en base : `vu` n'est qu'un cache, recalculé à chaque boot.
 * @returns {boolean} true si au moins un lieu a changé.
 */
export function refreshVisitedFromCircuits() {
    let changed = false;
    for (const ud of Object.values(state.userData || {})) {
        if (!ud || typeof ud !== 'object') continue;
        const next = computeVu(ud);
        if (ud.vu !== next && (ud.vu !== undefined || next)) {
            ud.vu = next;
            changed = true;
        }
    }
    return changed;
}

const stampOf = (v) => (Number.isFinite(v) ? v : null);

/**
 * Fusionne le statut visité distant d'un lieu dans le local.
 *
 * Avec une date d'un côté au moins : la plus récente gagne (une date absente
 * compte comme plus ancienne). Sans date des deux côtés : ancienne règle —
 * `vuManual` true gagne, `visitedByCircuits` en union, `vu` distant non migré
 * lu comme un `vuManual`.
 *
 * @param {object} local  userData local (non modifié)
 * @param {object} remote userData distant
 * @returns {object|null} Champs à appliquer au local, ou null si rien ne change.
 */
export function mergeVisited(local, remote) {
    const lT = stampOf(local.vuUpdatedAt);
    const rT = stampOf(remote.vuUpdatedAt);
    const sameList = (a, b) => (a || []).join('|') === (b || []).join('|');

    if (lT !== null || rT !== null) {
        if (rT === null || (lT !== null && lT >= rT)) return null;
        const vuManual = remote.vuManual === true;
        const visitedByCircuits = Array.isArray(remote.visitedByCircuits) ? [...remote.visitedByCircuits] : [];
        return { vuManual, visitedByCircuits, vuUpdatedAt: rT };
    }

    const patch = {};
    if (remote.vuManual === true && local.vuManual !== true) patch.vuManual = true;
    if (Array.isArray(remote.visitedByCircuits) && remote.visitedByCircuits.length > 0) {
        const localList = Array.isArray(local.visitedByCircuits) ? local.visitedByCircuits : [];
        const union = Array.from(new Set([...localList, ...remote.visitedByCircuits]));
        if (!sameList(union, localList)) patch.visitedByCircuits = union;
    }
    if (remote.vu === true && local.vu !== true && remote.vuManual === undefined && !Array.isArray(remote.visitedByCircuits)) {
        patch.vuManual = true;
    }
    return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Fusionne le statut « fait » distant d'un circuit officiel.
 * Même règle que `mergeVisited` : date la plus récente, sinon true gagne.
 * @param {boolean} localVal
 * @param {number|undefined} localStamp
 * @param {boolean} remoteVal
 * @param {number|undefined} remoteStamp
 * @returns {{ value: boolean, stamp: number|null }|null} null si rien ne change.
 */
export function mergeCircuitDone(localVal, localStamp, remoteVal, remoteStamp) {
    const lT = stampOf(localStamp);
    const rT = stampOf(remoteStamp);
    const l = localVal === true;
    const r = remoteVal === true;
    if (lT !== null || rT !== null) {
        if (rT === null || (lT !== null && lT >= rT)) return null;
        return { value: r, stamp: rT };
    }
    if (r && !l) return { value: true, stamp: null };
    return null;
}
