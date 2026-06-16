import { describe, it, expect, beforeEach, vi } from 'vitest';

// PR C du chantier re-zonage — test cœur de recalcActiveDestinationZones.
// Stratégie : on laisse tourner le VRAI getZoneFromCoords / zones.js (live binding
// partagé avec utils.js) pour exercer le vrai point-dans-polygone + le vrai merge ;
// on ne mocke que le réseau (fetchZonesAuto), la DB, le bus et la persistance locale.

const { sharedState, dbMocks, eventMock, fetchZonesAutoMock, saveDraftZonesMock, applyFiltersMock } = vi.hoisted(() => ({
    sharedState: {
        currentMapId: 'testdest',
        destinations: { maps: {} },
        loadedFeatures: [],
        customFeatures: [],
        userData: {},
    },
    dbMocks: { savePoiData: vi.fn(), saveAppState: vi.fn() },
    eventMock: { emit: vi.fn() },
    fetchZonesAutoMock: vi.fn(),
    saveDraftZonesMock: vi.fn(),
    applyFiltersMock: vi.fn(),
}));

vi.mock('../src/state.js', () => ({ state: sharedState }));
vi.mock('../src/osm-zones.js', () => ({ fetchZonesAuto: fetchZonesAutoMock }));
vi.mock('../src/data.js', () => ({ applyFilters: applyFiltersMock }));
vi.mock('../src/database.js', () => ({ savePoiData: dbMocks.savePoiData, saveAppState: dbMocks.saveAppState }));
vi.mock('../src/events.js', () => ({ eventBus: eventMock }));
vi.mock('../src/local-destinations.js', () => ({ saveDraftZones: saveDraftZonesMock }));

import { recalcActiveDestinationZones } from '../src/recalc-zones.js';
import { setZonesData } from '../src/zones.js';

// Carrés simples (anneaux [lng,lat]) — ZoneA et ZoneB disjoints.
const ZONE_A = {
    type: 'Feature',
    properties: { name: 'ZoneA', osm_id: 1, admin_level: '6' },
    geometry: { type: 'Polygon', coordinates: [[[10.45, 36.25], [10.55, 36.25], [10.55, 36.35], [10.45, 36.35], [10.45, 36.25]]] },
};
const ZONE_B = {
    type: 'Feature',
    properties: { name: 'ZoneB', osm_id: 2, admin_level: '6' },
    geometry: { type: 'Polygon', coordinates: [[[10.75, 36.50], [10.85, 36.50], [10.85, 36.60], [10.75, 36.60], [10.75, 36.50]]] },
};
const IN_A = [10.50, 36.30]; // [lng, lat] au centre de ZoneA
const IN_B = [10.80, 36.55]; // au centre de ZoneB

function poi(id, coords, props = {}) {
    return { type: 'Feature', properties: { HW_ID: id, ...props }, geometry: { type: 'Point', coordinates: coords } };
}

