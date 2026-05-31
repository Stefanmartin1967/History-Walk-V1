// scripts/migrate-description-case.mjs
//
// Unification du champ POI "description longue" : Description (capital) → description (lowercase).
//
// CONTEXTE : historiquement deux cases ont coexisté dans les geojson :
//   - "Description" (capital, convention des sources curatives historiques + DM storage.js)
//   - "description" (lowercase, convention JS, écrite par richEditor depuis sa création)
// Chaque nouveau lecteur devait connaître cette histoire et faire un fallback
// `description || Description`. Source d'oublis (cf. bug TTS Mosquée al-Ahjar
// résolu dans PR #703). On normalise tout sur lowercase (convention JS, déjà
// la cible du richEditor où les users éditent au quotidien).
//
// RÈGLE DE FUSION par feature :
//   1. Pas de `Description` (capital) → rien à faire
//   2. `Description` capital seul (lowercase absent ou null) → renommer en lowercase
//   3. lowercase seul (capital absent) → rien à faire (déjà bon)
//   4. Les 2 présentes :
//      a. Capital null ou vide → supprimer la clé capital
//      b. Capital non-null, lowercase null/absent → comme #2
//      c. Les 2 non-null et IDENTIQUES → supprimer la clé capital (doublon)
//      d. Les 2 non-null DIFFÉRENTES → garder lowercase (= curée plus récente),
//         supprimer capital, logger un AVERTISSEMENT (Stefan a déjà validé la
//         règle, mais on imprime les 5 cas connus pour mémoire / future review).
//
// NE TOUCHE PAS Description_courte (champ sémantiquement DISTINCT = info GPX
// Wikiloc). Voir [[project_description_courte_rename]] pour le followup à venir.
//
// Idempotent : 2e exécution ne change rien.
//
// Usage : `node scripts/migrate-description-case.mjs`

import { readFileSync, writeFileSync } from 'node:fs';

const FILES = ['public/djerba.geojson', 'public/hammamet.geojson'];

let totalRenamed = 0;
let totalDropped = 0;
let totalConflicts = 0;

for (const path of FILES) {
    const raw = readFileSync(path, 'utf8');
    const geo = JSON.parse(raw);
    let renamed = 0;
    let dropped = 0;
    const conflicts = [];

    for (const f of geo.features || []) {
        const p = f.properties;
        if (!p) continue;
        const hasCap = 'Description' in p;
        if (!hasCap) continue; // déjà migré (ou jamais eu de capital)

        const capVal = p.Description;
        const hasLow = 'description' in p;
        const lowVal = hasLow ? p.description : null;

        // Cas 4d : conflit réel (les 2 ont du contenu différent)
        if (capVal != null && lowVal != null && String(capVal) !== String(lowVal)) {
            conflicts.push({
                name: p['Nom du site FR'] || p.HW_ID || '(sans nom)',
                kept: lowVal,
                dropped: capVal,
            });
            delete p.Description;
            dropped++;
            continue;
        }

        // Cas 2 ou 4b : capital seul → renommer
        if (capVal != null && (lowVal == null)) {
            p.description = capVal;
            delete p.Description;
            renamed++;
            continue;
        }

        // Cas 4a / 4c : capital null OU doublon identique → drop
        delete p.Description;
        dropped++;
    }

    writeFileSync(path, JSON.stringify(geo, null, 2) + '\n', 'utf8');
    console.log(`${path} : ${renamed} renommé(s), ${dropped} doublon(s)/null(s) supprimé(s), ${conflicts.length} conflit(s) résolu(s)`);
    if (conflicts.length) {
        console.log('  Conflits (lowercase gardée, capital droppée) :');
        for (const c of conflicts) {
            const k = String(c.kept).slice(0, 60).replace(/\n/g, ' ');
            const d = String(c.dropped).slice(0, 60).replace(/\n/g, ' ');
            console.log(`    · ${c.name}`);
            console.log(`        kept    : ${k}${String(c.kept).length > 60 ? '…' : ''}`);
            console.log(`        dropped : ${d}${String(c.dropped).length > 60 ? '…' : ''}`);
        }
    }
    totalRenamed += renamed;
    totalDropped += dropped;
    totalConflicts += conflicts.length;
}

console.log(`\nTotal : ${totalRenamed} renommé(s), ${totalDropped} drop(s), ${totalConflicts} conflit(s).`);
