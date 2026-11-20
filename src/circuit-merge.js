// circuit-merge.js — réunir les circuits perso de deux appareils (synchro Google,
// PR 7 du chantier « synchro users », maquette écrans 43-46 validée par Stefan
// le 20/11/2026). Module PUR : reçoit les listes, rend ce qu'il faut écrire.
//
// Un circuit est comparé en MORCEAUX, séparément (field-dates.js CIRCUIT_PARTS) :
// nom, description, étapes, tracé. Pour chacun, la règle des champs
// (restore-merge.js decideField) : la version qui descend de l'autre gagne ; deux
// versions écrites chacune de son côté sont un choix pour le user. Le tracé suit
// les étapes : si les étapes sont à choisir, on ne demande pas le tracé à part.
//
// Corbeille : le geste le plus récent gagne. Fait / pas fait : idem (sans date,
// « fait » gagne). Suppression définitive : la liste des circuits supprimés est
// gardée pour toujours dans le compte ; un appareil qui a encore le circuit le
// supprime, SAUF s'il l'a modifié après la suppression : il le garde dans sa
// Corbeille (un « survivant », annoncé au user).

import {
    CIRCUIT_PARTS, circuitPart, circuitPartDate, PART_DATES_KEY, PART_FROM_KEY,
} from './field-dates.js';
import { decideField } from './restore-merge.js';

const PARTS = Object.keys(CIRCUIT_PARTS); // name, description, steps, trace
const NAMED = new Set(Object.values(CIRCUIT_PARTS).flat().filter(Boolean));
const NOT_CONTENT = new Set([
    'id', 'mapId', 'updatedAt', 'trashUpdatedAt', 'isDeleted', 'isCompleted', 'completedUpdatedAt',
    PART_DATES_KEY, PART_FROM_KEY,
]);

const isPerso = (c) => c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.poiIds) && !c.isOfficial;

function partKeys(circuit, part) {
    if (CIRCUIT_PARTS[part]) return CIRCUIT_PARTS[part];
    return Object.keys(circuit || {}).filter(k => !NOT_CONTENT.has(k) && !NAMED.has(k));
}

/**
 * Recopie un morceau de `source` dans `target` (qui est modifié), avec sa date.
 * @param {number} [date] date à poser (sinon celle de la source)
 * @param {number} [from] date de départ à poser (sinon celle de la source)
 */
export function takePart(target, source, part, date, from) {
    for (const k of partKeys(target, part)) if (!CIRCUIT_PARTS[part] || !(k in source)) delete target[k];
    for (const k of partKeys(source, part)) {
        if (source[k] === undefined) delete target[k];
        else target[k] = JSON.parse(JSON.stringify(source[k]));
    }
    const d = date ?? circuitPartDate(source, part);
    const f = from ?? source[PART_FROM_KEY]?.[part];
    target[PART_DATES_KEY] = { ...(target[PART_DATES_KEY] || {}) };
    target[PART_FROM_KEY] = { ...(target[PART_FROM_KEY] || {}) };
    if (d !== undefined) target[PART_DATES_KEY][part] = d; else delete target[PART_DATES_KEY][part];
    if (f !== undefined) target[PART_FROM_KEY][part] = f; else delete target[PART_FROM_KEY][part];
    return target;
}

/** Dernière date à laquelle le circuit a été touché (contenu, Corbeille, fait). */
export function lastTouched(c) {
    const dates = [c?.updatedAt, c?.trashUpdatedAt, c?.completedUpdatedAt, ...Object.values(c?.[PART_DATES_KEY] || {})]
        .filter(n => typeof n === 'number');
    return dates.length ? Math.max(...dates) : 0;
}

/** Valeur d'un morceau telle qu'on la montre au user (texte, liste d'étapes, tracé). */
function shown(circuit, part) {
    if (part === 'name' || part === 'description') return String(circuit?.[part] ?? '');
    if (part === 'steps') return [...(circuit?.poiIds || [])];
    return circuit?.realTrack || null;
}

