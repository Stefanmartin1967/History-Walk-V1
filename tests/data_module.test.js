// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (hoisted par vitest) ---
vi.mock('../src/state.js', () => {
    const state = {
        currentMapId: 'djerba',
        loadedFeatures: [],
        customFeatures: [],
        userData: {},
        hiddenPoiIds: [],
        currentCircuit: [],
        activeCircuitId: null,
        isAdmin: false,
        isSelectionModeActive: false,
        activeFilters: {
            zone: null,
            categories: [],
            vus: false,
            planifies: false,
            nonVerifies: false
        },
        selectionModeFilters: { hideVisited: false, hidePlanned: false }
    };
    return {
        state,
        setCurrentMap: vi.fn(),
        setLoadedFeatures: vi.fn(arr => { state.loadedFeatures = arr; }),
        setCustomFeatures: vi.fn(arr => { state.customFeatures = arr; }),
        setHiddenPoiIds: vi.fn(arr => { state.hiddenPoiIds = arr; }),
        setUserData: vi.fn(d => { state.userData = d; })
    };
});

vi.mock('../src/events.js', () => ({
    eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() }
}));

vi.mock('../src/database.js', () => ({
    getAllPoiDataForMap: vi.fn(),
    getAllCircuitsForMap: vi.fn(),
    savePoiData: vi.fn(),
    getAppState: vi.fn(),
    saveAppState: vi.fn(),
    saveCircuit: vi.fn()
}));

vi.mock('../src/logger.js', () => ({
    logModification: vi.fn()
}));

vi.mock('../src/gist-sync.js', () => ({
    schedulePush: vi.fn()
}));

vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));

let _hwidCounter = 0;
vi.mock('../src/utils.js', () => ({
    getPoiId: vi.fn(f => f?.properties?.HW_ID || f?.id),
    getPoiName: vi.fn(f => f?.properties?.name || 'Unknown'),
    generateHWID: vi.fn(() => `HW-${String(++_hwidCounter).padStart(26, '0')}`),
    getZoneFromCoords: vi.fn(() => 'TestZone')
}));

vi.mock('../src/admin-control-center.js', () => ({
    addToDraft: vi.fn(),
    getMigrationId: vi.fn(),
    getAdminDraft: vi.fn(() => ({ pendingPois: {}, modifications: {} }))
}));

vi.mock('../src/url-utils.js', () => ({
    getDomainFromUrl: vi.fn()
}));

import { state } from '../src/state.js';
import { saveAppState } from '../src/database.js';
import { addToDraft } from '../src/admin-control-center.js';
import {
    recomputeVu,
    getFilteredFeatures,
    isPendingPoi,
    addPendingPoiFeature,
    commitPendingPoiIfNeeded,
    discardPendingPoi
} from '../src/data.js';

function poi(id, props = {}) {
    return {
        type: 'Feature',
        properties: { HW_ID: id, ...props },
        geometry: { type: 'Point', coordinates: [10, 35] }
    };
}

function resetState() {
    state.currentMapId = 'djerba';
    state.loadedFeatures = [];
    state.customFeatures = [];
    state.userData = {};
    state.hiddenPoiIds = [];
    state.currentCircuit = [];
    state.activeCircuitId = null;
    state.isAdmin = false;
    state.isSelectionModeActive = false;
    state.activeFilters = {
        zone: null,
        categories: [],
        vus: false,
        planifies: false,
        nonVerifies: false
    };
    state.selectionModeFilters = { hideVisited: false, hidePlanned: false };
    _hwidCounter = 0;
}

