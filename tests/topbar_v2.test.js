// @vitest-environment jsdom
//
// Barre du haut PC (topbar-v2.js).
// - Bouton Filtres : pastille du nombre de filtres actifs (11/10/2026).
// - Palier étroit (barre < 932 px, handoff Claude Design « écran bas »,
//   12/11/2026) : la loupe ouvre la recherche sur toute la barre, « Lecture »
//   ouvre moment + langue des noms. Le CSS (container query) décide quand ces
//   boutons sont visibles ; on teste ici l'ouverture, la fermeture et l'état
//   affiché par « Lecture ». (Le repli mesuré de « Que faire ? », fitTourLabel,
//   a été retiré : son libellé reste visible partout.)
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

import { refreshFiltersButton, setupSearchToggle, setupLectureMenu } from '../src/topbar-v2.js';
import { state } from '../src/state.js';
import { getCurrentPatrimonialLang } from '../src/patrimonial-names.js';

beforeEach(() => {
    activeFilters = [];
    state.activeFilters = {};
    getCurrentPatrimonialLang.mockReturnValue('fr');
    document.body.innerHTML = `
        <div class="topbar">
            <button id="btn-tour" class="hw-topbar-action"><span>Que faire ?</span></button>
            <div class="search-container">
                <input type="search" id="search-input">
                <button id="hw-search-close" type="button">x</button>
            </div>
            <button id="hw-search-toggle" type="button" aria-expanded="false">loupe</button>
            <button id="hw-topbar-filters-btn"><span id="hw-topbar-filters-label">Filtres</span><span id="hw-topbar-filters-count" hidden></span></button>
            <div class="hw-prefs" id="hw-prefs">
                <button id="hw-lecture-btn" type="button" aria-expanded="false">
                    <span id="hw-lecture-emo"></span><span id="hw-lecture-lng"></span>
                </button>
                <div id="hw-prefs-pop">
                    <div class="hw-moment-toggle">
                        <button class="hw-moment-seg" data-theme="matin"><span>🌅</span></button>
                        <button class="hw-moment-seg" data-theme="plein-soleil"><span>☀️</span></button>
                    </div>
                </div>
            </div>
        </div>
        <p id="ailleurs">ailleurs</p>`;
});

describe('palier étroit — loupe de recherche', () => {
    const bar = () => document.querySelector('.topbar');
    const toggle = () => document.getElementById('hw-search-toggle');
    const input = () => document.getElementById('search-input');

    it('la loupe ouvre le champ sur toute la barre et y met le focus', () => {
        setupSearchToggle();
        toggle().click();
        expect(bar().classList.contains('is-search-open')).toBe(true);
        expect(toggle().getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(input());
    });

    it('la croix referme et rend le focus à la loupe', () => {
        setupSearchToggle();
        toggle().click();
        document.getElementById('hw-search-close').click();
        expect(bar().classList.contains('is-search-open')).toBe(false);
        expect(toggle().getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(toggle());
    });

    it('Échap dans le champ referme', () => {
        setupSearchToggle();
        toggle().click();
        input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(bar().classList.contains('is-search-open')).toBe(false);
    });
});

describe('palier étroit — bouton « Lecture »', () => {
    const wrap = () => document.getElementById('hw-prefs');
    const btn = () => document.getElementById('hw-lecture-btn');

    it("affiche l'émoji du moment courant et la langue des noms", () => {
        setupLectureMenu();
        expect(document.getElementById('hw-lecture-emo').textContent).toBe('☀️');
        expect(document.getElementById('hw-lecture-lng').textContent).toBe('FR');
    });

    it('noms en arabe : « ع » en police serif', () => {
        getCurrentPatrimonialLang.mockReturnValue('ar');
        setupLectureMenu();
        const lng = document.getElementById('hw-lecture-lng');
        expect(lng.textContent).toBe('ع');
        expect(lng.classList.contains('scr')).toBe(true);
    });

    it('ouvre et ferme le menu, aria-expanded suit', () => {
        setupLectureMenu();
        btn().click();
        expect(wrap().classList.contains('is-open')).toBe(true);
        expect(btn().getAttribute('aria-expanded')).toBe('true');
        btn().click();
        expect(wrap().classList.contains('is-open')).toBe(false);
        expect(btn().getAttribute('aria-expanded')).toBe('false');
    });

    it('un clic ailleurs ou Échap referme le menu', () => {
        setupLectureMenu();
        btn().click();
        document.getElementById('ailleurs').click();
        expect(wrap().classList.contains('is-open')).toBe(false);
        btn().click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(wrap().classList.contains('is-open')).toBe(false);
        expect(document.activeElement).toBe(btn());
    });

    it('un clic sur un moment, dans le menu, le laisse ouvert', () => {
        setupLectureMenu();
        btn().click();
        document.querySelector('.hw-moment-seg[data-theme="matin"]').click();
        expect(wrap().classList.contains('is-open')).toBe(true);
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
