// field-dates.js — date de changement de chaque donnée du user (19/11/2026,
// PR 1 du chantier « synchro users » : la fondation).
//
// Pour fusionner deux versions (restauration d'un fichier, synchronisation par
// le compte Google, texte officiel mis à jour depuis une modification), il faut
// savoir laquelle est la plus récente. Jusqu'ici, seuls le statut visité,
// Incontournable, les photos de travail et les circuits cachés/faits portaient
// une date. Ce module date le reste :
//   - chaque champ modifié d'une fiche (overlay userData) : `_fieldDates[champ]` ;
//   - chaque champ d'un lieu créé (ses properties, + `_position`) : idem ;
//   - chaque circuit perso : `updatedAt` (contenu), `trashUpdatedAt` (Corbeille).
//
// Module PUR. Les dates sont posées aux points d'écriture uniques (database.js) :
// aucun des sites qui modifient ces données n'a à s'en soucier.
//
// Règle commune : une valeur qui CHANGE reçoit la date du moment, sauf si
// l'écriture apporte elle-même une autre date (fusion d'une version venue
// d'ailleurs : elle garde la date de l'autre appareil).

export const FIELD_DATES_KEY = '_fieldDates';

// Clés techniques : jamais datées (ce ne sont pas des choix du user, ou elles
// ont déjà leur propre date — visité, Incontournable, photos de travail).
const META = new Set([
    FIELD_DATES_KEY, '_baseSha', '_candidateOrig', '_pending', 'noteSync', 'userData',
    'mapId', 'poiId', 'HW_ID', 'vu', 'accessPointStatus',
    'vuUpdatedAt', 'incontournableUpdatedAt', 'workPhotosUpdatedAt',
]);

export function isDatedKey(key) {
    return !META.has(key);
}

// « Vide » : absent, null, '', false ou liste vide valent la même chose (un
// éditeur qui écrit false par défaut ne change rien).
function norm(v) {
    if (v === undefined || v === null || v === '' || v === false) return '';
    if (Array.isArray(v) && v.length === 0) return '';
    return JSON.stringify(v);
}

export function sameValue(a, b) {
    return norm(a) === norm(b);
}

/**
 * Dates des champs qui changent dans une écriture.
 * @param {object|null} existing  état avant l'écriture
 * @param {object} data           champs écrits (peut porter `_fieldDates`)
 * @param {number} [now]
 * @returns {object|null} `_fieldDates` complet après l'écriture, ou null si rien ne change
 */
export function mergedFieldDates(existing, data, now = Date.now()) {
    if (!data || typeof data !== 'object') return null;
    const before = existing?.[FIELD_DATES_KEY] || {};
    const given = data[FIELD_DATES_KEY] || {};
    const fresh = {};
    for (const key of Object.keys(data)) {
        if (!isDatedKey(key)) continue;
        if (sameValue(data[key], existing?.[key])) continue;
        if (given[key] !== undefined && given[key] !== before[key]) continue; // date apportée
        fresh[key] = now;
    }
    const givenChanged = Object.keys(given).some(k => given[k] !== before[k]);
    if (!Object.keys(fresh).length && !givenChanged) return null;
    return { ...before, ...given, ...fresh };
}

/** Dates après le retrait de champs : un retrait est un changement (retour à l'officiel). */
export function datesAfterRemoval(existingDates, keys, now = Date.now()) {
    const out = { ...(existingDates || {}) };
    let changed = false;
    for (const k of keys || []) {
        if (!isDatedKey(k)) continue;
        out[k] = now;
        changed = true;
    }
    return changed ? out : null;
}

// ─── Lieux créés ──────────────────────────────────────────────────────────

const POSITION = '_position';

function placeFields(feature) {
    const props = feature?.properties || {};
    const out = {};
    for (const [k, v] of Object.entries(props)) if (isDatedKey(k)) out[k] = v;
    out[POSITION] = feature?.geometry?.coordinates;
    return out;
}

/**
 * Date les champs changés des lieux créés, entre la liste enregistrée et la
 * nouvelle. Modifie EN PLACE `properties._fieldDates` des lieux de `next` (ce
 * sont les objets en mémoire).
 * @returns {number} nombre de lieux dont une date a changé
 */
export function stampCreatedPlaces(previous, next, now = Date.now()) {
    if (!Array.isArray(next)) return 0;
    const before = new Map((Array.isArray(previous) ? previous : [])
        .map(f => [f?.properties?.HW_ID, f]).filter(([id]) => id));
    let count = 0;
    for (const feature of next) {
        if (!feature?.properties) continue;
        const old = before.get(feature.properties.HW_ID) || null;
        const dates = mergedFieldDates(
            old ? { ...placeFields(old), [FIELD_DATES_KEY]: old.properties[FIELD_DATES_KEY] } : null,
            { ...placeFields(feature), [FIELD_DATES_KEY]: feature.properties[FIELD_DATES_KEY] },
            now,
        );
        if (dates) { feature.properties[FIELD_DATES_KEY] = dates; count++; }
    }
    return count;
}

// ─── Circuits perso ───────────────────────────────────────────────────────

// Ce qui n'est pas le contenu du circuit : ses propres dates, la Corbeille et
// le statut « fait » (daté à part, officialCircuitsStatusUpdatedAt).
const CIRCUIT_VOLATILE = new Set(['updatedAt', 'trashUpdatedAt', 'isDeleted', 'isCompleted']);

function circuitContent(circuit) {
    if (!circuit) return '';
    const out = {};
    for (const k of Object.keys(circuit).sort()) if (!CIRCUIT_VOLATILE.has(k)) out[k] = circuit[k];
    return JSON.stringify(out);
}

/**
 * Date de modification d'un circuit qu'on enregistre : la date du moment si
 * son contenu change, sauf date apportée par l'écriture (fusion).
 * @returns {number|undefined} la valeur de `updatedAt` à enregistrer
 */
export function circuitUpdatedAt(existing, next, now = Date.now()) {
    if (next?.updatedAt !== undefined && next.updatedAt !== existing?.updatedAt) return next.updatedAt;
    if (existing && circuitContent(existing) === circuitContent(next)) return existing.updatedAt;
    return now;
}