beforeEach(() => {
    resetState();
    vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('recomputeVu', () => {
    it('no-op si userData null/undefined (pas de throw)', () => {
        expect(() => recomputeVu(null)).not.toThrow();
        expect(() => recomputeVu(undefined)).not.toThrow();
    });

    it('vu = true si vuManual === true', () => {
        const ud = { vuManual: true };
        recomputeVu(ud);
        expect(ud.vu).toBe(true);
    });

    it('vu = true si visitedByCircuits a au moins une entrée', () => {
        const ud = { visitedByCircuits: ['c1'] };
        recomputeVu(ud);
        expect(ud.vu).toBe(true);
    });

    it('vu = false si ni vuManual ni visitedByCircuits', () => {
        const ud = {};
        recomputeVu(ud);
        expect(ud.vu).toBe(false);
    });

    it('vu = true si vuManual=true ET visitedByCircuits=[] (manual prime)', () => {
        const ud = { vuManual: true, visitedByCircuits: [] };
        recomputeVu(ud);
        expect(ud.vu).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('isPendingPoi', () => {
    it('retourne false si POI absent de loadedFeatures', () => {
        expect(isPendingPoi('unknown')).toBe(false);
    });

    it('retourne false si POI présent mais non pending', () => {
        state.loadedFeatures = [poi('p1')];
        expect(isPendingPoi('p1')).toBe(false);
    });

    it('retourne true si POI présent avec _pending=true', () => {
        state.loadedFeatures = [poi('p1', { _pending: true })];
        expect(isPendingPoi('p1')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getFilteredFeatures', () => {
    it('retourne [] si state.loadedFeatures absent', () => {
        state.loadedFeatures = null;
        expect(getFilteredFeatures()).toEqual([]);
    });

    it('exclut les POI dans hiddenPoiIds', () => {
        state.loadedFeatures = [poi('p1'), poi('p2')];
        state.hiddenPoiIds = ['p1'];
        const r = getFilteredFeatures();
        expect(r).toHaveLength(1);
        expect(r[0].properties.HW_ID).toBe('p2');
    });

    it('filtre par activeFilters.zone (Zone string match)', () => {
        state.loadedFeatures = [poi('p1', { Zone: 'A' }), poi('p2', { Zone: 'B' })];
        state.activeFilters.zone = 'A';
        const r = getFilteredFeatures();
        expect(r).toHaveLength(1);
        expect(r[0].properties.HW_ID).toBe('p1');
    });

    it('filtre par activeFilters.categories (multi-select array.includes)', () => {
        state.loadedFeatures = [
            poi('p1', { 'Catégorie': 'Hotel' }),
            poi('p2', { 'Catégorie': 'Plage' }),
            poi('p3', { 'Catégorie': 'Mosquée' })
        ];
        state.activeFilters.categories = ['Hotel', 'Mosquée'];
        const r = getFilteredFeatures();
        expect(r.map(f => f.properties.HW_ID).sort()).toEqual(['p1', 'p3']);
    });

    it('incontournable bypass tous les filtres user (sauf hidden/zone/cat)', () => {
        state.loadedFeatures = [poi('p1', { incontournable: true, userData: { vu: true } })];
        state.activeFilters.vus = true; // normalement filtrerait les vus
        const r = getFilteredFeatures();
        expect(r).toHaveLength(1);
    });

    it('POIs du circuit actif passent toujours (même si vus + filter actif)', () => {
        const p1 = poi('p1', { userData: { vu: true } });
        state.loadedFeatures = [p1];
        state.currentCircuit = [p1];
        state.activeCircuitId = 'c1';
        state.activeFilters.vus = true;
        const r = getFilteredFeatures();
        expect(r).toHaveLength(1);
    });

    it('mode standard : activeFilters.vus exclut les POIs vus', () => {
        state.loadedFeatures = [
            poi('p1', { userData: { vu: true } }),
            poi('p2', { userData: { vu: false } })
        ];
        state.activeFilters.vus = true;
        const r = getFilteredFeatures();
        expect(r.map(f => f.properties.HW_ID)).toEqual(['p2']);
    });

    it('mode standard : activeFilters.planifies exclut les POIs avec planifieCounter > 0', () => {
        state.loadedFeatures = [
            poi('p1', { userData: { planifieCounter: 2 } }),
            poi('p2', { userData: {} })
        ];
        state.activeFilters.planifies = true;
        const r = getFilteredFeatures();
        expect(r.map(f => f.properties.HW_ID)).toEqual(['p2']);
    });

    it('mode sélection : selectionModeFilters.hideVisited filtre indépendamment', () => {
        state.loadedFeatures = [
            poi('p1', { userData: { vu: true } }),
            poi('p2', { userData: { vu: false } })
        ];
        state.isSelectionModeActive = true;
        state.selectionModeFilters.hideVisited = true;
        const r = getFilteredFeatures();
        expect(r.map(f => f.properties.HW_ID)).toEqual(['p2']);
    });

    it('admin : activeFilters.nonVerifies exclut les POIs verified', () => {
        state.loadedFeatures = [
            poi('p1', { verified: true }),
            poi('p2', { verified: false }),
            poi('p3', {})
        ];
        state.activeFilters.nonVerifies = true;
        const r = getFilteredFeatures();
        expect(r.map(f => f.properties.HW_ID).sort()).toEqual(['p2', 'p3']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('addPendingPoiFeature', () => {
    it('génère un HW_ID si absent ou format invalide', () => {
        const f = { type: 'Feature', properties: {}, geometry: null };
        addPendingPoiFeature(f);
        expect(f.properties.HW_ID).toMatch(/^HW-/);
        expect(f.properties.HW_ID.length).toBe(29);
    });

    it('préserve un HW_ID valide existant', () => {
        const validId = 'HW-' + '1'.repeat(26);
        const f = poi(validId);
        addPendingPoiFeature(f);
        expect(f.properties.HW_ID).toBe(validId);
    });

    it('marque le feature avec _pending=true et l\'ajoute à loadedFeatures + customFeatures', () => {
        const f = { type: 'Feature', properties: {}, geometry: null };
        addPendingPoiFeature(f);
        expect(f.properties._pending).toBe(true);
        expect(state.loadedFeatures).toContain(f);
        expect(state.customFeatures).toContain(f);
    });

    it('initialise userData[id] et lie properties.userData', () => {
        const f = { type: 'Feature', properties: {}, geometry: null };
        addPendingPoiFeature(f);
        const id = f.properties.HW_ID;
        expect(state.userData[id]).toBeDefined();
        expect(f.properties.userData).toBe(state.userData[id]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('commitPendingPoiIfNeeded', () => {
    it('no-op si POI absent de loadedFeatures', async () => {
        await commitPendingPoiIfNeeded('unknown');
        expect(saveAppState).not.toHaveBeenCalled();
    });

    it('no-op si POI présent mais non pending', async () => {
        state.loadedFeatures = [poi('p1')];
        await commitPendingPoiIfNeeded('p1');
        expect(saveAppState).not.toHaveBeenCalled();
    });

    it('retire le flag _pending et persiste customPois + lastGeoJSON', async () => {
        const f = poi('p1', { _pending: true });
        state.loadedFeatures = [f];
        state.customFeatures = [f];

        await commitPendingPoiIfNeeded('p1');

        expect(f.properties._pending).toBeUndefined();
        expect(saveAppState).toHaveBeenCalledWith('customPois_djerba', state.customFeatures);
        expect(saveAppState).toHaveBeenCalledWith('lastGeoJSON', expect.objectContaining({
            type: 'FeatureCollection',
            features: expect.arrayContaining([f])
        }));
    });

    it('admin : addToDraft("poi", id, { type: "creation" }) si state.isAdmin', async () => {
        const f = poi('p1', { _pending: true });
        state.loadedFeatures = [f];
        state.isAdmin = true;

        await commitPendingPoiIfNeeded('p1');

        expect(addToDraft).toHaveBeenCalledWith('poi', 'p1', { type: 'creation' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('discardPendingPoi', () => {
    it('retire le POI pending de loadedFeatures', () => {
        const f = poi('p1', { _pending: true });
        state.loadedFeatures = [f, poi('p2')];
        discardPendingPoi('p1');
        expect(state.loadedFeatures.map(x => x.properties.HW_ID)).toEqual(['p2']);
    });

    it('retire le POI pending de customFeatures', () => {
        const f = poi('p1', { _pending: true });
        state.loadedFeatures = [f];
        state.customFeatures = [f];
        discardPendingPoi('p1');
        expect(state.customFeatures).toHaveLength(0);
    });

    it('cleanup userData[id] s\'il est vide', () => {
        const f = poi('p1', { _pending: true });
        state.loadedFeatures = [f];
        state.userData['p1'] = {}; // empty
        discardPendingPoi('p1');
        expect(state.userData['p1']).toBeUndefined();
    });

    it('préserve userData[id] s\'il contient des champs (pas de cleanup destructif)', () => {
        const f = poi('p1', { _pending: true });
        state.loadedFeatures = [f];
        state.userData['p1'] = { vuManual: true };
        discardPendingPoi('p1');
        expect(state.userData['p1']).toEqual({ vuManual: true });
    });
});
