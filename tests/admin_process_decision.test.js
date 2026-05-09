// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// admin-control-center.processDecision (PR B2)
//
// Le sub-router de l'onglet Modifications expose 2 scopes pour le refus :
//  - scope='poi'    : revert userData + geometry, GARDE les photos pending
//                     (changement B2 vs comportement legacy qui purgait tout)
//  - scope='photos' : supprime UNIQUEMENT les photos pending pour ce POI,
//                     ne touche pas au reste
// ============================================================================

// vi.hoisted permet de partager des variables entre la factory de mock
// (hoistée en haut du fichier) et le reste des tests.
const h = vi.hoisted(() => {
    const mockState = {
        currentMapId: 'djerba',
        userData: {},
        loadedFeatures: []
    };
    return {
        mockState,
        setUserDataSpy: vi.fn(d => { mockState.userData = d; }),
        setOfficialCircuitsStatusSpy: vi.fn(),
        setHiddenPoiIdsSpy: vi.fn(),
        clearPendingAdminPhotosSpy: vi.fn(() => Promise.resolve()),
        deletePoiDataSpy: vi.fn(() => Promise.resolve()),
        saveAppStateSpy: vi.fn(() => Promise.resolve()),
        prepareDiffDataSpy: vi.fn(() => Promise.resolve()),
        renderTabSpy: vi.fn(),
        closeModalSpy: vi.fn(),
    };
});

const mockState = h.mockState;
const setUserDataSpy = h.setUserDataSpy;
const clearPendingAdminPhotosSpy = h.clearPendingAdminPhotosSpy;
const deletePoiDataSpy = h.deletePoiDataSpy;
const saveAppStateSpy = h.saveAppStateSpy;
const prepareDiffDataSpy = h.prepareDiffDataSpy;
const renderTabSpy = h.renderTabSpy;

vi.mock('../src/state.js', () => ({
    state: h.mockState,
    setUserData: (d) => h.setUserDataSpy(d),
    setOfficialCircuitsStatus: (d) => h.setOfficialCircuitsStatusSpy(d),
    setHiddenPoiIds: (d) => h.setHiddenPoiIdsSpy(d),
}));

vi.mock('../src/utils.js', () => ({
    getPoiId: (f) => f?.properties?.HW_ID
}));

vi.mock('../src/events.js', () => ({
    eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() }
}));

vi.mock('../src/lucide-icons.js', () => ({
    createIcons: vi.fn(),
    appIcons: {}
}));

vi.mock('../src/admin-geojson.js', () => ({
    generateMasterGeoJSONData: vi.fn(() => ({ features: [] }))
}));

vi.mock('../src/github-sync.js', () => ({
    uploadFileToGitHub: vi.fn(),
    deleteFileFromGitHub: vi.fn(),
    getStoredToken: vi.fn(() => 'fake_token')
}));

vi.mock('../src/config.js', () => ({
    GITHUB_OWNER: 'owner',
    GITHUB_REPO: 'repo',
    RAW_BASE: 'https://example.com',
    GITHUB_PATHS: {
        geojson: () => 'geojson',
        circuits: () => 'circuits',
        circuitFile: () => 'cf',
        photo: () => 'photo',
        tested: () => 'tested',
    },
    PERSONAL_KEYS: ['vu', 'notes']
}));

vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../src/modal.js', () => ({
    showConfirm: vi.fn(),
    closeModal: () => h.closeModalSpy()
}));

vi.mock('../src/database.js', () => ({
    saveAppState: (k, v) => h.saveAppStateSpy(k, v),
    getAppState: vi.fn(() => Promise.resolve(null)),
    getPendingAdminPhotos: vi.fn(() => Promise.resolve([])),
    setPendingAdminPhotos: vi.fn(() => Promise.resolve()),
    clearPendingAdminPhotos: (m, id) => h.clearPendingAdminPhotosSpy(m, id),
    deletePoiData: (m, id) => h.deletePoiDataSpy(m, id),
}));

vi.mock('../src/photo-service.js', () => ({
    uploadPhotoForPoi: vi.fn()
}));

vi.mock('../src/admin-diff-engine.js', () => ({
    reconcileLocalChanges: vi.fn(),
    prepareDiffData: () => h.prepareDiffDataSpy(),
    diffData: { pois: [], circuits: [], stats: {}, pendingPhotos: {} }
}));

