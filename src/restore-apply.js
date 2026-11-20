// restore-apply.js — appliquer une restauration qui fusionne, et pouvoir
// l'annuler (19/11/2026, PR 2 du chantier « synchro users »).
//
// 1. Lit l'état de l'appareil POUR LA DESTINATION DU FICHIER, en base (la
//    destination ouverte peut être une autre).
// 2. Fusionne (restore-merge.js, pur).
// 3. Garde une copie de ce qu'elle va toucher (« Annuler la restauration »,
//    possible jusqu'à la prochaine restauration).
// 4. Écrit, puis range le résumé et les textes à choisir : la page recharge, et
//    restore-ui.js les montre au redémarrage.

import {
    getAllPoiDataForMap, getAppState, saveAppState, getAllCircuitsForMap, saveCircuit,
    deleteCircuitById, replacePoiData, putPoiDataExact,
} from './database.js';
import { mergeBackup } from './restore-merge.js';
import { PHOTOS_KIND, photosOfBackup, countPhotos, addPhotos, removeAddedPhotos } from './photo-backup.js';

const lastKey = (mapId) => `lastRestore_${mapId}`;

/** État de l'appareil pour une destination, lu en base. */
export async function readDeviceState(mapId) {
    const [userData, places, circuits, hiddenPoiIds, status, statusAt, hiddenC, hiddenCAt] = await Promise.all([
        getAllPoiDataForMap(mapId),
        getAppState(`customPois_${mapId}`),
        getAllCircuitsForMap(mapId),
        getAppState(`hiddenPois_${mapId}`),
        getAppState(`official_circuits_status_${mapId}`),
        getAppState(`official_circuits_status_updated_${mapId}`),
        getAppState('hiddenCircuitIds'),
        getAppState('hiddenCircuitIdsUpdatedAt'),
    ]);
    return {
        userData: userData || {},
        places: places || [],
        circuits: (circuits || []).filter(c => !c.isOfficial),
        hiddenPoiIds: hiddenPoiIds || [],
        circuitsStatus: status || {},
        circuitsStatusUpdatedAt: statusAt || {},
        hiddenCircuitIds: hiddenC || [],
        hiddenCircuitIdsUpdatedAt: hiddenCAt || {},
    };
}

/** Le fichier, sous la même forme. `isPlace` : quels lieux du fichier sont des lieux créés. */
export function readFileState(json, isPlace) {
    const userData = {};
    for (const [id, data] of Object.entries(json.userData || {})) {
        // Photos en base64 (sauvegarde complète) : écrites à part, dans le store
        // des photos ; seules les références légères (chemins) suivent ici.
        const { photos, ...rest } = data || {};
        const light = (Array.isArray(photos) ? photos : []).filter(p => typeof p === 'string' && !p.startsWith('data:'));
        userData[id] = light.length ? { ...rest, photos: light } : rest;
    }
    return {
        userData,
        places: (json.baseGeoJSON?.features || []).filter(isPlace),
        circuits: json.myCircuits || [],
        hiddenPoiIds: json.hiddenPoiIds || [],
        circuitsStatus: json.officialCircuitsStatus || {},
        circuitsStatusUpdatedAt: json.officialCircuitsStatusUpdatedAt || {},
        hiddenCircuitIds: json.hiddenCircuitIds || [],
        hiddenCircuitIdsUpdatedAt: json.hiddenCircuitIdsUpdatedAt || {},
    };
}

/** Ce que contient un fichier, pour l'écran « avant de restaurer ». */
export function describeBackup(json, isPlace) {
    const photos = photosOfBackup(json);
    if (json?.kind === PHOTOS_KIND) {
        return { kind: PHOTOS_KIND, photos: countPhotos(photos), photoPlaces: Object.keys(photos).length };
    }
    const ud = Object.values(json.userData || {});
    return {
        photos: countPhotos(photos),
        visits: ud.filter(d => d?.vuManual === true || d?.vu === true || (Array.isArray(d?.visitedByCircuits) && d.visitedByCircuits.length)).length,
        notes: ud.filter(d => typeof d?.notes === 'string' && d.notes.trim()).length,
        places: (json.baseGeoJSON?.features || []).filter(isPlace).length,
        circuits: (json.myCircuits || []).filter(c => c && !c.isOfficial).length,
        done: Object.values(json.officialCircuitsStatus || {}).filter(Boolean).length,
    };
}

/**
 * Restaure en fusionnant. Ne recharge pas la page (l'appelant le fait).
 * @returns {Promise<{summary:object, conflicts:Array}>}
 */