describe('recalcActiveDestinationZones', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sharedState.currentMapId = 'testdest';
        sharedState.userData = {};
        sharedState.customFeatures = [];
        // Jeu de zones « trop serré » au départ : seulement ZoneA (live binding réel).
        setZonesData({ type: 'FeatureCollection', features: [structuredClone(ZONE_A)] });
        // Le fetch OSM ramène ZoneA (doublon osm_id) + ZoneB (manquante).
        fetchZonesAutoMock.mockResolvedValue({ type: 'FeatureCollection', features: [structuredClone(ZONE_A), structuredClone(ZONE_B)] });
    });

    it('merge dédupliqué, re-zone seulement les POIs changés, pousse côté appelant (dest GitHub)', async () => {
        sharedState.destinations.maps.testdest = { name: 'Test', country: 'tn', custom: false, status: 'draft' };
        const poi1 = poi('p1', IN_A, { Zone: 'ZoneA' });      // déjà correct → ne bouge pas
        const poi2 = poi('p2', IN_B, { Zone: 'Hors zone' });   // Hors zone → ZoneB (base/overlay)
        const poi3 = poi('p3', IN_B, {});                      // sans Zone → ZoneB (base/overlay)
        const poi4 = poi('p4', IN_A, { Zone: 'Hors zone' });   // Hors zone → ZoneA (custom)
        sharedState.loadedFeatures = [poi1, poi2, poi3, poi4];
        sharedState.customFeatures = [poi4];

        const res = await recalcActiveDestinationZones();

        // bbox passée au fetch = étendue réelle des POIs (+pad), couvre A et B.
        expect(fetchZonesAutoMock).toHaveBeenCalledTimes(1);
        const [bboxArg, countryArg] = fetchZonesAutoMock.mock.calls[0];
        expect(countryArg).toBe('tn');
        expect(bboxArg[0][0]).toBeLessThan(36.30); // south < plus bas POI
        expect(bboxArg[1][0]).toBeGreaterThan(36.55); // north > plus haut POI

        // Merge dédupliqué : ZoneB ajoutée, ZoneA pas dupliquée.
        expect(res.zonesAdded).toBe(1);
        expect(res.zonesTotal).toBe(2);

        // Re-zonage : p2, p3, p4 (pas p1).
        expect(res.rezoned).toBe(3);
        expect(res.horsZoneBefore).toBe(2);   // p2, p4
        expect(res.resolvedHorsZone).toBe(2); // p2, p4 ont retrouvé un quartier

        // POI de base → overlay userData + savePoiData ; POI déjà bon non touché.
        expect(sharedState.userData.p2.Zone).toBe('ZoneB');
        expect(sharedState.userData.p3.Zone).toBe('ZoneB');
        expect(sharedState.userData.p1).toBeUndefined();
        expect(dbMocks.savePoiData).toHaveBeenCalledTimes(2); // p2, p3 (pas p4 custom)

        // POI custom → properties + customPois (jamais userData).
        expect(poi4.properties.Zone).toBe('ZoneA');
        expect(sharedState.userData.p4).toBeUndefined();
        expect(dbMocks.saveAppState).toHaveBeenCalledWith('customPois_testdest', sharedState.customFeatures);

        // 1 event par POI re-zoné, 1 seul applyFilters.
        expect(eventMock.emit).toHaveBeenCalledTimes(3);
        expect(applyFiltersMock).toHaveBeenCalledTimes(1);

        // dest GitHub (custom:false) → PAS de saveDraftZones ; zones renvoyées pour le push.
        expect(saveDraftZonesMock).not.toHaveBeenCalled();
        expect(res.isLocalDraft).toBe(false);
        expect(res.zones.features).toHaveLength(2);
    });

    it('idempotent : un 2e recalcul sans changement ne re-zone rien', async () => {
        sharedState.destinations.maps.testdest = { name: 'Test', country: 'tn', custom: false };
        const p = poi('p1', IN_B, { Zone: 'ZoneB' }); // déjà correct après merge
        sharedState.loadedFeatures = [p];

        const res = await recalcActiveDestinationZones();

        expect(res.rezoned).toBe(0);
        expect(eventMock.emit).not.toHaveBeenCalled();
        expect(dbMocks.savePoiData).not.toHaveBeenCalled();
        expect(applyFiltersMock).toHaveBeenCalledTimes(1); // refresh quand même
    });

    it('brouillon LOCAL → persiste les zones en IndexedDB (saveDraftZones)', async () => {
        sharedState.destinations.maps.testdest = { name: 'Test', country: 'tn', custom: true };
        sharedState.loadedFeatures = [poi('p1', IN_B, { Zone: 'Hors zone' })];

        const res = await recalcActiveDestinationZones();

        expect(res.isLocalDraft).toBe(true);
        expect(saveDraftZonesMock).toHaveBeenCalledTimes(1);
        expect(saveDraftZonesMock).toHaveBeenCalledWith('testdest', res.zones);
    });

    it('garde-fous : pas de destination active / pas de lieux → throw', async () => {
        sharedState.destinations.maps = {};
        await expect(recalcActiveDestinationZones()).rejects.toThrow(/destination active/i);

        sharedState.destinations.maps.testdest = { name: 'Test', country: 'tn', custom: false };
        sharedState.loadedFeatures = [];
        await expect(recalcActiveDestinationZones()).rejects.toThrow(/aucun lieu/i);
    });
});
