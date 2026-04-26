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
import { APP_VERSION, state, setHomeLocation } from './state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { initializeDomReferences, DOM } from './ui.js';
import { updateSelectionModeButton } from './ui-selection.js';
import { populateAddPoiModalCategories } from './ui-filters.js';
import { showToast } from './toast.js';
import { setupCircuitEventListeners } from './ui-circuit-editor.js';
import { getPoiId } from './data.js';
import { isMobileView } from './mobile-state.js';
import { initMobileMode, initMobileNavListeners } from './mobile-nav.js';
import { initMobilePoiListeners } from './mobile-poi.js';
import { initMobileCircuitsListeners } from './mobile-circuits.js';
import { initUiModalsListeners } from './ui-modals.js';
import { initCircuitListeners, loadCircuitFromIds } from './circuit.js';
import { initUiDetailsListeners } from './ui-details.js';
import { setupFileListeners } from './fileManager.js';
import { setupSmartSearch } from './searchManager.js';
import { setupDesktopTools } from './desktopMode.js';
import { initAdminMode, showAdminLoginModal } from './admin.js';
import { initTokenCache } from './github-sync.js';

import { loadAndInitializeMap } from './app-startup.js';
import { showWelcomeIfNeeded } from './welcome.js';
import { setupEventBusListeners } from './events-bus.js';
import { setupFilterPanel } from './filter-panel.js';
import { setupTopbarV2 } from './topbar-v2.js';
import { showLegalNoticeModal } from './legal-modal.js';
import { setupDesktopUIListeners } from './events-desktop.js';
import { setupGlobalEventListeners } from './events-global.js';

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
    // 1. Initialisation de base
    // Affichage version (aucun raccourci admin associé : desktop = séquence G-O-D,
    // mobile = appui long sur le bouton ⚙ Menu du dock, cf. mobile-nav.js)
    const versionEl = document.getElementById('app-version');
    if (versionEl) {
        versionEl.textContent = APP_VERSION;
    }

    // Raccourci clavier G→O→D (hors champs de saisie) → ouvre le login admin
    let godSequence = '';
    let godTimeout;
    document.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
        godSequence += e.key.toLowerCase();
        if (godSequence.length > 3) godSequence = godSequence.slice(-3);
        clearTimeout(godTimeout);
        if (godSequence === 'god') {
            godSequence = '';
            if (!state.isAdmin) showAdminLoginModal();
            return;
        }
        godTimeout = setTimeout(() => { godSequence = ''; }, 2000);
    });

    initAdminMode();
    initializeDomReferences();
    initMobilePoiListeners();
    initMobileCircuitsListeners();
    initMobileNavListeners();
    initUiModalsListeners();
    initCircuitListeners();
    initUiDetailsListeners();

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

    // 3. Tour de contrôle et événements (AVANT le chargement de la carte pour s'assurer que data:filtered est capté)
    setupEventBusListeners();
    setupCircuitEventListeners();
    setupFilterPanel();
    setupTopbarV2();
    document.getElementById('btn-legal-notice')?.addEventListener('click', () => {
        document.getElementById('tools-menu-content')?.classList.remove('active');
        showLegalNoticeModal();
    });
    setupDesktopUIListeners();
    setupGlobalEventListeners();
    setupFileListeners();
    setupUnsavedChangesWarning();

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

    try {
        await initDB();

        // P3.2 : charger le PAT GitHub depuis IndexedDB (avec migration
        // automatique depuis l'ancien localStorage['github_pat']). Doit
        // s'exécuter avant toute opération admin/sync qui lit le token.
        await initTokenCache();

        const savedTheme = await getAppState('currentTheme');
        if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

        // Lieu de résidence pour le tri par proximité (défini dans Mon Espace)
        const savedHome = await getAppState('homeLocation');
        if (savedHome && typeof savedHome.lat === 'number' && typeof savedHome.lng === 'number') {
            setHomeLocation(savedHome);
        }

        // Lancement unique et propre de la carte
        await loadAndInitializeMap();

        // Écran de bienvenue (premier lancement uniquement)
        showWelcomeIfNeeded();

    } catch (error) {
        console.error("Échec init global:", error);
        if (String(error).includes('indexedDB') || String(error).includes('IDBFactory') || error.name === 'InvalidStateError') {
            showToast('Stockage local inaccessible (navigation privée stricte ?). Certaines fonctionnalités seront limitées.', 'error', 8000);
        }
    }

    createIcons({ icons: appIcons });

    // Import URL
    const urlParams = new URLSearchParams(window.location.search);
    const importIds = urlParams.get('import');
    const importName = urlParams.get('name');
    if (importIds) {
        const newUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        setTimeout(() => {
            loadCircuitFromIds(importIds, importName);
        }, 500);
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);

// ── INDICATEUR OFFLINE ────────────────────────────────────────────────────
function setupOfflineBanner() {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;
    const update = () => banner.classList.toggle('visible', !navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
}
setupOfflineBanner();

import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
    onNeedRefresh() {
        showToast(
            'Mise à jour disponible — rechargez pour l\'appliquer.',
            'info',
            10000,
            { label: 'Recharger', onClick: () => updateSW(true) }
        );
    },
    onOfflineReady() {
        showToast('Application prête hors-ligne.', 'success', 3000);
    },
});
