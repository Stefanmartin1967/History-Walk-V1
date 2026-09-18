// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Publication d'une MODIFICATION de circuit — sort du badge « Vérifié ».
//
// Règle (Stefan, 18/09/2026) : le badge atteste que le circuit publié a été
// marché. Il tombe à la publication si des étapes ont été AJOUTÉES ou
// RÉORDONNÉES par rapport au circuit marché ; un retrait le laisse. Le retrait
// est poussé en ligne aussitôt, APRÈS l'écriture de l'index.
// Avant : retiré en mémoire seule à l'ouverture de « Modifier », il revenait au
// rechargement — ou partait via « Tout publier » selon l'ordre des gestes.
// ============================================================================

const h = vi.hoisted(() => ({
    mockState: {
        isAdmin: true,
        testedCircuits: {},
        currentMapId: 'djerba',
        userData: {},
        loadedFeatures: [],
        customFeatures: [],
        officialCircuits: [],
        myCircuits: [],
    },
    uploadFileToGitHub: vi.fn(() => Promise.resolve()),
    deleteFileFromGitHub: vi.fn(() => Promise.resolve()),
    fetchWithTimeout: vi.fn(),
    forgetDeletedCircuit: vi.fn(() => Promise.resolve()),
    setOfficialCircuitDeleted: vi.fn(() => Promise.resolve()),
    store: {},
}));

