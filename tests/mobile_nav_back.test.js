// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// onHwBack : handler Back Android extrait de initMobileMode() (pattern
// proactif C7). Logique pure : lit state + mobile-state, route vers l'un
// des 3 niveaux (POI → fermer fiche, circuit-details → retour circuits,
// search/actions → retour circuits) ou no-op (non-mobile, racine).

vi.mock('../src/state.js', () => ({
    state: {
        currentFeatureId: null,
        activeCircuitId: null,
        isAdmin: false
    },
    setFilterCompleted: vi.fn()
}));

vi.mock('../src/mobile-state.js', () => ({
    isMobileView: vi.fn(() => true),
    getCurrentView: vi.fn(() => 'circuits'),
    setCurrentView: vi.fn(),
    getMobileCurrentPage: vi.fn(() => 1),
    setMobileCurrentPage: vi.fn(),
    getAllCircuitsOrdered: vi.fn(() => []),
    animateContainer: vi.fn(),
    pushMobileLevel: vi.fn()
}));

vi.mock('../src/ui-details.js', () => ({
    openDetailsPanel: vi.fn(),
    closeDetailsPanel: vi.fn()
}));

vi.mock('../src/circuit.js', () => ({
    navigatePoiDetails: vi.fn(),
    loadCircuitById: vi.fn(),
    clearCircuit: vi.fn()
}));

vi.mock('../src/mobile-circuits.js', () => ({
    renderMobileCircuitsList: vi.fn()
}));

vi.mock('../src/mobile-menu.js', () => ({
    renderMobileMenu: vi.fn()
}));

vi.mock('../src/ui.js', () => ({ DOM: {} }));

vi.mock('../src/data.js', () => ({
    getPoiId: vi.fn(),
    getPoiName: vi.fn(),
    addPoiFeature: vi.fn(),
    addPendingPoiFeature: vi.fn()
}));

vi.mock('../src/lucide-icons.js', () => ({
    createIcons: vi.fn(),
    appIcons: {}
}));

vi.mock('../src/map.js', () => ({ getIconForFeature: vi.fn() }));
vi.mock('../src/zones.js', () => ({ zonesData: { features: [] } }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn() }));
vi.mock('../src/search.js', () => ({ getSearchResults: vi.fn(() => []) }));
vi.mock('../src/admin.js', () => ({ showAdminLoginModal: vi.fn() }));
vi.mock('../src/utils.js', () => ({
    escapeHtml: vi.fn(s => s),
    sanitizeHTML: vi.fn(s => s),
    isPointInPolygon: vi.fn(() => false)
}));

import { state } from '../src/state.js';
import { isMobileView, getCurrentView, setCurrentView } from '../src/mobile-state.js';
import { closeDetailsPanel } from '../src/ui-details.js';
import { clearCircuit } from '../src/circuit.js';
import { renderMobileCircuitsList } from '../src/mobile-circuits.js';
import { onHwBack } from '../src/mobile-nav.js';

describe('onHwBack (bouton Back Android)', () => {
    beforeEach(() => {
        // switchMobileView() touche #mobile-main-container — doit exister
        document.body.innerHTML = '<div id="mobile-main-container"></div>';
        vi.clearAllMocks();
        vi.useFakeTimers();
        isMobileView.mockReturnValue(true);
        getCurrentView.mockReturnValue('circuits');
        state.currentFeatureId = null;
        state.activeCircuitId = null;
    });

    afterEach(() => {
        // Vider les timers en attente pour reset le flag _backHandled entre tests
        vi.runAllTimers();
        vi.useRealTimers();
    });

    describe('Niveau détecté', () => {
        it('POI ouvert + circuit actif → closeDetailsPanel(true)', () => {
            state.currentFeatureId = 'poi1';
            state.activeCircuitId = 'c1';

            onHwBack();

            expect(closeDetailsPanel).toHaveBeenCalledWith(true);
            expect(clearCircuit).not.toHaveBeenCalled();
            expect(setCurrentView).not.toHaveBeenCalled();
        });

        it('POI ouvert sans circuit → closeDetailsPanel(false)', () => {
            state.currentFeatureId = 'poi1';
            state.activeCircuitId = null;

            onHwBack();

            expect(closeDetailsPanel).toHaveBeenCalledWith(false);
        });

        it('view="circuit-details" → clearCircuit(false) + switchMobileView("circuits")', () => {
            getCurrentView.mockReturnValue('circuit-details');

            onHwBack();

            expect(clearCircuit).toHaveBeenCalledWith(false);
            // switchMobileView('circuits') appelle setCurrentView + renderMobileCircuitsList
            expect(setCurrentView).toHaveBeenCalledWith('circuits');
            expect(renderMobileCircuitsList).toHaveBeenCalled();
        });

        it('view="search" (≠ circuits) → switchMobileView("circuits") sans clearCircuit', () => {
            getCurrentView.mockReturnValue('search');

            onHwBack();

            expect(clearCircuit).not.toHaveBeenCalled();
            expect(setCurrentView).toHaveBeenCalledWith('circuits');
            expect(renderMobileCircuitsList).toHaveBeenCalled();
        });
    });

    describe('No-op', () => {
        it('non-mobile → aucun effet métier (flag posé quand même)', () => {
            isMobileView.mockReturnValue(false);
            state.currentFeatureId = 'poi1';
            state.activeCircuitId = 'c1';

            onHwBack();

            expect(closeDetailsPanel).not.toHaveBeenCalled();
            expect(clearCircuit).not.toHaveBeenCalled();
            expect(renderMobileCircuitsList).not.toHaveBeenCalled();
        });

        it('racine (view="circuits", pas de POI) → aucun effet (minimize natif)', () => {
            getCurrentView.mockReturnValue('circuits');
            state.currentFeatureId = null;

            onHwBack();

            expect(closeDetailsPanel).not.toHaveBeenCalled();
            expect(clearCircuit).not.toHaveBeenCalled();
            expect(setCurrentView).not.toHaveBeenCalled();
            expect(renderMobileCircuitsList).not.toHaveBeenCalled();
        });
    });

    describe('Déduplication', () => {
        it('2 appels synchrones → seul le 1er agit (flag 100 ms)', () => {
            getCurrentView.mockReturnValue('search');

            onHwBack();
            onHwBack(); // ignoré : _backHandled actif

            expect(setCurrentView).toHaveBeenCalledTimes(1);
            expect(renderMobileCircuitsList).toHaveBeenCalledTimes(1);

            // Après 100 ms, le flag se reset → nouvel appel agit à nouveau
            vi.advanceTimersByTime(100);
            onHwBack();

            expect(setCurrentView).toHaveBeenCalledTimes(2);
            expect(renderMobileCircuitsList).toHaveBeenCalledTimes(2);
        });
    });
});
