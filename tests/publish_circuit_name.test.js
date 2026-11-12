// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Publication d'un circuit : nom = fichier GPX (12/11/2026).
//
// Deux boucles de Rym Beach portaient le même nom : la 2e a écrasé le GPX de la
// 1re, puis renommer l'une a supprimé le GPX de l'autre. Garde-fous testés ici :
//  - un circuit dont le nom est déjà pris n'est PAS publié (le reste l'est) ;
//  - un renommage ne supprime pas l'ancien fichier s'il sert encore à un autre.
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
    showToast: vi.fn(),
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
// Garde-fou « carte à jour » (publish-base.js) : testé à part dans publish_base.test.js.
vi.mock('../src/publish-base.js', async (importOriginal) => ({
    ...(await importOriginal()),
    assertGeojsonBaseCurrent: vi.fn(async () => 'sha-en-ligne'),
}));

vi.mock('../src/github-sync.js', () => ({
    uploadFileToGitHub: h.uploadFileToGitHub,
    deleteFileFromGitHub: h.deleteFileFromGitHub,
    getStoredToken: vi.fn(() => 'tok'),
}));
vi.mock('../src/config.js', () => ({
    GITHUB_OWNER: 'o', GITHUB_REPO: 'r', RAW_BASE: 'https://example.com', GITHUB_BRANCH: 'main',
    GITHUB_PATHS: {
        geojson: (m) => `public/${m}.geojson`,
        circuits: (m) => `public/circuits/${m}.json`,
        circuitFile: () => '', photo: () => '', tested: (m) => `public/circuits/tested_${m}.json`,
    },
    PERSONAL_KEYS: ['vu', 'vuManual', 'notes', 'incontournable'],
}));
vi.mock('../src/net.js', () => ({ fetchWithTimeout: h.fetchWithTimeout }));
vi.mock('../src/toast.js', () => ({ showToast: h.showToast }));
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

const GPX = (name) => `public/circuits/djerba/${name}.gpx`;
const uploadedPaths = () => h.uploadFileToGitHub.mock.calls.map(c => c[4]);
const deletedPaths = () => h.deleteFileFromGitHub.mock.calls.map(c => c[3]); // (token, owner, repo, path, message)
const feat = (id, lng) => ({
    type: 'Feature',
    properties: { HW_ID: id, 'Nom du site FR': id },
    geometry: { type: 'Point', coordinates: [lng, 33.8] },
});
const TRACK = [[33.8, 10.8], [33.81, 10.81]];

/** Index publié + circuits locaux ; `toPublish` = ids proposés par le diff. */
function setup({ index, locals, toPublish }) {
    h.mockState.loadedFeatures = ['R', 'L', 'P'].map((id, i) => feat(id, 10.8 + i / 100));
    h.mockState.officialCircuits = locals;
    h.mockState.myCircuits = [];
    h.mockState.testedCircuits = {};
    h.store = {};
    diffData.circuits = toPublish.map(id => ({ id, name: locals.find(c => c.id === id).name, changes: [] }));
    h.fetchWithTimeout.mockResolvedValue({ ok: true, json: async () => JSON.parse(JSON.stringify(index)) });
}

beforeEach(() => {
    vi.clearAllMocks();
    diffData.pois = [];
    diffData.stats = {};
    diffData.pendingPhotos = {};
    diffData.testedChanges = null;
    h.uploadFileToGitHub.mockImplementation(() => Promise.resolve());
});

describe('publishChanges — nom de circuit = fichier GPX', () => {
    it("renommage : l'ancien fichier encore utilisé par un AUTRE circuit n'est pas supprimé", async () => {
        // Les deux boucles pointaient vers le même fichier ; on renomme celle de Lella.
        setup({
            index: [
                { id: 'TAG', name: 'Boucle autour de Rym Beach', file: 'djerba/Boucle autour de Rym Beach.gpx', poiIds: ['R', 'P', 'R'] },
                { id: 'LEL', name: 'Boucle autour de Rym Beach', file: 'djerba/Boucle autour de Rym Beach.gpx', poiIds: ['R', 'L', 'R'] },
            ],
            locals: [
                { id: 'TAG', name: 'Boucle autour de Rym Beach', poiIds: ['R', 'P', 'R'], realTrack: TRACK },
                { id: 'LEL', name: 'Boucle autour de Rym Beach via Lella Hadhria', poiIds: ['R', 'L', 'R'], realTrack: TRACK },
            ],
            toPublish: ['LEL'],
        });

        await publishChanges();

        expect(uploadedPaths()).toContain(GPX('Boucle autour de Rym Beach via Lella Hadhria'));
        expect(deletedPaths()).not.toContain(GPX('Boucle autour de Rym Beach'));
    });

    it("renommage simple : l'ancien fichier est bien supprimé (inchangé)", async () => {
        setup({
            index: [{ id: 'LEL', name: 'Ancien nom', file: 'djerba/Ancien nom.gpx', poiIds: ['R', 'L', 'R'] }],
            locals: [{ id: 'LEL', name: 'Nouveau nom', poiIds: ['R', 'L', 'R'], realTrack: TRACK }],
            toPublish: ['LEL'],
        });

        await publishChanges();

        expect(uploadedPaths()).toContain(GPX('Nouveau nom'));
        expect(deletedPaths()).toContain(GPX('Ancien nom'));
    });

    it("nom déjà pris par un autre circuit publié : pas publié, message, le fichier de l'autre intact", async () => {
        setup({
            index: [{ id: 'TAG', name: 'Boucle autour de Rym Beach', file: 'djerba/Boucle autour de Rym Beach.gpx', poiIds: ['R', 'P', 'R'] }],
            locals: [
                { id: 'TAG', name: 'Boucle autour de Rym Beach', poiIds: ['R', 'P', 'R'], realTrack: TRACK },
                { id: 'NEW', name: 'boucle autour de rym BEACH', poiIds: ['R', 'L', 'R'], realTrack: TRACK },
            ],
            toPublish: ['NEW'],
        });

        await publishChanges();

        expect(uploadedPaths().some(p => /rym beach\.gpx$/i.test(p))).toBe(false);
        expect(deletedPaths()).toEqual([]);
        expect(h.showToast.mock.calls.some(c => String(c[0]).includes('un autre circuit porte déjà ce nom'))).toBe(true);
    });

    it('nom libre : publié normalement', async () => {
        setup({
            index: [{ id: 'TAG', name: 'Boucle autour de Rym Beach', file: 'djerba/Boucle autour de Rym Beach.gpx', poiIds: ['R', 'P', 'R'] }],
            locals: [
                { id: 'TAG', name: 'Boucle autour de Rym Beach', poiIds: ['R', 'P', 'R'], realTrack: TRACK },
                { id: 'NEW', name: 'Boucle autour de Rym Beach via L', poiIds: ['R', 'L', 'R'], realTrack: TRACK },
            ],
            toPublish: ['NEW'],
        });

        await publishChanges();

        expect(uploadedPaths()).toContain(GPX('Boucle autour de Rym Beach via L'));
    });
});
