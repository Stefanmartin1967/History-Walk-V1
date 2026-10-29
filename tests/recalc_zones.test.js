import { describe, it, expect, beforeEach, vi } from 'vitest';

// Dégel de Zone — completeDestinationZones() ne fait plus QUE compléter le FICHIER de
// quartiers (fetch OSM bbox réelle des POIs + merge dedup + persistance/retour pour
// push). Elle ne mute AUCUN POI : la Zone se dérive à la volée ailleurs (getDerivedZone).
// On mocke réseau / data / local-destinations ; zones.js est réel (binding live + cache).

const { sharedState, fetchZonesAutoMock, fetchSubZonesMock, saveDraftZonesMock, applyFiltersMock } = vi.hoisted(() => ({
    sharedState: { currentMapId: 'testdest', destinations: { maps: {} }, loadedFeatures: [] },
    fetchZonesAutoMock: vi.fn(),
    fetchSubZonesMock: vi.fn(),
    saveDraftZonesMock: vi.fn(),
    applyFiltersMock: vi.fn(),
}));

vi.mock('../src/state.js', () => ({ state: sharedState }));
// Réseau mocké ; les fonctions pures (remplacement, dédup) restent réelles.
vi.mock('../src/osm-zones.js', async (importOriginal) => ({
    ...(await importOriginal()),
    fetchZonesAuto: fetchZonesAutoMock,
    fetchSubZones: fetchSubZonesMock,
}));
vi.mock('../src/data.js', () => ({ applyFilters: applyFiltersMock }));
vi.mock('../src/local-destinations.js', () => ({ saveDraftZones: saveDraftZonesMock }));

import { completeDestinationZones, subdivideZone, zonesWithCounts, restoreZones } from '../src/recalc-zones.js';
import { setZonesData, zonesData } from '../src/zones.js';

const ZONE_A = { type: 'Feature', properties: { name: 'ZoneA', osm_id: 1 }, geometry: { type: 'Polygon', coordinates: [[[10, 36], [11, 36], [11, 37], [10, 37], [10, 36]]] } };
const ZONE_B = { type: 'Feature', properties: { name: 'ZoneB', osm_id: 2 }, geometry: { type: 'Polygon', coordinates: [[[11, 37], [12, 37], [12, 38], [11, 38], [11, 37]]] } };

function poi(id, coords) {
    return { type: 'Feature', properties: { HW_ID: id, Zone: 'Hors zone' }, geometry: { type: 'Point', coordinates: coords } };
}

