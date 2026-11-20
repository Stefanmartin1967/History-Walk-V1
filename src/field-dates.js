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
//
// Chaque changement retient aussi la date de la version DONT IL PART
// (`_fieldFrom`, PR 2, 19/11/2026). C'est ce qui distingue « le PC a corrigé le
// texte reçu du téléphone » (il en descend : pas de question) de « les deux ont
// été écrits chacun de son côté » (vrai conflit) — cf. restore-merge.js.

export const FIELD_DATES_KEY = '_fieldDates';
export const FIELD_FROM_KEY = '_fieldFrom';

// Clés techniques : jamais datées (ce ne sont pas des choix du user, ou elles
// ont déjà leur propre date — visité, Incontournable, photos de travail).
const META = new Set([
    FIELD_DATES_KEY, '_fieldFrom', '_baseSha', '_officialBase', '_candidateOrig', '_pending', 'noteSync', 'userData',
    'mapId', 'poiId', 'HW_ID', 'vu', 'accessPointStatus',
    'vuUpdatedAt', 'incontournableUpdatedAt', 'workPhotosUpdatedAt',
]);

export function isDatedKey(key) {
    return !META.has(key);
}

// « Vide » : absent, null, '', false ou liste vide valent la même chose (un
// éditeur qui écrit false par défaut ne change rien).
function norm(v) {
    // Un texte ne diffère pas par ses espaces de début / fin ni ses fins de
    // ligne (19/11/2026 : une note du téléphone finie par une espace passait
    // pour « mise à jour » à la restauration).
    if (typeof v === 'string') v = v.replace(/\r\n/g, '\n').trim();
    if (v === undefined || v === null || v === '' || v === false) return '';
    if (Array.isArray(v) && v.length === 0) return '';
    return JSON.stringify(v);
}

export function sameValue(a, b) {
    return norm(a) === norm(b);
}

/**
 * Dates des champs qui changent dans une écriture, et la date de la version
 * dont chacun part.
 * @param {object|null} existing  état avant l'écriture
 * @param {object} data           champs écrits (peut porter `_fieldDates` / `_fieldFrom`)
 * @param {number} [now]
 * @returns {{_fieldDates: object, _fieldFrom: object}|null} les deux maps complètes
 *          après l'écriture, ou null si rien ne change
 */
export function fieldStamps(existing, data, now = Date.now()) {
    if (!data || typeof data !== 'object') return null;
    const before = existing?.[FIELD_DATES_KEY] || {};
    const beforeFrom = existing?.[FIELD_FROM_KEY] || {};
    const given = data[FIELD_DATES_KEY] || {};
    const givenFrom = data[FIELD_FROM_KEY] || {};
    const fresh = {};
    const freshFrom = {};
    for (const key of Object.keys(data)) {
        if (!isDatedKey(key)) continue;
        if (sameValue(data[key], existing?.[key])) continue;
        if (given[key] !== undefined && given[key] !== before[key]) continue; // date apportée
        fresh[key] = now;
        if (before[key] !== undefined) freshFrom[key] = before[key];
    }
    const givenChanged = Object.keys(given).some(k => given[k] !== before[k])
        || Object.keys(givenFrom).some(k => givenFrom[k] !== beforeFrom[k]);
    if (!Object.keys(fresh).length && !givenChanged) return null;
    return {
        [FIELD_DATES_KEY]: { ...before, ...given, ...fresh },
        [FIELD_FROM_KEY]: { ...beforeFrom, ...givenFrom, ...freshFrom },
    };
}

/** Après le retrait de champs : un retrait est un changement (retour à l'officiel). */
export function stampsAfterRemoval(existing, keys, now = Date.now()) {
    const dates = { ...(existing?.[FIELD_DATES_KEY] || {}) };
    const from = { ...(existing?.[FIELD_FROM_KEY] || {}) };
    let changed = false;
    for (const k of keys || []) {
        if (!isDatedKey(k)) continue;
        if (dates[k] !== undefined) from[k] = dates[k];
        dates[k] = now;
        changed = true;
    }
    return changed ? { [FIELD_DATES_KEY]: dates, [FIELD_FROM_KEY]: from } : null;
}

