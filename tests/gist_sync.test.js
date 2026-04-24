// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks (hoisted par vitest) ---
vi.mock('../src/state.js', () => {
    const state = {
        currentMapId: 'djerba',
        userData: {},
        loadedFeatures: [],
        officialCircuitsStatus: {},
        testedCircuits: {}
    };
    return {
        state,
        setTestedCircuit: vi.fn((cId, val) => {
            if (val) state.testedCircuits[cId] = true;
            else delete state.testedCircuits[cId];
        }),
        setOfficialCircuitStatus: vi.fn((cId, val) => {
            if (val) state.officialCircuitsStatus[cId] = true;
            else delete state.officialCircuitsStatus[cId];
        })
    };
});

vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn()
}));

vi.mock('../src/utils.js', () => ({
    getPoiId: vi.fn(f => f?.properties?.HW_ID)
}));

vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../src/database.js', () => ({
    savePoiData: vi.fn(),
    batchSavePoiData: vi.fn(),
    saveAppState: vi.fn()
}));

vi.mock('../src/events.js', () => ({
    eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() }
}));

import { state, setTestedCircuit, setOfficialCircuitStatus } from '../src/state.js';
import { getStoredToken } from '../src/github-sync.js';
import { buildPayload, mergeRemoteIntoLocal, schedulePush } from '../src/gist-sync.js';

function resetState() {
    state.currentMapId = 'djerba';
    state.userData = {};
    state.loadedFeatures = [];
    state.officialCircuitsStatus = {};
    state.testedCircuits = {};
}

