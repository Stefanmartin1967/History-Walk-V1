// @vitest-environment jsdom
//
// Pastille des filtres de Mes Circuits (mobile) et tri par défaut.
// Régression du 20/10/2026 (S25 de Stefan, v3.7.446) : pastille « 1 » à chaque
// démarrage sans aucun filtre. La liste s'affiche une première fois AVANT que
// main.js relise le point de départ (IndexedDB) ; le rendu écrivait alors le
// repli « Court » dans le tri choisi, et le second rendu (point de départ connu,
// défaut = Proximité) comptait ce tri comme un filtre.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/state.js', () => {
    const state = {
        homeLocation: null,
        filterCompleted: false,
        activeFilters: { zone: null },
        currentFeatureId: null,
        loadedFeatures: [],
        officialCircuits: [],
        myCircuits: [],
        activeCircuitId: null,
    };
    return {
        state,
        setActiveFilter: vi.fn((k, v) => { state.activeFilters[k] = v; }),
        setFilterCompleted: vi.fn(v => { state.filterCompleted = v; }),
    };
});

vi.mock('../src/data.js', () => ({
    getPoiId: vi.fn(f => f?.properties?.HW_ID),
    getPatrimonialName: vi.fn(() => ''),
    getSearchableNames: vi.fn(() => []),
}));

vi.mock('../src/text-search.js', () => ({
    foldForSearch: vi.fn(s => String(s ?? '').toLowerCase()),
}));

vi.mock('../src/lucide-icons.js', () => ({
    createIcons: vi.fn(),
    appIcons: {},
}));

vi.mock('../src/utils.js', () => ({
    escapeHtml: vi.fn(s => String(s ?? '')),
    sanitizeHTML: vi.fn(s => String(s ?? '')),
    getZoneFromCoords: vi.fn(() => null),
}));

vi.mock('../src/circuit.js', () => ({
    isCircuitTested: vi.fn(() => false),
    loadCircuitById: vi.fn(),
}));

vi.mock('../src/circuit-actions.js', () => ({
    handleCircuitVisitedToggle: vi.fn(),
}));

vi.mock('../src/circuit-list-service.js', () => ({
    getProcessedCircuits: vi.fn(() => []),
    formatUnseenLabel: vi.fn(() => ''),
}));

vi.mock('../src/start-point.js', () => ({
    openStartPointModal: vi.fn(async () => null),
}));

vi.mock('../src/events.js', () => ({
    eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

const HOME = { lat: 33.8076, lng: 10.8451, label: 'Houmt Souk', savedAt: 1 };

let state, getProcessedCircuits, renderMobileCircuitsList, getMobileSort;

beforeEach(async () => {
    // État des modules (tri, filtres locaux) neuf à chaque test, comme un démarrage.
    vi.resetModules();
    document.body.innerHTML = `
        <div id="mobile-header-slot"></div>
        <div id="mobile-main-container"></div>
        <div id="mobile-view-footer"></div>
    `;
    if (!globalThis.requestAnimationFrame) {
        globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
    }
    vi.clearAllMocks();
    // resetModules ne recharge pas les modules mockés : l'état partagé est remis à la main.
    ({ state } = await import('../src/state.js'));
    state.homeLocation = null;
    state.filterCompleted = false;
    state.activeFilters = { zone: null };
    ({ getProcessedCircuits } = await import('../src/circuit-list-service.js'));
    ({ renderMobileCircuitsList } = await import('../src/mobile-circuits.js'));
    ({ getMobileSort } = await import('../src/mobile-state.js'));
});

const headerBadge = () => document.querySelector('#mobile-mc-filter-btn .badge-n')?.textContent ?? null;
const appliedSort = () => getProcessedCircuits.mock.calls.at(-1)[0];
const checkedSort = () => document.querySelector('.ms-sort-btn.is-on')?.dataset.sort ?? null;
const openSheet = () => document.getElementById('mobile-mc-filter-btn').click();

// Ordre réel du démarrage mobile : initMobileMode() rend la liste, puis main.js
// relit le point de départ, puis app-startup.js rend à nouveau.
function bootWithSavedHome() {
    renderMobileCircuitsList();
    state.homeLocation = { ...HOME };
    renderMobileCircuitsList();
}

describe('Mes Circuits mobile — pastille des filtres et tri par défaut', () => {
    it('démarrage avec un point de départ enregistré : pas de pastille, tri Proximité', () => {
        bootWithSavedHome();

        expect(headerBadge()).toBeNull();
        expect(appliedSort()).toBe('proximity_asc');
        expect(getMobileSort()).toBe('proximity_asc');

        openSheet();
        expect(checkedSort()).toBe('proximity_asc');
        expect(document.getElementById('filter-sheet-badge').hidden).toBe(true);
    });

    it('sans point de départ : Proximité s\'applique comme Court, sans pastille', () => {
        renderMobileCircuitsList();

        expect(headerBadge()).toBeNull();
        expect(appliedSort()).toBe('dist_asc');
        // Le repli n'est pas écrit dans le tri choisi.
        expect(getMobileSort()).toBe('proximity_asc');

        openSheet();
        expect(checkedSort()).toBe('dist_asc');

        // Choisir « Court » revient au tri appliqué par défaut : pas de pastille.
        document.querySelector('.ms-sort-btn[data-sort="dist_asc"]').click();
        expect(headerBadge()).toBeNull();
    });

    it('un tri choisi autre que le défaut allume la pastille ; Tout réinitialiser l\'éteint', () => {
        bootWithSavedHome();
        openSheet();

        document.querySelector('.ms-sort-btn[data-sort="dist_asc"]').click();
        expect(headerBadge()).toBe('1');
        expect(appliedSort()).toBe('dist_asc');

        document.getElementById('filter-sheet-reset').click();
        expect(headerBadge()).toBeNull();
        expect(getMobileSort()).toBe('proximity_asc');
        expect(appliedSort()).toBe('proximity_asc');
        expect(checkedSort()).toBe('proximity_asc');
    });
});
