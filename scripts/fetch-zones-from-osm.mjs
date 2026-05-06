// scripts/fetch-zones-from-osm.mjs
//
// Récupère les boundaries administratives d'une destination via Overpass API
// et génère le fichier `public/{destId}-zones.geojson` exploitable par
// le DM, le scout et HW.
//
// Usage :
//   node scripts/fetch-zones-from-osm.mjs <destId> [adminLevel]
//   ex : node scripts/fetch-zones-from-osm.mjs hammamet 8
//
// adminLevel défaut = 6 (Tunisie utilise 6 pour les délégations/communes).
// Pour d'autres pays : 8 est l'équivalent (France, Allemagne, etc.).
// Tester d'autres niveaux si la couverture est trop large/fine.

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const destId = process.argv[2];
const adminLevel = process.argv[3] || '6';

if (!destId) {
    console.error('Usage : node scripts/fetch-zones-from-osm.mjs <destId> [adminLevel]');
    process.exit(1);
}

// Lire la bbox depuis destinations.json
const destinationsPath = resolve(ROOT, 'public', 'destinations.json');
const destinations = JSON.parse(readFileSync(destinationsPath, 'utf8'));
const dest = destinations.maps?.[destId];
if (!dest) {
    console.error(`Destination "${destId}" introuvable dans public/destinations.json`);
    process.exit(1);
}
if (!dest.bounds) {
    console.error(`Destination "${destId}" n'a pas de "bounds" dans destinations.json`);
    process.exit(1);
}

const [[south, west], [north, east]] = dest.bounds;
console.log(`Destination : ${dest.name} (${destId})`);
console.log(`Bbox        : S=${south} W=${west} N=${north} E=${east}`);
console.log(`Admin level : ${adminLevel}`);
console.log('');

// Query Overpass
const query = `[out:json][timeout:60];
(
  relation["boundary"="administrative"]["admin_level"="${adminLevel}"]
    (${south},${west},${north},${east});
);
out geom;`;

console.log('Requête Overpass en cours…');
const url = 'https://overpass-api.de/api/interpreter';
const resp = await fetch(url, {
    method: 'POST',
    headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Accept': 'application/json',
        'User-Agent': 'history-walk-zones-fetch/1.0'
    },
    body: query
});
if (!resp.ok) {
    console.error(`Erreur Overpass : HTTP ${resp.status}`);
    process.exit(1);
}
const data = await resp.json();
console.log(`Réponse reçue : ${data.elements.length} relation(s).`);

// Transforme en FeatureCollection
// Une relation OSM peut avoir plusieurs "outer" rings → on prend le premier outer.
// (Si une zone a plusieurs polygones disjoints, on perd les autres — acceptable
//  pour notre usage simple de détection inside/outside.)
// Assemble plusieurs ways outer en un ring fermé (chaining par nodes adjacents).
// Les boundaries OSM sont rarement un seul way — généralement N ways qui se
// touchent à leurs extrémités. On les chaîne en respectant les directions.
function assembleRings(outerWays) {
    if (outerWays.length === 0) return [];
    const segments = outerWays.map(w => w.geometry.map(n => [n.lon, n.lat]));
    const ptKey = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
    const ptEqual = (a, b) => ptKey(a) === ptKey(b);
    const rings = [];
    const used = new Array(segments.length).fill(false);
    for (let start = 0; start < segments.length; start++) {
        if (used[start]) continue;
        const ring = [...segments[start]];
        used[start] = true;
        let extended = true;
        while (extended) {
            extended = false;
            const tail = ring[ring.length - 1];
            for (let i = 0; i < segments.length; i++) {
                if (used[i]) continue;
                const seg = segments[i];
                if (ptEqual(tail, seg[0])) {
                    ring.push(...seg.slice(1));
                    used[i] = true; extended = true; break;
                }
                if (ptEqual(tail, seg[seg.length - 1])) {
                    const reversed = [...seg].reverse();
                    ring.push(...reversed.slice(1));
                    used[i] = true; extended = true; break;
                }
            }
        }
        // Fermer le ring si pas déjà fermé
        const first = ring[0], last = ring[ring.length - 1];
        if (!ptEqual(first, last)) ring.push([...first]);
        if (ring.length >= 4) rings.push(ring);
    }
    return rings;
}

const features = [];
let skippedNoGeometry = 0;
for (const rel of data.elements) {
    // Priorité noms : name:fr → name:en → name (souvent en arabe en Tunisie)
    const name = rel.tags?.['name:fr']
              || rel.tags?.['name:en']
              || rel.tags?.name
              || `(sans nom #${rel.id})`;
    const nameAr = rel.tags?.['name:ar'] || rel.tags?.name || '';
    if (!rel.members) { skippedNoGeometry++; continue; }
    const outerWays = rel.members.filter(m => m.type === 'way' && m.role === 'outer' && m.geometry);
    if (outerWays.length === 0) { skippedNoGeometry++; continue; }
    const rings = assembleRings(outerWays);
    if (rings.length === 0) { skippedNoGeometry++; continue; }
    // Si plusieurs rings outer (zones multipolygons), on prend le plus grand
    rings.sort((a, b) => b.length - a.length);
    const ring = rings[0];
    features.push({
        type: 'Feature',
        properties: {
            name,
            ...(nameAr && nameAr !== name ? { name_ar: nameAr } : {}),
            osm_id: rel.id,
            admin_level: rel.tags?.admin_level
        },
        geometry: { type: 'Polygon', coordinates: [ring] }
    });
}
if (skippedNoGeometry > 0) {
    console.log(`(${skippedNoGeometry} relation(s) ignorée(s) pour cause de géométrie absente/invalide)`);
}

const geojson = { type: 'FeatureCollection', features };
const outPath = resolve(ROOT, 'public', `${destId}-zones.geojson`);
writeFileSync(outPath, JSON.stringify(geojson, null, 2) + '\n', 'utf8');

console.log('');
console.log(`✓ ${features.length} zones extraites → ${outPath}`);
console.log('');
console.log('Liste des zones :');
features.forEach(f => console.log(`  - ${f.properties.name}`));
