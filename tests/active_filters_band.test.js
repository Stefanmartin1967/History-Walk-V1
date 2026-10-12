// @vitest-environment jsdom
//
// Bande « Filtres actifs » (PC, 11/10/2026) : une puce par filtre actif, chacune
// retirable, plus « Tout effacer » ; cachée sans filtre. Re-rendue à chaque
// data:filtered. La logique des filtres (source unique) est testée dans
// active_filters.test.js : ici, le rendu et le câblage des clics.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let active = [];
vi.mock('../src/filter-panel.js', () => ({
    getActiveFilters: vi.fn(() => active),
    removeActiveFilter: vi.fn(),
    resetAll: vi.fn(),
}));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));

import { setupActiveFiltersBand } from '../src/active-filters-band.js';
import { removeActiveFilter, resetAll } from '../src/filter-panel.js';
import { eventBus } from '../src/events.js';

const band = () => document.getElementById('hw-active-filters');

beforeEach(() => {
    active = [];
    eventBus.listeners = {};
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="hw-active-filters" hidden></div><button id="hw-topbar-filters-btn"></button>';
});

describe('bande « Filtres actifs »', () => {
    it('sans filtre : cachée et vide', () => {
        setupActiveFiltersBand();
        expect(band().hidden).toBe(true);
        expect(band().children).toHaveLength(0);
    });

    it('une puce par filtre, avec sa croix nommée, et « Tout effacer »', () => {
        active = [{ id: 'zone', label: 'Zone : Midoun' }, { id: 'categorie:Mosquée', label: 'Mosquée' }];
        setupActiveFiltersBand();
        expect(band().hidden).toBe(false);
        const chips = [...band().querySelectorAll('.hw-filter-chip')];
        expect(chips.map(c => c.textContent.trim())).toEqual(['Zone : Midoun', 'Mosquée']);
        expect(chips[1].querySelector('button').getAttribute('aria-label')).toBe('Retirer le filtre Mosquée');
        expect(band().querySelector('.hw-active-filters__clear').textContent).toBe('Tout effacer');
    });

    it('la croix retire CE filtre ; « Tout effacer » réinitialise tout', () => {
        active = [{ id: 'zone', label: 'Zone : Midoun' }, { id: 'vus', label: 'Lieux visités : masqués' }];
        setupActiveFiltersBand();
        band().querySelector('[data-remove="vus"]').click();
        expect(removeActiveFilter).toHaveBeenCalledWith('vus');
        band().querySelector('[data-clear]').click();
        expect(resetAll).toHaveBeenCalledTimes(1);
    });

    it('se met à jour à chaque data:filtered', () => {
        setupActiveFiltersBand();
        active = [{ id: 'zone', label: 'Zone : Midoun' }];
        eventBus.emit('data:filtered', []);
        expect(band().hidden).toBe(false);
        active = [];
        eventBus.emit('data:filtered', []);
        expect(band().hidden).toBe(true);
    });

    it('un libellé ne peut pas injecter de HTML', () => {
        active = [{ id: 'zone', label: 'Zone : <img src=x onerror=alert(1)>' }];
        setupActiveFiltersBand();
        expect(band().querySelector('img')).toBeNull();
        expect(band().textContent).toContain('<img src=x');
    });
});
