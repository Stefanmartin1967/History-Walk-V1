// @vitest-environment jsdom
//
// Note privée (10/08/2026) — vérifie le câblage réel dans ui-details.js :
// bascule lecture/édition, sauvegarde locale TOUJOURS, envoi heripia-travail
// SEULEMENT si un token existe (comportement identique à avant pour un
// visiteur sans token — cf. discussion avec Stefan sur la sauvegarde locale).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/events.js', () => ({
    eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() },
}));

vi.mock('../src/state.js', () => ({
    state: {
        isAdmin: false,
        currentFeatureId: null,
        currentCircuitIndex: null,
        currentMapId: 'djerba',
        loadedFeatures: [],
        userData: {},
    },
    setCurrentFeatureId: vi.fn(),
    setCurrentCircuitIndex: vi.fn(),
    setPoiFilterFromSearch: vi.fn(),
    getActiveDestinationName: vi.fn(() => 'Djerba'),
}));

vi.mock('../src/data.js', () => ({
    getPoiId: (f) => f?.properties?.HW_ID,
    getPatrimonialName: vi.fn(),
    updatePoiData: vi.fn((poiId, key, value) => {
        // Reflète le vrai comportement (toujours local, cf. data.js) pour que
        // le test de non-régression sur l'hydratation ait un state cohérent.
        return Promise.resolve();
    }),
    updatePoiCoordinates: vi.fn(),
    isPendingPoi: vi.fn(() => false),
    discardPendingPoi: vi.fn(),
}));

vi.mock('../src/tts.js', () => ({ speakText: vi.fn() }));
vi.mock('../src/mobile-state.js', () => ({
    isMobileView: vi.fn(() => false),
    pushMobileLevel: vi.fn(),
    animateContainer: vi.fn(),
    setMobileHeaderSlot: vi.fn(),
    setMobileViewFooter: vi.fn(),
}));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));

const buildHTMLMock = vi.fn((feature) => {
    const notes = feature?.properties?.userData?.notes ?? '';
    return `<div class="poi-panel" data-poi-id="${feature.properties.HW_ID}">
        <div id="poi-hero" class="poi-hero is-empty is-clickable"></div>
        <div class="poi-note-block">
            <div class="poi-note-view" id="poi-note-view" role="button" tabindex="0">${notes}</div>
            <textarea class="poi-notes-area is-hidden" id="poi-note-edit">${notes}</textarea>
        </div>
    </div>`;
});
vi.mock('../src/templates.js', () => ({ buildDetailsPanelHtml: (...a) => buildHTMLMock(...a) }));

