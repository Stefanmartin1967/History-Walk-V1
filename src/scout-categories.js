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
// Les tags ambigus (tour, palais, lieu de culte de religion inconnue) tombent
// volontairement sur `null` plutôt que sur une catégorie devinée à tort.

// OSM (historic / tourism / amenity / leisure) → catégorie-feuille v2.
export const HW_MAPPING = {
    // Site historique (P1 Niveau 1 : whitelist élargie au patrimoine bâti net —
    // ouvrages défensifs + sites funéraires. Les valeurs hors liste mais moissonnées
    // — palais, monastère, aqueduc, tour… — tombent volontairement
    // sur null → « A définir » → triage manuel, plutôt qu'une catégorie devinée à tort.)
    fort: 'Fortification', fortress: 'Fortification',
    citadel: 'Fortification', city_gate: 'Fortification', citywalls: 'Fortification', bastion: 'Fortification',
    // Château, Monument (05/11/2026, Wallonie) : un château est une résidence avant
    // d'être un ouvrage défensif ; le sous-type (fort, résidentiel, ferme) se choisit
    // à la curation. Monuments et mémoriaux ne sont plus « ambigus » depuis que la
    // catégorie existe.
    castle: 'Château', manor: 'Château',
    monument: 'Monument', memorial: 'Monument',
    // Potale (06/11/2026) : `wayside_shrine` était moissonné mais classé « ambigu »
    // depuis la v3.7.318, quand la catégorie n'existait pas (créée le 01/11/2026).
    // 275 potales de Wallonie arrivaient en « A définir », 181 sans nom (« Lieu
    // inconnu »). Une petite chapelle tracée en `building=chapel` reste Chapelle :
    // les lieux de culte sont testés avant ce tableau.
    wayside_shrine: 'Potale',
    archaeological_site: 'Site archéologique', ruins: 'Site archéologique',
    tomb: 'Site funéraire', mausoleum: 'Site funéraire', tumulus: 'Site funéraire',
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
    if (tags.building === 'chapel') return 'Chapelle';   // sans sous-type : porte ou grille se voit sur place
    if (tags.building === 'church' || tags.building === 'cathedral') return 'Église';
    if (tags.amenity === 'place_of_worship') {
        if (tags.religion === 'muslim') return 'Mosquée';
        if (tags.religion === 'christian') return 'Église';
        if (tags.religion === 'jewish') return 'Synagogue';
        return null;   // religion inconnue → triage manuel (app multi-pays, plus de défaut « Mosquée »)
    }
    // Patrimoine technique / vernaculaire (P1 Niveau 1) — clés hors `raw` ci-dessous,
    // traitées en amont. Branchent des catégories de la taxo jusque-là jamais moissonnées :
    if (tags.man_made === 'water_well') return 'Puits';
    if (tags.man_made === 'windmill' || tags.man_made === 'watermill') return 'Vestige industriel';   // sous-type Moulin à la curation
    if (tags.man_made === 'lighthouse') return 'Curiosité';
    if (tags.craft === 'pottery' || tags.craft === 'weaving' || tags.shop === 'pottery') return 'Artisanat';
    // Édifice civil (05/11/2026) : beffroi reconnu à son NOM, pas à `tower:type=belfry`,
    // qui désigne aussi les clochers d'église ; hôtel de ville via `amenity=townhall`
    // (moissonné seulement avec la case « Services publics »). Sous-type à la curation.
    if (/^beffroi(\s|$)/i.test((tags['name:fr'] || tags.name || '').trim())) return 'Édifice civil';
    if (tags.amenity === 'townhall') return 'Édifice civil';
    const raw = tags.historic || tags.tourism || tags.amenity || tags.leisure;
    return HW_MAPPING[raw] || null; // null = catégorie non devinée (candidat « inconnu »)
}
