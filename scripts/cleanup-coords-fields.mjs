// scripts/cleanup-coords-fields.mjs
//
// Migration one-shot : suppression des 3 champs textuels de coordonnées
// (Coordonnées GPS, Latitude, Longitude) du data POI.
//
// Décision Stefan 06/05/2026 : ces 3 champs sont du legacy DM (importés
// d'Excel). Le standard GeoJSON utilise `geometry.coordinates` qui est la
// SEULE source canonique. HW ne les écrit jamais ; les 52 POIs ajoutés via
// HW richEditor n'avaient déjà aucun de ces 3 champs et fonctionnaient
// parfaitement, prouvant qu'ils sont superflus.
//
// Pattern identique à PR #451 (Desc_wpt) et #452 (Temps/Prix) : couper net.
//
// Usage : node scripts/cleanup-coords-fields.mjs

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEOJSON_PATH = resolve(__dirname, '..', 'public', 'djerba.geojson');

const raw = readFileSync(GEOJSON_PATH, 'utf8');
const geo = JSON.parse(raw);

let removedCoords = 0, removedLat = 0, removedLng = 0;
let untouched = 0;

for (const feat of geo.features) {
    const props = feat.properties;
    let touched = false;

    if ('Coordonnées GPS' in props) { delete props['Coordonnées GPS']; removedCoords++; touched = true; }
    if ('Latitude' in props) { delete props['Latitude']; removedLat++; touched = true; }
    if ('Longitude' in props) { delete props['Longitude']; removedLng++; touched = true; }

    if (!touched) untouched++;
}

writeFileSync(GEOJSON_PATH, JSON.stringify(geo, null, 2) + '\n', 'utf8');

console.log('Cleanup champs coords textuels terminé :');
console.log(`  Total features                     : ${geo.features.length}`);
console.log(`  "Coordonnées GPS" retirés           : ${removedCoords}`);
console.log(`  "Latitude" retirés                  : ${removedLat}`);
console.log(`  "Longitude" retirés                 : ${removedLng}`);
console.log(`  POIs intacts (déjà sans ces champs) : ${untouched}`);
