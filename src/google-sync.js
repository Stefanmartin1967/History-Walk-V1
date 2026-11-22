// google-sync.js — synchroniser les données d'un user avec SON compte Google
// (PR 6 du chantier « synchro users », maquette écrans 35-42 validée par Stefan
// le 20/11/2026). Liaison et accès : google-account.js. Écrans : google-sync-ui.js.
//
// Un fichier par destination dans l'espace Heripia du compte (dossier caché
// appDataFolder) : `heripia-<destination>.json` = { v, mapId, savedAt, state,
// discarded, deletedCircuits }. `state` a la forme de readDeviceState (restore-apply.js).
//
// Une synchronisation = la restauration qui fusionne, avec le compte pour
// « fichier » (restore-merge.js : le plus récent gagne, un texte écrit des deux
// côtés est un conflit), puis l'envoi du résultat :
//  1. lire l'appareil et le fichier du compte ;
//  2. réunir ; écrire sur l'appareil ce qui vient du compte (en base et en
//     mémoire si c'est la destination ouverte) ;
//  3. renvoyer la réunion dans le compte. Pour un morceau encore À CHOISIR, le
//     compte garde SA version : l'autre appareil ne voit donc pas de conflit,
//     et quand le user choisit ici, le morceau choisi part de cette version
//     (writeChosenText, resolveCircuitChoice) — l'autre appareil le reprend sans question.
//
// DERNIER POINT COMMUN (22/11/2026, essai de Stefan : un tracé modifié des deux
// côtés, appareils déconnectés, était perdu sans question) : après chaque
// échange, l'appareil retient la date de chaque champ / morceau tel qu'il est
// dans le compte (`syncBase_<destination>`, lié à l'adresse du compte). À la
// synchro suivante, on regarde qui a changé depuis : l'appareil, le compte, ou
// les deux (à choisir) — cf. decideField. Les heures ne décident plus.
//
// Circuits perso (PR 7, maquette écrans 43-46) : réunis morceau par morceau
// (circuit-merge.js) ; Corbeille et « fait » suivent ; suppressions définitives
// gardées pour toujours dans le fichier (`deletedCircuits`). Pas encore : les
// doublons de lieux (PR 8). Les photos ne suivent jamais (seules leurs références).

import { state, removeMyCircuit, setHiddenPoiIds, setHiddenCircuitIds, setHiddenCircuitIdsUpdatedAt, setOfficialCircuitsStatus, setOfficialCircuitsStatusUpdatedAt } from './state.js';
import { replacePoiData, saveAppState, getAppState, saveCircuit, deleteCircuitById } from './database.js';
import { placeCircuitInState, persistCircuit } from './circuit-store.js';
import { readDeviceState } from './restore-apply.js';
import { mergeBackup } from './restore-merge.js';
import { mergeCircuitLists, takePart } from './circuit-merge.js';
import { FIELD_DATES_KEY, FIELD_FROM_KEY, PART_DATES_KEY, PART_FROM_KEY, CIRCUIT_PARTS, circuitPart, circuitPartDate, isDatedKey } from './field-dates.js';
import { generateHWID } from './utils.js';
import { listAppFileIds, readAppFile, writeAppFile, getLinkedAccount } from './google-account.js';

const FORMAT = 1;
const KEEP_DISCARDED_MS = 30 * 24 * 3600 * 1000;
export const fileNameFor = (mapId) => `heripia-${mapId}.json`;
const conflictsKey = (mapId) => `syncConflicts_${mapId}`;
const discardsKey = (mapId) => `syncDiscards_${mapId}`;
const deletedKey = (mapId) => `deletedCircuits_${mapId}`;
const baseKey = (mapId) => `syncBase_${mapId}`;
const deletedPlacesKey = (mapId) => `deletedPlaces_${mapId}`;

/**
 * Note la suppression d'un lieu créé (PR 8, 22/11/2026). Sans elle, la réunion
 * appareil + compte le faisait revenir depuis le compte. Gardée pour toujours
 * dans le fichier (`deletedPlaces`), comme les circuits.
 */
export async function recordPlaceDeletion(mapId, id, at = Date.now()) {
    const list = (await getAppState(deletedPlacesKey(mapId))) || {};
    list[String(id)] = at;
    await saveAppState(deletedPlacesKey(mapId), list);
}

