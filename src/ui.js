// ui.js
import { state, POI_CATEGORIES } from './state.js';
import { getPoiId, getPoiName, applyFilters, updatePoiData, updatePoiCoordinates, deletePoi } from './data.js';
import { restoreCircuit, saveAppState } from './database.js';
import { escapeXml } from './utils.js';
import { eventBus } from './events.js';
import { stopDictation, isDictationActive, speakText } from './voice.js';
import { clearCircuit, navigatePoiDetails, toggleSelectionMode, loadCircuitById } from './circuit.js';
import { map, clearMarkerHighlights, startMarkerDrag } from './map.js';
import { isMobileView, updatePoiPosition, renderMobileCircuitsList, renderMobilePoiList, switchMobileView } from './mobile.js';
import { createIcons, icons } from 'lucide';
import { showToast } from './toast.js';
import { buildDetailsPanelHtml as buildHTML, ICONS } from './templates.js';
import { getZonesData } from './circuit-actions.js';
import { calculateAdjustedTime } from './utils.js';
import { initPhotoViewer } from './ui-photo-viewer.js';
import { openPhotoGrid } from './ui-photo-grid.js';
import { initCircuitListUI, renderExplorerList } from './ui-circuit-list.js';
import { showConfirm, showAlert } from './modal.js';
import { RichEditor } from './richEditor.js';
import { openTrashModal, requestSoftDelete } from './ui-modals.js';
import { switchSidebarTab } from './ui-sidebar.js'; // Imported for use inside ui.js functions
import { exportFullBackupPC, exportDataForMobilePC, saveUserData, handleExportWithContribution } from './fileManager.js';
import { showStatisticsModal } from './statistics.js';

export const DOM = {};
let currentEditor = { fieldId: null, poiId: null, callback: null };

// --- INITIALISATION DOM ---

