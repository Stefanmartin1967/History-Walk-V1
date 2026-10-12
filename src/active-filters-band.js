// active-filters-band.js — bande « Filtres actifs » en tête de carte (PC).
//
// Handoff Claude Design « retouches testeurs », sujet 5 (11/10/2026). Un
// visiteur qui voyait une carte à moitié vide ne savait pas QUEL filtre la
// vidait : le bouton « Filtres (n) » ne disait que combien, et une info-bulle
// n'existe pas au toucher. Dès qu'un filtre est actif, une puce par filtre
// apparaît, chacune retirable, plus « Tout effacer ».
//
// Source unique : getActiveFilters (filter-panel.js), la même que le compteur
// de la barre du haut et le panneau. Rendu à chaque data:filtered (émis par
// applyFilters après tout changement de filtre). Téléphone : PR suivante —
// masquée ici par CSS (body.mobile-mode).

import L from 'leaflet';
import { getActiveFilters, removeActiveFilter, resetAll } from './filter-panel.js';
import { eventBus } from './events.js';
import { createIcons, appIcons } from './lucide-icons.js';

const BAND_ID = 'hw-active-filters';

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function render(band) {
    const filters = getActiveFilters();
    band.hidden = filters.length === 0;
    if (filters.length === 0) { band.innerHTML = ''; return; }
    band.innerHTML = `
        <span class="hw-active-filters__label">Filtres actifs</span>
        ${filters.map(({ id, label }) => `
            <span class="hw-filter-chip">
                <span>${escapeHtml(label)}</span>
                <button type="button" class="hw-filter-chip__remove" data-remove="${escapeHtml(id)}"
                        aria-label="Retirer le filtre ${escapeHtml(label)}"><i data-lucide="x"></i></button>
            </span>`).join('')}
        <button type="button" class="hw-active-filters__clear" data-clear>Tout effacer</button>`;
    createIcons({ icons: appIcons, root: band });
}

// Après un retrait, la puce cliquée n'existe plus : le focus clavier passe à la
// première croix restante, sinon (bande vide) au bouton « Filtres ».
function restoreFocus(band) {
    const target = band.hidden
        ? document.getElementById('hw-topbar-filters-btn')
        : band.querySelector('.hw-filter-chip__remove, .hw-active-filters__clear');
    target?.focus();
}

export function setupActiveFiltersBand() {
    const band = document.getElementById(BAND_ID);
    if (!band) return;

    // La bande vit DANS le conteneur Leaflet (comme le panneau Filtres) : sans
    // ça, un clic ou la molette sur elle agirait aussi sur la carte.
    L.DomEvent.disableClickPropagation(band);
    L.DomEvent.disableScrollPropagation(band);

    band.addEventListener('click', (e) => {
        const remove = e.target.closest('[data-remove]');
        if (remove) {
            const byKeyboard = e.detail === 0;
            removeActiveFilter(remove.dataset.remove);
            if (byKeyboard) restoreFocus(band);
            return;
        }
        if (e.target.closest('[data-clear]')) {
            const byKeyboard = e.detail === 0;
            resetAll();
            if (byKeyboard) restoreFocus(band);
        }
    });

    eventBus.on('data:filtered', () => render(band));
    render(band);
}
