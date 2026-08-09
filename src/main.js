// main.js
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
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
import { populateAddPoiModalCategories } from './ui-filters.js';
import { showToast } from './toast.js';
import { setupCircuitEventListeners } from './ui-circuit-editor.js';
import { getPoiId } from './data.js';
import { isMobileView } from './mobile-state.js';
import { initMobileMode, initMobileNavListeners } from './mobile-nav.js';
import { initMobilePoiListeners } from './mobile-poi.js';
import { initMobileCircuitsListeners } from './mobile-circuits.js';
// Import statique (pas dynamique) pour que le listener `beforeinstallprompt`
// attaché au top-level du module soit en place avant que Chrome/Edge émette
// l'event (sinon event perdu, banner jamais affiché).
import { initInstallBanner } from './install-pwa-banner.js';
import { initUiModalsListeners } from './ui-modals.js';
import { initCircuitListeners, loadCircuitFromIds } from './circuit.js';
import { initCircuitPageEvents } from './ui-circuit-page-events.js';
import { initCircuitRoutingUI } from './ui-circuit-routing.js';
import { initUiDetailsListeners, openDetailsPanel } from './ui-details.js';
import { eventBus } from './events.js';
import { setupFileListeners } from './fileManager.js';
import { setupSmartSearch } from './searchManager.js';
import { setupDesktopTools } from './desktopMode.js';
import { initAdminMode, showAdminLoginModal } from './admin.js';
import { initTokenCache } from './github-sync.js';

