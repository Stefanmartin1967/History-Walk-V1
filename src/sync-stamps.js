// sync-stamps.js — dates de changement des champs synchronisés par le Gist
// (18/11/2026, point 4 des conflits : « le changement le plus récent gagne »).
//
// Avant : « Incontournable » suivait « oui gagne » (un retrait revenait par
// l'autre appareil) ; les photos de travail suivaient « la version du Gist
// gagne » (un appareil resté ouvert pouvait effacer une référence ajoutée
// ailleurs) ; les circuits cachés suivaient « réunion » (un circuit réaffiché
// était caché de nouveau par l'autre appareil).
// Maintenant chaque changement est daté, et la fusion garde le plus récent —
// comme le statut visité (vuUpdatedAt, visited-state.js) et les circuits faits.
// Sans date des deux côtés (données d'avant ce changement), l'ancienne règle.
//
// Module PUR : aucune dépendance. La date est posée à UN endroit, l'écriture
// d'une fiche en base (database.js), pas à chaque site qui modifie ces champs.

/** Champ synchronisé → clé de sa date. Les deux listes de photos de travail
 *  partagent une date : elles doivent venir du même appareil (cf. gist-sync). */
export const SYNC_STAMPS = {
    incontournable: 'incontournableUpdatedAt',
    workPhotos: 'workPhotosUpdatedAt',
    keptWorkPhotos: 'workPhotosUpdatedAt',
};

const norm = (key, v) => {
    if (key === 'incontournable') return v === true;
    return Array.isArray(v) ? v.join('|') : '';
};

export const stampOf = (v) => (Number.isFinite(v) ? v : null);

/**
 * Dates à ajouter à une écriture de fiche : un champ synchronisé qui CHANGE
 * reçoit la date du moment, sauf si l'écriture apporte elle-même une autre date
 * (fusion d'une version reçue du Gist : elle garde la date de l'autre appareil).
 * @param {object|null} existing fiche en base avant l'écriture
 * @param {object} data champs écrits
 * @param {number} [now]
 * @returns {object|null} { <date>: now } ou null
 */
export function syncStampsFor(existing, data, now = Date.now()) {
    if (!data || typeof data !== 'object') return null;
    const prev = existing || {};
    const out = {};
    for (const [key, stampKey] of Object.entries(SYNC_STAMPS)) {
        if (!(key in data)) continue;
        if (norm(key, data[key]) === norm(key, prev[key])) continue;
        if (stampKey in data && data[stampKey] !== prev[stampKey]) continue; // date apportée
        out[stampKey] = now;
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Qui gagne entre ici et le Gist, pour un champ daté ?
 * @returns {'local'|'remote'|null} null : aucune date des deux côtés (ancienne règle)
 */
export function newer(localStamp, remoteStamp) {
    const l = stampOf(localStamp), r = stampOf(remoteStamp);
    if (l === null && r === null) return null;
    if (r === null || (l !== null && l >= r)) return 'local';
    return 'remote';
}

/**
 * Circuits cachés : fusion par circuit, la date la plus récente gagne ; sans
 * date des deux côtés, réunion (ancienne règle).
 * @param {{ids: string[], stamps: object}} local
 * @param {{ids: string[], stamps: object}} remote
 * @returns {{ids: string[], stamps: object, changed: boolean}}
 */
export function mergeHiddenCircuits(local, remote) {
    const lIds = new Set((local.ids || []).map(String));
    const rIds = new Set((remote.ids || []).map(String));
    const lSt = local.stamps || {};
    const rSt = remote.stamps || {};
    const all = new Set([...lIds, ...rIds, ...Object.keys(lSt), ...Object.keys(rSt)]);
    const ids = [];
    const stamps = { ...lSt };
    for (const id of all) {
        const win = newer(lSt[id], rSt[id]);
        let hidden;
        if (win === 'remote') { hidden = rIds.has(id); stamps[id] = rSt[id]; }
        else if (win === 'local') hidden = lIds.has(id);
        else hidden = lIds.has(id) || rIds.has(id);
        if (hidden) ids.push(id);
    }
    // Ordre d'ici conservé, ajouts à la fin.
    const ordered = [...(local.ids || []).map(String).filter(id => ids.includes(id)), ...ids.filter(id => !lIds.has(id))];
    const sameIds = ordered.length === lIds.size && ordered.every(id => lIds.has(id));
    const sameStamps = JSON.stringify(stamps) === JSON.stringify(lSt);
    return { ids: ordered, stamps, changed: !sameIds || !sameStamps };
}
