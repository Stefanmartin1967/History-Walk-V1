// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// admin-control-center : actions photos pending (PR B3)
//   - removeAdminPhoto(poiId, photoId)   → suppression unitaire
//   - bulkSetPhotoSkip(poiId, skipPublish) → tout cocher / tout décocher
// ============================================================================

const h = vi.hoisted(() => {
    const mockState = {
        currentMapId: 'djerba',
        userData: {},
        loadedFeatures: []
    };
    return {
        mockState,
        // IDB store mockée (clé = poiId)
        pendingStore: new Map(),
        getPendingAdminPhotosSpy: vi.fn(),
        setPendingAdminPhotosSpy: vi.fn(),
        renderTabSpy: vi.fn(),
    };
});

vi.mock('../src/state.js', () => ({
    state: h.mockState,
    setUserData: vi.fn(),
    setOfficialCircuitsStatus: vi.fn(),
    setHiddenPoiIds: vi.fn(),
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
    GITHUB_OWNER: 'owner', GITHUB_REPO: 'repo', RAW_BASE: 'https://example.com',
    GITHUB_PATHS: { geojson: () => '', circuits: () => '', circuitFile: () => '', photo: () => '', tested: () => '' },
    PERSONAL_KEYS: ['vu']
}));

vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn(), closeModal: vi.fn() }));