export function initializeDomReferences() {
    const ids = [
        'geojson-loader', 'search-input', 'search-results', 'btn-mode-selection', 'right-sidebar', 'sidebar-tabs', 
        'details-panel', 'circuit-panel', 'circuit-steps-list', 'circuit-title-text', 'circuit-title-input', 
        'circuit-description', 'edit-circuit-title-button', 'circuit-poi-count', 'circuit-distance',
        'gpx-importer', 'btn-export-gpx',
        'btn-import-gpx', 'loader-overlay', 'btn-save-data', 'btn-restore-data', 'restore-loader', 'btn-open-geojson', 
        'mobile-container', 'mobile-main-container', 'mobile-nav', 'fullscreen-editor', 'editor-title', 
        'editor-cancel-btn', 'editor-save-btn', 'editor-textarea', 'destination-loader',
        'photo-viewer', 'viewer-img', 'viewer-next', 'viewer-prev',
        'backup-modal', 'btn-backup-full', 'btn-backup-lite', 'btn-backup-cancel', 'btn-open-backup-modal',
        'btn-loop-circuit',
        'btn-clear-circuit', 'close-circuit-panel-btn',
        'btn-categories', 'btn-legend',
        'btn-open-my-circuits',
        'btn-bmc', 'btn-tools-menu', 'btn-open-trash', 'btn-bmc-topbar'
    ];
    
    // Récupération sécurisée des éléments
    ids.forEach(id => {
        const camelCaseId = id.replace(/-(\w)/g, (_, c) => c.toUpperCase());
        const el = document.getElementById(id);
        if (el) DOM[camelCaseId] = el;
    });

    if (DOM.btnOpenMyCircuits) {
        DOM.btnOpenMyCircuits.addEventListener('click', () => {
            closeAllDropdowns();

            if (DOM.rightSidebar && DOM.rightSidebar.style.display === 'none') {
                DOM.rightSidebar.style.display = 'flex';
                document.body.classList.add('sidebar-open');
                // FIX AUTOMATISÉ : Le redessin de la carte est maintenant géré automatiquement par ResizeObserver dans map.js
            }

            renderExplorerList();
            switchSidebarTab('explorer');
        });
    }

    if (DOM.btnToolsMenu) {
        DOM.btnToolsMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            const toolsMenu = document.getElementById('tools-menu-content');
            if (toolsMenu) {
                const isActive = toolsMenu.classList.contains('active');
                closeAllDropdowns();
                if (!isActive) toolsMenu.classList.add('active');
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

    // --- TOGGLE DESCRIPTION GPX (INTELLIGENT) ---
    const toggleGpxBtn = document.getElementById('btn-toggle-gpx-desc') || document.getElementById('mobile-btn-toggle-gpx-desc');
    const gpxSection = document.getElementById('section-gpx-desc') || document.getElementById('mobile-section-gpx-desc');

    // Détection du contenu (PC/Mobile)
    const shortDescText = document.getElementById('panel-short-desc-display')?.textContent ||
                          gpxSection?.querySelector('.short-text')?.textContent || "";

    const hasGpxDesc = shortDescText && shortDescText.trim() !== "";

    if (toggleGpxBtn && gpxSection) {
        // État Initial Intelligent
        if (hasGpxDesc) {
            // Si rempli : Bouton Bleu, Section Visible
            toggleGpxBtn.style.color = "var(--brand)";
            toggleGpxBtn.style.opacity = "1";
            gpxSection.style.display = "flex"; // Flex car .detail-section est flex
        } else {
            // Si vide : Bouton Gris/Transparent, Section Masquée
            toggleGpxBtn.style.color = "var(--ink-soft)";
            toggleGpxBtn.style.opacity = "0.5";
            gpxSection.style.display = "none";
        }

        toggleGpxBtn.addEventListener('click', () => {
            const isVisible = gpxSection.style.display !== 'none';
            if (isVisible) {
                gpxSection.style.setProperty('display', 'none', 'important');
            } else {
                gpxSection.style.setProperty('display', 'flex', 'important');
            }
        });
    }

    // --- EXPORT LOGIC WITH CONTRIBUTION MODAL ---
    if (DOM.btnExportGpx) {
        DOM.btnExportGpx.addEventListener('click', async () => {
            if (DOM.btnExportGpx.disabled) return;
            handleExportWithContribution('gpx', () => {
                // Original logic trigger
                // Note: The logic for GPX export is handled in main.js or circuit.js usually
                // But looking at codebase, main.js sets up listener on DOM.btnExportGpx too.
                // We need to Intercept it.
                // Since main.js is likely already loaded, this listener adds to it.
                // We should prevent Default if we want to stop immediate download?
                // Actually, the best way is to let the main logic be callable or manage it here.
                // However, main.js has the logic.
                // To avoid complexity, we can assume the user clicked "Exporter" in the modal.
                // But we need to BLOCK the original click if we want to show modal first.
                // We can't easily block another listener added elsewhere unless we use capture or remove it.
                // Strategy: We will dispatch a custom event 'ui:request-export-gpx' and move the logic from main.js to listen to that,
                // OR we check state here.

                // Simpler: Trigger the hidden export logic.
                // If main.js listens to click, we can't easily stop it.
                // We'll rely on a check in the actual export function or move the logic here.
                // Let's look at main.js later to refactor. For now let's set up the modal.

                // Assuming we can proceed:
                eventBus.emit('request-export-gpx');
            });
        });
    }

    // --- LOGIQUE SAUVEGARDE UNIFIÉE ---
    if (DOM.btnOpenBackupModal) {
        DOM.btnOpenBackupModal.addEventListener('click', () => {
            updateBackupSizeEstimates();
            if(DOM.backupModal) DOM.backupModal.classList.add('active');
        });
    }

    if (DOM.btnBackupCancel) {
        DOM.btnBackupCancel.addEventListener('click', () => {
            if(DOM.backupModal) DOM.backupModal.classList.remove('active');
        });
    }

    if (DOM.btnBackupFull) {
        DOM.btnBackupFull.addEventListener('click', () => {
            // Intercept for contribution modal
            import('./fileManager.js').then(({ handleExportWithContribution }) => {
                handleExportWithContribution('backup', () => {
                    if(window.innerWidth > 768) {
                        exportFullBackupPC();
                    } else {
                        saveUserData(true);
                    }
                    if(DOM.backupModal) DOM.backupModal.classList.remove('active');
                });
            });
        });
    }

    if (DOM.btnBackupLite) {
        DOM.btnBackupLite.addEventListener('click', () => {
            // Intercept for contribution modal
            import('./fileManager.js').then(({ handleExportWithContribution }) => {
                handleExportWithContribution('backup', () => {
                    if(window.innerWidth > 768) {
                        exportDataForMobilePC();
                    } else {
                        saveUserData(false);
                    }
                    if(DOM.backupModal) DOM.backupModal.classList.remove('active');
                });
            });
        });
    }

    if (DOM.btnOpenTrash) {
        DOM.btnOpenTrash.addEventListener('click', () => {
            openTrashModal();
            closeAllDropdowns();
        });
    }

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
            });
        });
    }

    const btnContact = document.getElementById('btn-contact-dev');
    if (btnContact) {
        btnContact.addEventListener('click', () => {
            const subject = encodeURIComponent("History Walk - Signalement / Contact");
            const body = encodeURIComponent("Bonjour,\n\nJe souhaite signaler un problème ou faire une suggestion :\n\n");
            window.location.href = `mailto:history.walk.007@gmail.com?subject=${subject}&body=${body}`;
        });
    }

    if (DOM.btnModeSelection) {
        updateSelectionModeButton(state.isSelectionModeActive);
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
        DOM.closeCircuitPanelBtn.addEventListener('click', () => toggleSelectionMode(false));
    }

    // Initialisation des sous-modules UI
    initPhotoViewer();
    initCircuitListUI();
    RichEditor.init(); // Setup écouteurs Rich Modal

    // Listen for tab change requests from other modules
    eventBus.on('ui:request-tab-change', (tabName) => {
        switchSidebarTab(tabName);
    });
}