vi.mock('../src/state.js', () => {
    const mod = ({
        state: h.mockState,
        setUserData: (ud) => { h.mockState.userData = ud || {}; },
        setCustomFeatures: (f) => { h.mockState.customFeatures = f || []; },
        setOfficialCircuits: (l) => { h.mockState.officialCircuits = l || []; },
        setTestedCircuit: (id, v) => {
            if (v) h.mockState.testedCircuits[id] = true; else delete h.mockState.testedCircuits[id];
        },
    });
    mod.DEFAULT_MAP_ID = 'djerba';
    mod.getActiveMapId = () => mod.state.currentMapId || 'djerba';
    return mod;
});
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/github-sync.js', () => ({
    uploadFileToGitHub: h.uploadFileToGitHub,
    deleteFileFromGitHub: h.deleteFileFromGitHub,
    getStoredToken: vi.fn(() => 'tok'),
}));
vi.mock('../src/config.js', () => ({
    GITHUB_OWNER: 'o', GITHUB_REPO: 'r', RAW_BASE: 'https://example.com',
    GITHUB_PATHS: {
        geojson: (m) => `public/${m}.geojson`,
        circuits: (m) => `public/circuits/${m}.json`,
        circuitFile: () => '', photo: () => '', tested: (m) => `public/circuits/tested_${m}.json`,
    },
    PERSONAL_KEYS: ['vu', 'vuManual', 'notes', 'incontournable'],
}));
vi.mock('../src/net.js', () => ({ fetchWithTimeout: h.fetchWithTimeout }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn(() => Promise.resolve(true)), closeModal: vi.fn() }));
vi.mock('../src/database.js', () => ({
    saveAppState: vi.fn(async (k, v) => { h.store[k] = JSON.parse(JSON.stringify(v)); }),
    getAppState: vi.fn(async (k) => h.store[k] ?? null),
    getPendingAdminPhotos: vi.fn(() => Promise.resolve([])),
    setPendingAdminPhotos: vi.fn(() => Promise.resolve()),
    clearPendingAdminPhotos: vi.fn(() => Promise.resolve()),
    deletePoiData: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/circuit-store.js', () => ({ forgetDeletedCircuit: h.forgetDeletedCircuit }));
vi.mock('../src/circuit-deletion-state.js', () => ({
    setOfficialCircuitDeleted: h.setOfficialCircuitDeleted,
    isOfficialCircuitDeleted: vi.fn(() => false),
    withoutServerDeletedCircuits: (l) => l,
}));
vi.mock('../src/photo-service.js', () => ({ uploadPhotoForPoi: vi.fn() }));
vi.mock('../src/admin-geojson.js', () => ({ generateMasterGeoJSONData: vi.fn(() => ({ features: [] })) }));
vi.mock('../src/admin-control-ui.js', () => ({ openControlCenterModal: vi.fn(), renderTab: vi.fn(), closeCCModal: vi.fn() }));
vi.mock('../src/gpx.js', () => ({ generateGPXString: vi.fn(() => '<gpx/>') }));
vi.mock('../src/admin-diff-engine.js', () => ({
    reconcileLocalChanges: vi.fn(),
    prepareDiffData: vi.fn(() => Promise.resolve()),
    purgeOrphanPendingPois: vi.fn(() => []),
    purgeOrphanPendingCircuits: vi.fn(() => []),
    diffData: { pois: [], circuits: [], stats: {}, pendingPhotos: {}, testedChanges: null },
}));


import { publishChanges } from '../src/admin-control-center.js';
import { diffData } from '../src/admin-diff-engine.js';

const INDEX_PATH = 'public/circuits/djerba.json';
const TESTED_PATH = 'public/circuits/tested_djerba.json';

const feat = (id, lng) => ({
    type: 'Feature',
    properties: { HW_ID: id, 'Nom du site FR': id },
    geometry: { type: 'Point', coordinates: [lng, 33.8] },
});

/** Circuit « C1 » publié avec les étapes `published`, modifié localement en `edited`. */
function setup({ published, edited, walked, tested = true }) {
    h.mockState.loadedFeatures = ['A', 'B', 'C', 'X'].map((id, i) => feat(id, 10.8 + i / 100));
    h.mockState.officialCircuits = [{
        id: 'C1', name: 'Circuit test', poiIds: edited,
        realTrack: [[33.8, 10.8], [33.81, 10.81]],
    }];
    h.mockState.myCircuits = [];
    h.mockState.testedCircuits = tested ? { C1: true, AUTRE: true } : { AUTRE: true };
    h.store = walked ? { tested_steps_djerba: { C1: walked } } : {};
    diffData.circuits = [{ id: 'C1', name: 'Circuit test', changes: [] }];
    const index = [{ id: 'C1', name: 'Circuit test', file: 'djerba/Circuit test.gpx', poiIds: published }];
    h.fetchWithTimeout.mockResolvedValue({ ok: true, json: async () => JSON.parse(JSON.stringify(index)) });
}

const testedUpload = () => h.uploadFileToGitHub.mock.calls.find(c => c[4] === TESTED_PATH);
const callOrder = (path) => {
    const i = h.uploadFileToGitHub.mock.calls.findIndex(c => c[4] === path);
    return i > -1 ? h.uploadFileToGitHub.mock.invocationCallOrder[i] : null;
};

beforeEach(() => {
    vi.clearAllMocks();
    diffData.pois = [];
    diffData.stats = {};
    diffData.pendingPhotos = {};
    diffData.testedChanges = null;
    h.uploadFileToGitHub.mockImplementation(() => Promise.resolve());
});

describe("publishChanges — badge « Vérifié » d'un circuit modifié", () => {
    it("étape AJOUTÉE : le badge tombe et le retrait est publié après l'index", async () => {
        setup({ published: ['A', 'B', 'C'], edited: ['A', 'B', 'X', 'C'] });

        await publishChanges();

        expect(h.mockState.testedCircuits).toEqual({ AUTRE: true });
        expect(testedUpload()).toBeTruthy();
        expect(JSON.parse(await testedUpload()[0].text())).toEqual({ AUTRE: true });
        expect(callOrder(TESTED_PATH)).toBeGreaterThan(callOrder(INDEX_PATH));
        expect(h.store.tested_circuits_djerba).toEqual({ AUTRE: true });
    });

    it('étapes RÉORDONNÉES : le badge tombe', async () => {
        setup({ published: ['A', 'B', 'C'], edited: ['A', 'C', 'B'] });

        await publishChanges();

        expect(h.mockState.testedCircuits.C1).toBeUndefined();
        expect(testedUpload()).toBeTruthy();
    });

    it("étape RETIRÉE seulement : le badge reste, rien n'est publié pour lui", async () => {
        setup({ published: ['A', 'B', 'C'], edited: ['A', 'C'] });

        await publishChanges();

        expect(h.mockState.testedCircuits.C1).toBe(true);
        expect(testedUpload()).toBeUndefined();
    });

    it('modifié, marché et coché AVANT publication : les étapes marchées font foi, le badge reste', async () => {
        setup({ published: ['A', 'B'], edited: ['A', 'X', 'B'], walked: ['A', 'X', 'B'] });

        await publishChanges();

        expect(h.mockState.testedCircuits.C1).toBe(true);
        expect(testedUpload()).toBeUndefined();
    });

    it('circuit non vérifié : rien à retirer', async () => {
        setup({ published: ['A', 'B'], edited: ['A', 'X', 'B'], tested: false });

        await publishChanges();

        expect(testedUpload()).toBeUndefined();
    });

    it("l'écriture de l'index échoue : le badge reste (le circuit en ligne est celui marché)", async () => {
        setup({ published: ['A', 'B', 'C'], edited: ['A', 'B', 'X', 'C'] });
        h.uploadFileToGitHub.mockImplementation((file, tok, o, r, path) =>
            path === INDEX_PATH ? Promise.reject(new Error('409')) : Promise.resolve());

        await publishChanges();

        expect(h.mockState.testedCircuits.C1).toBe(true);
        expect(testedUpload()).toBeUndefined();
    });
});
