// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================================
// zones-lighten.mjs — contours de quartiers allégés (plan validé par Stefan le
// 02/11/2026) : 5 m (Douglas-Peucker), 6 décimales, fichier sans indentation.
//
// Allégés UNE SEULE FOIS, à l'arrivée depuis OSM (osm-zones.js). L'écriture du
// fichier ne réallège pas : chaque « Compléter les quartiers » réécrit tout le
// fichier, et un second passage ferait glisser les anciens quartiers.
// ============================================================================

const h = vi.hoisted(() => ({ overpass: vi.fn() }));
vi.mock('../src/osm-overpass.js', () => ({ fetchOverpassJson: h.overpass }));
vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn(() => 'jeton'),
    uploadFileToGitHub: vi.fn(async () => ({ ok: true })),
    deleteFileFromGitHub: vi.fn(async () => ({ ok: true })),
    githubHttpError: vi.fn(async (r, action) => new Error(`${action} : HTTP ${r.status}`)),
}));
vi.mock('../src/database.js', () => ({ saveAppState: vi.fn(async () => {}) }));

import { lightenZones, zonesFileText } from '../src/zones-lighten.mjs';
import { fetchZonesAuto, fetchSubZones } from '../src/osm-zones.js';
import { pushDestinationZones, registerDraftDestinationOnGitHub } from '../src/publish-destination.js';
import { uploadFileToGitHub } from '../src/github-sync.js';

// À Charleroi (50,4° N) : 1 m ≈ 0,000009° de latitude.
const LAT = 50.4, LNG = 4.44;
const M = 1 / 110540;

// Carré de 1 km de côté, avec un point tous les 100 m le long du bord sud,
// dont un qui s'écarte de `bumpM` mètres vers le nord (14 points, fermé).
function square(bumpM, dx = 0) {
    const south = Array.from({ length: 11 }, (_, i) => [LNG + dx + i * 0.0014, LAT + (i === 5 ? bumpM * M : 0)]);
    return [...south, [LNG + dx + 0.014, LAT + 0.009], [LNG + dx, LAT + 0.009], [LNG + dx, LAT]];
}
const zone = (coordinates, type = 'Polygon') => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { name: 'Z', osm_id: 1 }, geometry: { type, coordinates } }],
});
const ringOf = (z) => z.features[0].geometry.coordinates[0];

describe('lightenZones', () => {
    it('retire les points alignés à moins de 5 m, garde un écart de plus de 5 m', () => {
        expect(ringOf(lightenZones(zone([square(2)])))).toHaveLength(5); // les 4 coins, fermé
        const kept = ringOf(lightenZones(zone([square(8)])));
        expect(kept.some(([, lat]) => Math.abs(lat - (LAT + 8 * M)) < 1e-6)).toBe(true);
    });

    it('arrondit à 6 décimales et garde l\'anneau fermé', () => {
        const ring = ringOf(lightenZones(zone([[[4.123456789, 50.987654321], [4.2, 50.9], [4.3, 51.0], [4.123456789, 50.987654321]]])));
        expect(ring[0]).toEqual([4.123457, 50.987654]);
        expect(ring[ring.length - 1]).toEqual(ring[0]);
    });

    it('garde tel quel un contour qui tomberait sous 4 points', () => {
        const thin = [[LNG, LAT], [LNG + 0.001, LAT], [LNG + 0.002, LAT + M], [LNG + 0.001, LAT + 2 * M], [LNG, LAT]];
        expect(ringOf(lightenZones(zone([thin])))).toHaveLength(5);
    });

    it('traite chaque morceau d\'un quartier en plusieurs morceaux, trous compris', () => {
        const out = lightenZones(zone([[square(2), square(2)], [square(2)]], 'MultiPolygon'));
        const g = out.features[0].geometry;
        expect(g.type).toBe('MultiPolygon');
        expect(g.coordinates.flat().map((r) => r.length)).toEqual([5, 5, 5]);
    });

    it('ne touche ni aux propriétés ni à l\'objet reçu', () => {
        const input = zone([square(2)]);
        const out = lightenZones(input);
        expect(out.features[0].properties).toEqual({ name: 'Z', osm_id: 1 });
        expect(ringOf(input)).toHaveLength(14);
    });

    it('collection vide ou absente : collection vide', () => {
        expect(lightenZones(undefined)).toEqual({ type: 'FeatureCollection', features: [] });
    });
});