vi.mock('../src/admin-control-ui.js', () => ({
    openControlCenterModal: vi.fn(),
    renderTab: (tab, diff, cbs) => h.renderTabSpy(tab, diff, cbs)
}));

// L'import doit venir après les mocks
import { processDecision } from '../src/admin-control-center.js';

function setupPoi(id, props = {}, userData = null, geom = [10, 33]) {
    const f = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: geom },
        properties: { HW_ID: id, ...props, userData: userData || {} }
    };
    mockState.loadedFeatures = [f];
    if (userData) mockState.userData[id] = userData;
    return f;
}

describe('processDecision — scope handling (PR B2)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockState.userData = {};
        mockState.loadedFeatures = [];
        // Stub minimal du DOM pour que le `card.remove()` ne plante pas
        document.body.innerHTML = '<div id="cc-diff-item-poi_1"></div>';
    });

    // ─────────────── scope='photos' ───────────────

    it('scope="photos" : appelle clearPendingAdminPhotos UNIQUEMENT', async () => {
        setupPoi('poi_1', { Description: 'X' }, { Description: 'X' });
        await processDecision('poi_1', 'refuse', 'photos');

        expect(clearPendingAdminPhotosSpy).toHaveBeenCalledWith('djerba', 'poi_1');
        // Ne touche PAS au reste
        expect(setUserDataSpy).not.toHaveBeenCalled();
        expect(deletePoiDataSpy).not.toHaveBeenCalled();
        expect(saveAppStateSpy).not.toHaveBeenCalled();
    });

    it('scope="photos" : déclenche un re-render après suppression', async () => {
        setupPoi('poi_1');
        await processDecision('poi_1', 'refuse', 'photos');
        expect(prepareDiffDataSpy).toHaveBeenCalled();
        expect(renderTabSpy).toHaveBeenCalledWith('changes', expect.anything(), expect.anything());
    });

    it('scope="photos" : userData reste inchangé même s\'il existe', async () => {
        setupPoi('poi_1', {}, { Description: 'gardé', notes: 'priv' });
        const before = { ...mockState.userData['poi_1'] };
        await processDecision('poi_1', 'refuse', 'photos');
        expect(mockState.userData['poi_1']).toEqual(before);
    });

    // ─────────────── scope='poi' (default) ───────────────

    it('scope="poi" : revert userData + persiste, MAIS NE PURGE PAS les photos (changement B2)', async () => {
        setupPoi('poi_1', {}, { Description: 'à supprimer' });
        await processDecision('poi_1', 'refuse', 'poi');

        // Revert
        expect(setUserDataSpy).toHaveBeenCalled();
        expect(saveAppStateSpy).toHaveBeenCalledWith('userData', expect.anything());
        expect(deletePoiDataSpy).toHaveBeenCalledWith('djerba', 'poi_1');
        // PAS de purge des photos pending (B2)
        expect(clearPendingAdminPhotosSpy).not.toHaveBeenCalled();
    });

    it('scope="poi" sans param : default = "poi"', async () => {
        setupPoi('poi_1', {}, { Description: 'x' });
        await processDecision('poi_1', 'refuse'); // pas de scope explicite
        expect(setUserDataSpy).toHaveBeenCalled();
        expect(clearPendingAdminPhotosSpy).not.toHaveBeenCalled();
    });

    it('scope="poi" : feature.properties.userData rebind après revert', async () => {
        const userData = { Description: 'à clean' };
        const f = setupPoi('poi_1', {}, userData);
        await processDecision('poi_1', 'refuse', 'poi');
        // Le bind doit cibler state.userData[id] || {} — aprés revert,
        // state.userData[id] est undefined → feature.properties.userData = {}
        expect(f.properties.userData).toEqual({});
    });

    // ─────────────── decision !== 'refuse' (accept) ───────────────

    it('decision !== "refuse" : pas de revert, juste UI grisée', async () => {
        setupPoi('poi_1', {}, { Description: 'x' });
        await processDecision('poi_1', 'accept');
        expect(setUserDataSpy).not.toHaveBeenCalled();
        expect(clearPendingAdminPhotosSpy).not.toHaveBeenCalled();
        expect(deletePoiDataSpy).not.toHaveBeenCalled();
    });
});
