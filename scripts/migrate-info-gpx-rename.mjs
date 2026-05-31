// scripts/migrate-info-gpx-rename.mjs
//
// Renomme la clé POI `Description_courte` en `info_gpx` dans les geojson.
//
// CONTEXTE : la clé historique `Description_courte` partageait son préfixe avec
// le champ `description` (longue), source de confusion. Sémantiquement c'est
// le texte qui voyage dans le <desc> des waypoints du GPX exporté (vu par
// Wikiloc, GPX Studio, applis de marche). Le nom `info_gpx` reflète cet usage
// sans ambiguïté ; le case lowercase suit la trajectoire prise par la PR #704
// (unification description) — tous les nouveaux noms canoniques en lowercase.
//
// Règle par feature :
//   1. Pas de `Description_courte` → rien à faire
//   2. `info_gpx` déjà présente → conflit théorique ; en pratique pas vu (0
//      occurrences sur djerba+hammamet à 31/05/2026), mais on traite quand
//      même : la valeur existante de `info_gpx` est préservée, la
//      `Description_courte` droppée (le nouveau nom est canonique).
//   3. `Description_courte` seule → renommer
//
// Idempotent : 2e exécution = no-op (plus aucune `Description_courte`).
//
// Usage : `node scripts/migrate-info-gpx-rename.mjs`

import { readFileSync, writeFileSync } from 'node:fs';

const FILES = ['public/djerba.geojson', 'public/hammamet.geojson'];

let totalRenamed = 0;
let totalConflicts = 0;

for (const path of FILES) {
    const raw = readFileSync(path, 'utf8');
    const geo = JSON.parse(raw);
    let renamed = 0;
    let conflicts = 0;

    for (const f of geo.features || []) {
        const p = f.properties;
        if (!p || !('Description_courte' in p)) continue;

        if ('info_gpx' in p) {
            // Conflit théorique : info_gpx existe déjà. On préserve info_gpx
            // (canonique) et on drop Description_courte.
            delete p.Description_courte;
            conflicts++;
            continue;
        }

        p.info_gpx = p.Description_courte;
        delete p.Description_courte;
        renamed++;
    }

    writeFileSync(path, JSON.stringify(geo, null, 2) + '\n', 'utf8');
    console.log(`${path} : ${renamed} renommé(s), ${conflicts} conflit(s).`);
    totalRenamed += renamed;
    totalConflicts += conflicts;
}

console.log(`\nTotal : ${totalRenamed} renommé(s), ${totalConflicts} conflit(s).`);
