// admin-geojson.js
// Génération du GeoJSON maître à partir de state.loadedFeatures.
// Extrait d'admin.js pour casser le cycle admin.js ↔ admin-control-center.js.
// Aucune dépendance DOM / UI : pure transformation de données.

import { state } from './state.js';
import { getPoiId } from './utils.js';

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

            // Nettoyage critique : photos base64 exclues (on ne garde que les URL).
            if (properties.photos && Array.isArray(properties.photos)) {
                properties.photos = properties.photos.filter(p => !p.startsWith('data:image'));
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