/**
 * Fusion d'UN circuit présent des deux côtés.
 * @returns {{next:object|null, tookFile:string[], conflicts:Array}} `next` : à enregistrer (null si rien ne change)
 */
export function mergeCircuitPair(here, file) {
    const next = JSON.parse(JSON.stringify(here));
    const tookFile = [];
    let conflicts = [];
    for (const part of PARTS) {
        const h = { value: circuitPart(here, part), date: circuitPartDate(here, part), from: here[PART_FROM_KEY]?.[part] };
        const f = { value: circuitPart(file, part), date: circuitPartDate(file, part), from: file[PART_FROM_KEY]?.[part] };
        const verdict = decideField(h, f);
        if (verdict === 'file') { takePart(next, file, part); tookFile.push(part); }
        if (verdict === 'both') conflicts.push({ key: part, here: shown(here, part), file: shown(file, part), fileDate: f.date });
    }
    // Le tracé suit les étapes : une seule question.
    if (conflicts.some(c => c.key === 'steps')) conflicts = conflicts.filter(c => c.key !== 'trace');

    // Corbeille : le geste le plus récent.
    if (!!file.isDeleted !== !!here.isDeleted) {
        const fileWins = here.trashUpdatedAt === undefined || (file.trashUpdatedAt !== undefined && file.trashUpdatedAt > here.trashUpdatedAt);
        if (fileWins) { next.isDeleted = !!file.isDeleted; next.trashUpdatedAt = file.trashUpdatedAt; tookFile.push('trash'); }
    }
    // Fait / pas fait : le plus récent ; sans date, « fait » gagne.
    if (!!file.isCompleted !== !!here.isCompleted) {
        const hd = here.completedUpdatedAt, fd = file.completedUpdatedAt;
        const fileWins = (fd !== undefined && (hd === undefined || fd > hd)) || (fd === undefined && hd === undefined && file.isCompleted);
        if (fileWins) { next.isCompleted = !!file.isCompleted; if (fd !== undefined) next.completedUpdatedAt = fd; tookFile.push('done'); }
    }
    return { next: tookFile.length ? next : null, tookFile, conflicts };
}

/**
 * Réunit les circuits perso d'une destination.
 * @param {Array} hereList circuits de l'appareil
 * @param {Array} fileList circuits du compte
 * @param {Object<string,number>} deletions suppressions définitives connues (id → date), des deux côtés
 * @param {number} [now]
 * @returns {{toSave:Array, toDelete:string[], added:Array, updated:Array, survivors:Array, conflicts:Array}}
 */
export function mergeCircuitLists(hereList = [], fileList = [], deletions = {}, now = Date.now()) {
    const here = new Map((hereList || []).filter(isPerso).map(c => [String(c.id), c]));
    const file = new Map((fileList || []).filter(isPerso).map(c => [String(c.id), c]));
    const out = { toSave: [], toDelete: [], added: [], updated: [], survivors: [], conflicts: [] };
    for (const id of new Set([...here.keys(), ...file.keys()])) {
        const h = here.get(id), f = file.get(id);
        const del = deletions[id];
        if (del !== undefined) {
            if (h) {
                if (lastTouched(h) <= del) { out.toDelete.push(id); continue; }
                if (!h.isDeleted && (h.trashUpdatedAt ?? 0) <= del) {
                    // Modifié ici après la suppression : gardé dans la Corbeille.
                    const kept = { ...h, isDeleted: true, trashUpdatedAt: now };
                    out.toSave.push(kept);
                    out.survivors.push(kept);
                    continue;
                }
            } else if (f && lastTouched(f) <= del) {
                continue; // supprimé ailleurs : on ne le reprend pas
            }
        }
        if (!h) { out.toSave.push(JSON.parse(JSON.stringify(f))); out.added.push(f); continue; }
        if (!f) continue;
        const r = mergeCircuitPair(h, f);
        if (r.next) { out.toSave.push(r.next); out.updated.push(r.next); }
        r.conflicts.forEach(c => out.conflicts.push({ ...c, kind: 'circuit', id }));
    }
    return out;
}
