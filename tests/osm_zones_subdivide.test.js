import { describe, it, expect, beforeEach, vi } from 'vitest';

// Subdiviser un quartier (29/10/2026) — partie OSM : requête des sous-zones,
// filtre des voisines, repli de niveau, et fonctions pures de remplacement/dédup.

const { fetchOverpassJsonMock } = vi.hoisted(() => ({ fetchOverpassJsonMock: vi.fn() }));
vi.mock('../src/osm-overpass.js', () => ({ fetchOverpassJson: fetchOverpassJsonMock }));

import { fetchSubZones, replaceZoneWithSubZones, coveredZoneIds } from '../src/osm-zones.js';

// Relation admin OSM (`out geom`) : un carré en un seul way « outer ».
function relation(id, name, level, [x0, y0, x1, y1]) {
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([lon, lat]) => ({ lon, lat }));
    return {
        type: 'relation', id,
        tags: { name, admin_level: String(level), boundary: 'administrative' },
        members: [{ type: 'way', role: 'outer', geometry: pts }],
    };
}
const square = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const PARENT = { type: 'Feature', properties: { name: 'Charleroi', osm_id: 8, admin_level: '8' }, geometry: square(4, 50, 5, 51) };

describe('fetchSubZones', () => {
    beforeEach(() => { fetchOverpassJsonMock.mockReset(); });

    it('demande le niveau juste en dessous DANS la zone parente, marque parent_osm_id', async () => {
        fetchOverpassJsonMock.mockResolvedValue({ elements: [
            relation(91, 'Marcinelle', 9, [4, 50, 4.5, 51]),
            relation(92, 'Gilly', 9, [4.5, 50, 5, 51]),
        ] });

        const subs = await fetchSubZones(PARENT);

        const query = fetchOverpassJsonMock.mock.calls[0][0];
        expect(query).toContain('rel(8);map_to_area');
        expect(query).toContain('"admin_level"="9"');
        expect(subs.map(f => f.properties.name)).toEqual(['Marcinelle', 'Gilly']);
        expect(subs.every(f => f.properties.parent_osm_id === 8)).toBe(true);
    });

    it('écarte une voisine qui ne fait que toucher la limite', async () => {
        fetchOverpassJsonMock.mockResolvedValue({ elements: [
            relation(91, 'Marcinelle', 9, [4, 50, 4.5, 51]),
            relation(92, 'Gilly', 9, [4.5, 50, 5, 51]),
            relation(93, 'Voisine', 9, [5, 50, 6, 51]), // collée à l'est, dehors
        ] });

        const subs = await fetchSubZones(PARENT);

        expect(subs.map(f => f.properties.name)).toEqual(['Marcinelle', 'Gilly']);
    });

    it('niveau suivant si le premier ne donne rien (pays qui saute un niveau)', async () => {
        fetchOverpassJsonMock
            .mockResolvedValueOnce({ elements: [] })
            .mockResolvedValueOnce({ elements: [
                relation(101, 'A', 10, [4, 50, 4.5, 51]),
                relation(102, 'B', 10, [4.5, 50, 5, 51]),
            ] });

        const subs = await fetchSubZones(PARENT);

        expect(fetchOverpassJsonMock.mock.calls[1][0]).toContain('"admin_level"="10"');
        expect(subs).toHaveLength(2);
    });

    it('une seule sous-zone n\'est pas une subdivision → []', async () => {
        fetchOverpassJsonMock.mockResolvedValue({ elements: [relation(91, 'Seule', 9, [4, 50, 5, 51])] });
        await expect(fetchSubZones(PARENT)).resolves.toEqual([]);
    });

    it('une erreur réseau REMONTE (action demandée par l\'admin)', async () => {
        fetchOverpassJsonMock.mockRejectedValue(new Error('HTTP 502'));
        await expect(fetchSubZones(PARENT)).rejects.toThrow('HTTP 502');
    });

    it('zone sans osm_id ou sans niveau → erreur, aucune requête', async () => {
        await expect(fetchSubZones({ properties: { name: 'X' } })).rejects.toThrow(/identifiant OSM/);
        expect(fetchOverpassJsonMock).not.toHaveBeenCalled();
    });
});

describe('replaceZoneWithSubZones / coveredZoneIds', () => {
    const z = (id, name, extra = {}) => ({ type: 'Feature', properties: { name, osm_id: id, ...extra }, geometry: square(0, 0, 1, 1) });

    it('remplace à sa place et ne duplique pas une sous-zone déjà présente', () => {
        const fc = { type: 'FeatureCollection', features: [z(1, 'Avant'), z(8, 'Charleroi'), z(92, 'Gilly'), z(2, 'Après')] };
        const out = replaceZoneWithSubZones(fc, 8, [z(91, 'Marcinelle'), z(92, 'Gilly')]);
        expect(out.features.map(f => f.properties.name)).toEqual(['Avant', 'Marcinelle', 'Gilly', 'Après']);
        expect(fc.features).toHaveLength(4); // entrée non mutée
    });

    it('zone absente → copie inchangée', () => {
        const fc = { type: 'FeatureCollection', features: [z(1, 'A')] };
        expect(replaceZoneWithSubZones(fc, 8, [z(91, 'M')]).features.map(f => f.properties.name)).toEqual(['A']);
    });

    it('coveredZoneIds : les zones ET les zones d\'origine subdivisées', () => {
        const fc = { type: 'FeatureCollection', features: [z(91, 'Marcinelle', { parent_osm_id: 8 }), z(9, 'Thuin')] };
        expect([...coveredZoneIds(fc)].sort((a, b) => a - b)).toEqual([8, 9, 91]);
    });
});
