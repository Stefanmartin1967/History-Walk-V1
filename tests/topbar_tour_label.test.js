// @vitest-environment jsdom
//
// « Que faire ? » (#btn-tour) dans la barre du haut (11/10/2026). La barre n'a
// que la largeur de la carte : mesuré à 956 px sur un portable à 1366 px, où le
// libellé tient de justesse, et elle débordait sous le panneau latéral avec le
// bouton tel que dessiné. Le libellé se replie (classe is-compact) dès que la
// barre DÉBORDE — mesure réelle, pas un seuil en px.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/state.js', () => ({ state: { activeFilters: {} } }));
vi.mock('../src/destination-switch.js', () => ({ switchActiveDestination: vi.fn() }));
let activeFilters = [];
vi.mock('../src/filter-panel.js', () => ({ toggleFilterPanel: vi.fn(), getActiveFilters: vi.fn(() => activeFilters) }));
vi.mock('../src/welcome.js', () => ({ showWelcomeAgain: vi.fn() }));
vi.mock('../src/theme.js', () => ({ setTheme: vi.fn(), getCurrentTheme: vi.fn(() => 'plein-soleil') }));
vi.mock('../src/patrimonial-names.js', () => ({ getCurrentPatrimonialLang: vi.fn(() => 'fr'), setPatrimonialLang: vi.fn() }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/utils.js', () => ({ isDestinationPublished: vi.fn(() => true) }));

import { refreshFiltersButton } from '../src/topbar-v2.js';
import { state } from '../src/state.js';

// jsdom ne calcule pas de mise en page : on impose largeur visible et largeur
// du contenu de la barre.
function setBar({ client, scroll }) {
    const bar = document.querySelector('.topbar');
    Object.defineProperty(bar, 'clientWidth', { configurable: true, value: client });
    Object.defineProperty(bar, 'scrollWidth', { configurable: true, value: scroll });
}

beforeEach(() => {
    activeFilters = [];
    state.activeFilters = {};
    document.body.innerHTML = `
        <div class="topbar">
            <button id="btn-tour" class="hw-topbar-action"><span>Que faire ?</span></button>
            <button id="hw-topbar-filters-btn"><span id="hw-topbar-filters-label">Filtres</span><span id="hw-topbar-filters-count" hidden></span></button>
        </div>`;
});

const tour = () => document.getElementById('btn-tour');

describe('« Que faire ? » — repli du libellé selon la place', () => {
    it('la barre tient : le libellé reste visible', () => {
        setBar({ client: 1400, scroll: 1400 });
        refreshFiltersButton();
        expect(tour().classList.contains('is-compact')).toBe(false);
    });

    it('la barre déborde : le libellé se replie', () => {
        setBar({ client: 896, scroll: 955 });
        refreshFiltersButton();
        expect(tour().classList.contains('is-compact')).toBe(true);
    });

    it('la place revient : le libellé se déplie de nouveau', () => {
        setBar({ client: 896, scroll: 955 });
        refreshFiltersButton();
        setBar({ client: 1400, scroll: 1400 });
        refreshFiltersButton();
        expect(tour().classList.contains('is-compact')).toBe(false);
    });
});

// Compteur « Filtres (n) » : n = nombre de FILTRES actifs (une puce = un
// filtre), lu dans la source unique getActiveFilters (11/10/2026).
describe('bouton Filtres — pastille du nombre de filtres actifs', () => {
    const btn = () => document.getElementById('hw-topbar-filters-btn');
    const count = () => document.getElementById('hw-topbar-filters-count');

    it("aucun filtre : pas de pastille, pas d'état actif", () => {
        refreshFiltersButton();
        expect(count().hidden).toBe(true);
        expect(btn().classList.contains('has-active')).toBe(false);
        expect(btn().getAttribute('aria-label')).toBe('Filtres');
    });

    it('trois filtres (même dans une seule section) : pastille « 3 », nom accessible', () => {
        activeFilters = [{ id: 'categorie:Mosquée' }, { id: 'categorie:Mausolée' }, { id: 'zone' }];
        refreshFiltersButton();
        expect(count().hidden).toBe(false);
        expect(count().textContent).toBe('3');
        expect(btn().classList.contains('has-active')).toBe(true);
        expect(btn().getAttribute('aria-label')).toBe('Filtres, 3 actifs');
    });
});