describe('completeDestinationZones (dégel de Zone)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sharedState.currentMapId = 'testdest';
        // Jeu « trop serré » au départ : seulement ZoneA.
        setZonesData({ type: 'FeatureCollection', features: [structuredClone(ZONE_A)] });
        // Le fetch OSM ramène ZoneA (doublon) + ZoneB (manquante).
        fetchZonesAutoMock.mockResolvedValue({ type: 'FeatureCollection', features: [structuredClone(ZONE_A), structuredClone(ZONE_B)] });
    });

    it('merge dédupliqué, ne mute AUCUN POI, renvoie les zones pour le push (dest GitHub)', async () => {
        sharedState.destinations.maps.testdest = { name: 'Test', country: 'tn', custom: false };
        const p1 = poi('p1', [10.5, 36.5]);
        const p2 = poi('p2', [11.5, 37.5]);
        sharedState.loadedFeatures = [p1, p2];

        const res = await completeDestinationZones();

        // Fetch sur l'étendue réelle des POIs, pays propagé.
        expect(fetchZonesAutoMock).toHaveBeenCalledTimes(1);
        expect(fetchZonesAutoMock.mock.calls[0][1]).toBe('tn');

        // ZoneB ajoutée, ZoneA dédupliquée → 2 au total.
        expect(res.zonesAdded).toBe(1);
        expect(res.zonesTotal).toBe(2);
        expect(zonesData.features).toHaveLength(2);

        // AUCUN POI touché (dégel : la Zone n'est plus stockée/figée ici).
        expect(p1.properties.Zone).toBe('Hors zone');
        expect(p2.properties.Zone).toBe('Hors zone');
        expect(p1.properties.userData).toBeUndefined();
        expect(p2.properties.userData).toBeUndefined();

        // Dest GitHub → pas de saveDraftZones ; zones renvoyées pour pushDestinationZones.
        expect(saveDraftZonesMock).not.toHaveBeenCalled();
        expect(res.isLocalDraft).toBe(false);
        expect(res.zones.features).toHaveLength(2);

        // Un seul refresh.
        expect(applyFiltersMock).toHaveBeenCalledTimes(1);
    });

    it('brouillon LOCAL → persiste les zones (saveDraftZones)', async () => {
        sharedState.destinations.maps.testdest = { name: 'Test', country: 'tn', custom: true };
        sharedState.loadedFeatures = [poi('p1', [11.5, 37.5])];

        const res = await completeDestinationZones();

        expect(res.isLocalDraft).toBe(true);
        expect(saveDraftZonesMock).toHaveBeenCalledWith('testdest', res.zones);
    });

    it('garde-fous : pas de destination active / pas de lieux → throw', async () => {
        sharedState.destinations.maps = {};
        await expect(completeDestinationZones()).rejects.toThrow(/destination active/i);

        sharedState.destinations.maps.testdest = { name: 'Test', country: 'tn', custom: false };
        sharedState.loadedFeatures = [];
        await expect(completeDestinationZones()).rejects.toThrow(/aucun lieu/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Subdiviser un quartier (29/10/2026) — Charleroi : 124 lieux dans une seule commune.
describe('subdivideZone', () => {
    const square = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
    const PARENT = { type: 'Feature', properties: { name: 'Charleroi', osm_id: 8, admin_level: '8' }, geometry: square(4, 50, 5, 51) };
    const OTHER = { type: 'Feature', properties: { name: 'Thuin', osm_id: 9, admin_level: '8' }, geometry: square(5, 50, 6, 51) };
    const SUB_W = { type: 'Feature', properties: { name: 'Marcinelle', osm_id: 91, admin_level: '9', parent_osm_id: 8 }, geometry: square(4, 50, 4.5, 51) };
    const SUB_E = { type: 'Feature', properties: { name: 'Gilly', osm_id: 92, admin_level: '9', parent_osm_id: 8 }, geometry: square(4.5, 50, 5, 51) };

    beforeEach(() => {
        vi.clearAllMocks();
        sharedState.currentMapId = 'testdest';
        sharedState.destinations.maps.testdest = { name: 'Test', country: 'be', custom: false };
        sharedState.loadedFeatures = [poi('a', [4.2, 50.5]), poi('b', [4.7, 50.5]), poi('c', [4.8, 50.6]), poi('d', [5.5, 50.5])];
        setZonesData({ type: 'FeatureCollection', features: [structuredClone(PARENT), structuredClone(OTHER)] });
        fetchSubZonesMock.mockResolvedValue([structuredClone(SUB_W), structuredClone(SUB_E)]);
    });

    it('zonesWithCounts : quartiers triés du plus peuplé au moins peuplé', () => {
        expect(zonesWithCounts()).toEqual([
            { osmId: 8, name: 'Charleroi', count: 3 },
            { osmId: 9, name: 'Thuin', count: 1 },
        ]);
    });

    it('remplace la zone à sa place, ne touche pas les autres, re-dérive les lieux', async () => {
        const res = await subdivideZone(8);

        expect(zonesData.features.map(f => f.properties.name)).toEqual(['Marcinelle', 'Gilly', 'Thuin']);
        expect(res.parentName).toBe('Charleroi');
        expect(res.subNames).toEqual(['Marcinelle', 'Gilly']);
        expect(res.isLocalDraft).toBe(false);
        expect(saveDraftZonesMock).not.toHaveBeenCalled();
        expect(applyFiltersMock).toHaveBeenCalledTimes(1);
        expect(zonesWithCounts().map(z => [z.name, z.count])).toEqual([['Gilly', 2], ['Marcinelle', 1], ['Thuin', 1]]);
    });

    it('brouillon LOCAL → persiste le nouveau jeu', async () => {
        sharedState.destinations.maps.testdest.custom = true;
        const res = await subdivideZone(8);
        expect(saveDraftZonesMock).toHaveBeenCalledWith('testdest', res.zones);
    });

    it('OSM ne connaît pas de subdivision → erreur explicite, jeu inchangé', async () => {
        fetchSubZonesMock.mockResolvedValue([]);
        await expect(subdivideZone(8)).rejects.toThrow(/subdivision pour « Charleroi »/);
        expect(zonesData.features.map(f => f.properties.name)).toEqual(['Charleroi', 'Thuin']);
    });

    it('quartier inconnu → erreur, aucun appel réseau', async () => {
        await expect(subdivideZone(999)).rejects.toThrow(/introuvable/);
        expect(fetchSubZonesMock).not.toHaveBeenCalled();
    });

    it('restoreZones remet le jeu d\'avant (envoi GitHub échoué)', async () => {
        const res = await subdivideZone(8);
        restoreZones(res.previous);
        expect(zonesData.features.map(f => f.properties.name)).toEqual(['Charleroi', 'Thuin']);
    });

    it('« Compléter les quartiers » ne remet pas la commune subdivisée par-dessus', async () => {
        await subdivideZone(8);
        fetchZonesAutoMock.mockResolvedValue({ type: 'FeatureCollection', features: [structuredClone(PARENT), structuredClone(OTHER)] });

        const res = await completeDestinationZones();

        expect(res.zonesAdded).toBe(0);
        expect(zonesData.features.map(f => f.properties.name)).toEqual(['Marcinelle', 'Gilly', 'Thuin']);
    });
});
