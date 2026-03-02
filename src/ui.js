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

function setupGlobalEditButton(poiId) {
    const editBtns = document.querySelectorAll('#btn-global-edit'); // querySelectorAll au cas où (PC/Mobile)
    
    editBtns.forEach(btn => {
        btn.addEventListener('click', () => {
             // Redirection directe vers Rich Editor
             import('./richEditor.js').then(m => m.RichEditor.openForEdit(poiId));
        });
    });
}

// --- SETUP LISTENERS DU PANNEAU DE DÉTAILS ---

function setupDetailsEventListeners(poiId) {
    // Note : Comme le HTML est écrasé à chaque ouverture, pas de risque de double-binding ici
    // tant qu'on cible des éléments à l'intérieur du panneau.

    // --- TOGGLE DESCRIPTION GPX (PRIORITAIRE) ---
    const toggleGpxBtn = document.getElementById('btn-toggle-gpx-desc') || document.getElementById('mobile-btn-toggle-gpx-desc');
    const gpxSection = document.getElementById('section-gpx-desc') || document.getElementById('mobile-section-gpx-desc');

    if (toggleGpxBtn && gpxSection) {
        // Détection du contenu
        const shortDescText = document.getElementById('panel-short-desc-display')?.textContent ||
                              gpxSection.querySelector('.short-text')?.textContent || "";
        const hasGpxDesc = shortDescText && shortDescText.trim() !== "";

        // État Initial
        if (hasGpxDesc) {
            toggleGpxBtn.style.color = "var(--brand)";
            toggleGpxBtn.style.opacity = "1";
            gpxSection.style.setProperty('display', 'flex', 'important');
        } else {
            toggleGpxBtn.style.color = "var(--ink-soft)";
            toggleGpxBtn.style.opacity = "0.5";
            gpxSection.style.setProperty('display', 'none', 'important');
        }

        // Click Listener (Robuste et simple)
        toggleGpxBtn.onclick = (e) => {
            e.stopPropagation(); // Évite propagation parasite
            const currentDisplay = window.getComputedStyle(gpxSection).display;

            if (currentDisplay === 'none') {
                gpxSection.style.setProperty('display', 'flex', 'important');
            } else {
                gpxSection.style.setProperty('display', 'none', 'important');
            }
        };
    }
    
    const inputPrice = document.getElementById('panel-price');
    if (inputPrice) {
        inputPrice.addEventListener('input', (e) => updatePoiData(poiId, 'price', e.target.value));
    }
    
    const chkVu = document.getElementById('panel-chk-vu');
    if (chkVu) {
        chkVu.addEventListener('change', (e) => {
            updatePoiData(poiId, 'vu', e.target.checked);

            if (!isMobileView()) {
                import('./data.js').then(dataModule => {
                    import('./map.js').then(mapModule => {
                        if (mapModule.refreshMapMarkers && dataModule.getFilteredFeatures) {
                            mapModule.refreshMapMarkers(dataModule.getFilteredFeatures());
                        }
                    });
                });

                if (state.activeFilters.vus) applyFilters();
            }
        });
    }

    // --- NOUVEAU CÂBLAGE : CASE INCONTOURNABLE ---
const chkInc = document.getElementById('panel-chk-incontournable');
if (chkInc) {
    chkInc.addEventListener('change', async (e) => {
        // 1. Sauvegarde (Mémoire + Disque) via votre fonction habituelle
        await updatePoiData(poiId, 'incontournable', e.target.checked);

        // 2. Mise à jour visuelle : On demande au Peintre de rafraîchir la carte
        if (!isMobileView()) {
            import('./data.js').then(dataModule => {
                import('./map.js').then(mapModule => {
                    if (mapModule.refreshMapMarkers && dataModule.getFilteredFeatures) {
                        // Le Tamis filtre, le Peintre dessine (avec le nouveau style doré !)
                        mapModule.refreshMapMarkers(dataModule.getFilteredFeatures());
                    }
                });
            });
        }
    });
}

    const chkVerif = document.getElementById('panel-chk-verified');
    if (chkVerif) {
        chkVerif.addEventListener('change', (e) => updatePoiData(poiId, 'verified', e.target.checked));
    }

    const softDeleteBtn = document.getElementById('btn-soft-delete');
    if (softDeleteBtn) {
        softDeleteBtn.addEventListener('click', () => {
            requestSoftDelete(state.currentFeatureId);
        });
    }

    const gmapsBtn = document.getElementById('open-gmaps-btn');
    if (gmapsBtn) {
        gmapsBtn.addEventListener('click', () => {
            const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
            if (feature && feature.geometry && feature.geometry.coordinates) {
                const [lng, lat] = feature.geometry.coordinates;
                // Lien Google Maps universel
                window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank');
            } else {
                showToast("Coordonnées introuvables.", "error");
            }
        });
    }

    // --- DEPLACEMENT DU MARQUEUR (MODE DRAG & DROP) ---
    const moveMarkerBtn = document.getElementById('btn-move-marker');
    if (moveMarkerBtn) {
        moveMarkerBtn.addEventListener('click', () => {
             startMarkerDrag(
                 poiId,
                 (lat, lng) => {
                     const latInput = document.getElementById('poi-lat');
                     const lngInput = document.getElementById('poi-lng');
                     if (latInput) latInput.value = lat.toFixed(5);
                     if (lngInput) lngInput.value = lng.toFixed(5);
                 },
                 async (lat, lng, revert) => {
                     if (await showConfirm("Déplacement", "Valider la nouvelle position ?", "Valider", "Annuler")) {
                         await updatePoiCoordinates(poiId, lat, lng);
                         showToast("Position mise à jour.", "success");
                     } else {
                         revert();
                         // Reset inputs
                         const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
                         const [oldLng, oldLat] = feature.geometry.coordinates;
                         const latInput = document.getElementById('poi-lat');
                         const lngInput = document.getElementById('poi-lng');
                         if (latInput) latInput.value = oldLat.toFixed(5);
                         if (lngInput) lngInput.value = oldLng.toFixed(5);
                     }
                 }
             );
        });
    }

    // --- NOUVEAU : BOUTON RECHERCHE GOOGLE ---
    const searchBtns = document.querySelectorAll('.btn-web-search');
    searchBtns.forEach(btn => {
        btn.addEventListener('click', () => {
             const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
             if (feature) {
                 const name = getPoiName(feature);
                 // Construction de la requête "Nom + Djerba"
                 const query = encodeURIComponent(`${name} Djerba`);
                 window.open(`https://www.google.com/search?q=${query}`, '_blank');
             }
        });
    });

    // --- TOGGLE LANGUE (FR/AR) ---
    const toggleLangBtn = document.getElementById('btn-toggle-lang') || document.getElementById('mobile-btn-toggle-lang');
    if (toggleLangBtn) {
        toggleLangBtn.addEventListener('click', () => {
            // On cible large (PC et Mobile)
            const fr = document.getElementById('panel-title-fr') || document.getElementById('mobile-title-fr');
            const ar = document.getElementById('panel-title-ar') || document.getElementById('mobile-title-ar');

            if (fr && ar) {
                const isFrVisible = fr.style.display !== 'none';
                fr.style.display = isFrVisible ? 'none' : '';
                ar.style.display = isFrVisible ? '' : 'none';
            }
        });
    }

    // (Ancien bouton Admin supprimé - géré par le crayon standard en God Mode)

    // --- TTS (Text-To-Speech) ---
    const speakBtns = document.querySelectorAll('.speak-btn');
    speakBtns.forEach(btn => {
        btn.addEventListener('click', () => {
             const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
             if (!feature) return;
             const props = feature.properties || {};
             const userData = props.userData || {};
             const textToRead = userData.description || props.Description || userData.Description || "Pas de description.";

             speakText(textToRead, btn);
        });
    });

    // Gestion Photos DÉLÉGUÉE

    // PHOTO GRID BUTTON LISTENER
    const btnPhotoGrid = document.getElementById('btn-open-photo-grid') || document.getElementById('mobile-btn-open-photo-grid');
    if(btnPhotoGrid) {
        // Clone to remove old listeners (if any, though we rebuild html)
        btnPhotoGrid.onclick = (e) => {
            e.stopPropagation();
            openPhotoGrid(poiId);
        };
    }

    // Ajustement du temps
    document.getElementById('time-increment-btn')?.addEventListener('click', () => adjustTime(5));
    document.getElementById('time-decrement-btn')?.addEventListener('click', () => adjustTime(-5));

    // Ajustement du prix (Stepper)
    document.getElementById('price-increment-btn')?.addEventListener('click', () => adjustPrice(0.5));
    document.getElementById('price-decrement-btn')?.addEventListener('click', () => adjustPrice(-0.5));

    // Navigation Mobile vs Desktop
    if (isMobileView()) {
        const moveBtn = document.getElementById('mobile-move-poi-btn');
        if (moveBtn) {
            moveBtn.addEventListener('click', async () => {
                if (await showConfirm("Mise à jour GPS", "Mettre à jour avec votre position GPS actuelle ?", "Mettre à jour", "Annuler")) {
                    // On délègue la mise à jour et on affiche le toast
                    await updatePoiPosition(poiId);
                }
            });
        }
        // ON GARDE CES BOUTONS : ils sont essentiels pour la navigation mobile
        document.getElementById('details-prev-btn')?.addEventListener('click', () => navigatePoiDetails(-1));
        document.getElementById('details-next-btn')?.addEventListener('click', () => navigatePoiDetails(1));
        document.getElementById('details-close-btn')?.addEventListener('click', () => closeDetailsPanel(true));
    } else {
        // ON GARDE CE BLOC : il gère la navigation sur ordinateur
        document.getElementById('prev-poi-button')?.addEventListener('click', () => navigatePoiDetails(-1));
        document.getElementById('next-poi-button')?.addEventListener('click', () => navigatePoiDetails(1));
        document.getElementById('close-details-button')?.addEventListener('click', () => closeDetailsPanel());
    }
}

