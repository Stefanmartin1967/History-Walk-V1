// topbar-v2.js
// Câblage du nouveau topbar (refonte Claude Design) :
// - Bouton "Filtres" unique avec compteur dynamique "Filtres (n)" (PR 3)
//   → ouvre le panneau de filtres unifié (cf. filter-panel.js)
// - Sélecteur de destination + dropdown des destinations disponibles (PR 4)
//   Djerba active ; Hammamet et Agadir présentés "Bientôt".
//
// Le compteur Filtres reflète le nombre de SECTIONS du panneau qui ont au
// moins un filtre actif (cf. spec : "comptage par section, pas par option").

import { state } from './state.js';
import { eventBus } from './events.js';
import { toggleFilterPanel } from './filter-panel.js';

const FILTERS_BTN_ID = 'hw-topbar-filters-btn';
const FILTERS_LABEL_ID = 'hw-topbar-filters-label';
const DEST_SELECTOR_ID = 'hw-dest-selector';
const DEST_MENU_ID = 'hw-dest-menu';

function isSectionActive(id) {
    const f = state.activeFilters || {};
    switch (id) {
        case 'localisation': return f.zone !== null && f.zone !== undefined;
        case 'categories':   return Array.isArray(f.categories) && f.categories.length > 0;
        case 'parcours':     return (f.vus && f.vus !== 'all')
                                  || (f.planifies && f.planifies !== 'all')
                                  || !!f.incontournablesOnly;
        case 'fiche':        return !!f.nonVerifies || !!f.noPhoto || !!f.noDesc;
        default:             return false;
    }
}

function countActiveSections() {
    return ['localisation', 'categories', 'parcours', 'fiche']
        .reduce((n, id) => n + (isSectionActive(id) ? 1 : 0), 0);
}

export function refreshFiltersButton() {
    const label = document.getElementById(FILTERS_LABEL_ID);
    const btn = document.getElementById(FILTERS_BTN_ID);
    if (!label || !btn) return;

    const n = countActiveSections();
    label.textContent = n > 0 ? `Filtres (${n})` : 'Filtres';
    btn.classList.toggle('is-active', n > 0);
}

// ─── Dropdown destination ──────────────────────────────────────────────────

function setDestMenuOpen(open) {
    const menu = document.getElementById(DEST_MENU_ID);
    const selector = document.getElementById(DEST_SELECTOR_ID);
    if (!menu || !selector) return;
    if (open) {
        menu.removeAttribute('hidden');
        selector.classList.add('is-open');
        selector.setAttribute('aria-expanded', 'true');
    } else {
        menu.setAttribute('hidden', '');
        selector.classList.remove('is-open');
        selector.setAttribute('aria-expanded', 'false');
    }
}

function isDestMenuOpen() {
    const menu = document.getElementById(DEST_MENU_ID);
    return !!menu && !menu.hasAttribute('hidden');
}

function toggleDestMenu() {
    setDestMenuOpen(!isDestMenuOpen());
}

function setupDestinationMenu() {
    const selector = document.getElementById(DEST_SELECTOR_ID);
    const menu = document.getElementById(DEST_MENU_ID);
    if (!selector || !menu) return;

    selector.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDestMenu();
    });

    // Click sur la destination active (Djerba) : ferme simplement le menu.
    // Les destinations disabled (Hammamet, Agadir) ne sont pas focusables
    // ni cliquables (pointer-events laissé natif via aria-disabled, et le
    // CSS .is-disabled met cursor:not-allowed).
    menu.querySelectorAll('.hw-dest-item.is-active').forEach(item => {
        item.addEventListener('click', () => setDestMenuOpen(false));
    });

    // Fermeture sur clic extérieur
    document.addEventListener('click', (e) => {
        if (!isDestMenuOpen()) return;
        if (e.target.closest(`#${DEST_SELECTOR_ID}`)) return;
        if (e.target.closest(`#${DEST_MENU_ID}`)) return;
        setDestMenuOpen(false);
    });

    // Fermeture sur Échap
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isDestMenuOpen()) {
            setDestMenuOpen(false);
            selector.focus();
        }
    });
}

// ─── Init ─────────────────────────────────────────────────────────────────

export function setupTopbarV2() {
    const filtersBtn = document.getElementById(FILTERS_BTN_ID);
    if (filtersBtn) {
        filtersBtn.addEventListener('click', toggleFilterPanel);
    }

    // Mise à jour du compteur à chaque changement de filtre.
    // Le filter-panel émet déjà data:filtered via applyFilters() après chaque
    // modif de filter, donc ce listener suffit.
    eventBus.on('data:filtered', refreshFiltersButton);

    // État initial (au cas où des filtres seraient restaurés au boot).
    refreshFiltersButton();

    // Dropdown des destinations (PR 4)
    setupDestinationMenu();
}
