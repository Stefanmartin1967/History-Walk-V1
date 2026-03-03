// main.js
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// FIX: Leaflet default icon paths in Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
});

import { initDB, getAppState, saveAppState } from './database.js';
import { APP_VERSION, state } from './state.js';
import { createIcons, icons } from 'lucide';
import { initializeDomReferences, DOM } from './ui.js';
import { updateSelectionModeButton } from './ui-selection.js';
import { populateAddPoiModalCategories } from './ui-filters.js';
import { showToast } from './toast.js';
import { setupCircuitEventListeners } from './ui-circuit-editor.js';
import { getPoiId } from './data.js';
import { isMobileView, initMobileMode } from './mobile.js';
import { setupFileListeners } from './fileManager.js';
import { setupSmartSearch } from './searchManager.js';
import { setupDesktopTools } from './desktopMode.js';
import { initAdminMode } from './admin.js';

import { loadAndInitializeMap } from './app-startup.js';
import { setupEventBusListeners, setupDesktopUIListeners, setupGlobalEventListeners } from './app-events.js';

// --- PROTECTION CONTRE LA PERTE DE DONNÉES (WORKFLOW) ---
function setupUnsavedChangesWarning() {
    window.addEventListener('beforeunload', (e) => {
        if (state.hasUnexportedChanges) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
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

    if (typeof populateAddPoiModalCategories === 'function') populateAddPoiModalCategories();

    // 2. Mode Mobile ou Desktop (UI SETUP ONLY)
    if (isMobileView()) {
        initMobileMode();
    } else {
        // UI Setup only (Map init is deferred to loadAndInitializeMap)
        setupDesktopTools();
        setupSmartSearch();
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

    setupEventBusListeners();
    setupCircuitEventListeners();
    setupDesktopUIListeners();
    setupGlobalEventListeners();
    setupFileListeners();
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

document.addEventListener('DOMContentLoaded', initializeApp);

import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
    onNeedRefresh() {
        updateSW(true);
    },
    onOfflineReady() {
        console.log("Application prête pour le mode hors-ligne !");
    },
});window.state = state; window.getPoiId = getPoiId;