// --- OUVERTURE/FERMETURE ---

export function openDetailsPanel(featureId, circuitIndex = null) {
    if (featureId === undefined || featureId < 0) return;
    
    // Fermeture propre d'une éventuelle popup carte existante
    if(!isMobileView() && map) map.closePopup();

    // Sécurité: feature existe ?
    const feature = state.loadedFeatures[featureId];
    if (!feature) return;

    // --- CORRECTION : Auto-détection intelligente du circuit ---
    // Si la position n'est pas fournie mais qu'un circuit est actif, on la retrouve !
    if (circuitIndex === null && state.currentCircuit && state.currentCircuit.length > 0) {
        const currentId = getPoiId(feature);
        const foundIndex = state.currentCircuit.findIndex(f => getPoiId(f) === currentId);
        if (foundIndex !== -1) circuitIndex = foundIndex;
    }

    state.currentFeatureId = featureId;
    state.currentCircuitIndex = circuitIndex;

    // Injection du HTML
    const targetPanel = isMobileView() ? DOM.mobileMainContainer : DOM.detailsPanel;
    targetPanel.innerHTML = buildHTML(feature, circuitIndex);
    
    // Ré-attachement des écouteurs (sur les nouveaux éléments uniquement)
    const poiId = getPoiId(feature);
    setupGlobalEditButton(poiId);  // ADDED: Global edit button
    setupDetailsEventListeners(poiId);

    // Initialisation icônes Lucide
    createIcons({ icons });

    if (isMobileView()) {
        targetPanel.style.display = 'block';
        targetPanel.style.overflowY = 'auto'; // Fix for scrollbar issue
        targetPanel.classList.add('mobile-standard-padding');
    } else {
        DOM.rightSidebar.style.display = 'flex';
        document.body.classList.add('sidebar-open');
        switchSidebarTab('details', true);
        renderExplorerList(); // Render circuit list with new active POI filter
    }
}