beforeEach(() => {
    resetState();
    vi.clearAllMocks();
    localStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('buildPayload', () => {
    it('filtre les clés hors SYNC_KEYS (photos/modifHistory absents)', () => {
        state.userData = {
            poi1: { vu: true, vuManual: true, photos: ['x'], modifHistory: [{}] }
        };
        const payload = buildPayload();
        expect(payload.userData.poi1).toEqual({ vu: true, vuManual: true });
        expect(payload.userData.poi1.photos).toBeUndefined();
        expect(payload.userData.poi1.modifHistory).toBeUndefined();
    });

    it('ignore les POI sans aucun champ SYNC_KEYS', () => {
        state.userData = {
            poi1: { photos: ['x'] },
            poi2: { vuManual: true }
        };
        const payload = buildPayload();
        expect(payload.userData.poi1).toBeUndefined();
        expect(payload.userData.poi2).toEqual({ vuManual: true });
    });

    it('préserve tous les SYNC_KEYS présents', () => {
        state.userData = {
            poi1: {
                vu: true, vuManual: true, visitedByCircuits: ['c1'],
                notes: 'hi', incontournable: true, planifie: true
            }
        };
        const payload = buildPayload();
        expect(payload.userData.poi1).toEqual({
            vu: true, vuManual: true, visitedByCircuits: ['c1'],
            notes: 'hi', incontournable: true, planifie: true
        });
    });

    it('enveloppe : mapId, circuitsStatus, testedCircuits, lastSync (ISO), appVersion', () => {
        state.currentMapId = 'djerba';
        state.officialCircuitsStatus = { c1: true };
        state.testedCircuits = { c2: true };
        const payload = buildPayload();
        expect(payload.mapId).toBe('djerba');
        expect(payload.circuitsStatus).toEqual({ c1: true });
        expect(payload.testedCircuits).toEqual({ c2: true });
        expect(payload.appVersion).toBe('1.0');
        expect(payload.lastSync).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('defaults quand state est vide → objets vides (pas undefined)', () => {
        state.userData = null;
        state.officialCircuitsStatus = null;
        state.testedCircuits = null;
        const payload = buildPayload();
        expect(payload.userData).toEqual({});
        expect(payload.circuitsStatus).toEqual({});
        expect(payload.testedCircuits).toEqual({});
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('mergeRemoteIntoLocal — guards', () => {
    it('remote null → { updates: [] }', () => {
        expect(mergeRemoteIntoLocal(null)).toEqual({ updates: [] });
    });

    it('remote sans userData → { updates: [] }', () => {
        expect(mergeRemoteIntoLocal({ mapId: 'djerba' })).toEqual({ updates: [] });
    });
});

describe('mergeRemoteIntoLocal — vuManual', () => {
    it('remote true + local false → merge + update', () => {
        state.userData = { poi1: { vuManual: false } };
        const remote = { userData: { poi1: { vuManual: true } } };
        const { updates } = mergeRemoteIntoLocal(remote);
        expect(updates).toHaveLength(1);
        expect(updates[0].data.vuManual).toBe(true);
        expect(state.userData.poi1.vuManual).toBe(true);
    });

    it('remote true + local true → pas d\'update (idempotent)', () => {
        state.userData = { poi1: { vuManual: true } };
        const remote = { userData: { poi1: { vuManual: true } } };
        const { updates } = mergeRemoteIntoLocal(remote);
        expect(updates).toHaveLength(0);
    });

    it('remote false + local true → local gagne (pas d\'update)', () => {
        state.userData = { poi1: { vuManual: true } };
        const remote = { userData: { poi1: { vuManual: false } } };
        const { updates } = mergeRemoteIntoLocal(remote);
        expect(updates).toHaveLength(0);
        expect(state.userData.poi1.vuManual).toBe(true);
    });
});

describe('mergeRemoteIntoLocal — visitedByCircuits', () => {
    it('union avec nouveaux éléments → update avec l\'union', () => {
        state.userData = { poi1: { visitedByCircuits: ['c1'] } };
        const remote = { userData: { poi1: { visitedByCircuits: ['c2', 'c3'] } } };
        const { updates } = mergeRemoteIntoLocal(remote);
        expect(updates).toHaveLength(1);
        expect([...updates[0].data.visitedByCircuits].sort()).toEqual(['c1', 'c2', 'c3']);
    });

    it('remote sous-ensemble de local → pas d\'update', () => {
        state.userData = { poi1: { visitedByCircuits: ['c1', 'c2'] } };
        const remote = { userData: { poi1: { visitedByCircuits: ['c1'] } } };
        const { updates } = mergeRemoteIntoLocal(remote);
        expect(updates).toHaveLength(0);
    });

    it('array remote vide → pas d\'update', () => {
        state.userData = { poi1: { visitedByCircuits: ['c1'] } };
        const remote = { userData: { poi1: { visitedByCircuits: [] } } };
        const { updates } = mergeRemoteIntoLocal(remote);
        expect(updates).toHaveLength(0);
    });
});

describe('mergeRemoteIntoLocal — vu rétro-compat & recompute', () => {
    it('remote vu=true sans migration → local vuManual=true', () => {
        state.userData = { poi1: {} };
        const remote = { userData: { poi1: { vu: true } } };
        const { updates } = mergeRemoteIntoLocal(remote);
        expect(updates).toHaveLength(1);
        expect(updates[0].data.vuManual).toBe(true);
    });

    it('vu recalculé : vuManual=true → vu=true', () => {
        state.userData = { poi1: {} };
        const remote = { userData: { poi1: { vuManual: true } } };
        const { updates } = mergeRemoteIntoLocal(remote);
        expect(updates[0].data.vu).toBe(true);
    });

    it('vu recalculé : visitedByCircuits non vide → vu=true', () => {
        state.userData = { poi1: {} };
        const remote = { userData: { poi1: { visitedByCircuits: ['c1'] } } };
        const { updates } = mergeRemoteIntoLocal(remote);
        expect(updates[0].data.vu).toBe(true);
    });
});

describe('mergeRemoteIntoLocal — notes', () => {
    it('remote présent + local vide → merge', () => {
        state.userData = { poi1: {} };
        const remote = { userData: { poi1: { notes: 'hello' } } };
        const { updates } = mergeRemoteIntoLocal(remote);
        expect(updates).toHaveLength(1);
        expect(updates[0].data.notes).toBe('hello');
    });

    it('local présent → local gagne', () => {
        state.userData = { poi1: { notes: 'local' } };
        const remote = { userData: { poi1: { notes: 'remote' } } };
        const { updates } = mergeRemoteIntoLocal(remote);
        expect(updates).toHaveLength(0);
        expect(state.userData.poi1.notes).toBe('local');
    });
});

describe('mergeRemoteIntoLocal — incontournable & circuits', () => {
    it('incontournable : true gagne', () => {
        state.userData = { poi1: {} };
        const remote = { userData: { poi1: { incontournable: true } } };
        const { updates } = mergeRemoteIntoLocal(remote);
        expect(updates[0].data.incontournable).toBe(true);
    });

    it('circuitsStatus : remote true → setter appelé + circuitsChanged=true', () => {
        const remote = { userData: {}, circuitsStatus: { c1: true } };
        const { circuitsChanged } = mergeRemoteIntoLocal(remote);
        expect(circuitsChanged).toBe(true);
        expect(setOfficialCircuitStatus).toHaveBeenCalledWith('c1', true);
    });

    it('testedCircuits : remote true → setter appelé (ajout)', () => {
        const remote = { userData: {}, testedCircuits: { c1: true } };
        const { circuitsChanged } = mergeRemoteIntoLocal(remote);
        expect(circuitsChanged).toBe(true);
        expect(setTestedCircuit).toHaveBeenCalledWith('c1', true);
    });

    it('testedCircuits : absent du remote → setter appelé (retrait)', () => {
        state.testedCircuits = { c2: true };
        const remote = { userData: {}, testedCircuits: { c1: true } };
        const { circuitsChanged } = mergeRemoteIntoLocal(remote);
        expect(circuitsChanged).toBe(true);
        expect(setTestedCircuit).toHaveBeenCalledWith('c2', false);
    });
});

describe('mergeRemoteIntoLocal — sync feature & POI nouveau', () => {
    it('met à jour feature.properties.userData si feature présente dans loadedFeatures', () => {
        const feature = { properties: { HW_ID: 'poi1', userData: {} } };
        state.userData = { poi1: {} };
        state.loadedFeatures = [feature];
        const remote = { userData: { poi1: { vuManual: true } } };
        mergeRemoteIntoLocal(remote);
        expect(feature.properties.userData.vuManual).toBe(true);
        expect(feature.properties.userData).toBe(state.userData.poi1);
    });

    it('accepte un POI présent dans remote mais absent en local', () => {
        state.userData = {};
        const remote = { userData: { poi1: { vuManual: true } } };
        const { updates } = mergeRemoteIntoLocal(remote);
        expect(updates).toHaveLength(1);
        expect(state.userData.poi1).toBeDefined();
        expect(state.userData.poi1.vuManual).toBe(true);
        expect(state.userData.poi1.vu).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('schedulePush', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 'gist-abc', files: {} })
        }));
        vi.mocked(getStoredToken).mockReturnValue('fake-token');
    });

    afterEach(() => {
        vi.useRealTimers();
        delete global.fetch;
    });

    it('debounce : N appels rapides → 1 seul push après 3s', async () => {
        schedulePush();
        schedulePush();
        schedulePush();
        expect(global.fetch).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(3000);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('re-scheduling annule le timer précédent (total 4s mais 2s après reset → 0 push)', async () => {
        schedulePush();
        await vi.advanceTimersByTimeAsync(2000);
        schedulePush();
        await vi.advanceTimersByTimeAsync(2000);
        expect(global.fetch).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1100);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
