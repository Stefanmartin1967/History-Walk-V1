// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// admin-control-ui : revoke des blob URLs (PR C2)
//
// Avant C2, chaque miniature de la grille pendingPhotos appelait
// URL.createObjectURL sans jamais URL.revokeObjectURL → fuite mémoire qui
// s'accumulait à chaque bascule de sous-vue (B2) ou ré-ouverture du CC.
//
// Avec C2 : les URLs sont trackées via _trackBlobUrl, et revokées :
//   - au début de chaque renderTab (avant le rendu suivant)
//   - au close du modal (bouton Fermer + close-modal action)
// ============================================================================

vi.mock('../src/state.js', () => ({ state: {} }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn(() => null),
    getStoredUsername: vi.fn(() => null),
    saveToken: vi.fn(),
    validateToken: vi.fn(),
    uploadFileToGitHub: vi.fn(),
}));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/modal.js', () => ({ openHwModal: vi.fn(), closeHwModal: vi.fn() }));
vi.mock('../src/admin-maintenance.js', () => ({ renderMaintenanceTab: vi.fn() }));

import {
    renderTab,
    setChangesSubView,
    revokeAllPendingBlobUrls,
    _getActiveBlobUrlCountForTests,
} from '../src/admin-control-ui.js';

// jsdom n'implémente pas createObjectURL/revokeObjectURL — on les stubbe
let createCalls;
let revokeCalls;
let urlSeq;

beforeEach(() => {
    // 1. Reset le Set partagé (module-level) — peut contenir des URLs
    //    résiduelles du test précédent. On utilise les anciens mocks pour
    //    cleaner avant de redéfinir.
    revokeAllPendingBlobUrls();

    // 2. Recréer les mocks frais pour ce test (sans pollution du beforeEach
    //    cleanup ci-dessus).
    createCalls = [];
    revokeCalls = [];
    urlSeq = 0;
    URL.createObjectURL = vi.fn((blob) => {
        const url = `blob:mock://${++urlSeq}`;
        createCalls.push({ blob, url });
        return url;
    });
    URL.revokeObjectURL = vi.fn((url) => {
        revokeCalls.push(url);
    });

    // Conteneur DOM minimal attendu par renderTab
    document.body.innerHTML = '<div id="admin-cc-content"></div>';
});

