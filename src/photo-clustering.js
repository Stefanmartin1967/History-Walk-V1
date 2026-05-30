// photo-clustering.js
// Groupement des photos importées (par GPS) en clusters, pour la modale
// « Traitement photos ». DEUX méthodes, comparables via un switch (admin) :
//
//   • 'proximity' (historique) — clustering transitif photo↔photo à 80 m
//     (clusterByLocation + filterOutliers + fusion par POI le plus proche).
//     Défaut chaîne : en ville, une rafale de photos espacées de <80 m fusionne
//     en un méga-cluster traversant des centaines de mètres → mauvais nom.
//
//   • 'by-poi' (nouveau, défaut) — chaque photo est rattachée au POI le plus
//     proche (≤ POI_RADIUS). Un cluster = un POI. Les photos sans POI proche
//     retombent sur un clustering de proximité (vraies photos de « trajet »).
//     Sépare nettement « photos du café » de « photos de l'église » même à
//     faible distance, car le découpage suit l'IDENTITÉ du lieu, pas la distance.
//
// Sortie commune : tableau de clusters { photos, center, nearbyPois,
// absoluteNearest } — la forme attendue par ui-photo-batch.normalizeClusters.
// nearbyPois[0] pilote le nom auto ET la cible d'enregistrement : en 'by-poi'
// on garantit que le POI d'ancrage y est en tête.
//
// Fonctions PURES (POIs passés en paramètre) → testées dans
// tests/photo_clustering.test.js. La dérive GPS en médina reste irréductible :
// aucune méthode n'est parfaite, d'où le dropdown de correction de la modale.

import {
    calculateDistance,
    calculateBarycenter,
    clusterByLocation,
    filterOutliers,
    getPoiId,
} from './utils.js';

export const CLUSTER_METHODS = ['by-poi', 'proximity'];
export const DEFAULT_CLUSTER_METHOD = 'by-poi';

const PROXIMITY_RADIUS = 80; // m — clustering transitif photo↔photo (historique)
const POI_RADIUS = 120;      // m — « ce POI est le lieu de la photo » ('by-poi')
const NEARBY_RADIUS = 100;   // m — POIs listés dans nearbyPois (les deux méthodes)

function visiblePoiFeatures(features, hiddenPoiIds) {
    const hidden = hiddenPoiIds || [];
    return (features || []).filter(f =>
        f && f.geometry && f.geometry.coordinates && !hidden.includes(getPoiId(f))
    );
}

// Enrichit un groupe de photos : barycentre + POIs proches (≤ NEARBY_RADIUS,
// triés) + POI absolu le plus proche. Si `anchorFeature` est fourni (méthode
// 'by-poi'), il est forcé en tête de nearbyPois (= nom + cible d'enregistrement).
function enrichGroup(photos, features, hiddenPoiIds, anchorFeature = null) {
    const center = calculateBarycenter(photos.map(p => p.coords));
    const visible = visiblePoiFeatures(features, hiddenPoiIds);

    const nearbyPois = [];
    let absoluteNearest = null;
    let minDist = Infinity;

    for (const feature of visible) {
        const [fLng, fLat] = feature.geometry.coordinates;
        const dist = calculateDistance(center.lat, center.lng, fLat, fLng);
        if (dist < NEARBY_RADIUS) nearbyPois.push({ feature, dist });
        if (dist < minDist) { minDist = dist; absoluteNearest = { feature, dist }; }
    }
    nearbyPois.sort((a, b) => a.dist - b.dist);

    if (anchorFeature) {
        // Le POI d'ancrage prime, même si le barycentre est plus proche d'un
        // voisin (cohérence nom ↔ cible d'enregistrement).
        const anchorId = getPoiId(anchorFeature);
        const others = nearbyPois.filter(np => getPoiId(np.feature) !== anchorId);
        const [aLng, aLat] = anchorFeature.geometry.coordinates;
        const anchorDist = calculateDistance(center.lat, center.lng, aLat, aLng);
        return {
            photos,
            center,
            nearbyPois: [{ feature: anchorFeature, dist: anchorDist }, ...others],
            absoluteNearest: null,
        };
    }

    return {
        photos,
        center,
        nearbyPois,
        absoluteNearest: nearbyPois.length === 0 ? absoluteNearest : null,
    };
}

