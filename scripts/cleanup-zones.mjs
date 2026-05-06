// scripts/cleanup-zones.mjs
//
// Nettoie le fichier {dest}-zones.geojson généré par fetch-zones-from-osm.mjs :
//  1. Supprime les zones explicitement listées en argument (séparées par virgule)
//  2. Pour chaque POI orphelin (hors de toutes les zones restantes), suggère
//     la zone OSM la plus proche (centroïde) — ne modifie pas le data POI.
//
// Usage :
//   node scripts/cleanup-zones.mjs <destId> "Zone1,Zone2,..."
//   ex : node scripts/cleanup-zones.mjs djerba "Hassi El Jerbi,Chammakh,Boughrara,El Jourf"
//
// Le data POI (public/{dest}.geojson) n'est PAS modifié. Stefan peut ensuite
// décider d'assigner les orphelins via le DM (mode master-detail rapide).

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const destId = process.argv[2];
const zonesToRemoveCsv = process.argv[3] || '';
if (!destId) {
    console.error('Usage : node scripts/cleanup-zones.mjs <destId> "Zone1,Zone2,..."');
    process.exit(1);
}
const zonesToRemove = zonesToRemoveCsv
    .split(',').map(s => s.trim()).filter(Boolean);

// 1. Charger les zones OSM générées
const zonesPath = resolve(ROOT, 'public', `${destId}-zones.geojson`);
const zonesGeo = JSON.parse(readFileSync(zonesPath, 'utf8'));
const before = zonesGeo.features.length;

// 2. Supprimer les zones listées
const removed = [];
zonesGeo.features = zonesGeo.features.filter(f => {
    if (zonesToRemove.includes(f.properties.name)) {
        removed.push(f.properties.name);
        return false;
    }
    return true;
});

// 3. Sauvegarder
writeFileSync(zonesPath, JSON.stringify(zonesGeo, null, 2) + '\n', 'utf8');

console.log(`Cleanup ${destId}-zones.geojson :`);
console.log(`  Zones avant : ${before}`);
console.log(`  Zones supprimées (${removed.length}) : ${removed.join(', ') || '(aucune)'}`);
console.log(`  Zones après : ${zonesGeo.features.length}`);
console.log('');

// 4. Bonus : identifier les POIs orphelins et suggérer une zone proche
const poisPath = resolve(ROOT, 'public', `${destId}.geojson`);
let poisGeo;
try { poisGeo = JSON.parse(readFileSync(poisPath, 'utf8')); }
catch { console.log('(Pas de fichier POIs pour suggérer les orphelins)'); process.exit(0); }

function pointInPolygon(pt, ring) {
    const [px, py] = pt;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

function centroid(ring) {
    let cx = 0, cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    return [cx / ring.length, cy / ring.length];
}

function distKm(a, b) {
    const cosLat = Math.cos((a[1] + b[1]) / 2 * Math.PI / 180);
    const dLat = (a[1] - b[1]) * 111;
    const dLng = (a[0] - b[0]) * 111 * cosLat;
    return Math.sqrt(dLat * dLat + dLng * dLng);
}

const orphans = [];
for (const poi of poisGeo.features) {
    const coords = poi.geometry.coordinates;
    let inside = false;
    for (const z of zonesGeo.features) {
        if (pointInPolygon(coords, z.geometry.coordinates[0])) { inside = true; break; }
    }
    if (!inside) orphans.push({ poi, coords });
}

if (orphans.length === 0) {
    console.log('Aucun POI orphelin. ✓');
    process.exit(0);
}

console.log(`POIs orphelins (${orphans.length}) — zone OSM la plus proche (centroïde) :`);
for (const { poi, coords } of orphans) {
    const dists = zonesGeo.features.map(z => ({
        name: z.properties.name,
        dist: distKm(coords, centroid(z.geometry.coordinates[0]))
    }));
    dists.sort((a, b) => a.dist - b.dist);
    const top3 = dists.slice(0, 3).map(d => `${d.name} (${d.dist.toFixed(1)}km)`).join(' · ');
    console.log(`  - ${(poi.properties['Nom du site FR'] || '?').padEnd(35)} → ${top3}`);
}
console.log('');
console.log('Pour assigner ces POIs : ouvrir le DM, cliquer sur chaque POI, choisir');
console.log('la zone proposée dans le dropdown Zone (qui sera désormais peuplé depuis');
console.log(`${destId}-zones.geojson).`);
