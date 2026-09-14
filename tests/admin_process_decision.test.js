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
        savePoiDataSpy: vi.fn(() => Promise.resolve()),
        saveAppStateSpy: vi.fn(() => Promise.resolve()),
        prepareDiffDataSpy: vi.fn(() => Promise.resolve()),
        renderTabSpy: vi.fn(),
        closeModalSpy: vi.fn(),
        showConfirmSpy: vi.fn(() => Promise.resolve(true)),
        fetchWithTimeoutSpy: vi.fn(),
        revertCircuitToPublishedSpy: vi.fn(() => Promise.resolve()),
    };
});

const mockState = h.mockState;
const setUserDataSpy = h.setUserDataSpy;
const clearPendingAdminPhotosSpy = h.clearPendingAdminPhotosSpy;
const deletePoiDataSpy = h.deletePoiDataSpy;
const saveAppStateSpy = h.saveAppStateSpy;
const prepareDiffDataSpy = h.prepareDiffDataSpy;
const renderTabSpy = h.renderTabSpy;

vi.mock('../src/state.js', () => {
    const mod = ({
    state: h.mockState,
    setUserData: (d) => h.setUserDataSpy(d),
    setOfficialCircuitsStatus: (d) => h.setOfficialCircuitsStatusSpy(d),
    setHiddenPoiIds: (d) => h.setHiddenPoiIdsSpy(d),
});
    // Ajout 07/09/2026 : getActiveMapId lit le MEME etat mocke que le module,
    // pour qu'un test qui change currentMapId change aussi la cle resolue.
    mod.DEFAULT_MAP_ID = 'djerba';
    mod.getActiveMapId = () => mod.state.currentMapId || mod.state.destinations?.activeMapId || 'djerba';
    return mod;
});

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
    // Sous-ensemble fidèle du vrai config.js (workPhotos compris : c'est une clé perso).
    PERSONAL_KEYS: ['vu', 'notes', 'workPhotos']
}));

vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../src/modal.js', () => ({
    showConfirm: (...a) => h.showConfirmSpy(...a),
    closeModal: () => h.closeModalSpy()
}));

// Scope 'circuit' : relecture de l'index publié + point d'écriture circuit-store.
vi.mock('../src/net.js', () => ({
    fetchWithTimeout: (...a) => h.fetchWithTimeoutSpy(...a)
}));

vi.mock('../src/circuit-store.js', () => ({
    forgetDeletedCircuit: vi.fn(() => Promise.resolve()),
    revertCircuitToPublished: (...a) => h.revertCircuitToPublishedSpy(...a)
}));

vi.mock('../src/circuit-deletion-state.js', () => ({
    setOfficialCircuitDeleted: vi.fn(() => Promise.resolve()),
    isOfficialCircuitDeleted: () => false,
    withoutServerDeletedCircuits: (l) => l
}));

vi.mock('../src/database.js', () => ({
    saveAppState: (k, v) => h.saveAppStateSpy(k, v),
    getAppState: vi.fn(() => Promise.resolve(null)),
    getPendingAdminPhotos: vi.fn(() => Promise.resolve([])),
    setPendingAdminPhotos: vi.fn(() => Promise.resolve()),
    clearPendingAdminPhotos: (m, id) => h.clearPendingAdminPhotosSpy(m, id),
    deletePoiData: (m, id) => h.deletePoiDataSpy(m, id),
    savePoiData: (m, id, d) => h.savePoiDataSpy(m, id, d),
}));

vi.mock('../src/photo-service.js', () => ({
    uploadPhotoForPoi: vi.fn()
}));

