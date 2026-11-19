// restore-merge.js — restaurer une sauvegarde en la RÉUNISSANT avec l'appareil
// (19/11/2026, PR 2 du chantier « synchro users », maquette écrans 17-19 validée).
//
// Avant : la restauration remplaçait (circuits perso, lieux masqués, statuts,
// lieux créés) ou faisait gagner le fichier champ par champ — un travail fait
// sur l'appareil depuis la sauvegarde disparaissait sans un mot.
//
// Maintenant, pour chaque donnée présente des deux côtés :
//  - la version qui DESCEND de l'autre gagne (dates de field-dates.js : un
//    changement retient la date de la version dont il part) — « le PC a corrigé
//    le texte reçu du téléphone » ne pose aucune question ;
//  - deux versions écrites chacune de son côté : pour un TEXTE, c'est un conflit
//    (la version de l'appareil reste en attendant le choix du user) ; pour le
//    reste (position, catégorie, cases…), la plus récente gagne ;
//  - aucune date des deux côtés (données d'avant la PR 1, appli pas encore
//    publiée) : le fichier gagne, comme avant.
// Ce qui n'existe que d'un côté est gardé (réunion). Visité, Incontournable,
// photos de travail, circuits faits / cachés : mêmes règles que le Gist.
//
// Module PUR : reçoit l'état de l'appareil et le fichier, rend le résultat et le
// résumé. L'écriture et l'écran sont ailleurs (fileManager.js, restore-ui.js).

import { FIELD_DATES_KEY, FIELD_FROM_KEY, isDatedKey, sameValue, placeFields, POSITION } from './field-dates.js';
import { newer, mergeHiddenCircuits } from './sync-stamps.js';
import { mergeVisited, mergeCircuitDone } from './visited-state.js';

// Champs de choix (liste fermée) : jamais une question, la plus récente gagne.
const CHOICE_KEYS = new Set(['Catégorie', 'Sous-type', 'État', 'Accès', 'Zone']);
// Gérés à part (règles du Gist) ou propres à l'appareil.
const SPECIAL_KEYS = new Set([
    'vu', 'vuManual', 'visitedByCircuits', 'incontournable', 'workPhotos', 'keptWorkPhotos', 'photos',
]);

/**
 * Qui gagne entre la version d'ici et celle du fichier, pour un champ ?
 * @param {{value:*, date?:number, from?:number}} here
 * @param {{value:*, date?:number, from?:number}} file
 * @returns {'same'|'here'|'file'|'both'} `both` : écrits chacun de son côté
 */
export function decideField(here, file) {
    if (sameValue(here.value, file.value)) return 'same';
    const hd = here.date, fd = file.date;
    if (hd === undefined) return 'file';       // ici jamais daté : fichier (y compris aucune date)
    if (fd === undefined) return 'here';       // le fichier n'a rien de daté : ici a changé depuis
    if (hd === fd) return 'here';
    if (here.from !== undefined && fd <= here.from) return 'here'; // ici descend du fichier
    if (file.from !== undefined && hd <= file.from) return 'file'; // le fichier descend d'ici
    return 'both';
}

function isText(key, a, b) {
    if (CHOICE_KEYS.has(key)) return false;
    return (typeof a === 'string' && a !== '') || (typeof b === 'string' && b !== '');
}

/**
 * Fusionne les champs datés de deux objets (overlay d'une fiche, ou properties
 * d'un lieu créé ramenées par placeFields).
 * @returns {{next:object, dates:object, from:object, tookFile:string[], keptHere:string[], conflicts:Array}}
 */
