import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Destination à TERRITOIRE (plan validé par Stefan le 02/11/2026, la Wallonie) :
// `territoryOsmId` dans destinations.json. Les quartiers sont les communes du
// territoire (« Compléter les quartiers »), ceux d'en dehors sont retirés, et le
// Scout ne capture que ce qui tombe dans un quartier.
// ============================================================================

const h = vi.hoisted(() => ({
    overpass: vi.fn(),
    state: { currentMapId: 'charleroi', destinations: { maps: {} }, loadedFeatures: [] },
}));
vi.mock('../src/osm-overpass.js', () => ({ fetchOverpassJson: h.overpass }));
vi.mock('../src/state.js', () => ({ state: h.state }));
vi.mock('../src/data.js', () => ({ applyFilters: vi.fn() }));
vi.mock('../src/local-destinations.js', () => ({ saveDraftZones: vi.fn() }));

import { fetchTerritoryZones } from '../src/osm-zones.js';
import { completeDestinationZones } from '../src/recalc-zones.js';
import { hasTerritory, inTerritory, zonesExtent } from '../src/scout-territory.js';
import { setZonesData, zonesData } from '../src/zones.js';

const WALLONIE = 90348;
const ring = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
// Relation admin OSM (`out geom`) : un carré en un seul way « outer ».
const relation = (id, name, level, box) => ({
    type: 'relation', id, tags: { name, admin_level: String(level), boundary: 'administrative' },
    members: [{ type: 'way', role: 'outer', geometry: ring(box).map(([lon, lat]) => ({ lon, lat })) }],
});
const zone = (id, name, box, extra = {}) => ({
    type: 'Feature', properties: { name, osm_id: id, admin_level: '8', ...extra },
    geometry: { type: 'Polygon', coordinates: [ring(box)] },
});

// Territoire : 4..6 E, 50..51 N. Deux communes dedans, une voisine qui touche la limite.
const TERRITORY = relation(WALLONIE, 'Wallonie', 4, [4, 50, 6, 51]);
const THUIN = relation(81, 'Thuin', 8, [4, 50, 5, 51]);
const NAMUR = relation(82, 'Namur', 8, [5, 50, 6, 51]);
const MAUBEUGE = relation(83, 'Maubeuge', 8, [3, 50, 4, 51]); // à l'ouest, touche la limite

describe('fetchTerritoryZones', () => {
    beforeEach(() => { h.overpass.mockReset(); });

    it('demande les communes DANS la relation du territoire, et la relation elle-même', async () => {
        h.overpass.mockResolvedValue({ elements: [TERRITORY, THUIN, NAMUR] });
        await fetchTerritoryZones(WALLONIE, 'be');
        const [query, options] = h.overpass.mock.calls[0];
        expect(query).toContain(`rel(${WALLONIE})->.t;.t out geom;.t map_to_area->.p;`);
        expect(query).toContain('"admin_level"="8"](area.p)');
        expect(options.timeoutMs).toBeGreaterThanOrEqual(120000); // Wallonie : 45 s mesurées
    });

    it('garde les communes du territoire, écarte la voisine et le territoire lui-même', async () => {
        h.overpass.mockResolvedValue({ elements: [TERRITORY, THUIN, NAMUR, MAUBEUGE] });
        const fc = await fetchTerritoryZones(WALLONIE, 'be');
        expect(fc.features.map((f) => f.properties.name)).toEqual(['Thuin', 'Namur']);
    });

    it('niveau suivant si le premier ne donne rien', async () => {
        h.overpass
            .mockResolvedValueOnce({ elements: [TERRITORY] })
            .mockResolvedValueOnce({ elements: [TERRITORY, relation(61, 'Hainaut', 6, [4, 50, 5, 51])] });
        const fc = await fetchTerritoryZones(WALLONIE, 'be');
        expect(h.overpass.mock.calls[1][0]).toContain('"admin_level"="6"');
        expect(fc.features.map((f) => f.properties.name)).toEqual(['Hainaut']);
    });

    it('territoire absent de la réponse, identifiant invalide, erreur réseau : erreur', async () => {
        h.overpass.mockResolvedValue({ elements: [THUIN] });
        await expect(fetchTerritoryZones(WALLONIE, 'be')).rejects.toThrow(/introuvable/);
        await expect(fetchTerritoryZones('abc', 'be')).rejects.toThrow(/invalide/);
        h.overpass.mockRejectedValue(new Error('HTTP 504'));
        await expect(fetchTerritoryZones(WALLONIE, 'be')).rejects.toThrow('HTTP 504');
    });
});

