// scripts/migrate-desc-wpt.mjs
//
// Migration one-shot Desc_wpt → Description_courte (chantier DM PR 4/5).
// Décision Stefan 05/05/2026 : couper net. Le champ Desc_wpt est supprimé
// du data après migration ; le code HW (gpx.js, richEditor.js, templates.js)
// retire le fallback dans la même PR.
//
// Règle de migration :
//   - si Desc_wpt vide/null → on retire juste le champ
//   - si Description_courte déjà rempli → on retire Desc_wpt (priorité au moderne)
//   - sinon → on copie Desc_wpt vers Description_courte puis on retire Desc_wpt
//
// Usage : node scripts/migrate-desc-wpt.mjs

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEOJSON_PATH = resolve(__dirname, '..', 'public', 'djerba.geojson');

const raw = readFileSync(GEOJSON_PATH, 'utf8');
const geo = JSON.parse(raw);

let migrated = 0;
let skippedAlreadyHasCourte = 0;
let removedEmpty = 0;
let untouched = 0;

for (const feat of geo.features) {
    const props = feat.properties;
    if (!('Desc_wpt' in props)) {
        untouched++;
        continue;
    }
    const wpt = props.Desc_wpt;
    const courte = props.Description_courte;
    if (wpt && wpt.trim()) {
        if (courte && courte.trim()) {
            skippedAlreadyHasCourte++;
        } else {
            props.Description_courte = wpt;
            migrated++;
        }
    } else {
        removedEmpty++;
    }
    delete props.Desc_wpt;
}

writeFileSync(GEOJSON_PATH, JSON.stringify(geo, null, 2) + '\n', 'utf8');

console.log('Migration Desc_wpt → Description_courte terminée :');
console.log(`  Total features                       : ${geo.features.length}`);
console.log(`  Migrés (Desc_wpt → Description_courte) : ${migrated}`);
console.log(`  Desc_wpt vide/null retiré              : ${removedEmpty}`);
console.log(`  Desc_wpt + Description_courte (skip)   : ${skippedAlreadyHasCourte}`);
console.log(`  Pas de Desc_wpt (intacts)              : ${untouched}`);