vi.mock('../src/database.js', () => ({
    saveAppState: vi.fn(() => Promise.resolve()),
    getAppState: vi.fn(() => Promise.resolve(null)),
    getPendingAdminPhotos: (mapId, poiId) => {
        h.getPendingAdminPhotosSpy(mapId, poiId);
        return Promise.resolve(h.pendingStore.get(poiId) || []);
    },
    setPendingAdminPhotos: (mapId, poiId, photos) => {
        h.setPendingAdminPhotosSpy(mapId, poiId, photos);
        if (!photos || photos.length === 0) {
            h.pendingStore.delete(poiId);
        } else {
            h.pendingStore.set(poiId, photos);
        }
        return Promise.resolve();
    },
    clearPendingAdminPhotos: vi.fn(() => Promise.resolve()),
    deletePoiData: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/photo-service.js', () => ({ uploadPhotoForPoi: vi.fn() }));

vi.mock('../src/admin-diff-engine.js', () => ({
    reconcileLocalChanges: vi.fn(),
    prepareDiffData: vi.fn(() => Promise.resolve()),
    diffData: { pois: [], circuits: [], stats: { pendingPhotoCount: 0 }, pendingPhotos: {} }
}));

vi.mock('../src/admin-control-ui.js', () => ({
    openControlCenterModal: vi.fn(),
    renderTab: (tab, diff, cbs) => h.renderTabSpy(tab, diff, cbs)
}));

import { removeAdminPhoto, bulkSetPhotoSkip } from '../src/admin-control-center.js';
import { diffData } from '../src/admin-diff-engine.js';

beforeEach(() => {
    vi.clearAllMocks();
    h.pendingStore.clear();
    diffData.pois = [];
    diffData.pendingPhotos = {};
    diffData.stats = { pendingPhotoCount: 0 };
});

// ─────────────────────────────────────────────────────────────────────────────
// removeAdminPhoto
// ─────────────────────────────────────────────────────────────────────────────
describe('removeAdminPhoto (PR B3)', () => {
    it('retire UNIQUEMENT la photo ciblée du store', async () => {
        h.pendingStore.set('p1', [
            { id: 'ph1', blob: new Blob(['a']), skipPublish: false },
            { id: 'ph2', blob: new Blob(['b']), skipPublish: true },
            { id: 'ph3', blob: new Blob(['c']), skipPublish: false },
        ]);

        await removeAdminPhoto('p1', 'ph2');

        expect(h.setPendingAdminPhotosSpy).toHaveBeenCalledTimes(1);
        const [, , savedPhotos] = h.setPendingAdminPhotosSpy.mock.calls[0];
        expect(savedPhotos.map(p => p.id)).toEqual(['ph1', 'ph3']);
    });

    it('retire l\'entrée du store si c\'était la dernière photo', async () => {
        h.pendingStore.set('p1', [{ id: 'only', blob: new Blob(['x']), skipPublish: false }]);

        await removeAdminPhoto('p1', 'only');

        expect(h.pendingStore.has('p1')).toBe(false);
    });

    it('synchronise diffData.pendingPhotos[poiId]', async () => {
        h.pendingStore.set('p1', [
            { id: 'ph1', blob: new Blob(['a']), skipPublish: false },
            { id: 'ph2', blob: new Blob(['b']), skipPublish: false }
        ]);
        diffData.pendingPhotos['p1'] = [
            { id: 'ph1', skipPublish: false },
            { id: 'ph2', skipPublish: false }
        ];
        diffData.pois.push({ id: 'p1', pendingPhotos: diffData.pendingPhotos['p1'], hasPendingPhotos: true });

        await removeAdminPhoto('p1', 'ph1');

        expect(diffData.pendingPhotos['p1']).toEqual([{ id: 'ph2', skipPublish: false }]);
        const item = diffData.pois.find(p => p.id === 'p1');
        expect(item.pendingPhotos.map(e => e.id)).toEqual(['ph2']);
        expect(item.hasPendingPhotos).toBe(true);
    });

    it('passe hasPendingPhotos à false quand on retire la dernière photo', async () => {
        h.pendingStore.set('p1', [{ id: 'only', blob: new Blob(['x']), skipPublish: false }]);
        diffData.pendingPhotos['p1'] = [{ id: 'only', skipPublish: false }];
        diffData.pois.push({ id: 'p1', pendingPhotos: diffData.pendingPhotos['p1'], hasPendingPhotos: true });

        await removeAdminPhoto('p1', 'only');

        const item = diffData.pois.find(p => p.id === 'p1');
        expect(item.pendingPhotos).toEqual([]);
        expect(item.hasPendingPhotos).toBe(false);
        expect(diffData.pendingPhotos['p1']).toBeUndefined();
    });

    it('décrémente pendingPhotoCount UNIQUEMENT si la photo retirée était à publier', async () => {
        h.pendingStore.set('p1', [
            { id: 'ph_pub',   blob: new Blob(['a']), skipPublish: false },
            { id: 'ph_local', blob: new Blob(['b']), skipPublish: true }
        ]);
        diffData.stats.pendingPhotoCount = 1; // seul ph_pub compte

        // Retirer la photo locale → compteur INCHANGÉ
        await removeAdminPhoto('p1', 'ph_local');
        expect(diffData.stats.pendingPhotoCount).toBe(1);

        // Retirer la photo publishable → -1
        await removeAdminPhoto('p1', 'ph_pub');
        expect(diffData.stats.pendingPhotoCount).toBe(0);
    });

    it('ne descend jamais pendingPhotoCount sous 0 (clamp)', async () => {
        h.pendingStore.set('p1', [{ id: 'ph1', blob: new Blob(['x']), skipPublish: false }]);
        diffData.stats.pendingPhotoCount = 0; // état incohérent volontaire

        await removeAdminPhoto('p1', 'ph1');
        expect(diffData.stats.pendingPhotoCount).toBe(0);
    });

    it('déclenche un re-render renderTab(\'changes\')', async () => {
        h.pendingStore.set('p1', [{ id: 'ph1', blob: new Blob(['a']), skipPublish: false }]);
        await removeAdminPhoto('p1', 'ph1');
        expect(h.renderTabSpy).toHaveBeenCalledWith('changes', expect.anything(), expect.anything());
    });

    it('résiste à un photoId inconnu (no-op silencieux)', async () => {
        h.pendingStore.set('p1', [{ id: 'ph1', blob: new Blob(['x']), skipPublish: false }]);
        await removeAdminPhoto('p1', 'ph_inconnu');
        // Le store reste inchangé après un setPendingAdminPhotos avec la même liste
        expect(h.pendingStore.get('p1').map(p => p.id)).toEqual(['ph1']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// bulkSetPhotoSkip
// ─────────────────────────────────────────────────────────────────────────────
describe('bulkSetPhotoSkip (PR B3)', () => {
    it('bascule TOUTES les photos vers skipPublish=true ("tout décocher")', async () => {
        h.pendingStore.set('p1', [
            { id: 'ph1', blob: new Blob(['a']), skipPublish: false },
            { id: 'ph2', blob: new Blob(['b']), skipPublish: false }
        ]);

        await bulkSetPhotoSkip('p1', true);

        const stored = h.pendingStore.get('p1');
        expect(stored.every(p => p.skipPublish === true)).toBe(true);
    });

    it('bascule TOUTES les photos vers skipPublish=false ("tout cocher")', async () => {
        h.pendingStore.set('p1', [
            { id: 'ph1', blob: new Blob(['a']), skipPublish: true },
            { id: 'ph2', blob: new Blob(['b']), skipPublish: true }
        ]);

        await bulkSetPhotoSkip('p1', false);

        const stored = h.pendingStore.get('p1');
        expect(stored.every(p => p.skipPublish === false)).toBe(true);
    });

    it('met à jour pendingPhotoCount cohéremment ("tout cocher" → +N)', async () => {
        h.pendingStore.set('p1', [
            { id: 'ph1', blob: new Blob(['a']), skipPublish: true },
            { id: 'ph2', blob: new Blob(['b']), skipPublish: true },
            { id: 'ph3', blob: new Blob(['c']), skipPublish: true },
        ]);
        diffData.pendingPhotos['p1'] = [
            { id: 'ph1', skipPublish: true },
            { id: 'ph2', skipPublish: true },
            { id: 'ph3', skipPublish: true },
        ];
        diffData.stats.pendingPhotoCount = 0;

        await bulkSetPhotoSkip('p1', false);
        expect(diffData.stats.pendingPhotoCount).toBe(3);
    });

    it('met à jour pendingPhotoCount cohéremment ("tout décocher" → -N)', async () => {
        h.pendingStore.set('p1', [
            { id: 'ph1', blob: new Blob(['a']), skipPublish: false },
            { id: 'ph2', blob: new Blob(['b']), skipPublish: false }
        ]);
        diffData.pendingPhotos['p1'] = [
            { id: 'ph1', skipPublish: false },
            { id: 'ph2', skipPublish: false }
        ];
        diffData.stats.pendingPhotoCount = 2;

        await bulkSetPhotoSkip('p1', true);
        expect(diffData.stats.pendingPhotoCount).toBe(0);
    });

    it('no-op si pas de photos pour ce POI (pas d\'écriture inutile)', async () => {
        await bulkSetPhotoSkip('p_inconnu', true);
        expect(h.setPendingAdminPhotosSpy).not.toHaveBeenCalled();
    });

    it('déclenche un re-render renderTab(\'changes\')', async () => {
        h.pendingStore.set('p1', [{ id: 'ph1', blob: new Blob(['a']), skipPublish: false }]);
        await bulkSetPhotoSkip('p1', true);
        expect(h.renderTabSpy).toHaveBeenCalledWith('changes', expect.anything(), expect.anything());
    });

    it('immutable : ne mute pas les anciennes entrées (création de nouveaux objets)', async () => {
        const original = { id: 'ph1', blob: new Blob(['a']), skipPublish: false };
        h.pendingStore.set('p1', [original]);

        await bulkSetPhotoSkip('p1', true);

        // L'ancien objet n'a pas été muté (le sortie est un nouveau spread)
        expect(original.skipPublish).toBe(false);
        // Mais le store contient bien la nouvelle valeur
        expect(h.pendingStore.get('p1')[0].skipPublish).toBe(true);
    });
});
