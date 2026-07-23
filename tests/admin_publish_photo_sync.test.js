// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Régression : publier des photos SANS autre modification sur le POI doit
// bien faire apparaître les nouvelles URLs dans le geojson envoyé à GitHub.
//
// Avant correctif : publishChanges() mettait à jour state.userData[poiId]
// mais jamais feature.properties.userData — le champ que lit réellement
// generateMasterGeoJSONData (admin-geojson.js). Résultat : le commit GitHub
// annonçait « N photo(s) » mais le geojson publié restait inchangé
// (photos: []), tant qu'aucune AUTRE modification du POI ne forçait par
// ailleurs cette synchronisation.
//
// admin-geojson.js n'est PAS mocké ici : le test doit passer par le vrai
// generateMasterGeoJSONData pour être un révélateur fiable de la régression.
// ============================================================================

const h = vi.hoisted(() => {
    const mockState = {
        currentMapId: 'djerba',
        userData: {},
        loadedFeatures: [],
        customFeatures: [],
        officialCircuits: [],
        myCircuits: [],
    };
    return {
        mockState,
        uploadedFiles: [],
        pendingStore: new Map(),
    };
});

vi.mock('../src/state.js', () => ({
    state: h.mockState,
    setUserData: (ud) => { h.mockState.userData = ud || {}; },
    setCustomFeatures: (f) => { h.mockState.customFeatures = f || []; },
}));

vi.mock('../src/events.js', () => ({
    eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() }
}));

vi.mock('../src/lucide-icons.js', () => ({
    createIcons: vi.fn(),
    appIcons: {}
}));

vi.mock('../src/github-sync.js', () => ({
    uploadFileToGitHub: (file, token, owner, repo, path, message) => {
        h.uploadedFiles.push({ file, path, message });
        return Promise.resolve();
    },
    deleteFileFromGitHub: vi.fn(() => Promise.resolve()),
    getStoredToken: vi.fn(() => 'fake_token'),
}));

vi.mock('../src/config.js', () => ({
    GITHUB_OWNER: 'owner', GITHUB_REPO: 'repo', RAW_BASE: 'https://example.com',
    GITHUB_PATHS: { geojson: (m) => `public/${m}.geojson`, circuits: () => '', circuitFile: () => '', photo: () => '', tested: () => '' },
    PERSONAL_KEYS: ['vu']
}));

vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn(() => Promise.resolve(true)), closeModal: vi.fn() }));

vi.mock('../src/database.js', () => ({
    saveAppState: vi.fn(() => Promise.resolve()),
    getAppState: vi.fn(() => Promise.resolve(null)),
    getPendingAdminPhotos: (mapId, poiId) => Promise.resolve(h.pendingStore.get(poiId) || []),
    setPendingAdminPhotos: vi.fn(() => Promise.resolve()),
    clearPendingAdminPhotos: vi.fn(() => Promise.resolve()),
    deletePoiData: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/photo-service.js', () => ({
    uploadPhotoForPoi: vi.fn(() => Promise.resolve('photos/poi_TEST_123.jpg'))
}));

vi.mock('../src/admin-diff-engine.js', () => ({
    reconcileLocalChanges: vi.fn(),
    prepareDiffData: vi.fn(() => Promise.resolve()),
    purgeOrphanPendingPois: vi.fn(() => []),
    purgeOrphanPendingCircuits: vi.fn(() => []),
    diffData: {
        pois: [],
        circuits: [],
        stats: { pendingPhotoCount: 0, poisModified: 0, photosAdded: 0 },
        pendingPhotos: {},
        testedChanges: null,
    }
}));

vi.mock('../src/admin-control-ui.js', () => ({
    openControlCenterModal: vi.fn(),
    renderTab: vi.fn(),
    closeCCModal: vi.fn(),
}));

import { publishChanges } from '../src/admin-control-center.js';
import { diffData } from '../src/admin-diff-engine.js';
import { state } from '../src/state.js';
import { getPoiId } from '../src/utils.js';

beforeEach(() => {
    vi.clearAllMocks();
    h.uploadedFiles.length = 0;
    h.pendingStore.clear();
    h.mockState.userData = {};
    h.mockState.customFeatures = [];
    diffData.pois = [];
    diffData.circuits = [];
    diffData.pendingPhotos = {};
    diffData.stats = { pendingPhotoCount: 0, poisModified: 0, photosAdded: 0 };
    diffData.testedChanges = null;
});

function buildFeature(id) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [10.9, 33.8] },
        properties: {
            HW_ID: id,
            'Nom du site FR': 'Mosquée Test',
            photos: [],
            userData: {},
        }
    };
}

describe('publishChanges — synchronisation photos (régression)', () => {
    it("répercute une photo nouvellement uploadée dans le geojson publié, même si le POI n'a AUCUNE autre modification en attente", async () => {
        const poiId = 'HW-TEST0000000000000001';
        const feature = buildFeature(poiId);
        h.mockState.loadedFeatures = [feature];

        // Photo seule en attente pour ce POI : rien d'autre (pas de poisModified),
        // exactement le scénario qui déclenchait le bug.
        h.pendingStore.set(poiId, [{ id: 'ph1', blob: new Blob(['x']), skipPublish: false }]);
        diffData.pendingPhotos = { [poiId]: [{ id: 'ph1', skipPublish: false }] };
        diffData.stats = { pendingPhotoCount: 1, poisModified: 0, photosAdded: 0 };

        await publishChanges();

        const geojsonUpload = h.uploadedFiles.find(u => u.path === 'public/djerba.geojson');
        expect(geojsonUpload).toBeTruthy();

        const text = await geojsonUpload.file.text();
        const published = JSON.parse(text);
        const publishedFeature = published.features.find(f => f.properties.HW_ID === poiId);

        expect(publishedFeature.properties.photos).toContain('photos/poi_TEST_123.jpg');

        // Le message de commit doit lui aussi refléter la réalité désormais.
        expect(geojsonUpload.message).toContain('1 photo(s)');
    });
});