// ─── Lieux créés ──────────────────────────────────────────────────────────

export const POSITION = '_position';

export function placeFields(feature) {
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
    const withStamps = (f) => ({ ...placeFields(f), [FIELD_DATES_KEY]: f.properties[FIELD_DATES_KEY], [FIELD_FROM_KEY]: f.properties[FIELD_FROM_KEY] });
    for (const feature of next) {
        if (!feature?.properties) continue;
        const old = before.get(feature.properties.HW_ID) || null;
        const stamps = fieldStamps(old ? withStamps(old) : null, withStamps(feature), now);
        if (stamps) { Object.assign(feature.properties, stamps); count++; }
    }
    return count;
}

// ─── Circuits perso ───────────────────────────────────────────────────────

// Ce qui n'est pas le contenu du circuit : ses propres dates, la Corbeille et
// le statut « fait » (daté à part, officialCircuitsStatusUpdatedAt).
const CIRCUIT_VOLATILE = new Set([
    'updatedAt', 'trashUpdatedAt', 'isDeleted', 'isCompleted', 'completedUpdatedAt',
    '_partDates', '_partFrom',
]);

// Les MORCEAUX d'un circuit perso (synchro Google, PR 7, maquette écrans 43-46
// validée par Stefan le 20/11/2026) : chacun a sa date, comparé séparément. On
// ne demande que pour un morceau changé des deux côtés. Le reste du contenu
// (transport, fichier…) suit le tracé.
export const CIRCUIT_PARTS = {
    name: ['name'],
    description: ['description'],
    steps: ['poiIds'],
    trace: null, // tout le reste du contenu
};
export const PART_DATES_KEY = '_partDates';
export const PART_FROM_KEY = '_partFrom';

/** Valeur d'un morceau (texte comparable). */
export function circuitPart(circuit, part) {
    if (!circuit) return '';
    const keys = CIRCUIT_PARTS[part];
    const out = {};
    if (keys) {
        for (const k of keys) out[k] = circuit[k];
    } else {
        const named = new Set(Object.values(CIRCUIT_PARTS).flat().filter(Boolean));
        for (const k of Object.keys(circuit).sort()) {
            if (!CIRCUIT_VOLATILE.has(k) && !named.has(k) && k !== 'id' && k !== 'mapId') out[k] = circuit[k];
        }
    }
    return JSON.stringify(out);
}

/** Date d'un morceau ; un circuit d'avant la PR 7 prend sa date d'ensemble. */
export function circuitPartDate(circuit, part) {
    return circuit?.[PART_DATES_KEY]?.[part] ?? circuit?.updatedAt;
}

/**
 * Dates des morceaux qui changent dans une écriture (même règle que les champs :
 * date du moment, sauf date apportée par l'écriture ; la date de départ est
 * retenue dans `_partFrom`).
 * @returns {{_partDates:object, _partFrom:object}|null}
 */
export function circuitPartStamps(existing, next, now = Date.now()) {
    if (!next) return null;
    const before = existing?.[PART_DATES_KEY] || {};
    const beforeFrom = existing?.[PART_FROM_KEY] || {};
    const given = next[PART_DATES_KEY] || {};
    const givenFrom = next[PART_FROM_KEY] || {};
    const dates = { ...before, ...given };
    const from = { ...beforeFrom, ...givenFrom };
    let changed = Object.keys(given).some(k => given[k] !== before[k]) || Object.keys(givenFrom).some(k => givenFrom[k] !== beforeFrom[k]);
    for (const part of Object.keys(CIRCUIT_PARTS)) {
        if (existing && circuitPart(existing, part) === circuitPart(next, part)) continue;
        if (given[part] !== undefined && given[part] !== before[part]) continue; // date apportée
        dates[part] = now;
        const prev = existing ? circuitPartDate(existing, part) : undefined;
        if (prev !== undefined) from[part] = prev; else delete from[part];
        changed = true;
    }
    return changed ? { [PART_DATES_KEY]: dates, [PART_FROM_KEY]: from } : null;
}

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
