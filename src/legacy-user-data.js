// legacy-user-data.js — rapatriement de l'ancienne copie globale `appState.userData`.
//
// Pourquoi (14/09/2026) : les données utilisateur d'un lieu vivaient à DEUX
// endroits — le store par destination `poiUserData` et une copie globale
// `appState.userData`, toutes destinations mêlées, fusionnée à chaque boot
// (data.js). Le nettoyage du CC ne touchait que le store : un lieu effacé
// revenait depuis la copie (constaté chez Stefan, 2 lieux en boucle). La copie
// mêlait aussi les destinations en mémoire (Djerba chargé sur Hammamet).
//
// Désormais `poiUserData` est le SEUL domicile. Au boot d'une destination, ses
// lieux sont rapatriés depuis la copie :
//  - une clé absente du store y est copiée ; une clé présente n'est JAMAIS écrasée
//    (le store primait déjà clé par clé dans l'ancienne fusion) ;
//  - l'entrée rapatriée est retirée de la copie ;
//  - une entrée VIDE est retirée ;
//  - une entrée d'un lieu inconnu de cette destination est CONSERVÉE, sans être
//    lue (autre destination pas encore ouverte, ou lieu disparu — décision Stefan :
//    garder, récupérable) ;
//  - la copie est supprimée quand il ne reste plus rien.
import { getAppState, saveAppState, deleteAppState, getAllPoiDataForMap, batchSavePoiData } from './database.js';

const LEGACY_KEY = 'userData';

// Clés anciennes de la copie (le store est normalisé par ses propres migrations).
function normalizeLegacyEntry(data) {
    delete data.HW_ID;
    delete data.id;
    if ('Description' in data) {
        if (!('description' in data) || data.description == null) data.description = data.Description;
        delete data.Description;
    }
    if ('Description_courte' in data) {
        if (!('info_gpx' in data) || data.info_gpx == null) data.info_gpx = data.Description_courte;
        delete data.Description_courte;
    }
    return data;
}

/**
 * Rapatrie dans `poiUserData` les entrées de la copie globale qui concernent les
 * lieux de `mapId`, puis allège (ou supprime) la copie.
 * L'écriture du store précède toujours la réécriture de la copie : un échec en
 * cours de route laisse la copie intacte, rejouable au boot suivant.
 * @param {string} mapId
 * @param {Iterable<string>} poiIdsOfMap Ids des lieux de la destination (geojson + lieux locaux).
 * @returns {Promise<{rapatries: number, retires: number, restants: number}>}
 */
export async function migrateLegacyUserData(mapId, poiIdsOfMap) {
    const legacy = await getAppState(LEGACY_KEY);
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
        return { rapatries: 0, retires: 0, restants: 0 };
    }

    const ids = poiIdsOfMap instanceof Set ? poiIdsOfMap : new Set(poiIdsOfMap);
    const stored = (await getAllPoiDataForMap(mapId)) || {};
    const updates = [];
    const kept = {};
    let retires = 0;

    for (const [poiId, raw] of Object.entries(legacy)) {
        const data = normalizeLegacyEntry(raw && typeof raw === 'object' ? { ...raw } : {});
        if (Object.keys(data).length === 0) { retires++; continue; }
        if (!ids.has(poiId)) { kept[poiId] = raw; continue; }

        const existing = stored[poiId] || {};
        const missing = {};
        for (const [key, value] of Object.entries(data)) {
            if (!(key in existing)) missing[key] = value;
        }
        if (Object.keys(missing).length > 0) updates.push({ poiId, data: missing });
        retires++;
    }

    if (updates.length > 0) await batchSavePoiData(mapId, updates);

    const restants = Object.keys(kept).length;
    if (restants === 0) await deleteAppState(LEGACY_KEY);
    else if (retires > 0) await saveAppState(LEGACY_KEY, kept);

    return { rapatries: updates.length, retires, restants };
}
