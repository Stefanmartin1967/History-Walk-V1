// scout-query.js — requête Overpass de la moisson Scout. Module FEUILLE (zéro
// dépendance), extrait de scout.js le 05/11/2026 pour pouvoir la tester face à
// getHwCategory (scout-categories.js) : un tag que le Scout sait classer mais ne
// moissonne pas est un angle mort silencieux. Cas fondateur : `building=chapel`,
// classé « Chapelle » depuis la création de la catégorie mais jamais demandé à
// Overpass (Chapelle Saint-Fiacre de Charleroi, trouvée en balade ; 211 chapelles
// de Wallonie sans fiche). Cf. tests/scout_query.test.js.

// Bâtiments religieux moissonnés même sans `amenity=place_of_worship` (chapelles
// de quartier, églises tracées depuis le cadastre). Chacun doit être classé par
// getHwCategory — et inversement, tout `building` qu'il classe doit figurer ici.
export const SCOUT_RELIGIOUS_BUILDINGS = ['mosque', 'church', 'cathedral', 'chapel', 'synagogue'];

export function buildQuery(b, cats) {
    const bb = `(${b.south},${b.west},${b.north},${b.east})`;
    const c = [];
    if (cats.has('religion')) {
        c.push(`nwr["amenity"="place_of_worship"]${bb};`);
        c.push(`nwr["building"~"^(${SCOUT_RELIGIOUS_BUILDINGS.join('|')})$"]${bb};`);
    }
    // P1 Niveau 1 : « Patrimoine historique » élargi (ouvrages défensifs, sites
    // funéraires, palais/monastères/aqueducs…) + patrimoine technique (`man_made`).
    if (cats.has('history')) {
        c.push(`nwr["historic"~"fort|castle|fortress|citadel|city_gate|citywalls|bastion|tower|archaeological_site|ruins|tomb|tumulus|mausoleum|monument|memorial|aqueduct|monastery|palace|manor|wayside_shrine|heritage"]${bb};`);
        c.push(`nwr["man_made"~"lighthouse|windmill|watermill|water_well"]${bb};`);
    }
    // « Musées & culture » : musées + artisanat traditionnel (poterie/tissage).
    if (cats.has('museum')) { c.push(`nwr["tourism"="museum"]${bb};`); c.push(`nwr["craft"~"pottery|weaving"]${bb};`); c.push(`nwr["shop"="pottery"]${bb};`); }
    if (cats.has('hotel')) c.push(`nwr["tourism"~"hotel|guest_house|hostel"]${bb};`);
    if (cats.has('restaurant')) c.push(`nwr["amenity"~"restaurant|cafe"]${bb};`);
    // « Tourisme & loisirs » = ex « Tourisme / Art » + ex « Loisirs / Parcs » fusionnés.
    if (cats.has('tourism')) { c.push(`nwr["tourism"~"viewpoint|artwork|attraction|gallery|theme_park|zoo|aquarium"]${bb};`); c.push(`nwr["leisure"~"park|water_park"]${bb};`); }
    if (cats.has('public')) c.push(`nwr["amenity"~"townhall|police|post_office|library"]${bb};`);
    return `[out:json][timeout:60];(${c.join('')});out center;`;
}