// --- ÉDITION DE CONTENU ---

export function closeAllDropdowns() {
    const ids = ['zonesMenu', 'categoriesMenu', 'tools-menu-content', 'admin-menu-content'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            // Pour les menus gérés par classe CSS (Outils / Admin), on retire le style inline qui bloque la classe active
            if (id === 'tools-menu-content' || id === 'admin-menu-content') {
                el.style.display = '';
            } else {
                // Pour les autres (Zones / Catégories), on utilise display: none
                el.style.display = 'none';
            }
            el.classList.remove('active');
        }
    });
}

// --- ESTIMATION TAILLE SAUVEGARDE ---
function updateBackupSizeEstimates() {
    // 1. Calcul taille JSON (Lite)
    // On simule l'objet qui sera exporté
    const liteData = {
        appVersion: "ESTIMATION",
        backupVersion: "3.0",
        timestamp: new Date().toISOString(),
        userData: state.userData || {},
        myCircuits: state.myCircuits || []
    };
    const jsonStr = JSON.stringify(liteData);
    const bytesLite = new Blob([jsonStr]).size;

    // Formatage Lite
    const sizeLite = formatBytes(bytesLite);
    const spanLite = document.getElementById('backup-size-lite');
    if(spanLite) spanLite.textContent = `~${sizeLite}`;

    // 2. Calcul taille Photos (Full)
    // On parcourt userData pour trouver les photos Base64
    let photoCount = 0;
    let photoBytes = 0;

    if (state.userData) {
        Object.values(state.userData).forEach(data => {
            if (data.photos && Array.isArray(data.photos)) {
                data.photos.forEach(photo => {
                    if (typeof photo === 'string' && photo.startsWith('data:image')) {
                        photoCount++;
                        // Estimation taille Base64 : taille string * 0.75 (approx)
                        photoBytes += photo.length; // En mémoire JS string = 2 octets/char mais en UTF-8 export c'est proche
                    }
                });
            }
        });
    }

    const totalFull = bytesLite + photoBytes;
    const sizeFull = formatBytes(totalFull);

    const spanFull = document.getElementById('backup-size-full');
    if(spanFull) {
        if(photoCount > 0) {
            spanFull.textContent = `~${sizeFull} (${photoCount} photo${photoCount > 1 ? 's' : ''})`;
        } else {
            spanFull.textContent = `~${sizeFull} (Sans photos)`;
        }
    }
}

function formatBytes(bytes, decimals = 1) {
    if (!+bytes) return '0 Octets';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Octets', 'Ko', 'Mo', 'Go'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// --- UTILITAIRES ---

export function updateSelectionModeButton(isActive) {
    const btn = document.getElementById('btn-mode-selection');
    if (!btn) return;

    if (isActive) {
        btn.innerHTML = `<i data-lucide="map-pin-plus"></i><span>Créer circuit</span>`;
        btn.title = "Mode création activé";
    } else {
        btn.innerHTML = `<i data-lucide="map-pin-off"></i><span>Explorer</span>`;
        btn.title = "Mode consultation";
    }
    createIcons({ icons });
}

export function updateExportButtonLabel(mapId) {
    // Deprecated: Button removed
}

