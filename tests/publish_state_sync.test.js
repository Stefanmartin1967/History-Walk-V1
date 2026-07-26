// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Alignement de l'état mémoire après publication (cause racine des pertes
// de données du 26/07 — Mosquée de Midoun, puis Marabout Bouziri).
//
// Le bug : publier vidait `state.userData[id]` sans reporter les valeurs dans
// `feature.properties`. La fiche (qui lit feature.properties.userData, conservé)
// affichait le neuf ; le RichEditor (qui lit state.userData, vidé) rouvrait sur
// les valeurs d'AVANT l'édition. L'admin corrigeait un champ, enregistrait, et
// republiait l'ancien contenu par-dessus le neuf — sans rien voir.
//
// Le test « rouvrir l'éditeur » reproduit exactement `merged` de richEditor.js.
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
}));

vi.mock('../src/state.js', () => ({
    state: h.mockState,
    setUserData: (ud) => { h.mockState.userData = ud || {}; },
    setCustomFeatures: (f) => { h.mockState.customFeatures = f || []; },
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
    PERSONAL_KEYS: ['vu', 'vuManual', 'notes', 'incontournable'],
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

import { publishChanges } from '../src/admin-control-center.js';
import { diffData } from '../src/admin-diff-engine.js';
import { state } from '../src/state.js';

const ID = 'HW-TEST0001';

/** Reproduit la fusion de richEditor.js (ligne « const merged = ... »). */
function ceQueVoitLEditeur(feature) {
    return { ...feature.properties, ...(state.userData[ID] || {}) };
}

function poser({ base = {}, overlay = {} } = {}) {
    const feature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [10.9, 33.8] },
        properties: { HW_ID: ID, 'Nom du site FR': 'Marabout Bouziri', ...base },
    };
    if (Object.keys(overlay).length) feature.properties.userData = overlay;
    state.loadedFeatures = [feature];
    state.userData = Object.keys(overlay).length ? { [ID]: { ...overlay } } : {};
    return feature;
}

beforeEach(() => {
    vi.clearAllMocks();
    state.customFeatures = [];
    diffData.pois = [];
    diffData.circuits = [];
    diffData.stats = {};
    diffData.pendingPhotos = {};
    diffData.testedChanges = null;
});

describe('publishChanges — état mémoire après publication', () => {
    it("RÉGRESSION : rouvrir l'éditeur montre les valeurs PUBLIÉES, pas celles d'avant", async () => {
        const feature = poser({
            overlay: {
                'Nom du site FR': 'Mausolée Fkih Kacem El Bouziri',
                Source: 'http://palaisbenayed.com/doc.pdf',
            },
        });
        diffData.pois = [{ id: ID, name: 'Marabout Bouziri', changes: [] }];

        await publishChanges();

        const vu = ceQueVoitLEditeur(feature);
        expect(vu['Nom du site FR']).toBe('Mausolée Fkih Kacem El Bouziri');
        expect(vu.Source).toBe('http://palaisbenayed.com/doc.pdf');
    });

    it('les valeurs publiées deviennent le patrimoine (feature.properties)', async () => {
        const feature = poser({ overlay: { description: 'La grande mosquée au centre de Midoun.' } });
        diffData.pois = [{ id: ID, name: 'x', changes: [] }];

        await publishChanges();

        expect(feature.properties.description).toBe('La grande mosquée au centre de Midoun.');
        expect(feature.properties.userData).toBeUndefined();
        expect(state.userData[ID]).toBeUndefined();
    });

    it('fiche et éditeur lisent le MÊME overlay (plus de divergence)', async () => {
        const feature = poser({ overlay: { description: 'neuve', vu: true } });
        diffData.pois = [{ id: ID, name: 'x', changes: [] }];

        await publishChanges();

        expect(feature.properties.userData).toEqual(state.userData[ID]);
    });

    it('PRÉSERVE les données perso (visité, notes) qui ne sont jamais publiées', async () => {
        const feature = poser({
            overlay: {
                description: 'texte publié',
                vu: true, vuManual: true,
                notes: 'revenir au coucher du soleil',
                incontournable: true,
            },
        });
        diffData.pois = [{ id: ID, name: 'x', changes: [] }];

        await publishChanges();

        expect(state.userData[ID]).toEqual({
            vu: true, vuManual: true,
            notes: 'revenir au coucher du soleil',
            incontournable: true,
        });
        // ...et elles ne fuient pas dans le patrimoine
        expect(feature.properties.vu).toBeUndefined();
        expect(feature.properties.notes).toBeUndefined();
        // ...tandis que le champ publié, lui, y est bien
        expect(feature.properties.description).toBe('texte publié');
    });

    it("une SUPPRESSION n'est pas aplatie (sinon le POI réapparaîtrait)", async () => {
        const feature = poser({ overlay: { _deleted: true } });
        diffData.pois = [{ id: ID, name: 'x', changes: [], isDeletion: true }];

        await publishChanges();

        // c'est ce flag que lit generateMasterGeoJSONData pour exclure le POI
        expect(feature.properties.userData?._deleted).toBe(true);
        expect(feature.properties._deleted).toBeUndefined();
        expect(state.userData[ID]).toBeUndefined();
    });

    it('ne touche pas aux POIs absents du diff', async () => {
        const feature = poser({ overlay: { description: 'brouillon en cours' } });
        diffData.pois = []; // rien à publier pour ce POI

        await publishChanges();

        expect(feature.properties.userData).toEqual({ description: 'brouillon en cours' });
        expect(state.userData[ID]).toEqual({ description: 'brouillon en cours' });
        expect(feature.properties.description).toBeUndefined();
    });
});