function mergeDated(here, file, keys) {
    const hDates = here[FIELD_DATES_KEY] || {}, hFrom = here[FIELD_FROM_KEY] || {};
    const fDates = file[FIELD_DATES_KEY] || {}, fFrom = file[FIELD_FROM_KEY] || {};
    const next = {};
    const dates = { ...hDates };
    const from = { ...hFrom };
    const tookFile = [], keptHere = [], conflicts = [];
    for (const key of keys) {
        const h = { value: here[key], date: hDates[key], from: hFrom[key] };
        const f = { value: file[key], date: fDates[key], from: fFrom[key] };
        // Absent du fichier sans date : le fichier ne dit rien de ce champ (il
        // n'existait pas encore, ou n'a jamais été touché là-bas) — on garde ici.
        // Un RETRAIT fait là-bas, lui, est daté (field-dates.js).
        if (f.value === undefined && f.date === undefined) { next[key] = h.value; continue; }
        let verdict = decideField(h, f);
        if (verdict === 'both' && !isText(key, h.value, f.value)) verdict = f.date > h.date ? 'file' : 'here';
        if (verdict === 'file') {
            next[key] = f.value;
            if (f.date !== undefined) dates[key] = f.date; else delete dates[key];
            if (f.from !== undefined) from[key] = f.from; else delete from[key];
            tookFile.push(key);
        } else {
            next[key] = h.value;
            if (verdict === 'here') keptHere.push(key);
            if (verdict === 'both') conflicts.push({ key, here: h.value ?? '', file: f.value ?? '', fileDate: f.date, fileFrom: f.from });
        }
    }
    return { next, dates, from, tookFile, keptHere, conflicts };
}

function datedKeys(a, b, filter = isDatedKey) {
    return [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])]
        .filter(k => filter(k) && !SPECIAL_KEYS.has(k));
}

/**
 * Fusion de l'overlay d'UNE fiche.
 * @returns {{data:object|null, tookFile:string[], keptHere:string[], conflicts:Array, addedVisit:boolean, addedNote:boolean}}
 *          `data` : l'overlay à enregistrer (null si rien ne change ici)
 */
export function mergePoiData(here = {}, file = {}) {
    const res = { data: null, tookFile: [], keptHere: [], conflicts: [], addedVisit: false, addedNote: false };
    const merged = mergeDated(here, file, datedKeys(here, file));
    const out = { ...here };
    let changed = false;
    res.tookFile.push(...merged.tookFile);
    for (const key of merged.tookFile) {
        if (file[key] === undefined) delete out[key]; else out[key] = file[key];
        changed = true;
    }
    if (merged.tookFile.length) {
        out[FIELD_DATES_KEY] = merged.dates;
        out[FIELD_FROM_KEY] = merged.from;
        if (!here.notes && file.notes && merged.tookFile.includes('notes')) res.addedNote = true;
    }

    // Visité : règle du Gist (la plus récente modification, sinon visité gagne).
    const visited = mergeVisited(here, file);
    if (visited) {
        Object.assign(out, visited);
        out.vu = out.vuManual === true || (Array.isArray(out.visitedByCircuits) && out.visitedByCircuits.length > 0);
        if (out.vu && !here.vu && !here.vuManual) res.addedVisit = true;
        changed = true;
        res.tookFile.push('vu');
    }
    // Incontournable : le plus récent ; sans date, « oui » gagne.
    const inc = newer(here.incontournableUpdatedAt, file.incontournableUpdatedAt);
    if (inc === 'remote' && (file.incontournable === true) !== (here.incontournable === true)) {
        out.incontournable = file.incontournable === true;
        out.incontournableUpdatedAt = file.incontournableUpdatedAt;
        changed = true; res.tookFile.push('incontournable');
    } else if (inc === null && file.incontournable === true && !here.incontournable) {
        out.incontournable = true;
        changed = true; res.tookFile.push('incontournable');
    }
    // Photos de travail : le plus récent ; sans date, le fichier (comme le Gist).
    const wp = newer(here.workPhotosUpdatedAt, file.workPhotosUpdatedAt);
    if (wp !== 'local') {
        for (const key of ['workPhotos', 'keptWorkPhotos']) {
            if (file[key] === undefined || sameValue(file[key], here[key])) continue;
            out[key] = file[key];
            changed = true; res.tookFile.push(key);
        }
        if (wp === 'remote') out.workPhotosUpdatedAt = file.workPhotosUpdatedAt;
    }

    // Références de photos (chemins) : réunion.
    if (Array.isArray(file.photos) && file.photos.length) {
        const union = [...new Set([...(Array.isArray(here.photos) ? here.photos : []), ...file.photos])];
        if (!sameValue(union, here.photos)) { out.photos = union; changed = true; res.tookFile.push('photos'); }
    }

    res.keptHere = merged.keptHere;
    res.conflicts = merged.conflicts;
    if (changed) res.data = out;
    return res;
}

