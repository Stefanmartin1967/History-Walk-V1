// photo-clustering.js
// Groupement des photos importées (par GPS) en clusters, pour la modale
// « Traitement photos ».
//
// Méthode « par lieu » : chaque photo est rattachée au POI le plus proche
// (≤ POI_RADIUS). Un cluster = un POI. Les photos sans POI proche retombent sur
// un clustering de proximité (vraies photos de « trajet »). Sépare nettement
// « photos du café » de « photos de l'église » même à faible distance, car le
// découpage suit l'IDENTITÉ du lieu, pas la distance — contrairement à l'ancien
// clustering transitif photo↔photo qui chaînait en ville (rafale de photos
// espacées de <80 m → méga-cluster traversant plusieurs lieux, mal nommé).
// Validé par Stefan sur ses photos (30/05/2026) ; la méthode « proximité »
// concurrente et son switch de comparaison ont été retirés après ce choix.
//
// Sortie : tableau de clusters { photos, center, nearbyPois, absoluteNearest } —
// la forme attendue par ui-photo-batch.normalizeClusters. nearbyPois[0] pilote
// le nom auto ET la cible d'enregistrement : le POI d'ancrage y est en tête.
//
// Fonction PURE (POIs passés en paramètre) → testée dans
// tests/photo_clustering.test.js. La dérive GPS en médina reste irréductible :
// aucune méthode n'est parfaite, d'où le dropdown de correction de la modale.

import {
    calculateDistance,
    calculateBarycenter,
    clusterByLocation,
    getPoiId,
} from './utils.js';

const POI_RADIUS = 120;     // m — « ce POI est le lieu de la photo »
const TRAJET_RADIUS = 80;   // m — regroupement des photos « trajet » (sans POI)
const NEARBY_RADIUS = 100;  // m — POIs listés dans nearbyPois (candidats proches)
const SUGGEST_RADIUS = 300; // m — plafond de la suggestion « plus proche » (au-delà,
                            //     on ne propose plus de lieu : suggérer un POI à 1 km
                            //     serait trompeur). Cf. badge « À rattacher ».

function visiblePoiFeatures(features, hiddenPoiIds) {
    const hidden = hiddenPoiIds || [];
    return (features || []).filter(f =>
        f && f.geometry && f.geometry.coordinates && !hidden.includes(getPoiId(f))
    );
}

// Enrichit un groupe de photos : barycentre + POIs proches (≤ NEARBY_RADIUS,
// triés) + POI absolu le plus proche. Si `anchorFeature` est fourni (groupe
// rattaché à un POI), il est forcé en tête de nearbyPois (= nom + cible save).
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

    // Suggestion « plus proche » seulement si le POI est à portée raisonnable
    // (≤ SUGGEST_RADIUS). Au-delà → pas de suggestion (groupe « Hors POI » pur).
    const suggested = (absoluteNearest && absoluteNearest.dist <= SUGGEST_RADIUS)
        ? absoluteNearest : null;

    return {
        photos,
        center,
        nearbyPois,
        absoluteNearest: nearbyPois.length === 0 ? suggested : null,
    };
}

// Tri chronologique : photos par date dans chaque cluster, puis clusters par
// date de leur 1re photo.
function chronoSort(clusters) {
    clusters.forEach(c => c.photos.sort((a, b) => (a.date || 0) - (b.date || 0)));
    clusters.sort((a, b) => (a.photos[0]?.date || 0) - (b.photos[0]?.date || 0));
    return clusters;
}

/**
 * Groupe des photos en clusters enrichis : 1 groupe = POI le plus proche
 * (≤ 120 m) ; photos sans POI proche → groupes « trajet » (proximité 80 m).
 * @param {Array<{coords:{lat:number,lng:number}, date?:number}>} photos
 * @param {Array} features  POIs (features GeoJSON)
 * @param {string[]} [hiddenPoiIds]
 * @returns {Array<{photos, center, nearbyPois, absoluteNearest}>}
 */
export function clusterPhotos(photos, features, hiddenPoiIds = []) {
    const valid = (photos || []).filter(p => p && p.coords && typeof p.coords.lat === 'number');
    if (valid.length === 0) return [];

    const visible = visiblePoiFeatures(features, hiddenPoiIds);
    const byPoi = new Map(); // poiId -> { feature, photos: [] }
    const leftover = [];

    for (const photo of valid) {
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

    const clusters = [];
    for (const { feature, photos: grouped } of byPoi.values()) {
        clusters.push(enrichGroup(grouped, features, hiddenPoiIds, feature));
    }
    // Photos de trajet (aucun POI dans POI_RADIUS) : regroupées par proximité.
    for (const c of clusterByLocation(leftover, TRAJET_RADIUS)) {
        clusters.push(enrichGroup(c, features, hiddenPoiIds));
    }

    return chronoSort(clusters);
}
