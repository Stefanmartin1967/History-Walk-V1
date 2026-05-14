// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks (hoisted par vitest) ---
vi.mock('../src/state.js', () => {
    const state = {
        currentMapId: 'djerba',
        currentFeatureId: null,
        currentCircuit: [],
        activeCircuitId: null,
        loadedFeatures: [],
        isAdmin: false,
        filterCompleted: false
    };
    return {
        state,
        setFilterCompleted: vi.fn(v => { state.filterCompleted = v; })
    };
});

vi.mock('../src/ui-dom.js', () => ({
    DOM: {
        mobileMainContainer: null
    }
}));

vi.mock('../src/ui-details.js', () => ({
    openDetailsPanel: vi.fn(),
    closeDetailsPanel: vi.fn()
}));

vi.mock('../src/data.js', () => ({
    getPoiId: vi.fn(f => f?.properties?.HW_ID || f?.id),
    getPoiName: vi.fn(f => f?.properties?.name || 'Unknown'),
    addPoiFeature: vi.fn(),
    addPendingPoiFeature: vi.fn()
}));

vi.mock('../src/lucide-icons.js', () => ({
    createIcons: vi.fn(),
    appIcons: {}
}));

vi.mock('../src/poi-icons.js', () => ({
    getIconForFeature: vi.fn(() => '<svg class="poi-icon"></svg>'),
    getIconHtml: vi.fn(() => '<svg class="poi-icon-mdi"></svg>')
}));

vi.mock('../src/utils.js', () => ({
    escapeHtml: vi.fn(s => String(s ?? '')),
    sanitizeHTML: vi.fn(s => String(s ?? '')),
    isPointInPolygon: vi.fn(() => false),
    getZoneFromCoords: vi.fn(() => null)
}));

vi.mock('../src/zones.js', () => ({
    zonesData: { features: [] }
}));

vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../src/modal.js', () => ({
    showConfirm: vi.fn()
}));

vi.mock('../src/search.js', () => ({
    getSearchResults: vi.fn(() => [])
}));

vi.mock('../src/events.js', () => ({
    eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() }
}));

vi.mock('../src/admin.js', () => ({
    showAdminLoginModal: vi.fn()
}));

vi.mock('../src/mobile-state.js', () => ({
    isMobileView: vi.fn(() => true),
    getCurrentView: vi.fn(() => 'circuits'),
    setCurrentView: vi.fn(),
    getMobileCurrentPage: vi.fn(() => 1),
    setMobileCurrentPage: vi.fn(),
    getAllCircuitsOrdered: vi.fn(() => []),
    animateContainer: vi.fn(),
    pushMobileLevel: vi.fn(),
    resetMobileSlots: vi.fn(),
    // setMobileHeaderSlot doit vraiment mettre à jour le DOM dans les tests pour
    // que renderMobileSearch puisse vérifier que #mobile-search-input est rendu.
    setMobileHeaderSlot: vi.fn((html) => {
        const slot = document.getElementById('mobile-header-slot');
        if (slot) slot.innerHTML = html || '';
    }),
    clearMobileHeaderSlot: vi.fn(),
    setMobileViewFooter: vi.fn(),
    clearMobileViewFooter: vi.fn()
}));

vi.mock('../src/mobile-circuits.js', () => ({
    renderMobileCircuitsList: vi.fn()
}));

vi.mock('../src/mobile-menu.js', () => ({
    renderMobileMenu: vi.fn()
}));

import { state } from '../src/state.js';
import { eventBus } from '../src/events.js';
import {
    getCurrentView,
    setCurrentView,
    setMobileCurrentPage,
    pushMobileLevel,
    animateContainer
} from '../src/mobile-state.js';
import { renderMobileCircuitsList } from '../src/mobile-circuits.js';
import { renderMobileMenu } from '../src/mobile-menu.js';
import { getSearchResults } from '../src/search.js';
import { openDetailsPanel } from '../src/ui-details.js';
import {
    initMobileNavListeners,
    switchMobileView,
    renderMobileSearch
} from '../src/mobile-nav.js';

// Helper: build the DOM that mobile-nav.js expects.
// Refonte PR 5 : ajout #mobile-header-slot (renderMobileSearch met l'input
// dans ce slot) et #mobile-view-footer (cleared par les renders).
function setupMobileDOM() {
    document.body.innerHTML = `
        <div id="mobile-header-slot"></div>
        <div id="mobile-main-container"></div>
        <div id="mobile-view-footer"></div>
        <div id="mobile-dock"></div>
        <button class="mobile-nav-btn" data-view="circuits">Circuits</button>
        <button class="mobile-nav-btn" data-view="search">Search</button>
        <button class="mobile-nav-btn" data-view="actions">Actions</button>
    `;
}

beforeEach(() => {
    setupMobileDOM();
    state.currentFeatureId = null;
    state.currentCircuit = [];
    state.activeCircuitId = null;
    state.loadedFeatures = [];
    state.isAdmin = false;
    state.filterCompleted = false;
    getCurrentView.mockReturnValue('circuits');
    vi.clearAllMocks();
});

