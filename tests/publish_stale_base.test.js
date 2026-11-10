// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Régression 10/11/2026 — « Beffroi de Charleroi ».
// 11:28 : publication avec photo + Vérifié. 11:32 : l'app, rechargée entre-temps,
// avait relu la carte d'AVANT (RAW garde 5 min) ; « Tout publier » réécrit tout
// le geojson depuis la mémoire → photo effacée, Vérifié décoché.
// Désormais : la carte chargée doit être la version en ligne, sinon RIEN ne part.
// publish-base.js n'est PAS mocké ici ; seule la lecture de version l'est.
// ============================================================================

const h = vi.hoisted(() => ({
    mockState: { currentMapId: 'charleroi', userData: {}, loadedFeatures: [], customFeatures: [], officialCircuits: [], myCircuits: [] },
    uploads: [],
    remoteSha: 'SHA_EN_LIGNE',
    putStatus: 200,
    pendingStore: new Map(),
}));

vi.mock('../src/state.js', () => {
    const mod = {
        state: h.mockState,
        setUserData: (ud) => { h.mockState.userData = ud || {}; },
        setCustomFeatures: (f) => { h.mockState.customFeatures = f || []; },
        DEFAULT_MAP_ID: 'djerba',
    };
    mod.getActiveMapId = () => mod.state.currentMapId;
    return mod;
});
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/github-sync.js', () => ({
    uploadFileToGitHub: vi.fn(async (file, token, owner, repo, path, message, opts) => {
        if (h.putStatus !== 200) { const e = new Error(`HTTP ${h.putStatus}`); e.status = h.putStatus; throw e; }
        h.uploads.push({ file, path, message, opts });
        return { content: { sha: 'SHA_APRES_PUBLICATION' } };
    }),
    deleteFileFromGitHub: vi.fn(async () => {}),
    getStoredToken: vi.fn(() => 'fake_token'),
}));
vi.mock('../src/repo-read.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getRepoFileSha: vi.fn(async () => h.remoteSha),
}));
vi.mock('../src/config.js', () => ({
    GITHUB_OWNER: 'owner', GITHUB_REPO: 'repo', GITHUB_BRANCH: 'main', RAW_BASE: 'https://example.com',
    GITHUB_PATHS: { geojson: (m) => `public/${m}.geojson`, circuits: () => '', circuitFile: () => '', photo: () => '', tested: () => '' },
    PERSONAL_KEYS: ['vu'],
}));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn(() => Promise.resolve(true)), showAlert: vi.fn(), closeModal: vi.fn() }));
vi.mock('../src/database.js', () => ({
    saveAppState: vi.fn(async () => {}),
    getAppState: vi.fn(async () => null),
    getPendingAdminPhotos: (mapId, poiId) => Promise.resolve(h.pendingStore.get(poiId) || []),
    setPendingAdminPhotos: vi.fn(async () => {}),
    clearPendingAdminPhotos: vi.fn(async () => {}),
    deletePoiData: vi.fn(async () => {}),
    savePoiData: vi.fn(async () => {}),
    removePoiDataKeys: vi.fn(async () => 0),
}));
vi.mock('../src/photo-service.js', () => ({ uploadPhotoForPoi: vi.fn(async () => 'https://photos/neuve.jpg') }));
vi.mock('../src/admin-diff-engine.js', () => ({
    reconcileLocalChanges: vi.fn(),
    prepareDiffData: vi.fn(async () => {}),
    purgeOrphanPendingPois: vi.fn(() => []),
    purgeOrphanPendingCircuits: vi.fn(() => []),
    diffData: { pois: [], circuits: [], stats: {}, pendingPhotos: {}, testedChanges: null },
}));
vi.mock('../src/admin-control-ui.js', () => ({ openControlCenterModal: vi.fn(), renderTab: vi.fn(), closeCCModal: vi.fn() }));

import { publishChanges } from '../src/admin-control-center.js';
import { diffData } from '../src/admin-diff-engine.js';
import { showAlert } from '../src/modal.js';
import { uploadPhotoForPoi } from '../src/photo-service.js';
import { setLoadedGeojsonSha, getLoadedGeojsonSha } from '../src/repo-read.js';

const ID = 'HW-01M616BRWS5WR93VM1BQWVN5GX';