/** Fusion des lieux créés : réunion par identifiant, champ par champ pour un lieu des deux côtés. */
export function mergePlaces(herePlaces = [], filePlaces = []) {
    const byId = new Map(herePlaces.map(f => [f?.properties?.HW_ID, f]));
    const result = herePlaces.map(f => f);
    const added = [], updated = [], kept = [], conflicts = [];
    for (const fileFeature of filePlaces) {
        const id = fileFeature?.properties?.HW_ID;
        if (!id) continue;
        const clean = JSON.parse(JSON.stringify(fileFeature));
        delete clean.properties.userData;
        const here = byId.get(id);
        if (!here) { result.push(clean); added.push(clean); continue; }

        const hFields = { ...placeFields(here), [FIELD_DATES_KEY]: here.properties[FIELD_DATES_KEY], [FIELD_FROM_KEY]: here.properties[FIELD_FROM_KEY] };
        const fFields = { ...placeFields(clean), [FIELD_DATES_KEY]: clean.properties[FIELD_DATES_KEY], [FIELD_FROM_KEY]: clean.properties[FIELD_FROM_KEY] };
        const merged = mergeDated(hFields, fFields, datedKeys(hFields, fFields));
        if (merged.tookFile.length) {
            const next = JSON.parse(JSON.stringify(here));
            for (const key of merged.tookFile) {
                if (key === POSITION) next.geometry = { ...next.geometry, coordinates: fFields[POSITION] };
                else if (clean.properties[key] === undefined) delete next.properties[key];
                else next.properties[key] = clean.properties[key];
            }
            next.properties[FIELD_DATES_KEY] = merged.dates;
            next.properties[FIELD_FROM_KEY] = merged.from;
            result[result.indexOf(here)] = next;
            updated.push(next);
        }
        if (merged.keptHere.length) kept.push(here);
        merged.conflicts.forEach(c => conflicts.push({ ...c, id }));
    }
    return { places: result, added, updated, kept, conflicts };
}

const isValidCircuit = (c) => c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.poiIds) && !c.isOfficial;

/** Circuits perso : réunion ; des deux côtés, la plus récente version gagne (contenu, puis Corbeille). */
export function mergeCircuits(hereCircuits = [], fileCircuits = []) {
    const byId = new Map(hereCircuits.map(c => [String(c.id), c]));
    const toSave = [], added = [], updated = [], kept = [];
    for (const fc of (fileCircuits || []).filter(isValidCircuit)) {
        const here = byId.get(String(fc.id));
        if (!here) { toSave.push({ ...fc }); added.push(fc); continue; }
        let next = here;
        const { isDeleted: _d, trashUpdatedAt: _t, updatedAt: _u, isCompleted: _c, ...fContent } = fc;
        const { isDeleted: _d2, trashUpdatedAt: _t2, updatedAt: _u2, isCompleted: _c2, ...hContent } = here;
        if (!sameValue(fContent, hContent)) {
            const fileWins = here.updatedAt === undefined || (fc.updatedAt !== undefined && fc.updatedAt > here.updatedAt);
            if (fileWins) next = { ...here, ...fContent, updatedAt: fc.updatedAt };
            else kept.push(here);
        }
        if (!!fc.isDeleted !== !!here.isDeleted) {
            const fileWins = here.trashUpdatedAt === undefined || (fc.trashUpdatedAt !== undefined && fc.trashUpdatedAt > here.trashUpdatedAt);
            if (fileWins) next = { ...next, isDeleted: !!fc.isDeleted, trashUpdatedAt: fc.trashUpdatedAt };
        }
        if (next !== here) { toSave.push(next); updated.push(next); }
    }
    return { toSave, added, updated, kept };
}

