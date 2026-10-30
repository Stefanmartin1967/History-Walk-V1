// track-fingerprint.js — Empreinte d'un tracé de circuit (realTrack).
//
// L'index publié (circuits/<map>.json) ne contient pas les tracés : ils vivent
// dans les GPX, chargés à la demande. Sans repère, le Centre de contrôle ne
// pouvait donc pas voir qu'un tracé avait changé — une retouche par points de
// passage, sans changement d'étapes, de nom ni de description, n'était ni
// publiée ni annulable (constat de Stefan, 30/10/2026).
//
// L'empreinte est écrite dans l'entrée d'index à chaque publication
// (`trackHash`) et comparée à celle du tracé local. Pour un circuit publié avant
// ce champ, la référence est l'empreinte du GPX publié : retenue au chargement
// du tracé officiel (rememberPublishedTrack), sinon relue sur le serveur.
//
// Module feuille (aucune dépendance) : importable partout, tests compris.

// Arrondi au micro-degré (~10 cm) : absorbe une éventuelle différence d'écriture
// des nombres sans masquer un vrai déplacement.
const roundCoord = (v) => Number(v).toFixed(6);

/**
 * Empreinte « <nb de points>-<hash> » d'un tracé [[lat, lon], …], ou null s'il
 * est vide. Hash FNV-1a 32 bits sur les coordonnées arrondies.
 */
export function trackFingerprint(realTrack) {
    if (!Array.isArray(realTrack) || realTrack.length === 0) return null;
    let h = 0x811c9dc5;
    for (const pt of realTrack) {
        const s = `${roundCoord(pt[0])},${roundCoord(pt[1])};`;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
    }
    return `${realTrack.length}-${h.toString(16).padStart(8, '0')}`;
}

// Nombre de points d'une empreinte (affichage du diff).
export function fingerprintPointCount(fp) {
    const n = parseInt(String(fp || '').split('-')[0], 10);
    return Number.isFinite(n) ? n : null;
}

// Empreintes des GPX publiés lus pendant la session, par id de circuit.
const publishedFingerprints = new Map();

// À appeler quand un tracé vient d'être lu dans le GPX PUBLIÉ (jamais avec un
// tracé local) : il devient la référence de comparaison de ce circuit.
export function rememberPublishedTrack(circuitId, realTrack) {
    const fp = trackFingerprint(realTrack);
    if (circuitId != null && fp) publishedFingerprints.set(String(circuitId), fp);
}

export function publishedTrackFingerprint(circuitId) {
    return publishedFingerprints.get(String(circuitId)) || null;
}

/** Points [[lat, lon], …] des <trkpt> d'un texte GPX. */
export function parseGpxTrack(gpxText) {
    const coords = [];
    const tags = String(gpxText || '').match(/<trkpt\b[^>]*>/g) || [];
    for (const tag of tags) {
        const lat = tag.match(/\blat="([^"]+)"/);
        const lon = tag.match(/\blon="([^"]+)"/);
        if (lat && lon) coords.push([parseFloat(lat[1]), parseFloat(lon[1])]);
    }
    return coords;
}
