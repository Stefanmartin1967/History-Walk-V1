// scripts/migrate-sous-type-generique.mjs
//
// Sous-type « Générique » → vide (décision de Stefan, 10/10/2026).
//
// CONTEXTE : « Générique » était le 4ᵉ sous-type des mosquées, pour une forme
// qu'on ne sait pas déterminer. Le visiteur le lisait sur la fiche (constat C3
// du 03/10/2026) sans que le mot lui apprenne rien. Aucun nom de remplacement
// ne convenait ; Stefan a tranché : on laisse vide, l'absence se voit (même
// logique que la section Description). La valeur sort de la taxonomie
// (public/poi-categories.json) et de la table d'icônes : une mosquée sans
// sous-type avait déjà la même icône.
//
// RÈGLE : toute feature dont `Sous-type` vaut exactement « Générique » passe à
// "" — la même valeur que les mosquées jamais classées. Rien d'autre ne bouge.
// Le fichier est réécrit dans son format exact (indentation 2, sans saut de
// ligne final) : le diff ne contient que les valeurs changées.
//
// Les données LOCALES (surcharges, lieux créés, sauvegardes restaurées) sont
// traitées au chargement par l'app : clearGenericSubtypeInPoiData (database.js)
// et la boucle customFeatures de displayGeoJSON (data.js).
//
// Idempotent : 2e exécution ne change rien.
//
// Usage : `node scripts/migrate-sous-type-generique.mjs`

import { readFileSync, writeFileSync } from 'node:fs';

const FILES = ['public/djerba.geojson', 'public/hammamet.geojson'];

let total = 0;
for (const path of FILES) {
    const geo = JSON.parse(readFileSync(path, 'utf8'));
    const changed = [];
    for (const f of geo.features || []) {
        const p = f.properties;
        if (p && p['Sous-type'] === 'Générique') {
            p['Sous-type'] = '';
            changed.push(`${p['Nom du site FR'] || p.HW_ID} (${p['Catégorie'] || '?'})`);
        }
    }
    if (changed.length) writeFileSync(path, JSON.stringify(geo, null, 2), 'utf8');
    console.log(`${path} : ${changed.length} fiche(s) passée(s) de « Générique » à vide`);
    for (const c of changed) console.log(`    · ${c}`);
    total += changed.length;
}
console.log(`\nTotal : ${total}.`);