afterEach(() => {
    document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initMobileNavListeners', () => {
    it('enregistre un listener eventBus pour "mobile:switch-view"', () => {
        initMobileNavListeners();
        expect(eventBus.on).toHaveBeenCalledWith('mobile:switch-view', expect.any(Function));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('switchMobileView — routing', () => {
    it('view="circuits" : setMobileCurrentPage(1) + renderMobileCircuitsList', () => {
        getCurrentView.mockReturnValue('search'); // pour pas que ça bloque le push (mais 'circuits' ne pousse jamais)
        switchMobileView('circuits');
        expect(setMobileCurrentPage).toHaveBeenCalledWith(1);
        expect(renderMobileCircuitsList).toHaveBeenCalled();
    });

    it('view="search" : DOM rendu (mobile-search-input présent)', () => {
        switchMobileView('search');
        expect(document.getElementById('mobile-search-input')).not.toBeNull();
    });

    it('view="actions" : renderMobileMenu appelé', () => {
        switchMobileView('actions');
        expect(renderMobileMenu).toHaveBeenCalled();
    });

    it('container vidé puis animateContainer appelé', () => {
        const container = document.getElementById('mobile-main-container');
        container.innerHTML = '<p>old content</p>';
        switchMobileView('actions');
        expect(animateContainer).toHaveBeenCalledWith(container);
    });

    it('resetMobileSlots appelé avant switch (dock auto-restauré via CSS sibling)', async () => {
        const { resetMobileSlots } = await import('../src/mobile-state.js');
        switchMobileView('actions');
        // resetMobileSlots vide header-slot + view-footer ; le dock revient
        // automatiquement via le sélecteur CSS `:not(:empty) ~ #mobile-dock`.
        expect(resetMobileSlots).toHaveBeenCalled();
    });

    it('boutons dock : class "active" togglée selon viewName', () => {
        switchMobileView('search');
        const buttons = document.querySelectorAll('.mobile-nav-btn[data-view]');
        const searchBtn = Array.from(buttons).find(b => b.dataset.view === 'search');
        const circuitsBtn = Array.from(buttons).find(b => b.dataset.view === 'circuits');
        expect(searchBtn.classList.contains('active')).toBe(true);
        expect(circuitsBtn.classList.contains('active')).toBe(false);
    });

    it('setCurrentView appelé avec viewName', () => {
        switchMobileView('search');
        expect(setCurrentView).toHaveBeenCalledWith('search');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('switchMobileView — pushMobileLevel (Back Android pattern C7)', () => {
    it('pushMobileLevel appelé pour view ≠ "circuits" ET ≠ current', () => {
        getCurrentView.mockReturnValue('circuits');
        switchMobileView('search');
        expect(pushMobileLevel).toHaveBeenCalledWith('search');
    });

    it('pushMobileLevel PAS appelé pour "circuits" (racine, jamais poussée)', () => {
        getCurrentView.mockReturnValue('actions');
        switchMobileView('circuits');
        expect(pushMobileLevel).not.toHaveBeenCalled();
    });

    it('pushMobileLevel PAS appelé si déjà sur cette view (anti-doublon)', () => {
        getCurrentView.mockReturnValue('search');
        switchMobileView('search');
        expect(pushMobileLevel).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('renderMobileSearch', () => {
    it('rend la structure DOM (#mobile-search-input dans le header-slot + état vide dans main)', () => {
        renderMobileSearch();
        // Refonte PR 5 : l'input vit dans le header-slot, l'état vide
        // (catégories) ou résultats dans le main-container.
        expect(document.getElementById('mobile-search-input')).not.toBeNull();
        const main = document.getElementById('mobile-main-container');
        // L'état vide rend .search-empty-body (catégories).
        expect(main.querySelector('.search-empty-body')).not.toBeNull();
    });

    it('input < 2 caractères → main vidé (pas d\'appel à getSearchResults)', () => {
        renderMobileSearch();
        const input = document.getElementById('mobile-search-input');
        const main = document.getElementById('mobile-main-container');
        // Le state.loadedFeatures est vide → search-empty-body sans catégories,
        // mais le main n'est pas vide tant que le user tape pas. Quand il
        // tape 1 char, on attend que le main devienne vide.
        input.value = 'x';
        input.dispatchEvent(new Event('input'));
        expect(main.innerHTML).toBe('');
        expect(getSearchResults).not.toHaveBeenCalled();
    });

    it('input ≥ 2 caractères → getSearchResults appelé + résultats rendus + click → openDetailsPanel', () => {
        const fakeFeature = { type: 'Feature', properties: { HW_ID: 'p1', name: 'Foo' }, geometry: { coordinates: [10, 33] } };
        state.loadedFeatures = [fakeFeature];
        getSearchResults.mockReturnValueOnce([fakeFeature]);

        renderMobileSearch();
        const input = document.getElementById('mobile-search-input');
        input.value = 'foo';
        input.dispatchEvent(new Event('input'));

        expect(getSearchResults).toHaveBeenCalledWith('foo');
        const main = document.getElementById('mobile-main-container');
        // Refonte PR 5 : .result-item → .search-result.
        const item = main.querySelector('.search-result');
        expect(item).not.toBeNull();
        expect(item.dataset.id).toBe('p1');

        item.click();
        expect(openDetailsPanel).toHaveBeenCalledWith(0);
    });
});