/** Dernière date à laquelle un lieu créé a été modifié. */
function placeTouched(p) {
    const dates = Object.values(p?.properties?.[FIELD_DATES_KEY] || {}).filter(n => typeof n === 'number');
    return dates.length ? Math.max(...dates) : 0;
}

/** Lieux créés présents après la réunion mais pas avant : arrivés du compte. */
export function arrivedPlaceIds(before, after) {
    const had = new Set((before || []).map(p => p?.properties?.HW_ID));
    return (after || []).map(p => p?.properties?.HW_ID).filter(id => id && !had.has(id));
}

/** Retire les lieux supprimés quelque part (sauf modifiés après la suppression). */
export function dropDeletedPlaces(places, deletions) {
    return (places || []).filter(p => {
        const at = deletions?.[p?.properties?.HW_ID];
        return at === undefined || placeTouched(p) > at;
    });
}

/** Dates d'un objet daté (overlay de fiche, properties de lieu) : champ → date, ou null. */
function datesOf(obj) {
    const dates = obj?.[FIELD_DATES_KEY] || {};
    const out = { ...dates };
    for (const k of Object.keys(obj || {})) {
        if (isDatedKey(k) && !(k in out)) out[k] = null;
    }
    return out;
}

/**
 * Le point commun après un échange : la date de chaque champ / morceau tel qu'il
 * est dans le compte (ce qui vient d'y être écrit).
 */
export function baseFromState(s, email) {
    const poi = {};
    for (const [id, data] of Object.entries(s.userData || {})) poi[id] = datesOf(data);
    const places = {};
    for (const p of s.places || []) if (p?.properties?.HW_ID) places[p.properties.HW_ID] = datesOf(p.properties);
    const circuits = {};
    for (const c of s.circuits || []) {
        if (!c?.id) continue;
        circuits[String(c.id)] = Object.fromEntries(Object.keys(CIRCUIT_PARTS).map(part => [part, circuitPartDate(c, part) ?? null]));
    }
    return { email, poi, places, circuits };
}

/** Choix en attente, sous la forme attendue par la fusion. */
function pendingSets(conflicts) {
    const data = new Set();
    const circuits = new Set();
    for (const c of conflicts) {
        if (c.kind === 'circuit') circuits.add(`${c.id}|${c.key}`);
        else data.add(`${c.kind}|${c.id}|${c.key}`);
    }
    return { data, circuits };
}

/** Oublie le point commun (Effacer : le compte ne contient plus rien). */
export async function clearSyncBases() {
    for (const mapId of knownMapIds()) await saveAppState(baseKey(mapId), null);
}

/** Note une suppression définitive de circuit perso (Corbeille → Supprimer). */
export async function recordCircuitDeletion(mapId, id, at = Date.now()) {
    const list = (await getAppState(deletedKey(mapId))) || {};
    list[String(id)] = at;
    await saveAppState(deletedKey(mapId), list);
}

function unionDeletions(a = {}, b = {}) {
    const out = { ...(a || {}) };
    for (const [id, at] of Object.entries(b || {})) out[id] = Math.max(out[id] ?? 0, at);
    return out;
}

function remoteState(file) {
    const s = file?.state || {};
    return {
        userData: s.userData || {},
        places: s.places || [],
        circuits: s.circuits || [],
        hiddenPoiIds: s.hiddenPoiIds || [],
        circuitsStatus: s.circuitsStatus || {},
        circuitsStatusUpdatedAt: s.circuitsStatusUpdatedAt || {},
        hiddenCircuitIds: s.hiddenCircuitIds || [],
        hiddenCircuitIdsUpdatedAt: s.hiddenCircuitIdsUpdatedAt || {},
    };
}

const hasData = (s) => Object.keys(s.userData || {}).length > 0 || (s.places || []).length > 0
    || (s.circuits || []).length > 0
    || (s.hiddenPoiIds || []).length > 0 || Object.keys(s.circuitsStatus || {}).length > 0
    || (s.hiddenCircuitIds || []).length > 0;

