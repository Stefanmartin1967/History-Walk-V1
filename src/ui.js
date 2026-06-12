// ui.js
import { state, POI_CATEGORIES } from './state.js';
import { getPoiId, getPoiName, applyFilters, updatePoiData, updatePoiCoordinates, deletePoi } from './data.js';
import { restoreCircuit, saveAppState } from './database.js';
import { escapeXml } from './utils.js';
import { eventBus } from './events.js';
import { clearCircuit, navigatePoiDetails, loadCircuitById } from './circuit.js';
import { toggleCircuitCreationMode } from './ui-circuit-editor.js';
import { map, clearMarkerHighlights, startMarkerDrag } from './map.js';
import { isMobileView } from './mobile-state.js';
import { updatePoiPosition, renderMobilePoiList } from './mobile-poi.js';
import { renderMobileCircuitsList } from './mobile-circuits.js';
import { switchMobileView } from './mobile-nav.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { buildDetailsPanelHtml as buildHTML, ICONS } from './templates.js';
import { getZonesData } from './circuit-actions.js';
import { calculateAdjustedTime } from './utils.js';
// ui-photo-viewer.js est désormais lazy-loadé par ui-photo-grid.js
// (openPhotoViewer dynamique). Plus d'init au boot — N4 rapport v3.
import { openPhotoGrid } from './ui-photo-grid.js';
import { initCircuitListUI, renderExplorerList } from './ui-circuit-list.js';
import { showConfirm, showAlert } from './modal.js';
import { RichEditor } from './richEditor.js';
// (Imports openTrashModal + requestSoftDelete retirés 10/05/2026, PR cleanup
// post-#514 : aucun usage actif dans ui.js après retrait du listener btnOpenTrash.
// requestSoftDelete reste utilisée dans ui-modals.js uniquement.)
import { switchSidebarTab } from './ui-sidebar.js'; // Imported for use inside ui.js functions
import { showStatisticsModal } from './statistics.js';
import { closeAllDropdowns } from './ui-utils.js';
import { DOM } from './ui-dom.js';

// Re-export pour compat : les consommateurs existants importent DOM depuis ui.js.
// La source unique est ui-dom.js (module feuille, sans cycle).
export { DOM };

let currentEditor = { fieldId: null, poiId: null, callback: null };

// --- INITIALISATION DOM ---