describe('« Compléter les quartiers » avec un territoire', () => {
    beforeEach(() => {
        h.overpass.mockReset();
        h.state.destinations.maps.charleroi = { name: 'Wallonie', country: 'be', territoryOsmId: WALLONIE };
        h.state.loadedFeatures = [];
        h.overpass.mockResolvedValue({ elements: [TERRITORY, THUIN, NAMUR] });
    });

    it('ajoute les communes manquantes, retire les quartiers hors territoire, garde les subdivisions', async () => {
        setZonesData({ type: 'FeatureCollection', features: [
            zone(81, 'Thuin', [4, 50, 5, 51]),
            zone(91, 'Marcinelle', [5, 50, 5.5, 51], { admin_level: '9', parent_osm_id: 82 }), // Namur subdivisée
            zone(83, 'Maubeuge', [3, 50, 4, 51]),
        ] });

        const res = await completeDestinationZones();

        expect(zonesData.features.map((f) => f.properties.name)).toEqual(['Thuin', 'Marcinelle']);
        expect(res).toMatchObject({ zonesAdded: 0, zonesRemoved: 1, zonesTotal: 2 });
    });

    it('ne demande pas de lieux chargés (les quartiers viennent du territoire)', async () => {
        setZonesData({ type: 'FeatureCollection', features: [] });
        const res = await completeDestinationZones();
        expect(res).toMatchObject({ zonesAdded: 2, zonesRemoved: 0, zonesTotal: 2 });
    });

    it('OSM ne renvoie aucune commune : erreur, quartiers inchangés', async () => {
        h.overpass.mockResolvedValue({ elements: [TERRITORY] });
        const before = { type: 'FeatureCollection', features: [zone(81, 'Thuin', [4, 50, 5, 51])] };
        setZonesData(before);
        await expect(completeDestinationZones()).rejects.toThrow(/aucun quartier/);
        expect(zonesData).toBe(before);
    });
});

describe('scout-territory', () => {
    it('hasTerritory : seulement avec territoryOsmId', () => {
        expect(hasTerritory({ territoryOsmId: WALLONIE })).toBe(true);
        expect(hasTerritory({ name: 'Djerba' })).toBe(false);
        expect(hasTerritory(undefined)).toBe(false);
    });

    it('inTerritory : dans un quartier oui ; hors quartier ou quartiers absents, non', () => {
        setZonesData({ type: 'FeatureCollection', features: [zone(81, 'Thuin', [4, 50, 5, 51])] });
        expect(inTerritory(50.5, 4.5)).toBe(true);
        expect(inTerritory(50.5, 3.5)).toBe(false);
        setZonesData({ type: 'FeatureCollection', features: [] });
        expect(inTerritory(50.5, 4.5)).toBe(false);
    });

    it('zonesExtent : étendue des quartiers, morceaux compris ; null sans quartier', () => {
        const multi = { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[ring([2.8, 50.7, 3.0, 50.8])], [ring([4, 49.5, 6.4, 50.8])]] } };
        expect(zonesExtent({ features: [zone(81, 'Thuin', [4, 50, 5, 51]), multi] })).toEqual([[49.5, 2.8], [51, 6.4]]);
        expect(zonesExtent({ features: [] })).toBeNull();
    });
});
