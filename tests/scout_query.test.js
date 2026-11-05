// Requête de moisson du Scout ↔ classement des tags (getHwCategory).
// Cas fondateur (05/11/2026) : `building=chapel` était classé « Chapelle » mais
// jamais demandé à Overpass — la Chapelle Saint-Fiacre de Charleroi (way/1167106081,
// building=chapel + name, sans amenity) n'a été trouvée qu'en balade. 211 chapelles
// de Wallonie étaient dans ce cas. `building=cathedral` avait le même trou.
import { describe, it, expect } from 'vitest';
import { buildQuery, SCOUT_RELIGIOUS_BUILDINGS } from '../src/scout-query.js';
import { getHwCategory } from '../src/scout-categories.js';

const BOX = { south: 50.405, west: 4.435, north: 50.413, east: 4.446 };

// Extrait la regex Overpass appliquée à `building` dans la requête « religion ».
function buildingRegex(query) {
    const m = query.match(/nwr\["building"~"([^"]+)"\]/);
    return m ? new RegExp(m[1]) : null;
}

describe('Scout — requête de moisson', () => {
    it('« Lieux de culte » moissonne les chapelles et les cathédrales, pas seulement les églises', () => {
        const re = buildingRegex(buildQuery(BOX, new Set(['religion'])));
        expect(re).not.toBeNull();
        for (const v of ['chapel', 'cathedral', 'church', 'mosque', 'synagogue']) expect(re.test(v), v).toBe(true);
    });

    it('la regex est ancrée : pas de valeur voisine attrapée par sous-chaîne', () => {
        const re = buildingRegex(buildQuery(BOX, new Set(['religion'])));
        expect(re.test('chapel_ruins')).toBe(false);
        expect(re.test('yes')).toBe(false);
    });

    it('chaque bâtiment religieux moissonné est classé par getHwCategory', () => {
        for (const v of SCOUT_RELIGIOUS_BUILDINGS) {
            expect(getHwCategory({ building: v }), v).not.toBeNull();
        }
    });

    it('la Chapelle Saint-Fiacre (building=chapel sans amenity) devient un candidat « Chapelle »', () => {
        const tags = { building: 'chapel', name: 'Chapelle Saint Fiacre' };
        expect(buildingRegex(buildQuery(BOX, new Set(['religion']))).test(tags.building)).toBe(true);
        expect(getHwCategory(tags)).toBe('Chapelle');
    });

    it('sans la case « Lieux de culte », aucun bâtiment religieux n\'est demandé', () => {
        expect(buildQuery(BOX, new Set(['history']))).not.toContain('"building"');
    });
});
