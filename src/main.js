// main.js
import { initDB, getAppState, saveAppState, getAllPoiDataForMap, getAllCircuitsForMap, deleteCircuitById } from './database.js';
import { APP_VERSION, state } from './state.js';
import { initMap, map, refreshMapMarkers, fitMapToContent } from './map.js';
import { eventBus } from './events.js';
import { createIcons, icons } from 'lucide';
import {
    initializeDomReferences,
    DOM,
    populateZonesMenu,
    populateCategoriesMenu,
    openDetailsPanel,
    closeDetailsPanel,
    populateAddPoiModalCategories,
    showLegendModal,
    openRestoreModal,
    updateSelectionModeButton,
    populateCircuitsMenu,
    closeAllDropdowns,
    updateExportButtonLabel
} from './ui.js';
import { showToast } from './toast.js';

import {
    toggleSelectionMode,
    clearCircuit,
    setupCircuitEventListeners,
    loadCircuitById,
    loadCircuitDraft
} from './circuit.js';

import { performCircuitDeletion, toggleCircuitVisitedStatus } from './circuit-actions.js';

import { displayGeoJSON, applyFilters, getPoiId } from './data.js';
import { isMobileView, initMobileMode, switchMobileView, renderMobilePoiList } from './mobile.js';

import {
    handleFileLoad,
    handleGpxFileImport,
    handlePhotoImport,
    saveUserData,
    handleRestoreFile,
    exportOfficialCircuitsJSON,
    exportDataForMobilePC,
    exportFullBackupPC
} from './fileManager.js';
import { setupSearch, setupSmartSearch } from './searchManager.js';
import { enableDesktopCreationMode, setupDesktopTools } from './desktopMode.js';
import { showConfirm } from './modal.js';
import { initAdminMode } from './admin.js';
import { generateSyncQR, startGenericScanner } from './sync.js';
import { setupTabs } from './ui-sidebar.js';

// --- FONCTION UTILITAIRE : Gestion des boutons de sauvegarde ---
function setSaveButtonsState(enabled) {
    const btnBackup = document.getElementById('btn-open-backup-modal');
    const btnRestore = document.getElementById('btn-restore-data');

    if (btnBackup) btnBackup.disabled = !enabled;
    if (btnRestore) btnRestore.disabled = false;
}

