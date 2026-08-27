// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { state, setDestinations, setOfficialCircuits, setCurrentMap, POI_CATEGORIES } from '../src/state.js';
import {
    loadDestinationsConfig,
    loadPoiCategoriesConfig,
    loadOfficialCircuits,
    loadZonesForActive,
    loadRejectedForActive,
} from '../src/app-startup.js';
import * as zonesModule from '../src/zones.js';
import * as rejectedModule from '../src/rejected.js';

// IndexedDB indispo en jsdom : on mocke le store appState (cache offline de la config).
vi.mock('../src/database.js', () => ({
    getAppState: vi.fn(async () => null),
    saveAppState: vi.fn(async () => {}),
}));
import { getAppState, saveAppState } from '../src/database.js';

// Helpers de réponse fetch
const okJson = (data) => ({ ok: true, json: async () => data });
const notOk = (status = 404) => ({ ok: false, status, json: async () => ({}) });
const badJson = () => ({ ok: true, json: async () => { throw new SyntaxError('JSON invalide'); } });

beforeEach(() => {
    // Silence les console.error/warn défensifs des loaders (bruit attendu).
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getAppState.mockReset(); getAppState.mockResolvedValue(null);
    saveAppState.mockReset(); saveAppState.mockResolvedValue(undefined);
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

    it('config valide → persiste lastDestinations (copie de secours hors-ligne)', async () => {
        const cfg = { activeMapId: 'testdest', maps: { testdest: { name: 'Test' } } };
        global.fetch = vi.fn(async () => okJson(cfg));
        await loadDestinationsConfig();
        expect(saveAppState).toHaveBeenCalledWith('lastDestinations', cfg);
    });

    it('fetch échoue + cache présent → fallback lastDestinations (boot hors-ligne à froid)', async () => {
        setDestinations({ activeMapId: 'djerba', maps: {} });
        const cached = { activeMapId: 'hammamet', maps: { hammamet: { name: 'Hammamet', status: 'published' } } };
        getAppState.mockResolvedValueOnce(cached); // 1er appel = le fallback
        global.fetch = vi.fn(async () => { throw new Error('offline'); });
        await loadDestinationsConfig();
        expect(state.destinations.activeMapId).toBe('hammamet'); // la dest active survit hors-ligne
        expect(saveAppState).not.toHaveBeenCalled(); // ne ré-écrit pas le cache avec lui-même
    });

    it('fetch échoue + cache absent → état inchangé (1er boot hors-ligne)', async () => {
        setDestinations({ activeMapId: 'sentinelle4', maps: {} });
        getAppState.mockResolvedValue(null);
        global.fetch = vi.fn(async () => { throw new Error('offline'); });
        await loadDestinationsConfig();
        expect(state.destinations.activeMapId).toBe('sentinelle4');
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
        // 2e arg = { signal } injecté par fetchWithTimeout (audit R3) — l'URL reste l'attendu.
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('circuits/hammamet.json'),
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
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

// ---------------------------------------------------------------------------
// Zones + rejets : ces deux loaders sont lancés EN PARALLÈLE du geojson au boot
// (PERF 27/08/2026). Ils n'avaient aucun test direct — or la parallélisation
// repose entièrement sur leur contrat : chacun encapsule son repli hors-ligne et
// NE REJETTE JAMAIS. Ces tests verrouillent ce contrat.
// ---------------------------------------------------------------------------

const zonesFC = (n = 1) => ({
    type: 'FeatureCollection',
    features: Array.from({ length: n }, (_, i) => ({
        type: 'Feature',
        properties: { name: `Quartier ${i + 1}` },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
    }))
});

describe('loadZonesForActive — repli et contrat de non-rejet', () => {
    it('réponse valide → zones appliquées', async () => {
        global.fetch = vi.fn(async () => okJson(zonesFC(3)));
        await loadZonesForActive('djerba', { status: 'published' });
        expect(zonesModule.zonesData.features).toHaveLength(3);
    });

    it('HTTP non-ok → zones VIDES, pas de crash (getZoneFromCoords reste sûr)', async () => {
        global.fetch = vi.fn(async () => notOk(404));
        await loadZonesForActive('djerba', { status: 'published' });
        expect(zonesModule.zonesData).toEqual({ type: 'FeatureCollection', features: [] });
    });

    it('erreur réseau + copie hors-ligne présente → repli sur lastZones_<mapId>', async () => {
        global.fetch = vi.fn(async () => { throw new Error('offline'); });
        getAppState.mockImplementation(async (k) => (k === 'lastZones_djerba' ? zonesFC(2) : null));
        await loadZonesForActive('djerba', { status: 'published' });
        expect(zonesModule.zonesData.features).toHaveLength(2);
    });

    it('erreur réseau SANS copie hors-ligne → FeatureCollection vide, pas de crash', async () => {
        global.fetch = vi.fn(async () => { throw new Error('offline'); });
        getAppState.mockResolvedValue(null);
        await loadZonesForActive('djerba', { status: 'published' });
        expect(zonesModule.zonesData).toEqual({ type: 'FeatureCollection', features: [] });
    });

    it('JSON malformé → repli, pas de crash', async () => {
        global.fetch = vi.fn(async () => badJson());
        getAppState.mockResolvedValue(null);
        await expect(loadZonesForActive('djerba', { status: 'published' })).resolves.toBeUndefined();
        expect(zonesModule.zonesData.features).toEqual([]);
    });

    it('CONTRAT PARALLÉLISATION : ne rejette JAMAIS, quelle que soit la panne', async () => {
        // Si ce contrat tombe, le lancement anticipé dans loadAndInitializeMap
        // produirait un rejet non géré entre le lancement et l'await.
        for (const panne of [
            () => { throw new Error('réseau mort'); },
            async () => notOk(500),
            async () => badJson(),
        ]) {
            global.fetch = vi.fn(panne);
            getAppState.mockRejectedValueOnce(new Error('IndexedDB HS'));
            await expect(loadZonesForActive('djerba', { status: 'published' })).resolves.toBeUndefined();
        }
    });
});

describe('loadRejectedForActive — repli et contrat de non-rejet', () => {
    it('réponse valide → rejets appliqués', async () => {
        global.fetch = vi.fn(async () => okJson({ 'node/123': { reason: 'doublon' } }));
        await loadRejectedForActive('djerba', { status: 'published' });
        expect(rejectedModule.rejectedData).toEqual({ 'node/123': { reason: 'doublon' } });
    });

    it('404 (destination jamais curée) → rejets VIDES : rien n\'est masqué au scan', async () => {
        global.fetch = vi.fn(async () => notOk(404));
        getAppState.mockResolvedValue(null);
        await loadRejectedForActive('hammamet', { status: 'draft' });
        expect(rejectedModule.rejectedData).toEqual({});
    });

    it('erreur réseau + copie hors-ligne présente → repli sur lastRejected_<mapId>', async () => {
        global.fetch = vi.fn(async () => { throw new Error('offline'); });
        getAppState.mockImplementation(async (k) => (k === 'lastRejected_djerba' ? { 'way/9': {} } : null));
        await loadRejectedForActive('djerba', { status: 'published' });
        expect(rejectedModule.rejectedData).toEqual({ 'way/9': {} });
    });

    it('CONTRAT PARALLÉLISATION : ne rejette JAMAIS, quelle que soit la panne', async () => {
        for (const panne of [
            () => { throw new Error('réseau mort'); },
            async () => notOk(500),
            async () => badJson(),
        ]) {
            global.fetch = vi.fn(panne);
            getAppState.mockRejectedValueOnce(new Error('IndexedDB HS'));
            await expect(loadRejectedForActive('djerba', { status: 'published' })).resolves.toBeUndefined();
        }
    });
});

describe('Boot — zones et rejets partent en parallèle, pas en file', () => {
    it('les deux requêtes sont émises AVANT que la première ne soit résolue', async () => {
        // Le défaut corrigé : chaque fetch attendait la fin du précédent, soit
        // 3 × RTT au démarrage. On vérifie la propriété qui compte — les requêtes
        // se chevauchent — plutôt qu'un temps mesuré, qui serait instable en CI.
        let enVol = 0;
        let maxSimultane = 0;
        const debloquer = [];
        global.fetch = vi.fn(() => {
            enVol++;
            maxSimultane = Math.max(maxSimultane, enVol);
            return new Promise((resolve) => debloquer.push(() => {
                enVol--;
                resolve(okJson(zonesFC(1)));
            }));
        });

        const p1 = loadZonesForActive('djerba', { status: 'published' });
        const p2 = loadRejectedForActive('djerba', { status: 'published' });
        await Promise.resolve(); // laisse partir les deux fetch

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(maxSimultane).toBe(2);

        debloquer.forEach((f) => f());
        await Promise.all([p1, p2]);
    });
});
