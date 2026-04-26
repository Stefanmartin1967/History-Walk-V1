// events-desktop.js
// Listeners DOM spécifiques à l'UI desktop (barre de filtres haute, menus
// contextuels, tabs, recherche, boutons import/sync). Aucun listener mobile
// et aucune souscription eventBus ici.

import { populateCategoriesMenu } from './ui-filters.js';
import { state, setActiveFilter } from './state.js';
import { DOM } from './ui-dom.js';
import { closeAllDropdowns } from './ui-utils.js';
import { showLegendModal } from './ui-modals.js';
import { applyFilters } from './data.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { setupSearch } from './searchManager.js';
import { setupTabs } from './ui-sidebar.js';

export function setupDesktopUIListeners() {
    document.getElementById('btn-categories')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const cMenu = document.getElementById('categoriesMenu');
        if (cMenu) {
            const isVisible = cMenu.style.display === 'block';
            closeAllDropdowns();
            if (!isVisible) cMenu.style.display = 'block';
        }
    });

    populateCategoriesMenu();

    document.getElementById('btn-legend')?.addEventListener('click', () => showLegendModal());

    document.getElementById('btn-filter-vus')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        // Toggle binaire entre 'all' et 'hide' (3-states refonte filtres :
        // l'état 'only' n'est accessible que via le nouveau panneau de filtres).
        const isHidden = btn.classList.toggle('active');
        setActiveFilter('vus', isHidden ? 'hide' : 'all');

        // Mise à jour de l'icône et du titre pour l'ACTION FUTURE
        if (isHidden) {
            // État actuel : Masqué -> Action : Tout afficher
            btn.innerHTML = `<i data-lucide="eye-off"></i><span>Visités</span>`;
            btn.title = "Tout afficher";
        } else {
            // État actuel : Visible -> Action : Masquer les visités
            btn.innerHTML = `<i data-lucide="eye"></i><span>Visités</span>`;
            btn.title = "Masquer les visités";
        }
        createIcons({ icons: appIcons, nameAttr: 'data-lucide', attrs: { 'class': "lucide" }, root: btn });
        applyFilters();
    });

    document.getElementById('btn-filter-planifies')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        // Toggle binaire entre 'all' et 'hide' (3-states refonte filtres :
        // l'état 'only' n'est accessible que via le nouveau panneau de filtres).
        const isHidden = btn.classList.toggle('active');
        setActiveFilter('planifies', isHidden ? 'hide' : 'all');

        // Mise à jour de l'icône et du titre pour l'ACTION FUTURE
        if (isHidden) {
            // État actuel : Masqué -> Action : Tout afficher
            btn.innerHTML = `<i data-lucide="calendar-off"></i><span>Planifiés</span>`;
            btn.title = "Tout afficher";
        } else {
            // État actuel : Visible -> Action : Masquer les planifiés
            btn.innerHTML = `<i data-lucide="calendar-check"></i><span>Planifiés</span>`;
            btn.title = "Masquer les planifiés";
        }
        createIcons({ icons: appIcons, nameAttr: 'data-lucide', attrs: { 'class': "lucide" }, root: btn });
        applyFilters();
    });

    document.getElementById('btn-filter-nonverifies')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const isActive = btn.classList.toggle('active');
        setActiveFilter('nonVerifies', isActive);
        if (isActive) {
            btn.innerHTML = `<i data-lucide="shield-off"></i>`;
            btn.title = "Afficher tous";
        } else {
            btn.innerHTML = `<i data-lucide="shield-check"></i>`;
            btn.title = "Non vérifiés seulement";
        }
        createIcons({ icons: appIcons, nameAttr: 'data-lucide', attrs: { 'class': "lucide" }, root: btn });
        applyFilters();
    });

    document.getElementById('btn-filter-zones')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const zMenu = document.getElementById('zonesMenu');
        if (zMenu) {
            const isVisible = zMenu.style.display === 'block';
            closeAllDropdowns();
            if (!isVisible) zMenu.style.display = 'block';
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#btn-filter-zones') && !e.target.closest('#zonesMenu')) {
            const zonesMenu = document.getElementById('zonesMenu');
            if (zonesMenu) zonesMenu.style.display = 'none';
        }
        if (!e.target.closest('#btn-categories') && !e.target.closest('#categoriesMenu')) {
            const cMenu = document.getElementById('categoriesMenu');
            if (cMenu) cMenu.style.display = 'none';
        }
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
