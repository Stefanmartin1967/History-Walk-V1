// topbar-v2.js
// Câblage du nouveau topbar (refonte Claude Design — PR 3) :
// - Bouton "Filtres" unique avec compteur dynamique "Filtres (n)"
//   → ouvre le panneau de filtres unifié (cf. filter-panel.js)
// - Sélecteur de destination : visuel uniquement en PR 3 (dropdown câblé en PR 4)
//
// Le compteur reflète le nombre de SECTIONS du panneau qui ont au moins
// un filtre actif (cf. spec : "comptage par section, pas par option cochée").

import { state } from './state.js';
import { eventBus } from './events.js';
import { toggleFilterPanel } from './filter-panel.js';

const FILTERS_BTN_ID = 'hw-topbar-filters-btn';
const FILTERS_LABEL_ID = 'hw-topbar-filters-label';

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
}
