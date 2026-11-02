// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// « Tout publier » envoie les rejets de candidats en attente en UN commit
// (02/11/2026), après le geojson. Échec → ils restent en attente.
// ============================================================================

const h = vi.hoisted(() => ({
    mockState: { currentMapId: 'charleroi', userData: {}, loadedFeatures: [], customFeatures: [], officialCircuits: [], myCircuits: [] },
    pending: 0,
    pushRejected: vi.fn(),
}));

vi.mock('../src/state.js', () => ({
    state: h.mockState,
    setUserData: (ud) => { h.mockState.userData = ud || {}; },
    setCustomFeatures: (f) => { h.mockState.customFeatures = f || []; },
    DEFAULT_MAP_ID: 'djerba',
    getActiveMapId: () => h.mockState.currentMapId,
}));
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/github-sync.js', () => ({
    uploadFileToGitHub: vi.fn(() => Promise.resolve()),
    deleteFileFromGitHub: vi.fn(() => Promise.resolve()),
    getStoredToken: vi.fn(() => 'tok'),
}));
vi.mock('../src/config.js', () => ({
    GITHUB_OWNER: 'o', GITHUB_REPO: 'r', RAW_BASE: 'https://example.com',
    GITHUB_PATHS: { geojson: (m) => `public/${m}.geojson`, circuits: () => '', circuitFile: () => '', photo: () => '', tested: () => '' },
    PERSONAL_KEYS: ['vu'],
}));
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
vi.mock('../src/rejected.js', () => ({ pendingRejectedCount: () => h.pending }));
vi.mock('../src/rejected-store.js', () => ({ pushRejected: h.pushRejected }));

import { publishChanges } from '../src/admin-control-center.js';
import { uploadFileToGitHub } from '../src/github-sync.js';
import { showConfirm } from '../src/modal.js';
import { showToast } from '../src/toast.js';

beforeEach(() => {
    vi.clearAllMocks();
    h.pending = 0;
    h.pushRejected.mockReset();
    h.pushRejected.mockResolvedValue();
});

describe('« Tout publier » et les rejets en attente', () => {
    it('rejets en attente : annoncés, envoyés une fois APRÈS le geojson, comptés dans le message du commit', async () => {
        h.pending = 3;
        const order = [];
        uploadFileToGitHub.mockImplementation(async () => { order.push('geojson'); });
        h.pushRejected.mockImplementation(async () => { order.push('rejets'); });

        await publishChanges();

        expect(showConfirm.mock.calls[0][1]).toContain('3 rejets de candidats seront aussi publiés');
        expect(h.pushRejected).toHaveBeenCalledTimes(1);
        expect(h.pushRejected).toHaveBeenCalledWith('charleroi');
        expect(order).toEqual(['geojson', 'rejets']);
        expect(uploadFileToGitHub.mock.calls[0][5]).toContain('3 rejet(s)');
    });

    it('aucun rejet en attente : rien à envoyer, rien d\'annoncé', async () => {
        await publishChanges();
        expect(h.pushRejected).not.toHaveBeenCalled();
        expect(showConfirm.mock.calls[0][1]).not.toContain('rejet');
    });

    it('envoi des rejets échoué : avertissement, la publication du geojson reste faite', async () => {
        h.pending = 1;
        h.pushRejected.mockRejectedValue(new Error('HTTP 409'));
        await publishChanges();
        expect(uploadFileToGitHub).toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/Rejets non publiés/), 'warning', 5000);
    });
});
