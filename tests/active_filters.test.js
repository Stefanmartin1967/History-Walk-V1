// @vitest-environment jsdom
//
// Filtres actifs — SOURCE UNIQUE (11/10/2026, handoff « retouches testeurs »,
// sujet 5). Les puces de la bande, le compteur « Filtres (n) » de la barre du
// haut et le panneau lisent tous getActiveFilters. Avant, trois définitions de
// « actif » divergeaient : la barre du haut ignorait les filtres admin et toutes
// comptaient des sections.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/state.js', () => {
    const state = { isAdmin: false, activeFilters: {} };
    return {
        state,
        setActiveFilters: vi.fn((f) => { state.activeFilters = f; }),
        POI_CATEGORIES: [],
    };
});
vi.mock('../src/taxonomy.js', () => ({ getGroups: vi.fn(() => []), getGroupForCategory: vi.fn() }));
vi.mock('../src/data.js', () => ({ applyFilters: vi.fn(), getFilteredFeatures: vi.fn(() => []) }));
vi.mock('../src/circuit-actions.js', () => ({ getZonesData: vi.fn(() => null) }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));

import { getActiveFilters, removeActiveFilter } from '../src/filter-panel.js';
import { state } from '../src/state.js';
import { applyFilters } from '../src/data.js';

const labels = () => getActiveFilters().map(f => f.label);

beforeEach(() => {
    state.isAdmin = false;
    state.activeFilters = { introuvableCarte: 'hide' }; // défaut visiteur
    vi.clearAllMocks();
});

describe('getActiveFilters — ce qui compte comme « actif »', () => {
    it('visiteur au repos : aucun filtre (« Existence à confirmer » masqué est le défaut, pas un choix)', () => {
        expect(getActiveFilters()).toEqual([]);
    });

    it('admin au repos : aucun filtre (son défaut est « Tous »)', () => {
        state.isAdmin = true;
        state.activeFilters = { introuvableCarte: 'all' };
        expect(getActiveFilters()).toEqual([]);
    });

    it('un filtre = une puce : zone, chaque catégorie, parcours, incontournables', () => {
        state.activeFilters = {
            introuvableCarte: 'hide', zone: 'Midoun', categories: ['Mosquée', 'Mausolée'],
            vus: 'hide', planifies: 'only', incontournablesOnly: true,
        };
        expect(labels()).toEqual([
            'Zone : Midoun', 'Mosquée', 'Mausolée',
            'Lieux visités : masqués', 'Lieux planifiés : seulement', 'Incontournables seulement',
        ]);
    });

    it('les filtres admin comptent aussi (la barre du haut les ignorait)', () => {
        state.isAdmin = true;
        state.activeFilters = { introuvableCarte: 'all', osmChecked: 'only', jalelChecked: 'hide' };
        expect(labels()).toEqual(['OSM vérifié : seulement', 'Jalel checké : masqués']);
    });
});

describe('removeActiveFilter — retirer UNE puce', () => {
    it('une catégorie : les autres restent', () => {
        state.activeFilters = { introuvableCarte: 'hide', categories: ['Mosquée', 'Mausolée'] };
        removeActiveFilter('categorie:Mosquée');
        expect(state.activeFilters.categories).toEqual(['Mausolée']);
        expect(applyFilters).toHaveBeenCalledTimes(1);
    });

    it('une ligne 3 états repasse à SON défaut (visiteur : « Existence à confirmer » → masqués)', () => {
        state.activeFilters = { introuvableCarte: 'all', vus: 'hide' };
        removeActiveFilter('introuvableCarte');
        removeActiveFilter('vus');
        expect(state.activeFilters.introuvableCarte).toBe('hide');
        expect(state.activeFilters.vus).toBe('all');
        expect(getActiveFilters()).toEqual([]);
    });

    it('zone et incontournables', () => {
        state.activeFilters = { introuvableCarte: 'hide', zone: 'Midoun', incontournablesOnly: true };
        removeActiveFilter('zone');
        removeActiveFilter('incontournablesOnly');
        expect(getActiveFilters()).toEqual([]);
    });

    it('id inconnu : rien ne bouge', () => {
        removeActiveFilter('nimportequoi');
        expect(applyFilters).not.toHaveBeenCalled();
    });
});
