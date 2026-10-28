// src/overpass-key.js
//
// Clé overpass.ch de l'admin (28/10/2026) : stockée dans IndexedDB (store
// 'appState', clé 'overpass_ch_key'), sur l'appareil seulement, comme le PAT
// GitHub (cf. github-sync.js). Jamais dans le code : le dépôt est public, une
// clé écrite en dur viderait le quota pour n'importe qui.
//
// Ce module ne fait que charger/persister ; la clé active vit dans
// osm-overpass.js (setOverpassKey), qui reste ainsi sans dépendance à la base.

import { getAppState, saveAppState } from './database.js';
import { setOverpassKey } from './osm-overpass.js';

const STORAGE_KEY = 'overpass_ch_key';

/** Charge la clé depuis IndexedDB. À appeler une fois au démarrage. */
export async function initOverpassKey() {
    try {
        setOverpassKey(await getAppState(STORAGE_KEY));
    } catch (err) {
        console.warn('[overpass-key] lecture IDB impossible, clé indisponible', err);
        setOverpassKey(null);
    }
}

/**
 * Enregistre (ou supprime, si vide) la clé. Active immédiatement, persistance
 * IDB en arrière-plan.
 * @param {string} key
 */
export function saveOverpassKey(key) {
    const clean = (key || '').trim() || null;
    setOverpassKey(clean);
    saveAppState(STORAGE_KEY, clean).catch(err => {
        console.warn('[overpass-key] saveOverpassKey: IDB persist failed', err);
    });
}
