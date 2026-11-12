// @vitest-environment jsdom
//
// Bande « Filtres actifs » de Mes Circuits (téléphone), au-dessus du dock.
// Handoff Claude Design « écran bas », lot 2 (12/11/2026) : le bouton réglages
// disait COMBIEN de filtres, jamais LESQUELS. Une puce par filtre, toucher la
// puce le retire, « Tout réinitialiser » au bout. Mêmes mocks que
// mobile_circuits_filter_badge.test.js.

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

let state, renderMobileCircuitsList;

beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = `
        <div id="mobile-header-slot"></div>
        <div id="mobile-main-container"></div>
        <div id="mobile-filter-strip" hidden></div>
        <div id="mobile-view-footer"></div>
        <button id="btn-mobile-filter"><span>Tout</span></button>
    `;
    if (!globalThis.requestAnimationFrame) {
        globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
    }
    vi.clearAllMocks();
    ({ state } = await import('../src/state.js'));
    state.homeLocation = { lat: 33.8, lng: 10.8, label: 'Houmt Souk', savedAt: 1 };
    state.filterCompleted = false;
    state.activeFilters = { zone: null };
    ({ renderMobileCircuitsList } = await import('../src/mobile-circuits.js'));
});

const strip = () => document.getElementById('mobile-filter-strip');
const chips = () => [...strip().querySelectorAll('.m-chip')].map(c => c.textContent.trim());
const chip = (label) => [...strip().querySelectorAll('.m-chip')].find(c => c.textContent.trim() === label);
const headerBadge = () => document.querySelector('#mobile-mc-filter-btn .badge-n')?.textContent ?? null;
const openSheet = () => document.getElementById('mobile-mc-filter-btn').click();

describe('Mes Circuits mobile — bande des filtres actifs', () => {
    it('aucun filtre : bande cachée et vide', () => {
        renderMobileCircuitsList();
        expect(strip().hidden).toBe(true);
        expect(strip().innerHTML).toBe('');
    });

    it('une puce par filtre, dans le même compte que la pastille', () => {
        renderMobileCircuitsList();
        openSheet();
        document.querySelector('[data-fchk="official"]').click();
        document.querySelector('.ms-sort-btn[data-sort="dist_desc"]').click();
        expect(strip().hidden).toBe(false);
        expect(chips()).toEqual(['Officiels', 'Tri : Long']);
        expect(headerBadge()).toBe('2');
        expect(chip('Officiels').getAttribute('aria-label')).toBe('Retirer le filtre Officiels');
        expect(strip().querySelector('[data-clear]').textContent).toBe('Tout réinitialiser');
    });

    it('toucher une puce retire son filtre', () => {
        renderMobileCircuitsList();
        openSheet();
        document.querySelector('[data-fchk="official"]').click();
        document.querySelector('[data-fchk="resto"]').click();
        chip('Officiels').click();
        expect(chips()).toEqual(['Avec resto']);
        expect(headerBadge()).toBe('1');
    });

    it('« Tout réinitialiser » vide et cache la bande', () => {
        renderMobileCircuitsList();
        openSheet();
        document.querySelector('[data-fchk="verified"]').click();
        strip().querySelector('[data-clear]').click();
        expect(strip().hidden).toBe(true);
        expect(headerBadge()).toBeNull();
    });

    it('« À faire » du dock devient une puce ; la retirer éteint le bouton du dock', async () => {
        const { setFilterCompleted } = await import('../src/state.js');
        state.filterCompleted = true;
        renderMobileCircuitsList();
        const dock = document.getElementById('btn-mobile-filter');
        expect(chips()).toEqual(['À faire']);
        expect(dock.classList.contains('is-filter-active')).toBe(true);
        chip('À faire').click();
        expect(setFilterCompleted).toHaveBeenLastCalledWith(false);
        expect(strip().hidden).toBe(true);
        expect(dock.classList.contains('is-filter-active')).toBe(false);
    });

    it('zone et distance : libellés lisibles', async () => {
        state.activeFilters.zone = 'Midoun';
        renderMobileCircuitsList();
        expect(chips()).toEqual(['Midoun']);
        chip('Midoun').click();
        expect(state.activeFilters.zone).toBeNull();
    });
});
