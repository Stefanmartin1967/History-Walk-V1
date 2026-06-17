import { describe, it, expect, beforeEach, vi } from 'vitest';

// Dégel de Zone — completeDestinationZones() ne fait plus QUE compléter le FICHIER de
// quartiers (fetch OSM bbox réelle des POIs + merge dedup + persistance/retour pour
// push). Elle ne mute AUCUN POI : la Zone se dérive à la volée ailleurs (getDerivedZone).
// On mocke réseau / data / local-destinations ; zones.js est réel (binding live + cache).

const { sharedState, fetchZonesAutoMock, saveDraftZonesMock, applyFiltersMock } = vi.hoisted(() => ({
    sharedState: { currentMapId: 'testdest', destinations: { maps: {} }, loadedFeatures: [] },
    fetchZonesAutoMock: vi.fn(),
    saveDraftZonesMock: vi.fn(),
    applyFiltersMock: vi.fn(),
}));

vi.mock('../src/state.js', () => ({ state: sharedState }));
vi.mock('../src/osm-zones.js', () => ({ fetchZonesAuto: fetchZonesAutoMock }));
vi.mock('../src/data.js', () => ({ applyFilters: applyFiltersMock }));
vi.mock('../src/local-destinations.js', () => ({ saveDraftZones: saveDraftZonesMock }));

import { completeDestinationZones } from '../src/recalc-zones.js';
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
