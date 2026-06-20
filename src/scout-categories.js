// scout-categories.js — devine la catégorie Heripia (taxonomie v2) d'un objet OSM
// moissonné par le Scout, à partir de ses tags. Module FEUILLE (zéro dépendance,
// testable seul), extrait de scout.js pour pouvoir croiser ses sorties avec la
// taxonomie réelle (cf. tests/scout_category_mapping.test.js).
//
// INVARIANT : toute valeur retournée non-nulle DOIT appartenir à getCategoryLabels()
// (taxonomy.js) — sinon le POI capturé hérite d'une catégorie fantôme (icône « ? »,
// valeur perdue au <select> du richEditor). À RESYNCHRONISER si la taxonomie change.
//   - une valeur retournée = catégorie devinée avec confiance,
//   - `null` = non devinée → le Scout marque le candidat « inconnu », et la capture
//     écrit le sentinel 'A définir' (badge « à catégoriser » au tri).
// Les tags ambigus (monument, mémorial, lieu de culte de religion inconnue) tombent
// volontairement sur `null` plutôt que sur une catégorie devinée à tort.

// OSM (historic / tourism / amenity / leisure) → catégorie-feuille v2.
export const HW_MAPPING = {
    // Site historique
    fort: 'Fortification', castle: 'Fortification',
    archaeological_site: 'Site archéologique', ruins: 'Site archéologique',
    // Culture & découvertes
    museum: 'Musée',
    theme_park: 'Curiosité', zoo: 'Curiosité', viewpoint: 'Curiosité',
    artwork: 'Curiosité', attraction: 'Curiosité',
    // Manger & boire
    restaurant: 'Restaurant', cafe: 'Café',
    // Services & commodités
    hotel: 'Hôtel', guest_house: 'Hôtel',
};

// P5 — détection d'écriture arabe (bloc arabe U+0600–06FF + Supplément U+0750–077F
// + Extended-A U+08A0–08FF + Formes de présentation A U+FB50–FDFF / B U+FE70–FEFF).
// Plage LARGE volontaire (décision Stefan). Module feuille : regex auto-contenue,
// pas d'import (préserve l'invariant « zéro dépendance »).
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
export function isArabicText(s) {
    return typeof s === 'string' && ARABIC_RE.test(s);
}

// Range le nom d'un objet OSM dans les bons champs Heripia (FR / arabe). Priorité
// aux tags explicites (name:fr → FR, name:ar → AR) ; à défaut, le tag brut `name`
// est rangé selon son écriture (arabe → AR, sinon → FR) — c'est ce qui évite qu'un
// nom en arabe atterrisse dans le champ français (bug P5). Renvoie { nameFr, nameAr }
// (chaînes vides si rien). La capture n'écrit la clé arabe que si nameAr est non vide.
export function resolveOsmNames(tags = {}) {
    const nFr = (tags['name:fr'] || '').trim();
    const nAr = (tags['name:ar'] || '').trim();
    const nRaw = (tags.name || '').trim();
    let nameFr = nFr;
    let nameAr = nAr;
    if (!nameFr && nRaw && !isArabicText(nRaw)) nameFr = nRaw;
    if (!nameAr && nRaw && isArabicText(nRaw)) nameAr = nRaw;
    return { nameFr, nameAr };
}

export function getHwCategory(tags = {}) {
    // Lieux de culte — on dérive la catégorie v2 du bâtiment puis de la religion.
    if (tags.building === 'mosque') return 'Mosquée';
    if (tags.building === 'synagogue') return 'Synagogue';
    if (tags.building === 'church' || tags.building === 'chapel' || tags.building === 'cathedral') return 'Église';
    if (tags.amenity === 'place_of_worship') {
        if (tags.religion === 'muslim') return 'Mosquée';
        if (tags.religion === 'christian') return 'Église';
        if (tags.religion === 'jewish') return 'Synagogue';
        return null;   // religion inconnue → triage manuel (app multi-pays, plus de défaut « Mosquée »)
    }
    const raw = tags.historic || tags.tourism || tags.amenity || tags.leisure;
    return HW_MAPPING[raw] || null; // null = catégorie non devinée (candidat « inconnu »)
}
