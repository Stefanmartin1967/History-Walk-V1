import { describe, it, expect, vi, beforeEach } from 'vitest';

// Conflits à la publication (18/11/2026) : de l'estampille posée à l'écriture
// jusqu'au conflit signalé dans le diff du Centre de contrôle.

const h = vi.hoisted(() => ({ online: null, onlineSha: null, versions: {}, hook: null, loadedSha: null }));

vi.mock('../src/repo-read.js', () => ({
    fetchRepoFile: vi.fn(async (path) => {
        if (path.endsWith('.geojson')) return { ok: true, json: async () => h.online, _geo: true };
        if (path.includes('tested')) return { ok: true, json: async () => ({}) };
        return { ok: true, json: async () => [] };
    }),
    repoFileSha: vi.fn((resp) => (resp?._geo ? h.onlineSha : null)),
    fetchRepoBlobJson: vi.fn(async (sha) => h.versions[sha] ?? null),
    listRepoDir: vi.fn(async () => null),
    getLoadedGeojsonSha: vi.fn(() => h.loadedSha),
}));

vi.mock('../src/state.js', () => {
    const mod = { state: { currentMapId: 'charleroi', loadedFeatures: [], customFeatures: [], userData: {}, officialCircuits: [], myCircuits: [], testedCircuits: {} } };
    mod.DEFAULT_MAP_ID = 'charleroi';
    mod.getActiveMapId = () => mod.state.currentMapId;
    return mod;
});
vi.mock('../src/database.js', () => ({
    getAllPendingAdminPhotos: vi.fn(async () => ({})),
    removePoiDataKeys: vi.fn(async () => 0),
    setPoiDataWriteHook: vi.fn((fn) => { h.hook = fn; }),
}));

import { state } from '../src/state.js';
import { prepareDiffData, diffData } from '../src/admin-diff-engine.js';
import { installOverlayBaseHook } from '../src/overlay-base-hook.js';
import { BASE_KEY } from '../src/overlay-base.js';

const S1 = '1'.repeat(40), S2 = '2'.repeat(40);
const ID = 'HW-GROTTE';
const feat = (props, coords) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: { HW_ID: ID, 'Nom du site FR': 'Grotte des Sarrasins', ...props } });
const OSM = [4.4592714, 50.3627415], SENTIER = [4.4594862, 50.3630564];

beforeEach(() => {
    state.userData = {};
    state.loadedFeatures = [feat({}, [...OSM])];
    diffData.pois = [];
    h.versions = {};
});

describe('estampille à l’écriture (crochet de savePoiData)', () => {
    it('note la version de la carte chargée, en base et en mémoire', () => {
        installOverlayBaseHook();
        h.loadedSha = S1;
        state.userData[ID] = { lat: 50.36277, lng: 4.45956 };
        const extra = h.hook('charleroi', ID, null, state.userData[ID]);
        expect(extra).toEqual({ lat: S1, lng: S1 });
        expect(state.userData[ID][BASE_KEY]).toEqual({ lat: S1, lng: S1 });
        // déjà estampillé : rien de nouveau
        expect(h.hook('charleroi', ID, { lat: 1, lng: 2, [BASE_KEY]: { lat: S1, lng: S1 } }, state.userData[ID])).toBeNull();
    });
});

describe('prepareDiffData', () => {
    it('position publiée ailleurs depuis : conflit, et compté', async () => {
        h.onlineSha = S2;
        h.online = { type: 'FeatureCollection', features: [feat({}, [...SENTIER])] };
        h.versions[S1] = { type: 'FeatureCollection', features: [feat({}, [...OSM])] };
        state.userData[ID] = { lat: 50.36277, lng: 4.45956, [BASE_KEY]: { lat: S1, lng: S1 } };
        state.loadedFeatures[0].properties.userData = state.userData[ID];
        await prepareDiffData({ pendingPois: { [ID]: { type: 'update' } }, pendingCircuits: {} });
        const item = diffData.pois.find(p => p.id === ID);
        expect(item.conflicts).toHaveLength(1);
        expect(item.conflicts[0]).toMatchObject({ key: 'position', online: [SENTIER[1], SENTIER[0]] });
        expect(diffData.stats.conflictPois).toBe(1);
        expect(item.changes.some(c => c.key === BASE_KEY)).toBe(false);
    });

    it('rien publié depuis (même version) : modification normale', async () => {
        h.onlineSha = S1;
        h.online = { type: 'FeatureCollection', features: [feat({}, [...OSM])] };
        state.userData[ID] = { lat: 50.36277, lng: 4.45956, [BASE_KEY]: { lat: S1, lng: S1 } };
        state.loadedFeatures[0].properties.userData = state.userData[ID];
        await prepareDiffData({ pendingPois: { [ID]: { type: 'update' } }, pendingCircuits: {} });
        const item = diffData.pois.find(p => p.id === ID);
        expect(item.changes[0].key).toBe('Position');
        expect(item.conflicts).toBeUndefined();
        expect(diffData.stats.conflictPois).toBe(0);
    });

    it('ancienne version illisible : aucun conflit conclu', async () => {
        h.onlineSha = S2;
        h.online = { type: 'FeatureCollection', features: [feat({}, [...SENTIER])] };
        state.userData[ID] = { lat: 50.36277, lng: 4.45956, [BASE_KEY]: { lat: S1, lng: S1 } };
        state.loadedFeatures[0].properties.userData = state.userData[ID];
        await prepareDiffData({ pendingPois: { [ID]: { type: 'update' } }, pendingCircuits: {} });
        expect(diffData.pois.find(p => p.id === ID).conflicts).toBeUndefined();
    });
});