vi.mock('../src/admin-diff-engine.js', () => ({
    reconcileLocalChanges: vi.fn(),
    prepareDiffData: () => h.prepareDiffDataSpy(),
    // Stub inerte du purge — pas de logique testée ici, juste ne pas crasher.
    purgeOrphanPendingPois: vi.fn(() => Promise.resolve([])),
    purgeOrphanPendingCircuits: vi.fn(() => []),
    diffData: { pois: [], circuits: [], stats: {}, pendingPhotos: {}, originalFeatures: [] }
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
        // Plus d'écriture dans la copie globale appState `userData` (14/09/2026) :
        // le store par destination est le seul domicile.
        expect(saveAppStateSpy).not.toHaveBeenCalledWith('userData', expect.anything());
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

    // Régression du 14/09/2026 : « Annuler » effaçait tout l'overlay, notes
    // comprises (9 notes retrouvées sur le dépôt privé, absentes du poste).
    it('scope="poi" : GARDE les clés personnelles (note, vu, photos de travail)', async () => {
        const f = setupPoi('poi_1', {}, {
            Description: 'modif à annuler',
            notes: 'ma note',
            vu: true,
            workPhotos: ['djerba/work_poi_1_1.jpg'],
        });

        await processDecision('poi_1', 'refuse', 'poi');

        const kept = { notes: 'ma note', vu: true, workPhotos: ['djerba/work_poi_1_1.jpg'] };
        expect(mockState.userData['poi_1']).toEqual(kept);
        expect(f.properties.userData).toEqual(kept);
        // Entrée REMPLACÉE en base : suppression puis réécriture des seules clés perso
        expect(deletePoiDataSpy).toHaveBeenCalledWith('djerba', 'poi_1');
        expect(h.savePoiDataSpy).toHaveBeenCalledWith('djerba', 'poi_1', kept);
        expect(deletePoiDataSpy.mock.invocationCallOrder[0]).toBeLessThan(h.savePoiDataSpy.mock.invocationCallOrder[0]);
    });

    it('scope="poi" sans clé personnelle : entrée supprimée, rien de réécrit', async () => {
        setupPoi('poi_1', {}, { Description: 'modif à annuler' });

        await processDecision('poi_1', 'refuse', 'poi');

        expect(mockState.userData['poi_1']).toBeUndefined();
        expect(deletePoiDataSpy).toHaveBeenCalledWith('djerba', 'poi_1');
        expect(h.savePoiDataSpy).not.toHaveBeenCalled();
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

// ─────────────────────────────────────────────────────────────────────────────
// scope='circuit' — « Annuler » une MODIFICATION non publiée (13/09/2026).
// Avant, seule une suppression en attente était défaite : sur une carte
// « MODIFIÉ », le diff était recalculé et la carte revenait, édition intacte.
describe("processDecision — scope='circuit' : annuler une modification", () => {
    const PUBLISHED = { id: 'HW-off', name: 'Nom publié', poiIds: ['a', 'b'] };
    const okIndex = (list) => ({ ok: true, json: async () => JSON.parse(JSON.stringify(list)) });

    beforeEach(() => {
        vi.clearAllMocks();
        h.showConfirmSpy.mockImplementation(() => Promise.resolve(true));
        h.revertCircuitToPublishedSpy.mockImplementation(() => Promise.resolve());
        document.body.innerHTML = '<div id="cc-diff-item-HW-off"></div>';
    });

    it("après confirmation, rétablit la version publiée", async () => {
        h.fetchWithTimeoutSpy.mockResolvedValue(okIndex([PUBLISHED, { id: 'HW-autre', name: 'Autre' }]));

        await processDecision('HW-off', 'refuse', 'circuit');

        expect(h.showConfirmSpy).toHaveBeenCalledTimes(1);
        expect(h.revertCircuitToPublishedSpy).toHaveBeenCalledWith(PUBLISHED);
        expect(prepareDiffDataSpy).toHaveBeenCalled(); // re-diff + re-render ensuite
    });

    it("ne touche à rien si l'admin garde sa modification", async () => {
        h.fetchWithTimeoutSpy.mockResolvedValue(okIndex([PUBLISHED]));
        h.showConfirmSpy.mockImplementation(() => Promise.resolve(false));

        await processDecision('HW-off', 'refuse', 'circuit');

        expect(h.revertCircuitToPublishedSpy).not.toHaveBeenCalled();
    });

    it("n'efface JAMAIS une création non publiée (absente de l'index)", async () => {
        h.fetchWithTimeoutSpy.mockResolvedValue(okIndex([{ id: 'HW-autre', name: 'Autre' }]));

        await processDecision('HW-neuf', 'refuse', 'circuit');

        expect(h.showConfirmSpy).not.toHaveBeenCalled();
        expect(h.revertCircuitToPublishedSpy).not.toHaveBeenCalled();
    });

    it("ne touche à rien si l'index publié est illisible", async () => {
        h.fetchWithTimeoutSpy.mockResolvedValue({ ok: false, status: 500 });

        await processDecision('HW-off', 'refuse', 'circuit');

        expect(h.showConfirmSpy).not.toHaveBeenCalled();
        expect(h.revertCircuitToPublishedSpy).not.toHaveBeenCalled();
    });
});