import { loadAndInitializeMap } from './app-startup.js';
import { setupWelcomeActions } from './welcome-actions.js';
import { showVersionNoteIfNeeded } from './version-note.js';
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

    // Sécurité splash : si le boot crashe ou prend > 5s, on retire quand même
    // le splash pour ne pas bloquer l'utilisateur. Le set normal se fait à la
    // fin de loadAndInitializeMap (cf. app-startup.js).
    setTimeout(() => {
        document.documentElement.setAttribute('hw-ready', '');
    }, 5000);

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
    initCircuitPageEvents();
    initUiDetailsListeners();

    if (typeof populateAddPoiModalCategories === 'function') populateAddPoiModalCategories();

    // 2. Mode Mobile ou Desktop (UI SETUP ONLY)
    if (isMobileView()) {
        initMobileMode();
    } else {
        // UI Setup only (Map init is deferred to loadAndInitializeMap)
        setupDesktopTools();
        setupSmartSearch();
    }

    // 3. Tour de contrôle et événements (AVANT le chargement de la carte pour s'assurer que data:filtered est capté)
    setupEventBusListeners();
    setupCircuitEventListeners();
    initCircuitRoutingUI();
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

    // Synchronise la meta theme-color (utilisée par la barre d'adresse navigateur,
    // status bar mobile PWA, title bar Windows en mode standalone) avec le thème actif.
    // Logique extraite dans src/theme.js (refonte topbar PC-2).
    const { initThemeColorMeta, cycleTheme, setTheme } = await import('./theme.js');
    initThemeColorMeta();

    // Bouton Thème legacy du menu Outils — conservé caché pour rétrocompatibilité
    // (sert encore de cible si jamais un appelant externe le déclenche).
    // Le vrai sélecteur thème vit désormais en topbar (dropdown preview 4 thèmes,
    // cf. topbar-v2.js setupThemeDropdown).
    const themeSelector = document.getElementById('btn-theme-selector');
    if (themeSelector) {
        themeSelector.addEventListener('click', cycleTheme);
    }

    try {
        await initDB();

        // Demande à l'OS de ne jamais évincer l'IndexedDB de Heripia sous pression
        // mémoire. Sans ça, un navigateur peut supprimer silencieusement photos et
        // POIs perso en cas de stockage faible (comportement observé sur Android).
        navigator.storage?.persist?.();

        // P3.2 : charger le PAT GitHub depuis IndexedDB (avec migration
        // automatique depuis l'ancien localStorage['github_pat']). Doit
        // s'exécuter avant toute opération admin/sync qui lit le token.
        await initTokenCache();

        const savedTheme = await getAppState('currentTheme');
        if (savedTheme) {
            // setTheme fait : data-theme sur html, applyThemeColor (meta),
            // saveAppState (idempotent, on vient de la lire), et hydrate le
            // miroir localStorage hw_theme pour theme-bootstrap.js au prochain F5.
            setTheme(savedTheme);
        }

        // Langue des noms patrimoniaux (FR ⇄ AR) — restaure la copie durable.
        // Le module patrimonial-names s'initialise déjà depuis localStorage ;
        // ceci couvre la restauration depuis une sauvegarde sur un nouvel appareil.
        const savedLang = await getAppState('currentPatrimonialLang');
        if (savedLang === 'ar' || savedLang === 'fr') {
            const { setPatrimonialLang } = await import('./patrimonial-names.js');
            setPatrimonialLang(savedLang);
        }

        // Lieu de résidence pour le tri par proximité (défini via start-point.js
        // lors du choix du tri « Proximité » dans Mes circuits)
        const savedHome = await getAppState('homeLocation');
        if (savedHome && typeof savedHome.lat === 'number' && typeof savedHome.lng === 'number') {
            setHomeLocation(savedHome);
        }

        // Lancement unique et propre de la carte
        await loadAndInitializeMap();

        // Câblage du choix d'usage (bouton "Visite guidée" de la topbar)
        setupWelcomeActions();

        // Note de version (1er lancement, puis à chaque changement important)
        showVersionNoteIfNeeded();

    } catch (error) {
        console.error("Échec init global:", error);
        if (String(error).includes('indexedDB') || String(error).includes('IDBFactory') || error.name === 'InvalidStateError') {
            showToast('Stockage local inaccessible (navigation privée stricte ?). Certaines fonctionnalités seront limitées.', 'error', 8000);
        }
    }

    createIcons({ icons: appIcons });

    // Bandeau "Installer cette app" : capture beforeinstallprompt et propose
    // l'install via un bouton custom (UX bien plus simple que le menu Chrome).
    // Le listener `beforeinstallprompt` est attaché au top-level du module
    // (cf. import statique en haut), donc déjà en place. Ici on initialise
    // juste l'UI (bouton install, dismiss).
    initInstallBanner();

    // Import URL
    const urlParams = new URLSearchParams(window.location.search);
    const importIds = urlParams.get('import');
    const importName = urlParams.get('name');
    const poiParam = urlParams.get('poi');
    const scoutResume = urlParams.get('scout');
    if (importIds) {
        const newUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        setTimeout(() => {
            loadCircuitFromIds(importIds, importName);
        }, 500);
    } else if (poiParam) {
        // Deep-link ?poi=HW_ID — bouton « Voir sur la carte Heripia » des pages
        // SEO statiques (scripts/generate-poi-pages.mjs). Ouvre la fiche du
        // lieu et centre la carte dessus. Même patron que ?import= ci-dessus
        // (URL nettoyée, délai pour laisser la carte finir son rendu).
        const newUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        setTimeout(() => {
            const index = state.loadedFeatures.findIndex(f => getPoiId(f) === poiParam);
            if (index > -1) {
                openDetailsPanel(index);
                eventBus.emit('map:focus-poi', { poiId: poiParam });
            } else {
                showToast('Lieu introuvable dans cette destination.', 'warning');
            }
        }, 500);
    } else if (scoutResume) {
        // Réouverture auto du Scout après création d'une destination : scout.js
        // (createDestinationDraft) bascule en ?map={id}&scout=1 → on rouvre l'outil
        // DESSUS pour éviter à l'admin de le relancer à la main sur son brouillon
        // vide. Même patron que ?poi= (URL nettoyée, délai pour laisser la carte
        // finir). Desktop + admin only : le Scout n'existe pas sur mobile, et
        // startScout regarde de toute façon state.isAdmin / currentMapId.
        const newUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        if (!isMobileView() && state.isAdmin) {
            setTimeout(async () => {
                try {
                    const { startScout } = await import('./scout.js');
                    startScout();
                } catch (e) { console.warn('[Startup] réouverture Scout impossible', e); }
            }, 500);
        }
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

// Flow update PWA (followup #3 post-chantier mobile, v2). Stratégie en deux
// couches pour distinguer boot vs mid-session de manière fiable :
//
// 1. `onRegistered` détecte un SW déjà en `waiting` à l'enregistrement → ça
//    veut dire qu'il a été installé pendant une session précédente et attend
//    qu'on l'active. On force `updateSW(true)` (skipWaiting + reload) →
//    reload PROPRE qui sert toutes les ressources via le nouveau SW. Évite
//    le bug « dock absent » observé en v1 : sans ce reload, la page tournait
//    avec un mix old/new SW pendant la transition, et le CSS du dock était
//    half-state.
// 2. `onNeedRefresh` fire quand un nouveau SW arrive PENDANT la session (le
//    plus souvent : install fini en background mid-session). Garde-fou
//    `PWA_BOOT_GRACE_MS` au cas où onNeedRefresh fire pendant le boot
//    (install rapide à l'enregistrement initial) : <5s = silencieux, >5s =
//    prompt classique (laisse le contrôle au user mid-session).
const PWA_BOOT_GRACE_MS = 5000;
const _pwaBootTime = Date.now();

const updateSW = registerSW({
    onRegistered(registration) {
        // Cold start avec SW déjà en waiting (session précédente l'avait
        // installé sans qu'on click Recharger) → on apply tout de suite.
        if (registration?.waiting) {
            updateSW(true);
        }
    },
    onNeedRefresh() {
        const elapsedSinceBoot = Date.now() - _pwaBootTime;
        if (elapsedSinceBoot < PWA_BOOT_GRACE_MS) {
            // Install ultra-rapide pendant le boot → auto-apply silencieux.
            updateSW(true);
            return;
        }
        // Mid-session → prompt classique avec bouton Recharger.
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