export function initializeDomReferences() {
    const ids = [
        'geojson-loader', 'search-input', 'search-results', 'right-sidebar', 'sidebar-tabs',
        'details-panel', 'circuit-panel', 'circuit-steps-list', 'circuit-title-text', 'circuit-title-input', 
        'circuit-description', 'circuit-poi-count', 'circuit-distance',
        'gpx-importer',
        'btn-import-gpx', 'loader-overlay', 'btn-save-data', 'restore-loader',
        'mobile-container', 'mobile-main-container', 'mobile-nav', 'fullscreen-editor', 'editor-title',
        'editor-cancel-btn', 'editor-save-btn', 'editor-textarea', 'destination-loader',
        // photo-viewer/viewer-* supprimés : migration V2 vers ui-photo-viewer.openPhotoViewer.
        // btn-restore-data / btn-open-trash retirés du DOM en PR #514 (cleanup menu
        // Outils). Bouton « Sauvegarder » réintroduit en PR2 dissolution Mon Espace
        // (06/06/2026) — cf. btn-tools-backup ci-dessous.
        'btn-loop-circuit',
        'btn-clear-circuit', 'close-circuit-panel-btn',
        // 'btn-legend' retiré : la Légende vit maintenant dans les contrôles
        // de carte Leaflet (cf. LegendControl dans map.js, PR harmonisation PC).
        'btn-bmc', 'btn-tools-menu', 'btn-bmc-topbar'
    ];
    
    // Récupération sécurisée des éléments
    ids.forEach(id => {
        const camelCaseId = id.replace(/-(\w)/g, (_, c) => c.toUpperCase());
        const el = document.getElementById(id);
        if (el) DOM[camelCaseId] = el;
    });

    if (DOM.btnToolsMenu) {
        DOM.btnToolsMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            const toolsMenu = document.getElementById('tools-menu-content');
            if (toolsMenu) {
                const isActive = toolsMenu.classList.contains('active');
                closeAllDropdowns();
                if (!isActive) {
                    // Ferme aussi les autres popups topbar (dest, theme, info-popover)
                    // qui n'écoutent pas closeAllDropdowns. Cf. fix #6 PR R3.
                    eventBus.emit('topbar:popup-opening', { id: 'tools' });
                    toolsMenu.classList.add('active');
                }
            }
        });
    }

    const btnStats = document.getElementById('btn-statistics');
    if (btnStats) {
        btnStats.addEventListener('click', () => {
            showStatisticsModal();
            closeAllDropdowns();
        });
    }

    // (Bloc « TOGGLE DESCRIPTION GPX (INTELLIGENT) » retiré 06/06/2026, PR1
    // fiche lieu. Il forçait `display:flex` au boot et créait un DOUBLE BINDING
    // avec setupGpxDescToggle dans ui-details.js → le toggle ne basculait plus
    // (Stefan a observé : « ça ne bascule pas »). Comportement attendu désormais
    // (option B2) : section Info GPX MASQUÉE par défaut via `is-hidden` du
    // template, ouverte/fermée via le toggle propre du kebab. L'état « disabled »
    // du bouton kebab quand le POI n'a pas d'info GPX est déjà géré par
    // `aria-disabled` dans le template — pas besoin d'override en JS.)

    // (Export GPX : l'ancien handler du bouton barre #btn-export-gpx a été RETIRÉ
    // le 07/06/2026 — doublon avec l'item « Exporter le GPX » du menu ⋮ du bloc
    // tracé. C'est désormais ce dernier qui appelle handleExportWithContribution
    // puis émet 'request-export-gpx' — cf. ui-circuit-routing.js.)

    // Bouton « Sauvegarder » du menu Outils — point d'entrée PC vers la
    // modale de sauvegarde (PR3 dissolution Mon Espace : openSaveModal V2
    // via openHwModal, remplace l'ancien openUserSpace).
    const btnToolsBackup = document.getElementById('btn-tools-backup');
    if (btnToolsBackup) {
        btnToolsBackup.addEventListener('click', () => {
            // .catch (audit R5) : chunk manquant juste après un déploiement →
            // sans lui, le clic ne faisait RIEN, en silence.
            import('./save-modal-ui.js').then(({ openSaveModal }) => openSaveModal())
                .catch(() => showToast("Chargement impossible — actualise l'application.", 'error', 4000));
            closeAllDropdowns();
        });
    }

    // (Listener btnOpenTrash retiré 10/05/2026, PR cleanup post-#514 :
    // le bouton Corbeille n'existe plus dans le menu Outils. Corbeille
    // accessible désormais via le bouton « Corbeille (n) » de « Mes circuits »
    // — cf. PR1 dissolution Mon Espace, src/circuit-trash-ui.js.)

    if (DOM.btnBmc) {
        DOM.btnBmc.addEventListener('click', () => {
            window.open('https://www.buymeacoffee.com/history_walk', '_blank');
        });
    }

    if (DOM.btnBmcTopbar) {
        DOM.btnBmcTopbar.addEventListener('click', () => {
            import('./fileManager.js').then(({ recordSupportClick }) => {
                recordSupportClick(); // Enregistre le clic pour ne plus embêter l'utilisateur
                window.open('https://www.buymeacoffee.com/history_walk', '_blank');
            }).catch(() => {
                // L'enregistrement du clic est secondaire — on honore au moins
                // l'intention (ouvrir la page de soutien). Audit R5.
                window.open('https://www.buymeacoffee.com/history_walk', '_blank');
            });
        });
    }

    const btnContact = document.getElementById('btn-contact-dev');
    if (btnContact) {
        btnContact.addEventListener('click', () => {
            const subject = encodeURIComponent("Heripia - Signalement / Contact");
            const body = encodeURIComponent("Bonjour,\n\nJe souhaite signaler un problème ou faire une suggestion :\n\n");
            window.location.href = `mailto:history.walk.007@gmail.com?subject=${subject}&body=${body}`;
        });
    }

    DOM.tabButtons = document.querySelectorAll('.tab-button');
    DOM.sidebarPanels = document.querySelectorAll('.sidebar-panel');
    
    // Écouteurs globaux (définis une seule fois au démarrage)
    if (DOM.editorCancelBtn) DOM.editorCancelBtn.addEventListener('click', () => DOM.fullscreenEditor.style.display = 'none');
    
    if (DOM.editorSaveBtn) DOM.editorSaveBtn.addEventListener('click', () => {
        if (currentEditor.callback) currentEditor.callback(DOM.editorTextarea.value);
        DOM.fullscreenEditor.style.display = 'none';
    });

    if (DOM.closeCircuitPanelBtn) {
        DOM.closeCircuitPanelBtn.addEventListener('click', () => toggleCircuitCreationMode(false));
    }

    // Initialisation des sous-modules UI
    initCircuitListUI();
    RichEditor.init(); // Setup écouteurs Rich Modal

    // Listen for tab change requests from other modules
    eventBus.on('ui:request-tab-change', (tabName) => {
        switchSidebarTab(tabName);
    });
}

export { closeAllDropdowns };

// --- UTILITAIRES ---

