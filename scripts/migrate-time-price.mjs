// scripts/migrate-time-price.mjs
//
// Migration one-shot Temps de visite / Prix d'entrée → Temps_minutes / Prix_TND
// (chantier DM PR 5/5). Décision Stefan 05/05/2026 : couper net.
//
// Règles :
//   - "Temps de visite": "01:00" / "03:00:00" / "1h30" / null → Temps_minutes (number, en min)
//   - "Prix d'entrée": "8 Dt" / "Gratuit" / null → Prix_TND (number, en TND)
//   - Les anciens champs sont supprimés
//
// Usage : node scripts/migrate-time-price.mjs

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEOJSON_PATH = resolve(__dirname, '..', 'public', 'djerba.geojson');

const raw = readFileSync(GEOJSON_PATH, 'utf8');
const geo = JSON.parse(raw);

function parseTimeToMinutes(s) {
    if (!s || typeof s !== 'string') return null;
    const trimmed = s.trim();
    if (!trimmed) return null;
    // Format HH:MM ou HH:MM:SS
    if (/^\d{1,2}:\d{1,2}(?::\d{1,2})?$/.test(trimmed)) {
        const [h, m] = trimmed.split(':').map(p => parseInt(p, 10));
        return (h || 0) * 60 + (m || 0);
    }
    // Format "1h30", "2h", "30min"
    const hMatch = trimmed.match(/^(\d+)\s*h\s*(\d{1,2})?\s*$/i);
    if (hMatch) {
        const h = parseInt(hMatch[1], 10);
        const m = hMatch[2] ? parseInt(hMatch[2], 10) : 0;
        return h * 60 + m;
    }
    const mMatch = trimmed.match(/^(\d+)\s*min$/i);
    if (mMatch) return parseInt(mMatch[1], 10);
    // Fallback : extraire le premier nombre comme minutes
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num > 0) return num;
    return null;
}

function parsePriceToTND(s) {
    if (s == null) return null;
    if (typeof s === 'number') return s;
    if (typeof s !== 'string') return null;
    const trimmed = s.trim();
    if (!trimmed) return null;
    if (/^gratuit$/i.test(trimmed)) return 0;
    // Extraire le premier nombre (entier ou décimal avec . ou ,)
    const m = trimmed.match(/^([\d]+(?:[.,]\d+)?)/);
    if (m) return parseFloat(m[1].replace(',', '.'));
    return null;
}

let timeMigrated = 0, timeRemoved = 0;
let priceMigrated = 0, priceRemoved = 0;

for (const feat of geo.features) {
    const props = feat.properties;

    if ('Temps de visite' in props) {
        const minutes = parseTimeToMinutes(props['Temps de visite']);
        if (minutes != null && minutes > 0) {
            props['Temps_minutes'] = minutes;
            timeMigrated++;
        } else {
            timeRemoved++;
        }
        delete props['Temps de visite'];
    }

    if ("Prix d'entrée" in props) {
        const tnd = parsePriceToTND(props["Prix d'entrée"]);
        if (tnd != null) {
            props['Prix_TND'] = tnd;
            priceMigrated++;
        } else {
            priceRemoved++;
        }
        delete props["Prix d'entrée"];
    }
}

writeFileSync(GEOJSON_PATH, JSON.stringify(geo, null, 2) + '\n', 'utf8');

console.log('Migration Temps/Prix terminée :');
console.log(`  Total features              : ${geo.features.length}`);
console.log(`  Temps migrés (en minutes)   : ${timeMigrated}`);
console.log(`  Temps null/vide retirés     : ${timeRemoved}`);
console.log(`  Prix migrés (en TND)        : ${priceMigrated}`);
console.log(`  Prix null/vide retirés      : ${priceRemoved}`);