vi.mock('../src/utils.js', () => ({ sanitizeHTML: vi.fn(s => s), openPoiOnMap: vi.fn() }));
vi.mock('../src/ui-photo-grid.js', () => ({ openPhotoGrid: vi.fn() }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn() }));
vi.mock('../src/ui-sidebar.js', () => ({ switchSidebarTab: vi.fn() }));
// vi.hoisted : les imports (donc l'exécution des factories vi.mock) sont
// traités avant tout code top-level ordinaire — sans ça, `detailsPanelEl`
// serait encore undefined quand la factory ci-dessous s'exécute (même piège
// de TDZ que rencontré pour ui_details_photo_refresh.test.js).
const { detailsPanelEl, mobileContainerEl } = vi.hoisted(() => ({
    detailsPanelEl: document.createElement('div'),
    mobileContainerEl: document.createElement('div'),
}));
document.body.appendChild(detailsPanelEl);
document.body.appendChild(mobileContainerEl);
vi.mock('../src/ui-dom.js', () => ({
    DOM: { detailsPanel: detailsPanelEl, mobileMainContainer: mobileContainerEl },
}));
vi.mock('../src/database.js', () => ({
    getPoiPhotos: vi.fn(() => Promise.resolve([])),
    getPendingAdminPhotos: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../src/work-photos.js', () => ({ getWorkPhotosById: vi.fn(() => []), loadWorkPhotoBlob: vi.fn() }));
vi.mock('../src/private-notes.js', () => ({
    loadPrivateNote: vi.fn(() => Promise.resolve(null)),
    savePrivateNote: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/github-sync.js', () => ({ getStoredToken: vi.fn(() => null) }));
vi.mock('../src/access-point-editor.js', () => ({ startAccessPointPlacement: vi.fn() }));
vi.mock('../src/help-popover.js', () => ({ configureHelp: vi.fn(), attachHelp: vi.fn() }));
vi.mock('../src/help-content.js', () => ({ GUIDE_LIRE_LIEU: {} }));

import { state } from '../src/state.js';
import { updatePoiData } from '../src/data.js';
import { getStoredToken } from '../src/github-sync.js';
import { loadPrivateNote, savePrivateNote } from '../src/private-notes.js';
import { openDetailsPanel } from '../src/ui-details.js';

// hydratePrivateNoteIfNeeded lit `state.userData` directement (comme le vrai
// code) — on le tient synchronisé avec `properties.userData` (ce que le vrai
// buildDetailsPanelHtml lirait), exactement comme data.js le fait en vrai
// (`feature.properties.userData = state.userData[poiId]`, même référence).
function feature(id, notes = '') {
    state.userData[id] = { notes };
    return {
        properties: { HW_ID: id, userData: state.userData[id] },
        geometry: { coordinates: [0, 0] },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    buildHTMLMock.mockClear();
    state.isAdmin = false;
    state.currentFeatureId = null;
    state.currentMapId = 'djerba';
    state.userData = {};
    vi.mocked(getStoredToken).mockReturnValue(null);
    vi.mocked(loadPrivateNote).mockResolvedValue(null);
});

describe('bascule lecture/édition', () => {
    it('clic sur la vue lecture révèle le textarea', () => {
        state.loadedFeatures = [feature('HW-1', 'une note')];
        openDetailsPanel(0);

        const view = document.getElementById('poi-note-view');
        const edit = document.getElementById('poi-note-edit');
        expect(edit.classList.contains('is-hidden')).toBe(true);

        view.click();

        expect(view.classList.contains('is-hidden')).toBe(true);
        expect(edit.classList.contains('is-hidden')).toBe(false);
    });
});

describe('sauvegarde au blur — locale TOUJOURS, distante SI token', () => {
    it('sans token : sauvegarde locale seule, comportement inchangé pour un visiteur', async () => {
        vi.mocked(getStoredToken).mockReturnValue(null);
        state.loadedFeatures = [feature('HW-1', '')];
        openDetailsPanel(0);

        const edit = document.getElementById('poi-note-edit');
        edit.value = 'nouvelle note';
        edit.dispatchEvent(new Event('blur'));
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

        expect(updatePoiData).toHaveBeenCalledWith('HW-1', 'notes', 'nouvelle note');
        expect(savePrivateNote).not.toHaveBeenCalled();
    });

    it('avec token : sauvegarde locale ET envoi vers heripia-travail', async () => {
        vi.mocked(getStoredToken).mockReturnValue('fake-token');
        state.loadedFeatures = [feature('HW-1', '')];
        openDetailsPanel(0);

        const edit = document.getElementById('poi-note-edit');
        edit.value = 'note admin';
        edit.dispatchEvent(new Event('blur'));
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

        expect(updatePoiData).toHaveBeenCalledWith('HW-1', 'notes', 'note admin');
        expect(savePrivateNote).toHaveBeenCalledWith('djerba', 'HW-1', 'note admin');
    });

    it('un échec d\'envoi distant ne fait pas planter la sauvegarde locale', async () => {
        vi.mocked(getStoredToken).mockReturnValue('fake-token');
        vi.mocked(savePrivateNote).mockRejectedValue(new Error('rate limit'));
        state.loadedFeatures = [feature('HW-1', '')];
        openDetailsPanel(0);

        const edit = document.getElementById('poi-note-edit');
        edit.value = 'note';
        expect(() => edit.dispatchEvent(new Event('blur'))).not.toThrow();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

        expect(updatePoiData).toHaveBeenCalled();
    });
});

describe('hydratation depuis heripia-travail (multi-appareils)', () => {
    it('local déjà rempli → aucune requête réseau (pas d\'écrasement d\'une saisie)', async () => {
        state.isAdmin = true;
        vi.mocked(getStoredToken).mockReturnValue('fake-token');
        state.loadedFeatures = [feature('HW-1', 'déjà là')];
        openDetailsPanel(0);
        await Promise.resolve(); await Promise.resolve();

        expect(loadPrivateNote).not.toHaveBeenCalled();
    });

    it('local vide + admin + token → vérifie heripia-travail', async () => {
        state.isAdmin = true;
        vi.mocked(getStoredToken).mockReturnValue('fake-token');
        vi.mocked(loadPrivateNote).mockResolvedValue('trouvée sur un autre appareil');
        state.loadedFeatures = [feature('HW-1', '')];
        state.currentFeatureId = 0; // simule le panel déjà "ouvert" pour la garde anti-obsolescence

        openDetailsPanel(0);
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

        expect(loadPrivateNote).toHaveBeenCalledWith('djerba', 'HW-1');
        expect(updatePoiData).toHaveBeenCalledWith('HW-1', 'notes', 'trouvée sur un autre appareil');
    });

    it('visiteur sans token → aucune vérification réseau', async () => {
        state.isAdmin = false;
        vi.mocked(getStoredToken).mockReturnValue(null);
        state.loadedFeatures = [feature('HW-1', '')];
        openDetailsPanel(0);
        await Promise.resolve(); await Promise.resolve();

        expect(loadPrivateNote).not.toHaveBeenCalled();
    });
});