// Tri chronologique : photos par date dans chaque cluster, puis clusters par
// date de leur 1re photo.
function chronoSort(clusters) {
    clusters.forEach(c => c.photos.sort((a, b) => (a.date || 0) - (b.date || 0)));
    clusters.sort((a, b) => (a.photos[0]?.date || 0) - (b.photos[0]?.date || 0));
    return clusters;
}

// Fusionne les clusters de proximité qui ont le même POI le plus proche
// (nearbyPois[0]) — déplacé depuis desktopMode (méthode historique).
function mergeBySamePoi(clusters) {
    const byPoi = new Map();
    const result = [];
    for (const c of clusters) {
        const best = c.nearbyPois?.[0];
        const key = best && getPoiId(best.feature);
        if (!key) { result.push(c); continue; }
        if (byPoi.has(key)) {
            const prev = byPoi.get(key);
            prev.photos = prev.photos.concat(c.photos);
            if (best.dist < prev.nearbyPois[0].dist) prev.nearbyPois = c.nearbyPois;
        } else {
            byPoi.set(key, c);
            result.push(c);
        }
    }
    return result;
}

// Méthode historique : transitif 80 m + outliers + fusion par POI.
function groupByProximity(photos, features, hiddenPoiIds) {
    const clusters = clusterByLocation(photos, PROXIMITY_RADIUS);
    const expanded = [];
    for (const c of clusters) {
        const { main, outliers } = filterOutliers(c);
        if (main.length > 0) expanded.push(main);
        if (outliers.length > 0) expanded.push(outliers);
    }
    const enriched = expanded.map(g => enrichGroup(g, features, hiddenPoiIds));
    return mergeBySamePoi(enriched);
}

// Méthode 'by-poi' : 1 cluster = 1 POI le plus proche (≤ POI_RADIUS).
// Les photos sans POI proche → clustering de proximité (trajet).
function groupByPoi(photos, features, hiddenPoiIds) {
    const visible = visiblePoiFeatures(features, hiddenPoiIds);
    const byPoi = new Map(); // poiId -> { feature, photos: [] }
    const leftover = [];

    for (const photo of photos) {
        let nearest = null;
        let minDist = Infinity;
        for (const f of visible) {
            const [fLng, fLat] = f.geometry.coordinates;
            const d = calculateDistance(photo.coords.lat, photo.coords.lng, fLat, fLng);
            if (d < minDist) { minDist = d; nearest = f; }
        }
        if (nearest && minDist <= POI_RADIUS) {
            const id = getPoiId(nearest);
            if (!byPoi.has(id)) byPoi.set(id, { feature: nearest, photos: [] });
            byPoi.get(id).photos.push(photo);
        } else {
            leftover.push(photo);
        }
    }

    const enriched = [];
    for (const { feature, photos: grouped } of byPoi.values()) {
        enriched.push(enrichGroup(grouped, features, hiddenPoiIds, feature));
    }
    // Photos de trajet (aucun POI dans POI_RADIUS) : regroupées par proximité.
    if (leftover.length > 0) {
        for (const c of clusterByLocation(leftover, PROXIMITY_RADIUS)) {
            enriched.push(enrichGroup(c, features, hiddenPoiIds));
        }
    }
    return enriched;
}

/**
 * Groupe des photos en clusters enrichis selon la méthode choisie.
 * @param {Array<{coords:{lat:number,lng:number}, date?:number}>} photos
 * @param {Array} features  POIs (features GeoJSON)
 * @param {'by-poi'|'proximity'} [method]
 * @param {string[]} [hiddenPoiIds]
 * @returns {Array<{photos, center, nearbyPois, absoluteNearest}>}
 */
export function clusterPhotos(photos, features, method = DEFAULT_CLUSTER_METHOD, hiddenPoiIds = []) {
    const valid = (photos || []).filter(p => p && p.coords && typeof p.coords.lat === 'number');
    if (valid.length === 0) return [];
    const clusters = method === 'proximity'
        ? groupByProximity(valid, features, hiddenPoiIds)
        : groupByPoi(valid, features, hiddenPoiIds);
    return chronoSort(clusters);
}
