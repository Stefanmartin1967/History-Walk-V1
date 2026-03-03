// app-events.js
import { eventBus } from './events.js';
import { isMobileView, renderMobilePoiList } from './mobile.js';
import { refreshMapMarkers } from './map.js';
import { populateZonesMenu, populateCategoriesMenu, populateCircuitsMenu } from './ui-filters.js';
import { loadCircuitById, clearCircuit } from './circuit.js';
import { performCircuitDeletion, toggleCircuitVisitedStatus } from './circuit-actions.js';
import { state } from './state.js';
import { DOM } from './ui.js';
import { showToast } from './toast.js';
import { closeAllDropdowns } from './ui-utils.js';
import { showLegendModal } from './ui-modals.js';
import { applyFilters } from './data.js';
import { createIcons, icons } from 'lucide';
import { setupSearch } from './searchManager.js';
import { setupTabs } from './ui-sidebar.js';
import { toggleSelectionMode } from './ui-circuit-editor.js';
import { showConfirm } from './modal.js';
import { handlePhotoImport } from './fileManager.js';

export function setupEventBusListeners() {
    eventBus.on('data:filtered', (visibleFeatures) => {
        if (isMobileView()) {
            renderMobilePoiList(visibleFeatures);
        } else {
            refreshMapMarkers(visibleFeatures);
            populateZonesMenu();
            populateCategoriesMenu();
        }
    });

    eventBus.on('circuit:request-load', async (id) => await loadCircuitById(id));
    eventBus.on('circuit:request-delete', async (id) => {
        const result = await performCircuitDeletion(id);
        if (result.success) {
            showToast(result.message, 'success');
            eventBus.emit('circuit:list-updated');
        } else {
            showToast(result.message, 'error');
        }
    });
    eventBus.on('circuit:request-import', (id) => {
        state.circuitIdToImportFor = id;
        if(DOM.gpxImporter) DOM.gpxImporter.click();
    });
    eventBus.on('circuit:request-toggle-visited', async ({ id, isChecked }) => {
        const result = await toggleCircuitVisitedStatus(id, isChecked);
        if (result.success) eventBus.emit('circuit:list-updated');
    });
    eventBus.on('circuit:list-updated', () => populateCircuitsMenu());
}

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
        // On inverse l'état logique : Actif = Masqué
        const isHidden = btn.classList.toggle('active');
        state.activeFilters.vus = isHidden;

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
        createIcons({ icons, nameAttr: 'data-lucide', attrs: { 'class': "lucide" }, root: btn });
        applyFilters();
    });

    document.getElementById('btn-filter-planifies')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        // On inverse l'état logique : Actif = Masqué
        const isHidden = btn.classList.toggle('active');
        state.activeFilters.planifies = isHidden;

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
        createIcons({ icons, nameAttr: 'data-lucide', attrs: { 'class': "lucide" }, root: btn });
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
            DOM.searchResults.style.display = 'none';
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

export function setupGlobalEventListeners() {
    const btnClear = document.getElementById('btn-clear-circuit');
    if (btnClear) btnClear.addEventListener('click', () => clearCircuit(true));

    const btnClose = document.getElementById('close-circuit-panel-button');
    if (btnClose) {
        btnClose.addEventListener('click', async () => {
            if (state.currentCircuit.length > 0) {
                if (await showConfirm("Fermeture", "Voulez-vous vraiment fermer et effacer le brouillon du circuit ?", "Fermer", "Annuler", true)) {
                    await clearCircuit(false);
                    toggleSelectionMode(false);
                }
            } else {
                toggleSelectionMode(false);
            }
        });
    }
}
