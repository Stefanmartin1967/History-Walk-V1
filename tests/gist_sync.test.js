// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks (hoisted par vitest) ---
vi.mock('../src/state.js', () => {
    const state = {
        currentMapId: 'djerba',
        userData: {},
        loadedFeatures: [],
        officialCircuitsStatus: {},
        testedCircuits: {},
        hiddenPoiIds: [],
        hiddenCircuitIds: []
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
        }),
        setHiddenPoiIds: vi.fn((ids) => { state.hiddenPoiIds = Array.isArray(ids) ? ids : []; }),
        setHiddenCircuitIds: vi.fn((ids) => { state.hiddenCircuitIds = Array.isArray(ids) ? ids : []; })
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
import { buildPayload, mergeRemoteIntoLocal, schedulePush, pushToGist, initGistReconnectSync } from '../src/gist-sync.js';

function resetState() {
    state.currentMapId = 'djerba';
    state.userData = {};
    state.loadedFeatures = [];
    state.officialCircuitsStatus = {};
    state.testedCircuits = {};
    state.hiddenPoiIds = [];
    state.hiddenCircuitIds = [];
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
        // 'planifie' retiré des SYNC_KEYS 14/05/2026 (refonte Mon Espace V2) :
        // valeur calculée à la volée via computePlanifieCounter, plus stockée.
        state.userData = {
            poi1: {
                vu: true, vuManual: true, visitedByCircuits: ['c1'],
                notes: 'hi', incontournable: true, planifie: true
            }
        };
        const payload = buildPayload();
        // planifie est désormais filtré (legacy)
        expect(payload.userData.poi1).toEqual({
            vu: true, vuManual: true, visitedByCircuits: ['c1'],
            notes: 'hi', incontournable: true
        });
        expect(payload.userData.poi1.planifie).toBeUndefined();
    });

    it('enveloppe : mapId, circuitsStatus, lastSync (ISO), appVersion — testedCircuits RETIRÉ', () => {
        state.currentMapId = 'djerba';
        state.officialCircuitsStatus = { c1: true };
        state.testedCircuits = { c2: true };
        const payload = buildPayload();
        expect(payload.mapId).toBe('djerba');
        expect(payload.circuitsStatus).toEqual({ c1: true });
        expect(payload.testedCircuits).toBeUndefined(); // retiré du Gist (autorité serveur, 07/06)
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
    });

    // PR4 refonte Mon Espace V2 — sync hiddenCircuitIds
    it('inclut hiddenCircuitIds dans le payload (refonte V2 PR4)', () => {
        state.hiddenCircuitIds = ['c1', 'c2'];
        const payload = buildPayload();
        expect(payload.hiddenCircuitIds).toEqual(['c1', 'c2']);
    });

    it('hiddenCircuitIds défaut [] si state vide', () => {
        state.hiddenCircuitIds = null;
        const payload = buildPayload();
        expect(payload.hiddenCircuitIds).toEqual([]);
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

// PR4 refonte Mon Espace V2 — merge hiddenCircuitIds (UNION)
describe('mergeRemoteIntoLocal — hiddenCircuitIds UNION', () => {
    it('remote ajoute des cachés au local → union', () => {
        state.hiddenCircuitIds = ['c1'];
        state.userData = {};
        const remote = { userData: {}, hiddenCircuitIds: ['c2', 'c3'] };
        const { hiddenChanged } = mergeRemoteIntoLocal(remote);
        expect(hiddenChanged).toBe(true);
        expect([...state.hiddenCircuitIds].sort()).toEqual(['c1', 'c2', 'c3']);
    });

    it('remote sous-ensemble du local → pas de changement', () => {
        state.hiddenCircuitIds = ['c1', 'c2'];
        state.userData = {};
        const remote = { userData: {}, hiddenCircuitIds: ['c1'] };
        const { hiddenChanged } = mergeRemoteIntoLocal(remote);
        expect(hiddenChanged).toBe(false);
        expect([...state.hiddenCircuitIds].sort()).toEqual(['c1', 'c2']);
    });

    it('remote vide → pas de changement', () => {
        state.hiddenCircuitIds = ['c1'];
        state.userData = {};
        const remote = { userData: {}, hiddenCircuitIds: [] };
        const { hiddenChanged } = mergeRemoteIntoLocal(remote);
        expect(hiddenChanged).toBe(false);
        expect(state.hiddenCircuitIds).toEqual(['c1']);
    });

    it('remote absent du champ → pas de crash, pas de changement', () => {
        state.hiddenCircuitIds = ['c1'];
        state.userData = {};
        const remote = { userData: {} }; // sans hiddenCircuitIds
        const { hiddenChanged } = mergeRemoteIntoLocal(remote);
        expect(hiddenChanged).toBe(false);
        expect(state.hiddenCircuitIds).toEqual(['c1']);
    });

    it('local vide + remote présent → union = remote', () => {
        state.hiddenCircuitIds = [];
        state.userData = {};
        const remote = { userData: {}, hiddenCircuitIds: ['c1', 'c2'] };
        const { hiddenChanged } = mergeRemoteIntoLocal(remote);
        expect(hiddenChanged).toBe(true);
        expect([...state.hiddenCircuitIds].sort()).toEqual(['c1', 'c2']);
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

    it('testedCircuits : NON synchronisé via le Gist (autorité serveur) — ni ajout ni retrait', () => {
        state.testedCircuits = { c2: true };
        const remote = { userData: {}, testedCircuits: { c1: true } };
        mergeRemoteIntoLocal(remote);
        // Le « vérifié » n'est plus touché par le Gist (07/06) : autorité = fichier
        // serveur appliqué au boot. Donc aucun appel + état local inchangé.
        expect(setTestedCircuit).not.toHaveBeenCalled();
        expect(state.testedCircuits).toEqual({ c2: true });
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

// ─────────────────────────────────────────────────────────────────────────────
// Audit R2 (11/06/2026) : la promesse du bandeau hors-ligne (« vos modifications
// repartent au retour du réseau ») doit être VRAIE. Un push tenté hors-ligne ne
// gaspille pas un fetch voué à l'échec ; il est marqué en attente et rejoué à
// l'event 'online'.
describe('retry au retour du réseau (offline → online)', () => {
    let onLineValue;

    beforeEach(() => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 'gist-abc', files: {} })
        }));
        vi.mocked(getStoredToken).mockReturnValue('fake-token');
        localStorage.setItem('hw_gist_id', 'gist-existing'); // → branche updateGist (PATCH)
        onLineValue = true;
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => onLineValue });
    });

    afterEach(() => {
        delete global.fetch;
    });

    it('hors-ligne : aucun fetch tenté (push voué à l\'échec évité)', async () => {
        onLineValue = false;
        await pushToGist();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('au retour online, le push en attente est rejoué (1 PATCH)', async () => {
        initGistReconnectSync();
        onLineValue = false;
        await pushToGist();                       // marque pending, n'appelle pas fetch
        expect(global.fetch).not.toHaveBeenCalled();

        onLineValue = true;
        window.dispatchEvent(new Event('online')); // rejoue pushToGist
        await Promise.resolve();
        await Promise.resolve();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
