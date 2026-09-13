// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Publication d'une SUPPRESSION de circuit — oubli de la copie locale.
//
// Régression du 13/09/2026 : éditer un officiel enregistre sa version modifiée
// en base locale. Une fois sa suppression publiée (poubelle du panneau Circuit
// → « Tout publier »), cette copie restait : au F5, rattachée à aucune entrée
// d'index, elle devenait un circuit orphelin — masqué de la liste mais
// « NOUVEAU » au diff du CC, et republié au « Tout publier » suivant.
//
// La purge ne doit intervenir qu'APRÈS l'écriture de l'index : si elle échoue,
// l'intention de suppression doit survivre pour être rejouée.
// ============================================================================

const h = vi.hoisted(() => ({
    mockState: {
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
}));

vi.mock('../src/state.js', () => {
    const mod = ({
        state: h.mockState,
        setUserData: (ud) => { h.mockState.userData = ud || {}; },
        setCustomFeatures: (f) => { h.mockState.customFeatures = f || []; },
        setOfficialCircuits: (l) => { h.mockState.officialCircuits = l || []; },
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
        circuitFile: () => '', photo: () => '', tested: () => '',
    },
    PERSONAL_KEYS: ['vu', 'vuManual', 'notes', 'incontournable'],
}));
vi.mock('../src/net.js', () => ({ fetchWithTimeout: h.fetchWithTimeout }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn(() => Promise.resolve(true)), closeModal: vi.fn() }));
vi.mock('../src/database.js', () => ({
    saveAppState: vi.fn(() => Promise.resolve()),
    getAppState: vi.fn(() => Promise.resolve(null)),
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
vi.mock('../src/gpx.js', () => ({ generateGPXString: vi.fn() }));
vi.mock('../src/admin-diff-engine.js', () => ({
    reconcileLocalChanges: vi.fn(),
    prepareDiffData: vi.fn(() => Promise.resolve()),
    purgeOrphanPendingPois: vi.fn(() => []),
    purgeOrphanPendingCircuits: vi.fn(() => []),
    diffData: { pois: [], circuits: [], stats: {}, pendingPhotos: {}, testedChanges: null },
}));

import { publishChanges } from '../src/admin-control-center.js';
import { diffData } from '../src/admin-diff-engine.js';

const INDEX = [
    { id: 'HW-DEL', name: 'À supprimer', file: 'djerba/À supprimer.gpx' },
    { id: 'HW-KEEP', name: 'Gardé', file: 'djerba/Gardé.gpx' },
];
const INDEX_PATH = 'public/circuits/djerba.json';

beforeEach(() => {
    vi.clearAllMocks();
    diffData.pois = [];
    diffData.stats = {};
    diffData.pendingPhotos = {};
    diffData.testedChanges = null;
    diffData.circuits = [{ id: 'HW-DEL', name: 'À supprimer', changes: [], isDeletion: true }];
    h.fetchWithTimeout.mockResolvedValue({ ok: true, json: async () => JSON.parse(JSON.stringify(INDEX)) });
    h.uploadFileToGitHub.mockImplementation(() => Promise.resolve());
});

const indexUploadOrder = () => {
    const i = h.uploadFileToGitHub.mock.calls.findIndex(c => c[4] === INDEX_PATH);
    return i > -1 ? h.uploadFileToGitHub.mock.invocationCallOrder[i] : null;
};

describe('publishChanges — suppression de circuit publiée', () => {
    it("oublie la copie locale du circuit supprimé, APRÈS l'écriture de l'index", async () => {
        await publishChanges();

        expect(h.forgetDeletedCircuit).toHaveBeenCalledWith('HW-DEL');
        expect(indexUploadOrder()).not.toBeNull();
        expect(h.forgetDeletedCircuit.mock.invocationCallOrder[0]).toBeGreaterThan(indexUploadOrder());
    });

    it("ne touche pas aux circuits qui ne sont pas supprimés", async () => {
        await publishChanges();

        expect(h.forgetDeletedCircuit).not.toHaveBeenCalledWith('HW-KEEP');
    });

    it("n'oublie RIEN si l'écriture de l'index échoue (l'intention doit survivre)", async () => {
        h.uploadFileToGitHub.mockImplementation((file, tok, o, r, path) =>
            path === INDEX_PATH ? Promise.reject(new Error('409')) : Promise.resolve());

        await publishChanges();

        expect(h.forgetDeletedCircuit).not.toHaveBeenCalled();
        expect(h.setOfficialCircuitDeleted).not.toHaveBeenCalled();
    });
});