export function closeDetailsPanel(goBackToList = false) {
    clearMarkerHighlights();
    if (window.speechSynthesis && window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    if (isDictationActive()) stopDictation();
    
    state.currentFeatureId = null; // Reset filter universally BEFORE rendering either view

    if (isMobileView()) {
        if(goBackToList && state.activeCircuitId) {
            renderMobilePoiList(state.currentCircuit);
        } else {
             renderMobileCircuitsList();
        }
    } else {
        if (state.isSelectionModeActive) {
            switchSidebarTab('circuit');
        } else {
            // Default to explorer when closing details
            renderExplorerList();
            switchSidebarTab('explorer');
        }
    }
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

export function adjustTime(minutesToAdd) {
    if (state.currentFeatureId === null) return;
    const trigger = document.getElementById('panel-time-display');
    if (!trigger) return;

    // On délègue le calcul mathématique au spécialiste
    const newTime = calculateAdjustedTime(
        trigger.dataset.hours, 
        trigger.dataset.minutes, 
        minutesToAdd
    );
    
    const poiId = getPoiId(state.loadedFeatures[state.currentFeatureId]);
    updatePoiData(poiId, 'timeH', newTime.h);
    updatePoiData(poiId, 'timeM', newTime.m);
    
    // ui.js ne fait plus que l'affichage visuel
    trigger.textContent = `${String(newTime.h).padStart(2, '0')}h${String(newTime.m).padStart(2, '0')}`;
    trigger.dataset.hours = newTime.h;
    trigger.dataset.minutes = newTime.m;
}

export function adjustPrice(delta) {
    if (state.currentFeatureId === null) return;
    const trigger = document.getElementById('panel-price-display');
    if (!trigger) return;

    let currentVal = parseFloat(trigger.dataset.value) || 0;
    let newVal = Math.max(0, currentVal + delta); // Pas de prix négatif

    // Arrondi pour éviter 10.50000001
    newVal = Math.round(newVal * 100) / 100;

    const poiId = getPoiId(state.loadedFeatures[state.currentFeatureId]);
    updatePoiData(poiId, 'price', newVal);

    trigger.textContent = newVal === 0 ? 'Gratuit' : newVal;
    trigger.dataset.value = newVal;

    const currencySpan = document.getElementById('panel-price-currency');
    if (currencySpan) {
        currencySpan.style.display = newVal > 0 ? '' : 'none';
    }
}

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

