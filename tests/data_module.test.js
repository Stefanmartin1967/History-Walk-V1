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
import { saveAppState, savePoiData } from '../src/database.js';
import { addToDraft } from '../src/admin-control-center.js';
import { schedulePush } from '../src/gist-sync.js';
import { showToast } from '../src/toast.js';
import { logModification } from '../src/logger.js';
import { eventBus } from '../src/events.js';
import { getZoneFromCoords } from '../src/utils.js';
import {
    recomputeVu,
    getFilteredFeatures,
    passesUserFilters,
    passesStructuralFilters,
    isPendingPoi,
    addPendingPoiFeature,
    commitPendingPoiIfNeeded,
    discardPendingPoi,
    updatePoiData,
    addPoiFeature,
    updatePoiCoordinates,
    deletePoi
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
describe('passesUserFilters', () => {
    it('retourne false pour feature null/undefined', () => {
        expect(passesUserFilters(null)).toBe(false);
        expect(passesUserFilters(undefined)).toBe(false);
    });

    it('out si POI dans hiddenPoiIds', () => {
        state.hiddenPoiIds = ['p1'];
        expect(passesUserFilters(poi('p1'))).toBe(false);
    });

    it('hidden bat incontournable (POI caché reste caché même incontournable)', () => {
        state.hiddenPoiIds = ['p1'];
        expect(passesUserFilters(poi('p1', { incontournable: true }))).toBe(false);
    });

    it('incontournable bypasse vus + planifies', () => {
        state.activeFilters.vus = true;
        state.activeFilters.planifies = true;
        const f = poi('p1', { incontournable: true, userData: { vu: true, planifieCounter: 5 } });
        expect(passesUserFilters(f)).toBe(true);
    });

    it('POI du circuit actif bypasse les filtres user', () => {
        const p1 = poi('p1', { userData: { vu: true } });
        state.loadedFeatures = [p1];
        state.currentCircuit = [p1];
        state.activeCircuitId = 'c1';
        state.activeFilters.vus = true;
        expect(passesUserFilters(p1)).toBe(true);
    });

    it('mode standard : vus=true exclut un POI vu (non incontournable)', () => {
        state.activeFilters.vus = true;
        expect(passesUserFilters(poi('p1', { userData: { vu: true } }))).toBe(false);
    });

    it('mode standard : planifies=true exclut planifieCounter > 0', () => {
        state.activeFilters.planifies = true;
        expect(passesUserFilters(poi('p1', { userData: { planifieCounter: 1 } }))).toBe(false);
    });

    it('mode sélection : utilise selectionModeFilters au lieu de activeFilters', () => {
        state.isSelectionModeActive = true;
        state.activeFilters.vus = false; // ignoré en mode sélection
        state.selectionModeFilters.hideVisited = true;
        expect(passesUserFilters(poi('p1', { userData: { vu: true } }))).toBe(false);
    });

    it('admin : nonVerifies=true exclut les POIs verified=true', () => {
        state.activeFilters.nonVerifies = true;
        expect(passesUserFilters(poi('p1', { verified: true }))).toBe(false);
        expect(passesUserFilters(poi('p2', { verified: false }))).toBe(true);
    });

    it('par défaut (aucun filtre actif) : POI passe', () => {
        expect(passesUserFilters(poi('p1'))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('passesStructuralFilters', () => {
    it('retourne false pour feature null/undefined', () => {
        expect(passesStructuralFilters(null)).toBe(false);
        expect(passesStructuralFilters(undefined)).toBe(false);
    });

    it('par défaut (aucun filtre) : POI passe', () => {
        expect(passesStructuralFilters(poi('p1', { Zone: 'A' }))).toBe(true);
    });

    it('filtre zone : POI hors zone exclu', () => {
        state.activeFilters.zone = 'A';
        expect(passesStructuralFilters(poi('p1', { Zone: 'B' }))).toBe(false);
        expect(passesStructuralFilters(poi('p2', { Zone: 'A' }))).toBe(true);
    });

    it('skipZone:true ignore le filtre zone', () => {
        state.activeFilters.zone = 'A';
        expect(passesStructuralFilters(poi('p1', { Zone: 'B' }), { skipZone: true })).toBe(true);
    });

    it('filtre catégorie multi : POI hors liste exclu', () => {
        state.activeFilters.categories = ['Mosquée', 'Plage'];
        expect(passesStructuralFilters(poi('p1', { 'Catégorie': 'Restaurant' }))).toBe(false);
        expect(passesStructuralFilters(poi('p2', { 'Catégorie': 'Mosquée' }))).toBe(true);
    });

    it('skipZone:true conserve le filtre catégorie', () => {
        state.activeFilters.zone = 'A';
        state.activeFilters.categories = ['Mosquée'];
        const f = poi('p1', { Zone: 'B', 'Catégorie': 'Restaurant' });
        // skipZone passe le filtre Zone, mais catégorie échoue toujours
        expect(passesStructuralFilters(f, { skipZone: true })).toBe(false);
    });

    it('categories=[] équivaut à pas de filtre catégorie', () => {
        state.activeFilters.categories = [];
        expect(passesStructuralFilters(poi('p1', { 'Catégorie': 'Restaurant' }))).toBe(true);
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

// ─────────────────────────────────────────────────────────────────────────────
describe('updatePoiData', () => {
    it('initialise userData[poiId] si absent', async () => {
        await updatePoiData('p1', 'notes', 'hello');
        expect(state.userData['p1']).toBeDefined();
        expect(state.userData['p1'].notes).toBe('hello');
    });

    it('cas key="vu" : écrit vuManual et recalcule vu (jamais directement vu)', async () => {
        await updatePoiData('p1', 'vu', true);
        expect(state.userData['p1'].vuManual).toBe(true);
        expect(state.userData['p1'].vu).toBe(true);
    });

    it('cas key="vu" : value=false écrit vuManual=false', async () => {
        state.userData['p1'] = { vuManual: true, vu: true, visitedByCircuits: [] };
        await updatePoiData('p1', 'vu', false);
        expect(state.userData['p1'].vuManual).toBe(false);
        expect(state.userData['p1'].vu).toBe(false);
    });

    it('cas key autre : écrit la valeur directement', async () => {
        await updatePoiData('p1', 'planifie', true);
        expect(state.userData['p1'].planifie).toBe(true);
    });

    it('sync feature.properties.userData après update', async () => {
        const f = poi('p1');
        state.loadedFeatures = [f];
        await updatePoiData('p1', 'notes', 'sync');
        expect(f.properties.userData).toBe(state.userData['p1']);
    });

    it('savePoiData + showToast "Enregistré" + schedulePush appelés', async () => {
        await updatePoiData('p1', 'notes', 'x');
        expect(savePoiData).toHaveBeenCalledWith('djerba', 'p1', state.userData['p1']);
        expect(showToast).toHaveBeenCalledWith('Enregistré', 'success', 1500);
        expect(schedulePush).toHaveBeenCalled();
    });

    it.each([
        ['Catégorie', 'Hotel'],
        ['Zone', 'Houmt Souk'],
        ['vu', true],
        ['vuManual', true],
        ['planifieCounter', 2],
        ['incontournable', true],
        ['verified', true],
    ])('emit data:filtered (via applyFilters) si key="%s" affecte les filtres', async (key, value) => {
        await updatePoiData('p1', key, value);
        expect(eventBus.emit).toHaveBeenCalledWith('data:filtered', expect.anything());
    });

    it.each([
        ['notes', 'x'],
        ['photos', []],
        ['planifie', true],
    ])('PAS d\'emit data:filtered si key="%s" n\'affecte pas les filtres', async (key, value) => {
        await updatePoiData('p1', key, value);
        expect(eventBus.emit).not.toHaveBeenCalledWith('data:filtered', expect.anything());
    });

    it('admin + key non-personal : addToDraft appelé', async () => {
        state.isAdmin = true;
        await updatePoiData('p1', 'Catégorie', 'Hotel');
        expect(addToDraft).toHaveBeenCalledWith('poi', 'p1', { key: 'Catégorie', value: 'Hotel' });
    });

    it('admin + key personal (vu/notes/planifie) : PAS de addToDraft', async () => {
        state.isAdmin = true;
        await updatePoiData('p1', 'vu', true);
        await updatePoiData('p1', 'notes', 'private');
        await updatePoiData('p1', 'planifieCounter', 3);
        expect(addToDraft).not.toHaveBeenCalled();
    });

    it('non-admin + key non-personal : PAS de addToDraft', async () => {
        state.isAdmin = false;
        await updatePoiData('p1', 'Catégorie', 'Hotel');
        expect(addToDraft).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('addPoiFeature', () => {
    it('génère un HW_ID si absent ou format invalide', async () => {
        const f = { type: 'Feature', properties: {}, geometry: null };
        await addPoiFeature(f);
        expect(f.properties.HW_ID).toMatch(/^HW-/);
        expect(f.properties.HW_ID.length).toBe(29);
    });

    it('préserve un HW_ID valide existant', async () => {
        const validId = 'HW-' + '1'.repeat(26);
        const f = poi(validId);
        await addPoiFeature(f);
        expect(f.properties.HW_ID).toBe(validId);
    });

    it('ajoute le feature à loadedFeatures + customFeatures sans flag _pending', async () => {
        const f = poi('HW-' + '2'.repeat(26));
        await addPoiFeature(f);
        expect(state.loadedFeatures).toContain(f);
        expect(state.customFeatures).toContain(f);
        expect(f.properties._pending).toBeUndefined();
    });

    it('persiste customPois immédiatement via saveAppState (vs addPendingPoiFeature qui ne persiste pas)', async () => {
        const f = poi('HW-' + '3'.repeat(26));
        await addPoiFeature(f);
        expect(saveAppState).toHaveBeenCalledWith('customPois_djerba', state.customFeatures);
    });

    it('admin : addToDraft creation appelé', async () => {
        state.isAdmin = true;
        const f = poi('HW-' + '4'.repeat(26));
        await addPoiFeature(f);
        expect(addToDraft).toHaveBeenCalledWith('poi', 'HW-' + '4'.repeat(26), { type: 'creation' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updatePoiCoordinates', () => {
    it('initialise userData[poiId] avec lat/lng', async () => {
        await updatePoiCoordinates('p1', 36.5, 10.7);
        expect(state.userData['p1'].lat).toBe(36.5);
        expect(state.userData['p1'].lng).toBe(10.7);
    });

    it('met à jour la geometry du feature ([lng, lat] order GeoJSON)', async () => {
        const f = poi('p1');
        state.loadedFeatures = [f];
        await updatePoiCoordinates('p1', 36.5, 10.7);
        expect(f.geometry.coordinates).toEqual([10.7, 36.5]);
    });

    it('recalcule la Zone via getZoneFromCoords et la met sur properties.Zone', async () => {
        const f = poi('p1');
        state.loadedFeatures = [f];
        getZoneFromCoords.mockReturnValueOnce('NewZone');
        await updatePoiCoordinates('p1', 36.5, 10.7);
        expect(getZoneFromCoords).toHaveBeenCalledWith(36.5, 10.7);
        expect(f.properties.Zone).toBe('NewZone');
    });

    it('met à jour customFeatures et persiste customPois si POI custom', async () => {
        const f = poi('p1');
        state.loadedFeatures = [f];
        state.customFeatures = [f];
        await updatePoiCoordinates('p1', 36.5, 10.7);
        expect(state.customFeatures[0].geometry.coordinates).toEqual([10.7, 36.5]);
        expect(saveAppState).toHaveBeenCalledWith('customPois_djerba', state.customFeatures);
    });

    it('savePoiData + logModification appelés systématiquement', async () => {
        await updatePoiCoordinates('p1', 36.5, 10.7);
        expect(savePoiData).toHaveBeenCalledWith('djerba', 'p1', state.userData['p1']);
        expect(logModification).toHaveBeenCalledWith(
            'p1',
            'Deplacement',
            'All',
            null,
            expect.stringContaining('36.50000')
        );
    });

    it('admin : addToDraft coords avec originalLat/Lng capturés AVANT mutation', async () => {
        const f = poi('p1');
        f.geometry.coordinates = [9.0, 33.0]; // [lng, lat] initial
        state.loadedFeatures = [f];
        state.isAdmin = true;

        await updatePoiCoordinates('p1', 36.5, 10.7);

        expect(addToDraft).toHaveBeenCalledWith('poi', 'p1', {
            type: 'coords',
            lat: 36.5,
            lng: 10.7,
            originalLat: 33.0,
            originalLng: 9.0
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deletePoi', () => {
    it('initialise hiddenPoiIds si absent et y ajoute le poiId', async () => {
        state.hiddenPoiIds = null;
        await deletePoi('p1');
        expect(state.hiddenPoiIds).toContain('p1');
    });

    it('persiste hiddenPois via saveAppState', async () => {
        await deletePoi('p1');
        expect(saveAppState).toHaveBeenCalledWith('hiddenPois_djerba', state.hiddenPoiIds);
    });

    it('évite le doublon dans hiddenPoiIds', async () => {
        state.hiddenPoiIds = ['p1'];
        await deletePoi('p1');
        const occurrences = state.hiddenPoiIds.filter(id => id === 'p1').length;
        expect(occurrences).toBe(1);
    });

    it('retire de customFeatures + persiste customPois si POI custom', async () => {
        const f = poi('p1');
        state.customFeatures = [f, poi('p2')];
        await deletePoi('p1');
        expect(state.customFeatures.map(x => x.properties.HW_ID)).toEqual(['p2']);
        expect(saveAppState).toHaveBeenCalledWith('customPois_djerba', state.customFeatures);
    });

    it('admin : addToDraft delete + flag _deleted sur properties.userData', async () => {
        const f = poi('p1');
        state.loadedFeatures = [f];
        state.isAdmin = true;

        await deletePoi('p1');

        expect(addToDraft).toHaveBeenCalledWith('poi', 'p1', { type: 'delete' });
        expect(f.properties.userData._deleted).toBe(true);
    });

    it('emit data:filtered (via applyFilters) après suppression', async () => {
        await deletePoi('p1');
        expect(eventBus.emit).toHaveBeenCalledWith('data:filtered', expect.anything());
    });
});
