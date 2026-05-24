// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { state, setDestinations, setOfficialCircuits, setCurrentMap, POI_CATEGORIES } from '../src/state.js';
import {
    loadDestinationsConfig,
    loadPoiCategoriesConfig,
    loadOfficialCircuits,
} from '../src/app-startup.js';

// Helpers de réponse fetch
const okJson = (data) => ({ ok: true, json: async () => data });
const notOk = (status = 404) => ({ ok: false, status, json: async () => ({}) });
const badJson = () => ({ ok: true, json: async () => { throw new SyntaxError('JSON invalide'); } });

beforeEach(() => {
    // Silence les console.error/warn défensifs des loaders (bruit attendu).
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
    // Restaure l'état partagé aux défauts pour ne pas contaminer les autres fichiers.
    setDestinations({ activeMapId: 'djerba', maps: {} });
    setOfficialCircuits([]);
    setCurrentMap(null);
});

describe('loadDestinationsConfig', () => {
    it('config valide → setDestinations appliqué', async () => {
        const cfg = { activeMapId: 'testdest', maps: { testdest: { name: 'Test' } } };
        global.fetch = vi.fn(async () => okJson(cfg));
        await loadDestinationsConfig();
        expect(state.destinations.activeMapId).toBe('testdest');
    });

    it('HTTP non-ok (404) → état destinations inchangé (pas d\'écrasement)', async () => {
        setDestinations({ activeMapId: 'sentinelle', maps: {} });
        global.fetch = vi.fn(async () => notOk(404));
        await loadDestinationsConfig();
        expect(state.destinations.activeMapId).toBe('sentinelle');
    });

    it('erreur réseau (throw) → état inchangé, pas de crash', async () => {
        setDestinations({ activeMapId: 'sentinelle2', maps: {} });
        global.fetch = vi.fn(async () => { throw new Error('network down'); });
        await expect(loadDestinationsConfig()).resolves.toBeUndefined();
        expect(state.destinations.activeMapId).toBe('sentinelle2');
    });

    it('JSON malformé → état inchangé, pas de crash', async () => {
        setDestinations({ activeMapId: 'sentinelle3', maps: {} });
        global.fetch = vi.fn(async () => badJson());
        await expect(loadDestinationsConfig()).resolves.toBeUndefined();
        expect(state.destinations.activeMapId).toBe('sentinelle3');
    });
});

describe('loadOfficialCircuits — résilience (échec/vide)', () => {
    it('HTTP non-ok → officialCircuits = []', async () => {
        setOfficialCircuits([{ id: 'pre', isOfficial: true }]);
        global.fetch = vi.fn(async () => notOk(500));
        await loadOfficialCircuits();
        expect(state.officialCircuits).toEqual([]);
    });

    it('erreur réseau → officialCircuits = [], pas de crash', async () => {
        setOfficialCircuits([{ id: 'pre', isOfficial: true }]);
        global.fetch = vi.fn(async () => { throw new Error('network down'); });
        await expect(loadOfficialCircuits()).resolves.toBeUndefined();
        expect(state.officialCircuits).toEqual([]);
    });

    it('tableau vide → officialCircuits = []', async () => {
        global.fetch = vi.fn(async () => okJson([]));
        await loadOfficialCircuits();
        expect(state.officialCircuits).toEqual([]);
    });

    it('utilise la destination active dans l\'URL (multi-destinations)', async () => {
        setCurrentMap('hammamet');
        global.fetch = vi.fn(async () => notOk(404));
        await loadOfficialCircuits();
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('circuits/hammamet.json'));
    });
});

describe('loadPoiCategoriesConfig — fallback gracieux', () => {
    it('HTTP non-ok → pas de crash, taxonomie de secours conservée', async () => {
        global.fetch = vi.fn(async () => notOk(404));
        await expect(loadPoiCategoriesConfig()).resolves.toBeUndefined();
        expect(Array.isArray(POI_CATEGORIES)).toBe(true);
        expect(POI_CATEGORIES.length).toBeGreaterThan(0);
    });

    it('erreur réseau → pas de crash (fallback sur la taxonomie intégrée)', async () => {
        global.fetch = vi.fn(async () => { throw new Error('network down'); });
        await expect(loadPoiCategoriesConfig()).resolves.toBeUndefined();
    });
});