/** Écrit sur l'appareil ce que la réunion a pris du compte. */
async function applyToDevice(mapId, result) {
    const current = mapId === state.currentMapId;
    for (const [id, data] of Object.entries(result.userData)) {
        await replacePoiData(mapId, id, data);
        if (current) {
            // Même objet gardé : la carte et la fiche ouverte le partagent.
            const ud = state.userData[id] || (state.userData[id] = {});
            const dates = ud[FIELD_DATES_KEY], from = ud[FIELD_FROM_KEY];
            for (const k of Object.keys(ud)) delete ud[k];
            Object.assign(ud, { [FIELD_DATES_KEY]: dates, [FIELD_FROM_KEY]: from }, data);
            const feature = (state.loadedFeatures || []).find(f => f?.properties?.HW_ID === id);
            if (feature) feature.properties.userData = ud;
        }
    }
    if (result.placesChanged) {
        await saveAppState(`customPois_${mapId}`, result.places);
        if (current) applyPlacesInMemory(result.places);
    }
    for (const circuit of result.circuitsToSave || []) {
        const c = { ...circuit, mapId: circuit.mapId || mapId };
        await saveCircuit(c);
        if (current) placeCircuitInState(c);
    }
    for (const id of result.circuitsToDelete || []) {
        await deleteCircuitById(id);
        if (current && (state.myCircuits || []).some(c => String(c.id) === String(id))) removeMyCircuit(id);
    }
    await saveAppState(`hiddenPois_${mapId}`, result.hiddenPoiIds);
    await saveAppState(`official_circuits_status_${mapId}`, result.circuitsStatus);
    await saveAppState(`official_circuits_status_updated_${mapId}`, result.circuitsStatusUpdatedAt);
    await saveAppState('hiddenCircuitIds', result.hiddenCircuitIds);
    await saveAppState('hiddenCircuitIdsUpdatedAt', result.hiddenCircuitIdsUpdatedAt);
    if (current) {
        setHiddenPoiIds(result.hiddenPoiIds);
        setOfficialCircuitsStatus(result.circuitsStatus);
        setOfficialCircuitsStatusUpdatedAt(result.circuitsStatusUpdatedAt);
        setHiddenCircuitIds(result.hiddenCircuitIds);
        setHiddenCircuitIdsUpdatedAt(result.hiddenCircuitIdsUpdatedAt);
    }
}

/** Lieux créés de la destination ouverte : ajoutés ou mis à jour sur la carte. */
function applyPlacesInMemory(places) {
    if (!Array.isArray(state.customFeatures)) state.customFeatures = [];
    for (const place of places) {
        const id = place?.properties?.HW_ID;
        if (!id) continue;
        const shown = (state.loadedFeatures || []).find(f => f?.properties?.HW_ID === id);
        if (shown) {
            const userData = shown.properties.userData;
            shown.properties = { ...place.properties, ...(userData ? { userData } : {}) };
            shown.geometry = place.geometry;
        } else {
            const feature = JSON.parse(JSON.stringify(place));
            if (!state.userData[id]) state.userData[id] = {};
            feature.properties.userData = state.userData[id];
            state.loadedFeatures.push(feature);
        }
    }
    // Lieux supprimés ailleurs : retirés de la carte (sauf un lieu « en attente »,
    // créé ici et pas encore enregistré).
    const kept = new Set(places.map(p => p?.properties?.HW_ID));
    const gone = (state.customFeatures || []).filter(f => !f?.properties?._pending && !kept.has(f?.properties?.HW_ID));
    if (gone.length) {
        const goneIds = new Set(gone.map(f => f.properties.HW_ID));
        state.loadedFeatures = (state.loadedFeatures || []).filter(f => !goneIds.has(f?.properties?.HW_ID));
    }
    const pendingHere = (state.customFeatures || []).filter(f => f?.properties?._pending && !kept.has(f?.properties?.HW_ID));
    state.customFeatures = [
        ...places.map(p => (state.loadedFeatures || []).find(f => f?.properties?.HW_ID === p?.properties?.HW_ID) || p),
        ...pendingHere,
    ];
}

/**
 * Ce qui part dans le compte : l'appareil après réunion, sauf pour les morceaux
 * encore à choisir, où le compte garde sa version (cf. en-tête).
 */