/** Le Beffroi tel que l'app l'a relu à 11:3x : version d'AVANT 11:28. */
function beffroiPerime() {
    const userData = { description: 'Texte corrigé' };
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [4.4436702, 50.4125544] },
        properties: { HW_ID: ID, 'Nom du site FR': 'Beffroi de Charleroi', verified: false, description: 'Ancien texte', userData },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    h.uploads.length = 0;
    h.pendingStore.clear();
    h.remoteSha = 'SHA_EN_LIGNE';
    h.putStatus = 200;
    const f = beffroiPerime();
    h.mockState.loadedFeatures = [f];
    h.mockState.userData = { [ID]: f.properties.userData };
    diffData.pois = [{ id: ID, name: 'Beffroi de Charleroi', changes: [{ key: 'description', old: 'Ancien texte', new: 'Texte corrigé' }] }];
    diffData.circuits = [];
    diffData.pendingPhotos = {};
    diffData.stats = { poisModified: 1, photosAdded: 0, pendingPhotoCount: 0 };
    diffData.testedChanges = null;
});

describe('publishChanges — carte chargée plus ancienne que la version en ligne', () => {
    it("REFUSE la publication : rien n'est envoyé, l'admin est prévenu", async () => {
        setLoadedGeojsonSha('charleroi', 'SHA_AVANT_11H28');   // l'app a chargé l'ancienne carte
        h.remoteSha = 'SHA_PUBLICATION_11H28';                  // en ligne : photo + Vérifié

        await publishChanges();

        expect(h.uploads).toHaveLength(0);
        expect(showAlert).toHaveBeenCalledWith('Publication refusée', expect.stringContaining('Rechargez'));
        // La modification en attente n'est pas consommée.
        expect(h.mockState.userData[ID]).toEqual({ description: 'Texte corrigé' });
    });

    it("refuse AVANT d'envoyer les photos en attente", async () => {
        setLoadedGeojsonSha('charleroi', 'SHA_AVANT');
        h.remoteSha = 'SHA_APRES';
        h.pendingStore.set(ID, [{ id: 'ph1', blob: new Blob(['x']), skipPublish: false }]);
        diffData.pendingPhotos = { [ID]: [{ id: 'ph1' }] };

        await publishChanges();

        expect(uploadPhotoForPoi).not.toHaveBeenCalled();
        expect(h.uploads).toHaveLength(0);
    });

    it('refuse aussi quand la version chargée est inconnue (carte venue du cache)', async () => {
        setLoadedGeojsonSha('charleroi', null);
        await publishChanges();
        expect(h.uploads).toHaveLength(0);
        expect(showAlert).toHaveBeenCalled();
    });
});

describe('publishChanges — carte à jour', () => {
    it('publie en imposant la version attendue, puis retient la nouvelle version', async () => {
        setLoadedGeojsonSha('charleroi', 'SHA_EN_LIGNE');

        await publishChanges();

        const geo = h.uploads.find(u => u.path === 'public/charleroi.geojson');
        expect(geo).toBeTruthy();
        expect(geo.opts).toEqual({ expectedSha: 'SHA_EN_LIGNE' });
        expect(getLoadedGeojsonSha('charleroi')).toBe('SHA_APRES_PUBLICATION');
        expect(showAlert).not.toHaveBeenCalled();
    });

    it('deux publications de suite dans la même session passent', async () => {
        setLoadedGeojsonSha('charleroi', 'SHA_EN_LIGNE');
        await publishChanges();
        h.remoteSha = 'SHA_APRES_PUBLICATION';
        diffData.pois = [{ id: ID, name: 'Beffroi de Charleroi', changes: [{ key: 'Source', old: '', new: 'x' }] }];
        h.mockState.userData = { [ID]: { Source: 'x' } };
        h.mockState.loadedFeatures[0].properties.userData = h.mockState.userData[ID];

        await publishChanges();

        expect(h.uploads.filter(u => u.path === 'public/charleroi.geojson')).toHaveLength(2);
        expect(h.uploads[1].opts).toEqual({ expectedSha: 'SHA_APRES_PUBLICATION' });
    });

    it('GitHub refuse l\'envoi (409, carte changée entre-temps) : publication refusée', async () => {
        setLoadedGeojsonSha('charleroi', 'SHA_EN_LIGNE');
        h.putStatus = 409;

        await publishChanges();

        expect(showAlert).toHaveBeenCalledWith('Publication refusée', expect.any(String));
        expect(getLoadedGeojsonSha('charleroi')).toBe('SHA_EN_LIGNE');
    });
});
