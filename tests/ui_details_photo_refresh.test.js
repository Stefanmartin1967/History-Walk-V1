// @vitest-environment jsdom
//
// Fix 10/08/2026 : une fiche déjà ouverte ne se rafraîchissait pas quand ses
// photos changeaient via la modale de tri (ui-photo-batch.js), qui opère en
// toile de fond sans savoir qu'une fiche est affichée. Constaté avec une photo
// de travail restée visible après un import réel, jusqu'à F5.
//
// Ce test vérifie le CÔTÉ ÉCOUTE (ui-details.js) : le listener 'poi:photos-updated'
// ne doit rafraîchir QUE si l'id concerné est celui de la fiche actuellement
// ouverte. state.currentFeatureId est un INDEX dans loadedFeatures (pas le
// HW_ID) — piège déjà rencontré en écrivant le fix, couvert ici.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock est hoisté au-dessus de TOUT le corps du fichier — `listeners` doit
// l'être aussi (vi.hoisted), sinon la factory ci-dessous s'exécute avant que
// `const listeners = {}` n'ait tourné (TDZ error observé en écrivant ce test).
const { listeners } = vi.hoisted(() => ({ listeners: {} }));
vi.mock('../src/events.js', () => ({
    eventBus: {
        on: vi.fn((evt, fn) => { (listeners[evt] ||= []).push(fn); }),
        emit: vi.fn(),
        off: vi.fn(),
    },
}));

vi.mock('../src/state.js', () => ({
    state: {
        isAdmin: false,
        currentFeatureId: null,
        currentCircuitIndex: null,
        loadedFeatures: [],
        currentCircuit: [],
    },
    setCurrentFeatureId: vi.fn(),
    setCurrentCircuitIndex: vi.fn(),
    setPoiFilterFromSearch: vi.fn(),
    getActiveDestinationName: vi.fn(() => 'Djerba'),
}));

vi.mock('../src/data.js', () => ({
    getPoiId: (f) => f?.properties?.HW_ID,
    getPatrimonialName: vi.fn(),
    updatePoiData: vi.fn(),
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

const buildHTMLMock = vi.fn(() => '<div class="poi-panel"></div>');
vi.mock('../src/templates.js', () => ({ buildDetailsPanelHtml: (...a) => buildHTMLMock(...a) }));

vi.mock('../src/utils.js', () => ({ sanitizeHTML: vi.fn(s => s), openPoiOnMap: vi.fn() }));
vi.mock('../src/ui-photo-grid.js', () => ({ openPhotoGrid: vi.fn() }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn() }));
vi.mock('../src/ui-sidebar.js', () => ({ switchSidebarTab: vi.fn() }));
vi.mock('../src/ui-dom.js', () => ({
    DOM: { detailsPanel: document.createElement('div'), mobileMainContainer: document.createElement('div') },
}));
vi.mock('../src/database.js', () => ({
    getPoiPhotos: vi.fn(() => Promise.resolve([])),
    getPendingAdminPhotos: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../src/work-photos.js', () => ({ getWorkPhotosById: vi.fn(() => []), loadWorkPhotoBlob: vi.fn() }));
vi.mock('../src/access-point-editor.js', () => ({ startAccessPointPlacement: vi.fn() }));
vi.mock('../src/help-popover.js', () => ({ configureHelp: vi.fn(), attachHelp: vi.fn() }));
vi.mock('../src/help-content.js', () => ({ GUIDE_LIRE_LIEU: {} }));

import { state } from '../src/state.js';
// Import réel : c'est SON eventBus.on('poi:photos-updated', ...) qu'on teste.
import '../src/ui-details.js';

function feature(id) {
    return { properties: { HW_ID: id }, geometry: { coordinates: [0, 0] } };
}

function fireEvent(id) {
    listeners['poi:photos-updated'].forEach(fn => fn({ id }));
}

beforeEach(() => {
    buildHTMLMock.mockClear();
    state.currentFeatureId = null;
    state.currentCircuitIndex = null;
    state.loadedFeatures = [];
    state.currentCircuit = [];
});

describe("poi:photos-updated — écoute enregistrée à l'import du module", () => {
    it('le listener existe (module chargé une fois, effet de bord voulu)', () => {
        expect(listeners['poi:photos-updated']).toBeDefined();
        expect(listeners['poi:photos-updated'].length).toBeGreaterThan(0);
    });
});

describe('poi:photos-updated — filtrage sur la fiche réellement ouverte', () => {
    it("rafraîchit quand l'id concerné est celui de la fiche ouverte", () => {
        state.loadedFeatures = [feature('HW-1'), feature('HW-2')];
        state.currentFeatureId = 1; // index → HW-2

        fireEvent('HW-2');

        expect(buildHTMLMock).toHaveBeenCalledTimes(1);
    });

    it("NE rafraîchit PAS quand un AUTRE POI est concerné", () => {
        state.loadedFeatures = [feature('HW-1'), feature('HW-2')];
        state.currentFeatureId = 1; // index → HW-2

        fireEvent('HW-1');

        expect(buildHTMLMock).not.toHaveBeenCalled();
    });

    it('aucune fiche ouverte (currentFeatureId null) → no-op, pas de crash', () => {
        state.loadedFeatures = [feature('HW-1')];
        state.currentFeatureId = null;

        expect(() => fireEvent('HW-1')).not.toThrow();
        expect(buildHTMLMock).not.toHaveBeenCalled();
    });

    it("l'index ne correspond à aucune feature → no-op (garde-fou tableau)", () => {
        state.loadedFeatures = [feature('HW-1')];
        state.currentFeatureId = 5; // hors bornes

        expect(() => fireEvent('HW-1')).not.toThrow();
        expect(buildHTMLMock).not.toHaveBeenCalled();
    });
});