export function buildUpload(after, remote, conflicts) {
    const out = JSON.parse(JSON.stringify(after));
    for (const c of conflicts) {
        if (c.kind === 'circuit') {
            const mine = (out.circuits || []).find(x => String(x.id) === String(c.id));
            const theirs = (remote.circuits || []).find(x => String(x.id) === String(c.id));
            if (!mine || !theirs) continue;
            for (const part of c.key === 'steps' ? ['steps', 'trace'] : [c.key]) takePart(mine, theirs, part);
            continue;
        }
        if (c.kind === 'place') {
            const mine = out.places.find(p => p?.properties?.HW_ID === c.id);
            const theirs = remote.places.find(p => p?.properties?.HW_ID === c.id);
            if (!mine || !theirs) continue;
            const tp = theirs.properties;
            mine.properties[c.key] = tp[c.key];
            mine.properties[FIELD_DATES_KEY] = { ...(mine.properties[FIELD_DATES_KEY] || {}), [c.key]: tp[FIELD_DATES_KEY]?.[c.key] };
            mine.properties[FIELD_FROM_KEY] = { ...(mine.properties[FIELD_FROM_KEY] || {}), [c.key]: tp[FIELD_FROM_KEY]?.[c.key] };
        } else {
            const mine = out.userData[c.id];
            const theirs = remote.userData[c.id];
            if (!mine || !theirs) continue;
            mine[c.key] = theirs[c.key];
            mine[FIELD_DATES_KEY] = { ...(mine[FIELD_DATES_KEY] || {}), [c.key]: theirs[FIELD_DATES_KEY]?.[c.key] };
            mine[FIELD_FROM_KEY] = { ...(mine[FIELD_FROM_KEY] || {}), [c.key]: theirs[FIELD_FROM_KEY]?.[c.key] };
        }
    }
    return out;
}

/** Ce que le compte a reçu de l'appareil (pour « Envoyé depuis cet appareil »). */
function sentSummary(remote, here, upload = here) {
    const s = mergeBackup({ ...remote, circuits: [] }, { ...here, circuits: [] }).summary;
    // Circuits envoyés : nouveaux pour le compte, ou dont un morceau change dans
    // ce qui part (22/11 : un tracé envoyé affichait « Rien de nouveau »).
    const theirs = new Map((remote.circuits || []).map(c => [String(c.id), c]));
    const parts = Object.keys(CIRCUIT_PARTS);
    const circuits = (upload.circuits || []).filter(c => {
        const r = theirs.get(String(c.id));
        return !r || parts.some(p => circuitPart(c, p) !== circuitPart(r, p));
    }).length;
    return { visits: s.visits, notes: s.notes, places: s.places.length, updated: s.updated.length, circuits };
}

// ─── À choisir et versions écartées ────────────────────────────────────────

const sameConflict = (a, b) => a.kind === b.kind && a.id === b.id && a.key === b.key;

/** Ce qui attend encore un choix pour une destination (textes, morceaux de circuits). */
export async function getSyncConflicts(mapId) {
    return (await getAppState(conflictsKey(mapId))) || [];
}

async function storeConflicts(mapId, fresh) {
    const kept = (await getSyncConflicts(mapId)).filter(c => !fresh.some(f => sameConflict(c, f)));
    const next = [...kept, ...fresh.map(c => ({ ...c, at: Date.now() }))];
    await saveAppState(conflictsKey(mapId), next);
    return next;
}

/** Oublie ce qui attendait un choix, toutes destinations (Déconnecter, Effacer). */
export async function clearSyncConflicts() {
    for (const mapId of knownMapIds()) await saveAppState(conflictsKey(mapId), []);
}

/**
 * Un choix a été fait : il quitte la liste, et la (ou les) version(s)
 * écartée(s) partent au prochain envoi, gardées 30 jours dans le compte.
 * @param {string|null} finalText texte gardé (textes) ; pour un circuit, `choice` dit le côté
 * @param {'here'|'file'|'both'} [choice]
 */
