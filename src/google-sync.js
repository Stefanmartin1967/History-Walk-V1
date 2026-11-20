// google-sync.js — synchroniser les données d'un user avec SON compte Google
// (PR 6 du chantier « synchro users », maquette écrans 35-42 validée par Stefan
// le 20/11/2026). Liaison et accès : google-account.js. Écrans : google-sync-ui.js.
//
// Un fichier par destination dans l'espace Heripia du compte (dossier caché
// appDataFolder) : `heripia-<destination>.json` = { v, mapId, savedAt, state,
// discarded }. `state` a la forme de readDeviceState (restore-apply.js).
//
// Une synchronisation = la restauration qui fusionne, avec le compte pour
// « fichier » (restore-merge.js : le plus récent gagne, un texte écrit des deux
// côtés est un conflit), puis l'envoi du résultat :
//  1. lire l'appareil et le fichier du compte ;
//  2. réunir ; écrire sur l'appareil ce qui vient du compte (en base et en
//     mémoire si c'est la destination ouverte) ;
//  3. renvoyer la réunion dans le compte. Pour un texte encore À CHOISIR, le
//     compte garde SA version : l'autre appareil ne voit donc pas de conflit,
//     et quand le user choisit ici, le texte choisi part de cette version
//     (writeChosenText) — l'autre appareil le reprend sans question.
//
// Pas encore synchronisés : les circuits perso (PR 7) et les doublons de lieux
// (PR 8). Les photos ne suivent jamais (seules leurs références légères).

import { state, setHiddenPoiIds, setHiddenCircuitIds, setHiddenCircuitIdsUpdatedAt, setOfficialCircuitsStatus, setOfficialCircuitsStatusUpdatedAt } from './state.js';
import { replacePoiData, saveAppState, getAppState } from './database.js';
import { readDeviceState } from './restore-apply.js';
import { mergeBackup } from './restore-merge.js';
import { FIELD_DATES_KEY, FIELD_FROM_KEY } from './field-dates.js';
import { listAppFileIds, readAppFile, writeAppFile } from './google-account.js';

const FORMAT = 1;
const KEEP_DISCARDED_MS = 30 * 24 * 3600 * 1000;
export const fileNameFor = (mapId) => `heripia-${mapId}.json`;
const conflictsKey = (mapId) => `syncConflicts_${mapId}`;
const discardsKey = (mapId) => `syncDiscards_${mapId}`;

/** État d'une destination tel qu'on le synchronise (sans les circuits perso : PR 7). */
async function deviceState(mapId) {
    const here = await readDeviceState(mapId);
    return { ...here, circuits: [] };
}

function remoteState(file) {
    const s = file?.state || {};
    return {
        userData: s.userData || {},
        places: s.places || [],
        circuits: [],
        hiddenPoiIds: s.hiddenPoiIds || [],
        circuitsStatus: s.circuitsStatus || {},
        circuitsStatusUpdatedAt: s.circuitsStatusUpdatedAt || {},
        hiddenCircuitIds: s.hiddenCircuitIds || [],
        hiddenCircuitIdsUpdatedAt: s.hiddenCircuitIdsUpdatedAt || {},
    };
}

const hasData = (s) => Object.keys(s.userData || {}).length > 0 || (s.places || []).length > 0
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
    state.customFeatures = places.map(p => (state.loadedFeatures || []).find(f => f?.properties?.HW_ID === p?.properties?.HW_ID) || p);
}

/**
 * Ce qui part dans le compte : l'appareil après réunion, sauf pour les textes
 * encore à choisir, où le compte garde sa version (cf. en-tête).
 */
