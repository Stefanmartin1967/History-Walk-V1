// candidate-edits.js — modifications d'un candidat Scout gardé sur l'appareil
// (18/11/2026, point 2 des conflits, maquette « candidats Scout modifiés »).
//
// Un candidat capturé par le Scout vit dans customPois_{id} : ses modifications
// s'écrivent DANS le lieu (poi-persistence.js), sans overlay → rien ne gardait
// l'ancienne valeur, et le Centre de contrôle ne pouvait ni les voir ni les
// montrer. On note donc, au premier changement de chaque champ, la valeur
// capturée (`_candidateOrig`, dans les propriétés du lieu) ; le Centre de
// contrôle compare la valeur actuelle à celle-là. La note n'est jamais publiée
// (admin-geojson.js la retire). Module pur.

import { sameValue } from './overlay-base.js';

export const ORIG_KEY = '_candidateOrig';

// La validation (candidate → false) est une curation, pas une modification.
const IGNORED = new Set(['candidate', 'userData', ORIG_KEY]);

/**
 * Note la valeur d'origine des champs qui vont changer (première fois seulement).
 * @param {object} props propriétés du candidat (modifiées en place)
 * @param {object} data champs sur le point d'être écrits
 */
export function noteCandidateOriginals(props, data) {
    if (!props || props.candidate !== true || !data) return;
    const orig = { ...(props[ORIG_KEY] || {}) };
    let added = false;
    for (const k of Object.keys(data)) {
        if (IGNORED.has(k) || k in orig) continue;
        orig[k] = props[k] === undefined ? null : props[k];
        added = true;
    }
    if (added) props[ORIG_KEY] = orig;
}

/** Note la position capturée avant un déplacement (première fois seulement). */
export function noteCandidatePosition(props, coords) {
    if (!props || props.candidate !== true || !Array.isArray(coords)) return;
    const orig = props[ORIG_KEY] || {};
    if ('position' in orig) return;
    props[ORIG_KEY] = { ...orig, position: [coords[0], coords[1]] };
}

const fmtPos = (c) => (Array.isArray(c) ? `${(+c[1]).toFixed(5)}, ${(+c[0]).toFixed(5)}` : '—');

/**
 * Changements d'un candidat depuis sa capture : [{ key, old, new }].
 * @param {object} feature candidat (geometry.coordinates = [lng, lat])
 */
export function candidateChanges(feature) {
    const props = feature?.properties || {};
    const orig = props[ORIG_KEY];
    if (!orig) return [];
    const out = [];
    for (const [k, before] of Object.entries(orig)) {
        if (k === 'position') {
            const now = feature.geometry?.coordinates;
            if (fmtPos(now) !== fmtPos(before)) out.push({ key: 'Position', rawKey: 'position', old: fmtPos(before), new: fmtPos(now) });
            continue;
        }
        if (!sameValue(props[k], before)) {
            out.push({ key: k, rawKey: k, old: before === null || before === '' ? '—' : before, new: props[k] ?? '—' });
        }
    }
    return out;
}