export async function resolveSyncConflict(mapId, conflict, finalText, choice) {
    const left = (await getSyncConflicts(mapId)).filter(c => !sameConflict(c, conflict));
    await saveAppState(conflictsKey(mapId), left);
    const discards = (await getAppState(discardsKey(mapId))) || [];
    const isText = typeof conflict.here === 'string' || typeof conflict.file === 'string';
    for (const [side, value] of [['appareil', conflict.here], ['compte', conflict.file]]) {
        const lost = isText
            ? typeof value === 'string' && value.trim() !== '' && value.trim() !== String(finalText ?? '').trim()
            : (choice === 'here' && side === 'compte') || (choice === 'file' && side === 'appareil');
        if (lost) discards.push({ at: Date.now(), kind: conflict.kind, id: conflict.id, key: conflict.key, side, value });
    }
    await saveAppState(discardsKey(mapId), discards);
    return left;
}

/**
 * Choix pour des étapes ou un tracé modifiés des deux côtés (écrans 44-45). Le
 * morceau gardé est daté maintenant et part de la version du compte : l'autre
 * appareil le reprend sans question.
 * @param {'here'|'file'|'both'} choice  « both » : l'autre version devient une copie
 */
export async function resolveCircuitChoice(mapId, conflict, choice) {
    const current = (state.myCircuits || []).find(c => String(c.id) === String(conflict.id));
    if (!current) return resolveSyncConflict(mapId, conflict, null, choice);
    const theirs = conflict.fileCircuit;
    const parts = conflict.key === 'steps' ? ['steps', 'trace'] : [conflict.key];
    const now = Date.now();
    const next = JSON.parse(JSON.stringify(current));
    for (const part of parts) {
        if (choice === 'file' && theirs) {
            takePart(next, theirs, part, now, conflict.fileDate);
        } else {
            next[PART_DATES_KEY] = { ...(next[PART_DATES_KEY] || {}), [part]: now };
            next[PART_FROM_KEY] = { ...(next[PART_FROM_KEY] || {}), ...(conflict.fileDate !== undefined ? { [part]: conflict.fileDate } : {}) };
        }
    }
    await persistCircuit(next);
    if (choice === 'both' && theirs) {
        const copy = JSON.parse(JSON.stringify(theirs));
        copy.id = generateHWID();
        copy.mapId = mapId;
        copy.name = `${theirs.name} (copie)`;
        for (const k of ['isDeleted', 'trashUpdatedAt', 'updatedAt', PART_DATES_KEY, PART_FROM_KEY]) delete copy[k];
        await persistCircuit(copy);
    }
    return resolveSyncConflict(mapId, conflict, null, choice);
}

function mergeDiscarded(remoteList, localList, now = Date.now()) {
    const all = [...(Array.isArray(remoteList) ? remoteList : []), ...(localList || [])];
    return all.filter(d => d && now - (d.at || 0) < KEEP_DISCARDED_MS);
}

// ─── Synchroniser ───────────────────────────────────────────────────────────

/**
 * Synchronise une destination. L'accès Google doit être valable (google-account).
 * @param {string} mapId
 * @param {{ files?: Object<string,string>, email?: string }} [opts] noms → ids déjà listés ; compte relié
 * @returns {Promise<{mapId:string, created:boolean, summary:object|null, sent:object|null, conflicts:Array, newConflicts?:Array, changed:boolean, survivors?:Array}>}
 */