/**
 * Fusion complète d'une sauvegarde avec l'appareil.
 * @param {object} here  { userData, places, circuits, hiddenPoiIds, circuitsStatus, circuitsStatusUpdatedAt, hiddenCircuitIds, hiddenCircuitIdsUpdatedAt }
 * @param {object} file  même forme, lue dans le fichier
 * @returns {object} ce qu'il faut écrire + `summary` + `conflicts`
 */
export function mergeBackup(here, file) {
    const userData = {};
    const summary = { visits: 0, notes: 0, places: [], circuits: [], updated: [], kept: [], keptCircuits: 0 };
    const conflicts = [];

    const ids = new Set([...Object.keys(here.userData || {}), ...Object.keys(file.userData || {})]);
    for (const id of ids) {
        const h = here.userData?.[id];
        const f = file.userData?.[id];
        if (!f) continue;
        const r = mergePoiData(h || {}, f);
        if (r.data) userData[id] = r.data;
        if (r.addedVisit) summary.visits++;
        if (r.addedNote) summary.notes++;
        if (h && r.tookFile.length && !r.addedVisit) summary.updated.push(id);
        if (h && r.keptHere.length) summary.kept.push(id);
        r.conflicts.forEach(c => conflicts.push({ ...c, kind: 'poi', id }));
    }

    const places = mergePlaces(here.places || [], file.places || []);
    summary.places = places.added.map(f => f.properties?.['Nom du site FR'] || f.properties?.HW_ID);
    places.updated.forEach(f => summary.updated.push(f.properties.HW_ID));
    places.kept.forEach(f => summary.kept.push(f.properties.HW_ID));
    places.conflicts.forEach(c => conflicts.push({ ...c, kind: 'place' }));

    const circuits = mergeCircuits(here.circuits || [], file.circuits || []);
    summary.circuits = circuits.added.map(c => c.name);
    summary.keptCircuits = circuits.kept.length;
    summary.updatedCircuits = circuits.updated.length;

    // Lieux masqués : réunion (masquer = supprimer, pas de geste inverse).
    const hiddenPoiIds = [...new Set([...(here.hiddenPoiIds || []), ...(file.hiddenPoiIds || [])])];

    // Circuits faits : la plus récente modification, par circuit.
    const circuitsStatus = { ...(here.circuitsStatus || {}) };
    const circuitsStatusUpdatedAt = { ...(here.circuitsStatusUpdatedAt || {}) };
    for (const [cid, val] of Object.entries(file.circuitsStatus || {})) {
        const res = mergeCircuitDone(circuitsStatus[cid], circuitsStatusUpdatedAt[cid], val, file.circuitsStatusUpdatedAt?.[cid]);
        if (!res) continue;
        if (res.value) circuitsStatus[cid] = true; else delete circuitsStatus[cid];
        if (res.stamp !== null) circuitsStatusUpdatedAt[cid] = res.stamp;
    }

    // Circuits cachés : le plus récent geste, par circuit.
    const hidden = mergeHiddenCircuits(
        { ids: here.hiddenCircuitIds || [], stamps: here.hiddenCircuitIdsUpdatedAt || {} },
        { ids: file.hiddenCircuitIds || [], stamps: file.hiddenCircuitIdsUpdatedAt || {} },
    );

    summary.updated = [...new Set(summary.updated)];
    summary.kept = [...new Set(summary.kept.filter(id => !summary.updated.includes(id)))];
    return {
        userData,
        places: places.places,
        placesChanged: places.added.length > 0 || places.updated.length > 0,
        circuitsToSave: circuits.toSave,
        hiddenPoiIds,
        circuitsStatus, circuitsStatusUpdatedAt,
        hiddenCircuitIds: hidden.ids, hiddenCircuitIdsUpdatedAt: hidden.stamps,
        summary,
        conflicts,
    };
}
