// overlay-base-hook.js — pose le crochet d'estampille sur les écritures de fiche
// (18/11/2026, conflits à la publication ; principe dans overlay-base.js).
//
// Séparé d'overlay-base.js (pur, testé sans état) : ce module lit l'état de
// l'app (version de la carte chargée, overlay en mémoire) et se branche sur
// database.js au démarrage (loadAndInitializeMap).

import { state } from './state.js';
import { getLoadedGeojsonSha } from './repo-read.js';
import { setPoiDataWriteHook, setStampListener, setOfficialBaseHook } from './database.js';
import { BASE_KEY, newStamps, OFFICIAL_BASE_KEY, newOfficialBases } from './overlay-base.js';
import { getPoiId } from './utils.js';
import { isCustomPoi } from './poi-persistence.js';

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
    // Côté user (pas de SHA de carte) : valeur officielle du champ à sa première
    // modification. Jamais pour un lieu créé (ses champs ne sont pas officiels),
    // jamais en admin (il a les conflits à la publication).
    setOfficialBaseHook((mapId, poiId, existing, data) => {
        if (state.isAdmin || mapId !== state.currentMapId || isCustomPoi(poiId)) return null;
        const feature = state.loadedFeatures?.find(f => getPoiId(f) === poiId);
        const bases = feature ? newOfficialBases(existing, data, feature.properties) : null;
        if (!bases) return null;
        const ud = state.userData?.[poiId];
        if (ud) ud[OFFICIAL_BASE_KEY] = { ...(ud[OFFICIAL_BASE_KEY] || {}), ...bases };
        return bases;
    });
    // Dates de changement (sync-stamps.js, field-dates.js) : même recopie en mémoire.
    setStampListener((mapId, poiId, dated) => {
        if (mapId !== state.currentMapId) return;
        const ud = state.userData?.[poiId];
        if (ud) Object.assign(ud, dated);
    });
}