function makePoiWithPhotos(id, photos) {
    return {
        id, name: `POI ${id}`, changes: [], hasPendingPhotos: true,
        pendingPhotos: photos.map((skip, i) => ({
            id: `${id}_ph${i}`,
            blob: new Blob([new Uint8Array([i])], { type: 'image/jpeg' }),
            skipPublish: skip
        }))
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// revokeAllPendingBlobUrls : helper de base
// ─────────────────────────────────────────────────────────────────────────────
describe('revokeAllPendingBlobUrls (PR C2)', () => {
    it('vide le Set quand il est vide (no-op)', () => {
        expect(_getActiveBlobUrlCountForTests()).toBe(0);
        revokeAllPendingBlobUrls();
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        expect(_getActiveBlobUrlCountForTests()).toBe(0);
    });

    it('revoke chaque URL trackée puis vide le Set', () => {
        // Render une grille pour peupler le Set via _trackBlobUrl
        setChangesSubView('photos');
        const diffData = {
            pois: [makePoiWithPhotos('p1', [false, true, false])],
            circuits: [],
            stats: {}
        };
        renderTab('changes', diffData, {});
        expect(_getActiveBlobUrlCountForTests()).toBe(3);

        revokeAllPendingBlobUrls();
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
        expect(_getActiveBlobUrlCountForTests()).toBe(0);
    });

    it('tolère URL.revokeObjectURL qui throw (mode défensif)', () => {
        URL.revokeObjectURL = vi.fn(() => { throw new Error('already revoked'); });

        setChangesSubView('photos');
        renderTab('changes', {
            pois: [makePoiWithPhotos('p1', [false])],
            circuits: [], stats: {}
        }, {});
        expect(_getActiveBlobUrlCountForTests()).toBe(1);

        // Ne doit pas lancer
        expect(() => revokeAllPendingBlobUrls()).not.toThrow();
        // Le Set est quand même vidé après tentative (cleanup garanti)
        expect(_getActiveBlobUrlCountForTests()).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// renderTab : revoke automatique avant chaque rendu
// ─────────────────────────────────────────────────────────────────────────────
describe('renderTab — auto-revoke avant rendu (PR C2)', () => {
    it('revoke les URLs précédentes au passage d\'un onglet à un autre', () => {
        const diffData = {
            pois: [makePoiWithPhotos('p1', [false, false])],
            circuits: [], stats: {}
        };

        setChangesSubView('photos');
        renderTab('changes', diffData, {});
        expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
        expect(_getActiveBlobUrlCountForTests()).toBe(2);

        // Bascule sur dashboard → revoke les 2 URLs photos
        renderTab('dashboard', { ...diffData, stats: { poisModified: 0, circuitsModified: 0, pendingPhotoCount: 0 } }, {});
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
        expect(_getActiveBlobUrlCountForTests()).toBe(0);
    });

    it('revoke + recrée à chaque re-render de la sous-vue Photos (pas d\'accumulation)', () => {
        const diffData = {
            pois: [makePoiWithPhotos('p1', [false, false, true])],
            circuits: [], stats: {}
        };

        setChangesSubView('photos');
        renderTab('changes', diffData, {});
        expect(_getActiveBlobUrlCountForTests()).toBe(3);

        // Re-render de la même vue → les anciennes URLs sont revoked,
        // de nouvelles sont créées (3 + 3 = 6 createCalls, 3 revokeCalls).
        renderTab('changes', diffData, {});
        expect(URL.createObjectURL).toHaveBeenCalledTimes(6);
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
        expect(_getActiveBlobUrlCountForTests()).toBe(3);
    });

    it('revoke aussi quand on bascule entre Lieux ↔ Photos ↔ Circuits', () => {
        const diffData = {
            pois: [
                { id: 'p_lieu', name: 'L', changes: [{ key: 'Description', old: 'a', new: 'b' }] },
                makePoiWithPhotos('p_photo', [false, false]),
            ],
            circuits: [{ id: 'c1', name: 'C', changes: [{ key: 'Distance', old: '1', new: '2' }] }],
            stats: {}
        };

        // Photos : 2 URLs
        setChangesSubView('photos');
        renderTab('changes', diffData, {});
        expect(_getActiveBlobUrlCountForTests()).toBe(2);

        // Lieux : revoke les 2 photos, pas de nouvelles
        setChangesSubView('lieux');
        renderTab('changes', diffData, {});
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
        expect(_getActiveBlobUrlCountForTests()).toBe(0);

        // Retour Photos : 2 nouvelles URLs
        setChangesSubView('photos');
        renderTab('changes', diffData, {});
        expect(URL.createObjectURL).toHaveBeenCalledTimes(4);
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2); // toujours 2 (les nouvelles ne sont pas encore revoked)
        expect(_getActiveBlobUrlCountForTests()).toBe(2);

        // Circuits : revoke les 2 nouvelles
        setChangesSubView('circuits');
        renderTab('changes', diffData, {});
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
        expect(_getActiveBlobUrlCountForTests()).toBe(0);
    });

    it('renderTab sans photos n\'appelle pas createObjectURL ni revokeObjectURL inutilement', () => {
        const diffData = {
            pois: [{ id: 'p1', name: 'L', changes: [{ key: 'Nom', old: 'a', new: 'b' }] }],
            circuits: [], stats: {}
        };
        setChangesSubView('lieux');
        renderTab('changes', diffData, {});
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        // revokeAllPendingBlobUrls est appelé mais sur Set vide → 0 invocations
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });
});
