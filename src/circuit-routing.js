// circuit-routing.js — Routage in-app via BRouter (profil piéton).
//
// Produit un `realTrack` ([[lat, lon], …], format Heripia) à partir d'une
// séquence ordonnée de POIs. L'ancre de routage de chaque POI = son point
// d'accès au tracé (`accessPoint`, posé par l'admin sur la voie la plus proche)
// s'il existe, sinon ses coordonnées réelles — exactement la logique de
// `trackAnchorOf` (gpx.js) qui alimente le « vol d'oiseau ».
//
// BRouter (serveur public brouter.de) est interrogeable directement depuis le
// navigateur (CORS ouvert), sans clé ni backend — adapté au paradigme PWA
// statique d'Heripia. Online-only : la création de circuit se fait sur PC, le
// vol d'oiseau reste le repli hors-ligne / si BRouter est indisponible.
import { getAccessPoint } from './utils.js';

const BROUTER_URL = 'https://brouter.de/brouter';
export const DEFAULT_PROFILE = 'hiking-beta'; // profil rando piéton validé sur Djerba

// Ancre de routage d'un POI : point d'accès au tracé si défini/valide, sinon
// coordonnées réelles du POI. Renvoie [lon, lat].
function anchorOf(feature) {
    return getAccessPoint(feature) || feature.geometry.coordinates;
}

// Sérialise une liste de points [lon, lat] au format `lonlats` de BRouter.
function toLonLats(points) {
    return points.map(([lon, lat]) => `${lon.toFixed(8)},${lat.toFixed(8)}`).join('|');
}

/**
 * Route une séquence de points [lon, lat] via BRouter.
 * @param {number[][]} points  Liste ordonnée de [lon, lat] (≥ 2).
 * @param {string} [profile]   Profil BRouter (défaut : hiking-beta).
 * @returns {Promise<{realTrack: number[][], distanceKm: number, durationMin: number}>}
 *   `realTrack` au format [[lat, lon], …], prêt à être posé sur `circuit.realTrack`.
 * @throws {Error} message lisible si réseau KO ou tracé absent.
 */
export async function routePoints(points, profile = DEFAULT_PROFILE) {
    if (!Array.isArray(points) || points.length < 2) {
        throw new Error('Au moins 2 lieux sont nécessaires pour tracer un itinéraire.');
    }
    const url = `${BROUTER_URL}?lonlats=${toLonLats(points)}&profile=${encodeURIComponent(profile)}&format=geojson&alternativeidx=0`;

    let resp;
    try {
        resp = await fetch(url);
    } catch (e) {
        throw new Error('BRouter est injoignable — vérifiez la connexion internet.');
    }
    if (!resp.ok) {
        throw new Error(`BRouter n'a pas pu calculer l'itinéraire (erreur ${resp.status}).`);
    }

    let gj;
    try {
        gj = await resp.json();
    } catch (e) {
        throw new Error('Réponse BRouter illisible.');
    }

    const feat = gj && Array.isArray(gj.features) ? gj.features[0] : null;
    const coords = feat && feat.geometry ? feat.geometry.coordinates : null;
    if (!Array.isArray(coords) || coords.length === 0) {
        throw new Error("BRouter n'a renvoyé aucun tracé.");
    }

    // BRouter renvoie [lon, lat, ele] → Heripia attend [lat, lon].
    const realTrack = coords.map(c => [c[1], c[0]]);

    const props = feat.properties || {};
    const distanceKm = props['track-length'] ? (+props['track-length']) / 1000 : 0;
    const durationMin = props['total-time'] ? Math.round((+props['total-time']) / 60) : 0;

    return { realTrack, distanceKm, durationMin };
}

/**
 * Route un circuit décrit par sa séquence ordonnée de features POI.
 * L'ancre de chaque POI = `accessPoint || coordonnées réelles`.
 * @param {Object[]} features  Features POI dans l'ordre du circuit.
 * @param {string} [profile]
 * @returns {Promise<{realTrack: number[][], distanceKm: number, durationMin: number}>}
 */
export async function routeCircuit(features, profile = DEFAULT_PROFILE) {
    const anchors = (features || [])
        .map(anchorOf)
        .filter(a => Array.isArray(a) && a.length >= 2 && Number.isFinite(a[0]) && Number.isFinite(a[1]));
    return routePoints(anchors, profile);
}
