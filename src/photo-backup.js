// photo-backup.js — sauvegarde « Photos » et ajout de photos sans rien effacer
// (20/11/2026, PR 3 du chantier « synchro users » : Données / Photos remplacent
// Légère / Complète, idée de Stefan validée sur la maquette Sauvegarder).
//
// Pourquoi un fichier à part : les photos pèsent lourd (une sauvegarde
// « complète » de 40 Mo de photos pouvait faire planter la restauration sur un
// téléphone modeste, cf. project_backup_lite_vs_complete_rationale). Les données
// restent un petit fichier ; les photos ont le leur.
//
// ⚠️ savePoiPhotos REMPLACE toutes les photos d'un lieu. Restaurer en lui
// passant les seules photos du fichier effaçait celles ajoutées depuis sur
// l'appareil. addPhotos lit d'abord les photos du lieu et n'ajoute que celles
// qui manquent (même id, ou même contenu : pas de doublon si on restaure deux
// fois le même fichier).

import { state } from './state.js';
import { getAllPoiPhotosForMap, getPoiPhotos, savePoiPhotos, blobToBase64, base64ToBlob } from './database.js';
import { sha256OfFile, downloadFile } from './utils.js';
import { showToast } from './toast.js';

export const PHOTOS_KIND = 'photos';

/** Le fichier « Photos » de la destination : { [lieu]: [{ id, data }] }. */
export async function buildPhotosBackup(mapId) {
    const entries = await getAllPoiPhotosForMap(mapId);
    const photos = {};
    let count = 0;
    for (const entry of entries) {
        if (!entry?.poiId || !Array.isArray(entry.photos) || !entry.photos.length) continue;
        photos[entry.poiId] = await Promise.all(entry.photos.map(async p => ({ id: p.id, data: await blobToBase64(p.blob) })));
        count += entry.photos.length;
    }
    return { backupVersion: state.appVersion || '3.0', kind: PHOTOS_KIND, mapId, date: new Date().toISOString(), photos, count };
}

/** Bouton « Sauvegarder mes photos » : téléchargement local (fichier lourd). */
export async function exportPhotosBackup(fileName) {
    try {
        const mapId = state.currentMapId;
        const data = await buildPhotosBackup(mapId);
        if (!data.count) { showToast('Aucune photo à sauvegarder sur cet appareil.', 'info'); return; }
        downloadFile(fileName(mapId), JSON.stringify(data), 'application/json');
        showToast(`${data.count} photo${data.count > 1 ? 's' : ''} sauvegardée${data.count > 1 ? 's' : ''}.`, 'success');
    } catch (err) {
        console.error('[photo-backup] export :', err);
        showToast('Erreur lors de la sauvegarde des photos.', 'error');
    }
}

/**
 * Photos d'un fichier, ramenées à une forme unique { [lieu]: [{ id?, data }] } :
 * fichier « Photos » (`photos`), ou ancienne sauvegarde complète (base64 dans
 * `userData[lieu].photos`).
 */
export function photosOfBackup(json) {
    if (json?.kind === PHOTOS_KIND) return json.photos || {};
    const out = {};
    for (const [poiId, data] of Object.entries(json?.userData || {})) {
        const b64 = (Array.isArray(data?.photos) ? data.photos : []).filter(p => typeof p === 'string' && p.startsWith('data:'));
        if (b64.length) out[poiId] = b64.map(data => ({ data }));
    }
    return out;
}

export function countPhotos(byPoi) {
    return Object.values(byPoi || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

let _seq = 0;
/**
 * Ajoute les photos qui manquent, lieu par lieu, sans toucher aux autres.
 * @returns {Promise<{added: Object<string,string[]>, count: number}>} ids ajoutés par lieu
 */
export async function addPhotos(mapId, byPoi) {
    const added = {};
    let count = 0;
    for (const [poiId, list] of Object.entries(byPoi || {})) {
        if (!Array.isArray(list) || !list.length) continue;
        const existing = await getPoiPhotos(mapId, poiId);
        const ids = new Set(existing.map(p => p.id));
        const hashes = new Set((await Promise.all(existing.map(p => sha256OfFile(p.blob)))).filter(Boolean));
        const fresh = [];
        for (const item of list) {
            if (!item?.data) continue;
            if (item.id && ids.has(item.id)) continue;
            const blob = base64ToBlob(item.data);
            const hash = await sha256OfFile(blob);
            if (hash && hashes.has(hash)) continue;
            const id = item.id || `restored_${poiId}_${Date.now()}_${_seq++}`;
            fresh.push({ id, blob });
            ids.add(id);
            if (hash) hashes.add(hash);
        }
        if (!fresh.length) continue;
        await savePoiPhotos(mapId, poiId, [...existing, ...fresh]);
        added[poiId] = fresh.map(p => p.id);
        count += fresh.length;
    }
    return { added, count };
}

/** Annulation : retire les photos ajoutées par une restauration (et elles seules). */
export async function removeAddedPhotos(mapId, added) {
    for (const [poiId, ids] of Object.entries(added || {})) {
        const drop = new Set(ids);
        const existing = await getPoiPhotos(mapId, poiId);
        await savePoiPhotos(mapId, poiId, existing.filter(p => !drop.has(p.id)));
    }
}
