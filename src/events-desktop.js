// events-desktop.js
// Listeners DOM spécifiques à l'UI desktop (barre de filtres haute, menus
// contextuels, tabs, recherche, boutons import/sync). Aucun listener mobile
// et aucune souscription eventBus ici.

import { DOM } from './ui-dom.js';
import { showLegendModal } from './ui-modals.js';
import { setupSearch } from './searchManager.js';
import { setupTabs } from './ui-sidebar.js';

// PR 3 (refonte topbar Claude Design) : les anciens boutons filtres
// (#btn-filter-zones, #btn-categories, #btn-filter-vus, #btn-filter-planifies,
// #btn-filter-nonverifies) ont été retirés du topbar. Tout passe désormais
// par le panneau de filtres unifié, ouvert depuis #hw-topbar-filters-btn
// (cf. topbar-v2.js).

export function setupDesktopUIListeners() {
    document.getElementById('btn-legend')?.addEventListener('click', () => showLegendModal());

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#btn-tools-menu') && !e.target.closest('#tools-menu-content')) {
            const tMenu = document.getElementById('tools-menu-content');
            if (tMenu) tMenu.classList.remove('active');
        }
        if (!e.target.closest('#btn-admin-menu') && !e.target.closest('#admin-menu-content')) {
            const aMenu = document.getElementById('admin-menu-content');
            if (aMenu) aMenu.classList.remove('active');
        }
    });

    if (DOM.searchInput) DOM.searchInput.addEventListener('input', setupSearch);
    document.addEventListener('click', (e) => {
        if (DOM.searchResults && !e.target.closest('.search-container')) {
            DOM.searchResults.classList.add('is-hidden');
        }
    });

    setupTabs();

    const btnImportPhotos = document.getElementById('btn-import-photos');
    const photoLoader = document.getElementById('photo-gps-loader');
    if (btnImportPhotos && photoLoader) {
        btnImportPhotos.addEventListener('click', () => photoLoader.click());
    }

    const btnSyncScan = document.getElementById('btn-sync-scan');
    if (btnSyncScan) btnSyncScan.style.display = 'none';

    const btnSyncShare = document.getElementById('btn-sync-share');
    if (btnSyncShare) btnSyncShare.style.display = 'none';
}