export function buildUpload(after, remote, conflicts) {
    const out = JSON.parse(JSON.stringify(after));
    for (const c of conflicts) {
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
function sentSummary(remote, here) {
    const s = mergeBackup(remote, here).summary;
    return { visits: s.visits, notes: s.notes, places: s.places.length, updated: s.updated.length };
}

// ─── Textes à choisir et versions écartées ─────────────────────────────────

const sameConflict = (a, b) => a.kind === b.kind && a.id === b.id && a.key === b.key;

/** Textes encore à choisir pour une destination. */
export async function getSyncConflicts(mapId) {
    return (await getAppState(conflictsKey(mapId))) || [];
}

async function storeConflicts(mapId, fresh) {
    const kept = (await getSyncConflicts(mapId)).filter(c => !fresh.some(f => sameConflict(c, f)));
    const next = [...kept, ...fresh.map(c => ({ ...c, at: Date.now() }))];
    await saveAppState(conflictsKey(mapId), next);
    return next;
}

/** Oublie les textes à choisir de toutes les destinations (Déconnecter, Effacer). */
export async function clearSyncConflicts() {
    for (const mapId of knownMapIds()) await saveAppState(conflictsKey(mapId), []);
}

/**
 * Un texte a été choisi : il quitte la liste, et la (ou les) version(s)
 * écartée(s) partent au prochain envoi, gardées 30 jours dans le compte.
 */
export async function resolveSyncConflict(mapId, conflict, finalText) {
    const left = (await getSyncConflicts(mapId)).filter(c => !sameConflict(c, conflict));
    await saveAppState(conflictsKey(mapId), left);
    const discards = (await getAppState(discardsKey(mapId))) || [];
    for (const [side, value] of [['appareil', conflict.here], ['compte', conflict.file]]) {
        if (typeof value === 'string' && value.trim() && value.trim() !== String(finalText).trim()) {
            discards.push({ at: Date.now(), kind: conflict.kind, id: conflict.id, key: conflict.key, side, value });
        }
    }
    await saveAppState(discardsKey(mapId), discards);
    return left;
}

function mergeDiscarded(remoteList, localList, now = Date.now()) {
    const all = [...(Array.isArray(remoteList) ? remoteList : []), ...(localList || [])];
    return all.filter(d => d && now - (d.at || 0) < KEEP_DISCARDED_MS);
}

// ─── Synchroniser ───────────────────────────────────────────────────────────

/**
 * Synchronise une destination. L'accès Google doit être valable (google-account).
 * @param {string} mapId
 * @param {{ files?: Object<string,string> }} [opts] noms → ids déjà listés
 * @returns {Promise<{mapId:string, created:boolean, summary:object|null, sent:object|null, conflicts:Array, changed:boolean}>}
 */
export async function syncMap(mapId, { files } = {}) {
    const ids = files || await listAppFileIds();
    const name = fileNameFor(mapId);
    const fileId = ids[name] || null;
    const here = await deviceState(mapId);
    const pendingDiscards = (await getAppState(discardsKey(mapId))) || [];

    if (!fileId) {
        // Compte encore vide pour cette destination : l'appareil y est copié.
        if (!hasData(here)) return { mapId, created: false, summary: null, sent: null, conflicts: [], changed: false };
        const id = await writeAppFile(null, name, { v: FORMAT, mapId, savedAt: Date.now(), state: here, discarded: mergeDiscarded([], pendingDiscards) });
        ids[name] = id;
        await saveAppState(discardsKey(mapId), []);
        return { mapId, created: true, summary: null, sent: sentSummary(remoteState({}), here), conflicts: [], changed: false };
    }

    const file = await readAppFile(fileId);
    const remote = remoteState(file);
    const result = mergeBackup(here, remote);
    await applyToDevice(mapId, result);
    const changed = Object.keys(result.userData).length > 0 || result.placesChanged;

    const after = await deviceState(mapId);
    const conflicts = result.conflicts.length ? await storeConflicts(mapId, result.conflicts) : await getSyncConflicts(mapId);
    const upload = buildUpload(after, remote, conflicts);
    await writeAppFile(fileId, name, {
        v: FORMAT, mapId, savedAt: Date.now(), state: upload,
        discarded: mergeDiscarded(file?.discarded, pendingDiscards),
    });
    await saveAppState(discardsKey(mapId), []);
    return { mapId, created: false, summary: result.summary, sent: sentSummary(remote, here), conflicts: result.conflicts, changed };
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