// --- PROTECTION CONTRE LA PERTE DE DONNÉES (WORKFLOW) ---
function setupUnsavedChangesWarning() {
    window.addEventListener('beforeunload', (e) => {
        if (state.hasUnexportedChanges) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

function updateAppTitle(mapId) {
    if (!mapId) return;
    const mapName = mapId.charAt(0).toUpperCase() + mapId.slice(1);
    const title = `History Walk - ${mapName}`;
    document.title = title;
    const appTitle = document.getElementById('app-title');
    if (appTitle) appTitle.textContent = title;

    updateExportButtonLabel(mapId);
}

async function loadOfficialCircuits() {
    const mapId = state.currentMapId || 'djerba';
    const circuitsUrl = `./circuits/${mapId}.json`;

    try {
        const response = await fetch(circuitsUrl);
        if (response.ok) {
            const officials = await response.json();
            state.officialCircuits = officials.map(off => ({
                ...off,
                isOfficial: true,
                id: off.id || `official_${off.name.replace(/\s+/g, '_')}`
            }));
            console.log(`[Main] ${state.officialCircuits.length} circuits officiels chargés.`);
            import('./events.js').then(({ eventBus }) => eventBus.emit('circuit:list-updated'));
        } else {
             state.officialCircuits = [];
        }
    } catch (e) {
        console.warn(`[Main] Erreur circuits officiels ${mapId}:`, e);
        state.officialCircuits = [];
    }
}

async function loadDestinationsConfig() {
    const baseUrl = import.meta.env?.BASE_URL || './';
    const configUrl = baseUrl + 'destinations.json';

    try {
        const response = await fetch(configUrl);
        if (response.ok) {
            state.destinations = await response.json();
            console.log("[Config] destinations.json chargé.", state.destinations);
        }
    } catch (e) {
        console.error("[Config] Erreur chargement destinations.json.", e);
    }
}

// --- NOUVEAU : Chargement et Initialisation Unifiés ---
async function loadAndInitializeMap() {
    // 0. Config (CRITIQUE : On attend la config avant tout)
    await loadDestinationsConfig();

    const baseUrl = import.meta.env?.BASE_URL || './';

    // 1. Calcul de la stratégie de vue (Avant d'init la carte)
    let activeMapId = 'djerba';
    let initialView = { center: [33.77478, 10.94353], zoom: 11.5 }; // Fallback ultime

    // A. Détermination Map ID
    if (state.destinations) {
        const urlParams = new URLSearchParams(window.location.search);
        const urlMapId = urlParams.get('map');
        if (urlMapId && state.destinations.maps[urlMapId]) {
            activeMapId = urlMapId;
        } else if (state.destinations.activeMapId) {
            activeMapId = state.destinations.activeMapId;
        }
        // B. Config View (si dispo)
        if (state.destinations.maps[activeMapId] && state.destinations.maps[activeMapId].startView) {
            initialView = state.destinations.maps[activeMapId].startView;
        }
    }

    // C. Restauration Vue Utilisateur (SUPPRIMÉE)
    // On force la vue par défaut pour éviter les conflits d'initialisation

    // 2. Chargement des données (GeoJSON)
    let geojsonData = null;
    let fileName = `${activeMapId}.geojson`;
    if (state.destinations?.maps[activeMapId]?.file) {
        fileName = state.destinations.maps[activeMapId].file;
    }

    if (DOM.loaderOverlay) DOM.loaderOverlay.style.display = 'flex';

    try {
        const resp = await fetch(baseUrl + fileName);
        if(resp.ok) geojsonData = await resp.json();
    } catch(e) {
        // Fallback offline
        const lastMapId = await getAppState('lastMapId');
        const lastGeoJSON = await getAppState('lastGeoJSON');
        if (lastMapId === activeMapId && lastGeoJSON) {
            geojsonData = lastGeoJSON;
            console.warn("Chargement hors-ligne (fallback)");
        } else {
            console.error("Erreur download map", e);
        }
    }

    if (!geojsonData) {
        showToast("Impossible de charger la carte.", 'error');
        if (DOM.loaderOverlay) DOM.loaderOverlay.style.display = 'none';
        return;
    }

    // 3. Mise à jour État
    state.currentMapId = activeMapId;
    updateAppTitle(activeMapId);
    await saveAppState('lastMapId', activeMapId);
    if (!isMobileView()) await saveAppState('lastGeoJSON', geojsonData);

    // 4. Chargement User Data & Circuits (Smart Merge)
    try {
        state.userData = await getAllPoiDataForMap(activeMapId) || {};
        state.myCircuits = await getAllCircuitsForMap(activeMapId) || [];
        state.officialCircuitsStatus = await getAppState(`official_circuits_status_${activeMapId}`) || {};
        await loadOfficialCircuits();

        const validCircuits = [];
        for (const c of state.myCircuits) {
            let toDelete = false;
            if (!c.poiIds || c.poiIds.length === 0) toDelete = true;
            if (toDelete) await deleteCircuitById(c.id);
            else validCircuits.push(c);
        }
        state.myCircuits = validCircuits;

        if (state.officialCircuits) {
            state.officialCircuits = state.officialCircuits.map(off => {
                const loc = state.myCircuits.find(l => String(l.id) === String(off.id));
                return loc ? { ...off, ...loc, isOfficial: true } : off;
            });
            state.myCircuits = state.myCircuits.filter(c =>
                !state.officialCircuits.some(off => String(off.id) === String(c.id))
            );
        }
    } catch (e) { console.warn("Erreur chargement user data", e); }

    // 5. RENDU (La stabilisation est ici)
    if (isMobileView()) {
        state.loadedFeatures = geojsonData.features || [];
        await saveAppState('lastGeoJSON', geojsonData); // Mobile cache specific
        setSaveButtonsState(true);
        switchMobileView('circuits');
    } else {
        // INIT MAP UNE SEULE FOIS AVEC LA BONNE VUE
        // Plus de "Djerba default" puis "Jump"
        initMap(initialView.center, initialView.zoom);

        // NOUVEAU : On active la création desktop après que la map soit prête
        enableDesktopCreationMode();

        await displayGeoJSON(geojsonData, activeMapId);

        // Rétablissement du centrage intelligent
        fitMapToContent();

        try { await loadCircuitDraft(); } catch (e) {}
        setSaveButtonsState(true);
        if (DOM.btnRestoreData) DOM.btnRestoreData.disabled = false;

        import('./events.js').then(({ eventBus }) => eventBus.emit('circuit:list-updated'));
    }

    if (DOM.loaderOverlay) DOM.loaderOverlay.style.display = 'none';
}

async function initializeApp() {
    console.log("🚀 Version chargée :", APP_VERSION);

    // 0. Vérification Version
    const storedVersion = localStorage.getItem('hw_app_version');
    if (storedVersion !== APP_VERSION) {
        localStorage.setItem('hw_app_version', APP_VERSION);
        if (storedVersion) {
            setTimeout(() => { window.location.reload(true); }, 100);
            return;
        }
    } else if (!storedVersion) {
        localStorage.setItem('hw_app_version', APP_VERSION);
    }

    // 0. Admin
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'admin' || urlParams.get('admin') === 'true') {
        state.isAdmin = true;
        document.body.classList.add('admin-mode');
        if (DOM.appTitle) DOM.appTitle.textContent += " (Admin)";
    }

    // 1. Initialisation de base
    const versionEl = document.getElementById('app-version');
    if (versionEl) {
        versionEl.textContent = APP_VERSION;
        let clickCount = 0;
        let clickTimeout;
        versionEl.addEventListener('click', () => {
            clickCount++;
            clearTimeout(clickTimeout);
            if (clickCount >= 7) {
                state.isAdmin = !state.isAdmin;
                showToast(`Mode GOD : ${state.isAdmin ? 'ACTIVÉ' : 'DÉSACTIVÉ'}`, state.isAdmin ? 'success' : 'info');
                import('./events.js').then(({ eventBus }) => eventBus.emit('admin:mode-toggled', state.isAdmin));
                clickCount = 0;
            } else {
                clickTimeout = setTimeout(() => { clickCount = 0; }, 2000);
            }
        });
        versionEl.style.cursor = 'pointer';
        versionEl.title = "Cliquez 7 fois pour le mode Admin";
    }

    initAdminMode();
    initializeDomReferences();
    setupCircuitEventListeners();
    setupEventBusListeners();
    createIcons({ icons });

    if (typeof populateAddPoiModalCategories === 'function') populateAddPoiModalCategories();
    setupFileListeners();

    // 2. Mode Mobile ou Desktop (UI SETUP ONLY)
    if (isMobileView()) {
        initMobileMode();
    } else {
        // UI Setup only (Map init is deferred to loadAndInitializeMap)
        setupDesktopTools();
        setupSmartSearch();
        setupDesktopUIListeners();
        updateSelectionModeButton(state.isSelectionModeActive);
        document.body.classList.add('sidebar-open');
    }

    try {
        await initDB();
        const savedTheme = await getAppState('currentTheme');
        if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

        // Lancement unique et propre de la carte
        await loadAndInitializeMap();

    } catch (error) {
        console.error("Échec init global:", error);
    }

    // 4. Tour de contrôle
    function setupGlobalEventListeners() {
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

    const themeSelector = document.getElementById('btn-theme-selector');
    if (themeSelector) {
        themeSelector.addEventListener('click', () => {
            const themes = ['maritime', 'desert', 'oasis', 'night'];
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'maritime';
            const currentIndex = themes.indexOf(currentTheme);
            const nextIndex = (currentIndex + 1) % themes.length;
            const nextTheme = themes[nextIndex];
            document.documentElement.setAttribute('data-theme', nextTheme);
            saveAppState('currentTheme', nextTheme);
        });
    }

    setupGlobalEventListeners();
    setupUnsavedChangesWarning();
    createIcons({ icons });

    // Import URL
    const importIds = urlParams.get('import');
    const importName = urlParams.get('name');
    if (importIds) {
        const newUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        setTimeout(() => {
             import('./circuit.js').then(module => {
                 module.loadCircuitFromIds(importIds, importName);
             });
        }, 500);
    }
}

function setupEventBusListeners() {
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

function setupDesktopUIListeners() {
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

function setupFileListeners() {
    if (DOM.restoreLoader) {
        DOM.restoreLoader.removeEventListener('change', handleRestoreFile);
        DOM.restoreLoader.addEventListener('change', handleRestoreFile);
    }
    if (DOM.btnRestoreData) {
        DOM.btnRestoreData.addEventListener('click', () => {
            if (!DOM.btnRestoreData.disabled) openRestoreModal();
        });
    }
    if (DOM.geojsonLoader) {
        DOM.geojsonLoader.removeEventListener('change', handleFileLoad);
        DOM.geojsonLoader.addEventListener('change', handleFileLoad);
    }
    if (DOM.btnOpenGeojson) DOM.btnOpenGeojson.addEventListener('click', () => DOM.geojsonLoader.click());

    const btnSaveMobile = document.getElementById('btn-save-mobile');
    if (btnSaveMobile) {
        btnSaveMobile.addEventListener('click', () => {
            if (window.innerWidth > 768) {
                exportDataForMobilePC();
            } else {
                saveUserData(false);
            }
        });
    }

    const btnSaveCircuits = document.getElementById('btn-save-circuits');
    if (btnSaveCircuits) {
        btnSaveCircuits.addEventListener('click', () => exportOfficialCircuitsJSON());
    }

    const btnSaveFull = document.getElementById('btn-save-full');
    if (btnSaveFull) {
        btnSaveFull.addEventListener('click', () => {
            if (window.innerWidth > 768) {
                exportFullBackupPC();
            } else {
                saveUserData(true);
            }
        });
    }

    const photoLoader = document.getElementById('photo-gps-loader');
    if (photoLoader) photoLoader.addEventListener('change', handlePhotoImport);

    if (DOM.gpxImporter) DOM.gpxImporter.addEventListener('change', handleGpxFileImport);
}

document.addEventListener('DOMContentLoaded', initializeApp);

import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
    onNeedRefresh() {
        updateSW(true);
    },
    onOfflineReady() {
        console.log("Application prête pour le mode hors-ligne !");
    },
});