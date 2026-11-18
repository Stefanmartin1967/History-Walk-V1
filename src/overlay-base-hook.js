// overlay-base-hook.js — pose le crochet d'estampille sur les écritures de fiche
// (18/11/2026, conflits à la publication ; principe dans overlay-base.js).
//
// Séparé d'overlay-base.js (pur, testé sans état) : ce module lit l'état de
// l'app (version de la carte chargée, overlay en mémoire) et se branche sur
// database.js au démarrage (loadAndInitializeMap).

import { state } from './state.js';
import { getLoadedGeojsonSha } from './repo-read.js';
import { setPoiDataWriteHook, setSyncStampListener } from './database.js';
import { BASE_KEY, newStamps } from './overlay-base.js';

export function installOverlayBaseHook() {
    setPoiDataWriteHook((mapId, poiId, existing, data) => {
        const extra = newStamps(existing, data, getLoadedGeojsonSha(mapId));
        if (!extra) return null;
        // La mémoire (lue par le Centre de contrôle) porte les mêmes estampilles
        // que la base. Même objet que feature.properties.userData : modifié en place.
        if (mapId === state.currentMapId) {
            const ud = state.userData?.[poiId];
            if (ud) ud[BASE_KEY] = { ...(ud[BASE_KEY] || {}), ...extra };
        }
        return extra;
    });
    // Dates de synchro Gist (sync-stamps.js) : même recopie en mémoire.
    setSyncStampListener((mapId, poiId, dated) => {
        if (mapId !== state.currentMapId) return;
        const ud = state.userData?.[poiId];
        if (ud) Object.assign(ud, dated);
    });
}
