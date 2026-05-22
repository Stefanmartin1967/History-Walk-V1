import { describe, it, expect, vi } from 'vitest';

// generateGPXString (gpx.js) construit le GPX exporté. On vérifie qu'en Cas B
// (pas de realTrack — le « vol d'oiseau » qu'on ouvre ensuite dans GPX Studio),
// les <trkpt> portent les coordonnées RÉELLES des POIs, et NON une position
// « snappée » sur la route.
//
// Régression du bug : l'ancien pré-snap OSRM (profil VOITURE) déplaçait chaque
// ancre sur la route carrossable la plus proche → pour un POI en retrait ou sur
// un sentier, l'ancre atterrissait à côté, et GPX Studio (qui s'ancre sur ces
// <trkpt>) routait en IGNORANT le POI. Désormais : <trkpt> = vraies coords POI.
//
// gpx.js importe beaucoup de modules « browser » → on les mocke tous.
vi.mock('../src/state.js', () => ({ state: {}, APP_VERSION: '0.0.0-test', addMyCircuit: vi.fn() }));
vi.mock('../src/data.js', () => ({ getPoiId: (f) => f?.properties?.HW_ID, getPoiName: (f) => f?.properties?.Nom || '' }));
vi.mock('../src/circuit.js', () => ({ loadCircuitById: vi.fn(), generateCircuitName: vi.fn() }));
vi.mock('../src/database.js', () => ({ getAppState: vi.fn(), saveCircuit: vi.fn() }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/utils.js', () => ({ downloadFile: vi.fn(), escapeXml: (s) => (s == null ? '' : String(s)), generateHWID: vi.fn() }));
vi.mock('../src/map.js', () => ({ updatePolylines: vi.fn() }));

import { generateGPXString } from '../src/gpx.js';

const poi = (id, lon, lat, nom) => ({ properties: { HW_ID: id, Nom: nom }, geometry: { coordinates: [lon, lat] } });

// Extrait les <trkpt lat=".." lon=".."> dans l'ordre → renvoie [[lon, lat], …].
function parseTrkpts(gpx) {
    return [...gpx.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)]
        .map(m => [parseFloat(m[2]), parseFloat(m[1])]);
}

describe('generateGPXString — Cas B (vol d\'oiseau) : <trkpt> = vraies coords POI', () => {
    it('écrit les trkpt aux coordonnées EXACTES des POIs (pas de snap routier)', () => {
        const circuit = [
            poi('A', 11.021607, 33.793757, 'Mosquée Sidi Abdelkader'),
            poi('B', 11.028802, 33.798111, 'Mosquée Khaled Ibn Elwalid'),
            poi('C', 11.033472, 33.787861, 'Mosquée Sidi Wahlan'),
        ];
        const gpx = generateGPXString(circuit, 'HW-X', 'Boucle test', 'desc'); // pas de realTrack

        expect(parseTrkpts(gpx)).toEqual([
            [11.021607, 33.793757],
            [11.028802, 33.798111],
            [11.033472, 33.787861],
        ]);
    });

    it('les <trkpt> coïncident avec les <wpt> (ancres pile sur les POIs)', () => {
        const circuit = [poi('A', 11.05, 33.80, 'A'), poi('B', 11.06, 33.81, 'B')];
        const gpx = generateGPXString(circuit, 'HW-X', 'C', 'd');

        const wpts = [...gpx.matchAll(/<wpt lat="([^"]+)" lon="([^"]+)"/g)]
            .map(m => [parseFloat(m[2]), parseFloat(m[1])]);
        expect(parseTrkpts(gpx)).toEqual(wpts);
    });

    it('Cas A (realTrack fourni) : <trkpt> = la trace réelle, pas les POIs', () => {
        const circuit = [poi('A', 11.0, 33.0, 'A'), poi('B', 11.1, 33.1, 'B')];
        const realTrack = [[33.0, 11.0], [33.05, 11.05], [33.1, 11.1]]; // [lat, lon]
        const gpx = generateGPXString(circuit, 'HW-X', 'C', 'd', realTrack);

        const trkpts = parseTrkpts(gpx);
        expect(trkpts).toEqual([[11.0, 33.0], [11.05, 33.05], [11.1, 33.1]]);
        expect(trkpts.length).toBe(3); // 3 points de trace ≠ 2 POIs → bien realTrack
    });
});
