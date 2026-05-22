// admin-geojson.js
// Génération du GeoJSON maître à partir de state.loadedFeatures.
// Extrait d'admin.js pour casser le cycle admin.js ↔ admin-control-center.js.
// Aucune dépendance DOM / UI : pure transformation de données.

import { state } from './state.js';
import { getPoiId } from './utils.js';
import { PERSONAL_KEYS } from './config.js';

export function generateMasterGeoJSONData(excludedIds = []) {
    if (!state.loadedFeatures || state.loadedFeatures.length === 0) {
        return null;
    }

    const features = state.loadedFeatures
        .filter(f => {
             const id = getPoiId(f);
             if (excludedIds.includes(id)) return false;
             if (f.properties.userData && f.properties.userData._deleted) return false;
             return true;
        })
        .map(f => {
            const properties = JSON.parse(JSON.stringify(f.properties));
            const standardizedHWID = properties.HW_ID;

            if (properties.userData) {
                Object.assign(properties, properties.userData);
                delete properties.userData;
            }

            // Blindage : l'ID unifié ne doit pas être écrasé par une vieille valeur dans userData.
            if (standardizedHWID) {
                properties.HW_ID = standardizedHWID;
            }

            // Purge des champs perso (Gist privé) — ne JAMAIS pousser dans le geojson public.
            PERSONAL_KEYS.forEach(k => { delete properties[k]; });

            // Nettoyage critique : photos base64 exclues (on ne garde que les URL).
            if (properties.photos && Array.isArray(properties.photos)) {
                properties.photos = properties.photos.filter(p => !p.startsWith('data:image'));
            }

            // Point d'accès au tracé : on ne publie qu'un couple [lon, lat] valide.
            // Un accessPoint absent ou retiré (null via l'overlay) ne doit pas
            // laisser de résidu (`accessPoint: null`) dans le geojson public.
            const ap = properties.accessPoint;
            if (!Array.isArray(ap) || ap.length !== 2 || !Number.isFinite(ap[0]) || !Number.isFinite(ap[1])) {
                delete properties.accessPoint;
            }

            delete properties._leaflet_id;

            return {
                type: "Feature",
                geometry: f.geometry,
                properties: properties
            };
        });

    return {
        type: "FeatureCollection",
        features: features
    };
}