describe('à l\'arrivée depuis OSM (osm-zones.js)', () => {
    // Relation admin OSM (`out geom`) : un seul way « outer ».
    const relation = (id, ring, extraTags = {}) => ({
        type: 'relation', id, tags: { name: `R${id}`, admin_level: '9', ...extraTags },
        members: [{ type: 'way', role: 'outer', geometry: ring.map(([lon, lat]) => ({ lon, lat })) }],
    });
    beforeEach(() => { h.overpass.mockReset(); });

    it('les quartiers d\'une zone géographique arrivent allégés', async () => {
        h.overpass.mockResolvedValue({ elements: [relation(91, square(2))] });
        const fc = await fetchZonesAuto([[50, 4], [51, 5]], 'be');
        expect(ringOf(fc)).toEqual(ringOf(lightenZones(zone([square(2)]))));
    });

    it('les sous-quartiers aussi, triés d\'abord sur leur forme brute', async () => {
        const parent = { type: 'Feature', properties: { name: 'P', osm_id: 8, admin_level: '8' },
            geometry: { type: 'Polygon', coordinates: [[[4, 50], [5, 50], [5, 51], [4, 51], [4, 50]]] } };
        h.overpass.mockResolvedValue({ elements: [relation(91, square(2)), relation(92, square(2, 0.02))] });
        const subs = await fetchSubZones(parent);
        expect(subs.map((f) => f.geometry.coordinates[0].length)).toEqual([5, 5]);
        expect(subs.every((f) => f.properties.parent_osm_id === 8)).toBe(true);
    });
});

describe('écriture du fichier', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const b64 = btoa(JSON.stringify({ maps: {} }));
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ content: b64 }) })));
    });

    const pushedZones = async (path) => {
        const call = uploadFileToGitHub.mock.calls.find((c) => c[4] === path);
        return call[0].text();
    };

    it('zonesFileText : sans indentation, retour à la ligne final, contours inchangés', () => {
        const text = zonesFileText(zone([square(2)]));
        expect(text.endsWith('}\n')).toBe(true);
        expect(text.trimEnd()).not.toContain('\n');
        expect(ringOf(JSON.parse(text))).toHaveLength(14);
    });

    it('« Compléter les quartiers » / « Subdiviser » / Scout (pushDestinationZones) : compact, pas réallégé', async () => {
        await pushDestinationZones('charleroi', zone([square(2)]));
        expect(await pushedZones('public/charleroi-zones.geojson')).toBe(zonesFileText(zone([square(2)])));
    });

    it('création d\'une destination : compact, pas réallégé', async () => {
        await registerDraftDestinationOnGitHub('mons', { bounds: [[50, 3], [51, 4]], startView: {} }, zone([square(2)]));
        expect(await pushedZones('public/mons-zones.geojson')).toBe(zonesFileText(zone([square(2)])));
    });
});

describe('fichiers publiés', () => {
    it.each(['djerba', 'hammamet', 'charleroi'])('%s-zones.geojson : compact, 6 décimales au plus', (dest) => {
        const text = readFileSync(resolve(__dirname, '..', 'public', `${dest}-zones.geojson`), 'utf8');
        // trimEnd : sous Windows (autocrlf), la copie de travail finit par CRLF.
        expect(text.trimEnd()).toBe(zonesFileText(JSON.parse(text)).trimEnd());
        expect(text).not.toMatch(/\d\.\d{7}/);
    });
});