export async function applyRestore(mapId, json, isPlace) {
    // Fichier « Photos » : seulement des photos, ajoutées sans rien remplacer.
    if (json?.kind === PHOTOS_KIND) {
        const photos = await addPhotos(mapId, photosOfBackup(json));
        const summary = { visits: 0, notes: 0, places: [], circuits: [], updated: [], kept: [], keptCircuits: 0, photos: photos.count };
        await saveAppState(lastKey(mapId), { at: Date.now(), fileDate: json.date || null, summary, conflicts: [], showSummary: true, undo: { photos: photos.added } });
        return { summary, conflicts: [] };
    }

    const here = await readDeviceState(mapId);
    const result = mergeBackup(here, readFileState(json, isPlace));

    // Copie de sécurité : seulement ce que la restauration touche.
    const undo = {
        userData: Object.fromEntries(Object.keys(result.userData).map(id => [id, here.userData[id] ?? null])),
        places: result.placesChanged ? here.places : null,
        circuits: result.circuitsToSave.map(c => ({ id: c.id, before: here.circuits.find(h => String(h.id) === String(c.id)) ?? null })),
        hiddenPoiIds: here.hiddenPoiIds,
        circuitsStatus: here.circuitsStatus,
        circuitsStatusUpdatedAt: here.circuitsStatusUpdatedAt,
        hiddenCircuitIds: here.hiddenCircuitIds,
        hiddenCircuitIdsUpdatedAt: here.hiddenCircuitIdsUpdatedAt,
    };

    for (const [id, data] of Object.entries(result.userData)) await replacePoiData(mapId, id, data);
    if (result.placesChanged) await saveAppState(`customPois_${mapId}`, result.places);
    for (const circuit of result.circuitsToSave) await saveCircuit({ ...circuit, mapId: circuit.mapId || mapId });
    await saveAppState(`hiddenPois_${mapId}`, result.hiddenPoiIds);
    await saveAppState(`official_circuits_status_${mapId}`, result.circuitsStatus);
    await saveAppState(`official_circuits_status_updated_${mapId}`, result.circuitsStatusUpdatedAt);
    await saveAppState('hiddenCircuitIds', result.hiddenCircuitIds);
    await saveAppState('hiddenCircuitIdsUpdatedAt', result.hiddenCircuitIdsUpdatedAt);

    // Photos d'une ancienne sauvegarde complète : AJOUTÉES à celles de l'appareil
    // (avant le 20/11/2026, savePoiPhotos remplaçait toutes les photos du lieu).
    const photos = await addPhotos(mapId, photosOfBackup(json));
    undo.photos = photos.added;
    result.summary.photos = photos.count;

    await saveAppState(lastKey(mapId), {
        at: Date.now(),
        fileDate: json.date || null,
        summary: result.summary,
        conflicts: result.conflicts,
        showSummary: true,
        undo,
    });
    return { summary: result.summary, conflicts: result.conflicts };
}

export async function getLastRestore(mapId) {
    return (await getAppState(lastKey(mapId))) || null;
}

export async function saveLastRestore(mapId, value) {
    await saveAppState(lastKey(mapId), value);
}

/** « Annuler la restauration » : remet l'appareil exactement comme avant. */
export async function undoLastRestore(mapId) {
    const last = await getLastRestore(mapId);
    if (!last?.undo) return false;
    const u = last.undo;
    await removeAddedPhotos(mapId, u.photos);
    for (const [id, before] of Object.entries(u.userData || {})) await putPoiDataExact(mapId, id, before);
    if (u.places) await saveAppState(`customPois_${mapId}`, u.places);
    for (const { id, before } of u.circuits || []) {
        if (before) await saveCircuit(before);
        else await deleteCircuitById(id);
    }
    // Restauration de photos seules : les listes n'ont pas été touchées.
    if (u.hiddenPoiIds !== undefined) {
        await saveAppState(`hiddenPois_${mapId}`, u.hiddenPoiIds || []);
        await saveAppState(`official_circuits_status_${mapId}`, u.circuitsStatus || {});
        await saveAppState(`official_circuits_status_updated_${mapId}`, u.circuitsStatusUpdatedAt || {});
        await saveAppState('hiddenCircuitIds', u.hiddenCircuitIds || []);
        await saveAppState('hiddenCircuitIdsUpdatedAt', u.hiddenCircuitIdsUpdatedAt || {});
    }
    await saveAppState(lastKey(mapId), null);
    return true;
}