export async function syncMap(mapId, { files, email = getLinkedAccount()?.email } = {}) {
    const ids = files || await listAppFileIds();
    const name = fileNameFor(mapId);
    const fileId = ids[name] || null;
    const here = await readDeviceState(mapId);
    const pendingDiscards = (await getAppState(discardsKey(mapId))) || [];
    const localDeletions = (await getAppState(deletedKey(mapId))) || {};
    const localPlaceDeletions = (await getAppState(deletedPlacesKey(mapId))) || {};

    if (!fileId) {
        // Compte encore vide pour cette destination : l'appareil y est copié.
        if (!hasData(here) && !Object.keys(localDeletions).length && !Object.keys(localPlaceDeletions).length) {
            return { mapId, created: false, summary: null, sent: null, conflicts: [], changed: false };
        }
        const id = await writeAppFile(null, name, {
            v: FORMAT, mapId, savedAt: Date.now(), state: here,
            discarded: mergeDiscarded([], pendingDiscards), deletedCircuits: localDeletions, deletedPlaces: localPlaceDeletions,
        });
        ids[name] = id;
        await saveAppState(discardsKey(mapId), []);
        await saveAppState(baseKey(mapId), baseFromState(here, email));
        return { mapId, created: true, summary: null, sent: sentSummary(remoteState({}), here), conflicts: [], changed: false };
    }

    const file = await readAppFile(fileId);
    const remote = remoteState(file);
    // Point commun du dernier échange, s'il vaut pour ce compte.
    const stored = await getAppState(baseKey(mapId));
    const base = stored && stored.email === email ? stored : null;
    const pending = pendingSets(await getSyncConflicts(mapId));
    // Fiches, lieux, listes : règles de la restauration. Circuits perso : morceau
    // par morceau (circuit-merge.js), avec les suppressions des deux côtés.
    const result = mergeBackup({ ...here, circuits: [] }, { ...remote, circuits: [] },
        base ? { base, pending: pending.data } : { pending: pending.data });
    const deletions = unionDeletions(localDeletions, file?.deletedCircuits);
    // Lieux créés supprimés quelque part : retirés de la réunion.
    const placeDeletions = unionDeletions(localPlaceDeletions, file?.deletedPlaces);
    const keptPlaces = dropDeletedPlaces(result.places, placeDeletions);
    if (keptPlaces.length !== result.places.length) { result.places = keptPlaces; result.placesChanged = true; }
    const circ = mergeCircuitLists(here.circuits, remote.circuits, deletions, Date.now(),
        { base: base ? (base.circuits || {}) : undefined, pending: pending.circuits });
    result.circuitsToSave = circ.toSave;
    result.circuitsToDelete = circ.toDelete;
    result.summary.circuits = circ.added.map(c => c.name);
    await applyToDevice(mapId, result);
    const changed = Object.keys(result.userData).length > 0 || result.placesChanged
        || circ.toSave.length > 0 || circ.toDelete.length > 0;

    const fresh = [
        ...result.conflicts,
        ...circ.conflicts.map(c => ({ ...c, fileCircuit: remote.circuits.find(x => String(x.id) === String(c.id)) })),
    ];
    const after = await readDeviceState(mapId);
    // Un choix déjà en attente est retrouvé à chaque synchronisation : on ne
    // l'annonce qu'une fois (sinon un toast à chaque envoi).
    const before = await getSyncConflicts(mapId);
    const newConflicts = fresh.filter(f => !before.some(b => sameConflict(b, f)));
    const conflicts = fresh.length ? await storeConflicts(mapId, fresh) : before;
    const upload = buildUpload(after, remote, conflicts);
    await writeAppFile(fileId, name, {
        v: FORMAT, mapId, savedAt: Date.now(), state: upload,
        discarded: mergeDiscarded(file?.discarded, pendingDiscards),
        deletedCircuits: deletions,
        deletedPlaces: placeDeletions,
    });
    await saveAppState(discardsKey(mapId), []);
    await saveAppState(deletedKey(mapId), deletions);
    await saveAppState(deletedPlacesKey(mapId), placeDeletions);
    await saveAppState(baseKey(mapId), baseFromState(upload, email));
    return {
        mapId, created: false, summary: result.summary, sent: sentSummary(remote, here, upload), conflicts: fresh, newConflicts, changed,
        survivors: circ.survivors, circuitsChanged: [...circ.toSave.map(c => String(c.id)), ...circ.toDelete.map(String)],
        // Lieux créés sur un autre appareil, arrivés ici (PR 8, écran 50 : « Même lieu ? »).
        arrivedPlaces: arrivedPlaceIds(here.places, result.places),
    };
}

/** Destinations connues (destinations.json), la destination ouverte en tête. */
export function knownMapIds() {
    const all = Object.keys(state.destinations?.maps || {});
    const current = state.currentMapId;
    return [...new Set([current, ...all].filter(Boolean))];
}

/**
 * Synchronise toutes les destinations (première liaison) : celles qui ont des
 * données ici ou un fichier dans le compte.
 * @returns {Promise<Array>} un résultat par destination (cf. syncMap)
 */
export async function syncAllMaps() {
    const files = await listAppFileIds();
    const out = [];
    for (const mapId of knownMapIds()) out.push(await syncMap(mapId, { files }));
    return out;
}
