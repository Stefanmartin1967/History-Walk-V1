// ui.js
import { state, POI_CATEGORIES } from './state.js';
import { getPoiId, getPoiName, applyFilters, updatePoiData, updatePoiCoordinates } from './data.js';
import { restoreCircuit, saveAppState } from './database.js';
import { escapeXml } from './utils.js';
import { eventBus } from './events.js';
import { stopDictation, isDictationActive, speakText } from './voice.js';
import { clearCircuit, navigatePoiDetails, toggleSelectionMode, loadCircuitById } from './circuit.js';
import { map, clearMarkerHighlights } from './map.js';
import { isMobileView, updatePoiPosition, renderMobileCircuitsList, renderMobilePoiList, switchMobileView } from './mobile.js';
import { createIcons, icons } from 'lucide';
import { showToast } from './toast.js';
import { buildDetailsPanelHtml as buildHTML, ICONS } from './templates.js';
import { getZonesData } from './circuit-actions.js';
import { calculateAdjustedTime } from './utils.js';
import { initPhotoViewer, setupPhotoPanelListeners } from './ui-photo-viewer.js';
import { initCircuitListUI, renderExplorerList } from './ui-circuit-list.js';
import { showConfirm, showAlert } from './modal.js';
import { RichEditor } from './richEditor.js';
import { switchSidebarTab } from './ui-sidebar.js'; // Imported for use inside ui.js functions
import { exportFullBackupPC, exportDataForMobilePC, saveUserData } from './fileManager.js';
import { invalidateMapSize } from './map.js';

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
        'explorer-list', 'btn-open-my-circuits',
        'btn-bmc', 'btn-tools-menu'
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
                // FIX: On force le redessin de la carte (sinon elle peut être coupée)
                invalidateMapSize();
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

    // --- LOGIQUE SAUVEGARDE UNIFIÉE ---
    if (DOM.btnOpenBackupModal) {
        DOM.btnOpenBackupModal.addEventListener('click', () => {
            updateBackupSizeEstimates();
            if(DOM.backupModal) DOM.backupModal.style.display = 'flex';
        });
    }

    if (DOM.btnBackupCancel) {
        DOM.btnBackupCancel.addEventListener('click', () => {
            if(DOM.backupModal) DOM.backupModal.style.display = 'none';
        });
    }

    if (DOM.btnBackupFull) {
        DOM.btnBackupFull.addEventListener('click', () => {
            if(window.innerWidth > 768) {
                exportFullBackupPC();
            } else {
                saveUserData(true);
            }
            if(DOM.backupModal) DOM.backupModal.style.display = 'none';
        });
    }

    if (DOM.btnBackupLite) {
        DOM.btnBackupLite.addEventListener('click', () => {
            if(window.innerWidth > 768) {
                exportDataForMobilePC();
            } else {
                saveUserData(false);
            }
            if(DOM.backupModal) DOM.backupModal.style.display = 'none';
        });
    }

    if (DOM.btnBmc) {
        DOM.btnBmc.addEventListener('click', () => {
            window.open('https://www.buymeacoffee.com/history_walk', '_blank');
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
             // 1. Trouver le layer correspondant sur la carte
             if (!state.geojsonLayer) return;

             let targetLayer = null;
             state.geojsonLayer.eachLayer(layer => {
                 if (getPoiId(layer.feature) === poiId) targetLayer = layer;
             });

             if (!targetLayer) {
                 showToast("Marqueur introuvable sur la carte.", "error");
                 return;
             }

             // 2. Activer le drag
             if (targetLayer.dragging) {
                 targetLayer.dragging.enable();
                 targetLayer.setOpacity(0.7); // Feedback visuel
                 showToast("Mode déplacement activé. Glissez le marqueur !", "info");

                 // Définition des handlers pour pouvoir les retirer proprement
                 const onDrag = (e) => {
                     const { lat, lng } = e.target.getLatLng();
                     const latInput = document.getElementById('poi-lat');
                     const lngInput = document.getElementById('poi-lng');
                     if (latInput) latInput.value = lat.toFixed(5);
                     if (lngInput) lngInput.value = lng.toFixed(5);
                 };

                 const onDragEnd = async (e) => {
                     const { lat, lng } = e.target.getLatLng();

                     // Confirmation
                     if (await showConfirm("Déplacement", "Valider la nouvelle position ?", "Valider", "Annuler")) {
                         await updatePoiCoordinates(poiId, lat, lng);
                         targetLayer.dragging.disable();
                         targetLayer.setOpacity(1);
                         showToast("Position mise à jour.", "success");
                     } else {
                         // Annulation : On remet l'ancienne position
                         const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
                         const [oldLng, oldLat] = feature.geometry.coordinates;
                         targetLayer.setLatLng([oldLat, oldLng]);

                         targetLayer.dragging.disable();
                         targetLayer.setOpacity(1);

                         // Reset inputs
                         const latInput = document.getElementById('poi-lat');
                         const lngInput = document.getElementById('poi-lng');
                         if (latInput) latInput.value = oldLat.toFixed(5);
                         if (lngInput) lngInput.value = oldLng.toFixed(5);
                     }
                     // Cleanup
                     targetLayer.off('drag', onDrag);
                     targetLayer.off('dragend', onDragEnd);
                 };

                 targetLayer.on('drag', onDrag);
                 targetLayer.on('dragend', onDragEnd);
             }
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
    setupPhotoPanelListeners(poiId);

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
    }
}

export function closeDetailsPanel(goBackToList = false) {
    clearMarkerHighlights();
    if (window.speechSynthesis && window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    if (isDictationActive()) stopDictation();
    
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
            state.currentFeatureId = null;
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

export function populateZonesMenu() {
    const zonesMenu = document.getElementById('zonesMenu');
    const zonesLabel = document.getElementById('zonesLabel');
    if (!zonesMenu) return;

    zonesMenu.innerHTML = '';

    // On demande les données calculées au spécialiste
    const data = getZonesData();

    if (!data || data.sortedZones.length === 0) {
        zonesMenu.innerHTML = '<button disabled>Aucune zone visible</button>';
        return;
    }

    // Création du bouton "Toutes"
    const allZonesBtn = document.createElement('button');
    allZonesBtn.textContent = `Toutes les zones (${data.totalVisible})`;
    allZonesBtn.onclick = () => {
        state.activeFilters.zone = null;
        if(zonesLabel) zonesLabel.textContent = 'Zone';
        zonesMenu.style.display = 'none';
        applyFilters();
    };
    zonesMenu.appendChild(allZonesBtn);

    // Création des boutons par zone
    data.sortedZones.forEach(zone => {
        const zoneBtn = document.createElement('button');
        zoneBtn.textContent = `${zone} (${data.zoneCounts[zone]})`;
        zoneBtn.onclick = () => {
            state.activeFilters.zone = zone;
            if(zonesLabel) zonesLabel.textContent = zone;
            zonesMenu.style.display = 'none';
            applyFilters();
        };
        zonesMenu.appendChild(zoneBtn);
    });
}

export function populateCircuitsMenu() {
    const circuitsMenu = document.getElementById('circuitsMenu');
    if (!circuitsMenu) return;

    circuitsMenu.innerHTML = '';
    const visibleCircuits = state.myCircuits.filter(c => !c.isDeleted);

    if (visibleCircuits.length === 0) {
        circuitsMenu.innerHTML = '<button disabled>Aucun circuit</button>';
        return;
    }

    visibleCircuits.forEach(circuit => {
        const btn = document.createElement('button');
        btn.textContent = escapeXml(circuit.name);
        btn.onclick = () => {
            loadCircuitById(circuit.id);
            switchSidebarTab('circuit');
            circuitsMenu.style.display = 'none';
        };
        circuitsMenu.appendChild(btn);
    });
}

// --- NOTIFICATIONS (TOASTS) ---

export function populateAddPoiModalCategories() {
    const select = document.getElementById('new-poi-category');
    if (!select) return;

    select.innerHTML = POI_CATEGORIES.map(c => 
        `<option value="${c}">${c}</option>`
    ).join('');
    
    select.value = "A définir";
}

export function populateCategoriesMenu() {
    const menu = document.getElementById('categoriesMenu');
    if (!menu) return;

    // 1. Déterminer les catégories disponibles (Data Source)
    let categories = [];
    if (state.loadedFeatures && state.loadedFeatures.length > 0) {
        const cats = new Set(
            state.loadedFeatures
                .map(f => f.properties['Catégorie'])
                .filter(c => c && c.trim() !== '')
        );
        categories = Array.from(cats).sort();
    } else {
        categories = POI_CATEGORIES;
    }

    // 2. Vérifier si on doit reconstruire le DOM
    // On regarde les labels existants pour éviter les rebuilds inutiles (clignotements, scroll reset)
    const existingLabels = Array.from(menu.querySelectorAll('label')).map(l => l.innerText.trim());
    const needsRebuild = existingLabels.length !== categories.length ||
                         !existingLabels.every((l, i) => l === categories[i]);

    if (!needsRebuild) {
        // MAJ des checkboxes uniquement (Sync avec activeFilters)
        const checkboxes = menu.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.checked = state.activeFilters.categories.includes(cb.value);
        });
        return;
    }

    // 3. Reconstruction (Si nécessaire)
    menu.innerHTML = '';

    // --- "TOUT VOIR" (Option par défaut) ---
    const allWrapper = document.createElement('label');
    allWrapper.style.display = 'flex';
    allWrapper.style.alignItems = 'center';
    allWrapper.style.padding = '8px 16px';
    allWrapper.style.cursor = 'pointer';
    allWrapper.style.userSelect = 'none';
    allWrapper.style.borderBottom = '1px solid var(--surface-muted)';

    const allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.value = 'ALL';
    allCb.style.marginRight = '10px';
    // Coché si aucun filtre n'est actif
    allCb.checked = state.activeFilters.categories.length === 0;

    allCb.addEventListener('change', (e) => {
        if (e.target.checked) {
            // Si on coche "Tout voir", on vide la liste des filtres
            state.activeFilters.categories = [];
            // Et on décoche visuellement les autres
            menu.querySelectorAll('input[type="checkbox"]:not([value="ALL"])').forEach(c => c.checked = false);
        } else {
            // On empêche de décocher "Tout voir" si c'est la seule option active (pour éviter état vide)
            // Sauf si une autre catégorie est cochée (géré par la logique inverse)
            if (state.activeFilters.categories.length === 0) {
                e.target.checked = true;
                return;
            }
        }
        applyFilters();
    });

    allWrapper.appendChild(allCb);
    allWrapper.appendChild(document.createTextNode("Tout voir"));
    allWrapper.addEventListener('mouseenter', () => allWrapper.style.backgroundColor = 'var(--surface-muted)');
    allWrapper.addEventListener('mouseleave', () => allWrapper.style.backgroundColor = 'transparent');
    menu.appendChild(allWrapper);

    // --- LISTE DES CATÉGORIES ---
    categories.forEach(cat => {
        const wrapper = document.createElement('label');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.padding = '8px 16px';
        wrapper.style.cursor = 'pointer';
        wrapper.style.userSelect = 'none';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = cat;
        cb.style.marginRight = '10px';

        if (state.activeFilters.categories.includes(cat)) {
            cb.checked = true;
        }

        cb.addEventListener('change', (e) => {
            if (e.target.checked) {
                state.activeFilters.categories.push(cat);
                // Si on coche une catégorie, on décoche "Tout voir"
                allCb.checked = false;
            } else {
                state.activeFilters.categories = state.activeFilters.categories.filter(c => c !== cat);
                // Si plus aucune catégorie n'est cochée, on recoche "Tout voir"
                if (state.activeFilters.categories.length === 0) {
                    allCb.checked = true;
                }
            }
            applyFilters();
        });

        wrapper.appendChild(cb);
        wrapper.appendChild(document.createTextNode(cat));

        wrapper.addEventListener('mouseenter', () => wrapper.style.backgroundColor = 'var(--surface-muted)');
        wrapper.addEventListener('mouseleave', () => wrapper.style.backgroundColor = 'transparent');

        menu.appendChild(wrapper);
    });
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
    const btn = document.getElementById('btn-save-circuits');
    if (btn) {
        const safeMapId = mapId || 'circuits';
        // On met à jour le texte en conservant l'icône
        btn.innerHTML = `<i data-lucide="share-2"></i> Exporter ${safeMapId}.json`;
        // On force le rendu de l'icône pour ce bouton spécifique
        createIcons({ icons, nameAttr: 'data-lucide', attrs: { 'class': "lucide" }, root: btn });
    }
}

export function showLegendModal() {
    const title = "Légende";
    const message = `
    <div style="text-align: left; display: flex; flex-direction: column; gap: 15px;">
        <div style="font-weight: 600; border-bottom: 1px solid var(--line); padding-bottom: 4px; margin-bottom: 4px;">Marqueurs</div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 24px; height: 24px; background: #FFFFFF; border-radius: 50%; border: 3px solid #10B981; box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.3);"></div>
            <span><strong>Visité</strong> (Lieu marqué comme vu)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 24px; height: 24px; background: #FFFFFF; border-radius: 50%; border: 3px solid #3B82F6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);"></div>
            <span><strong>Planifié</strong> (Ajouté à un circuit)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 28px; height: 28px; display: flex; justify-content: center; align-items: center;">
                <div style="width: 100%; height: 100%; background: #FEF08A; clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%); display: flex; justify-content: center; align-items: center; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.25));">
                </div>
            </div>
            <span><strong>Incontournable</strong> (Lieu VIP à ne pas manquer)</span>
        </div>

        <div style="font-weight: 600; border-bottom: 1px solid var(--line); padding-bottom: 4px; margin-bottom: 4px; margin-top: 10px;">Lignes des Circuits</div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 40px; height: 4px; background: #EF4444; border-radius: 2px;"></div>
            <span><strong>Vol d'oiseau</strong> (Trajet direct non précis)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 40px; height: 4px; background: #3B82F6; border-radius: 2px;"></div>
            <span><strong>Tracé réel</strong> (Chemin GPS précis à suivre)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 40px; height: 4px; background: #10B981; border-radius: 2px;"></div>
            <span><strong>Circuit terminé</strong> (Marqué comme fait)</span>
        </div>
    </div>`;

    showAlert(title, message, "Fermer").catch(() => {});

    // Force l'affichage des icônes dans la modale
    const modalMessage = document.getElementById('custom-modal-message');
    if (modalMessage) {
        createIcons({ icons, root: modalMessage });
    }
}

export function openRestoreModal() {
    const deletedCircuits = state.myCircuits.filter(c => c.isDeleted);

    if (deletedCircuits.length === 0) {
        showToast("Corbeille vide.", "info");
        return;
    }

    const html = `
        <div style="display: flex; flex-direction: column; gap: 10px; max-height: 300px; overflow-y: auto;">
            ${deletedCircuits.map(c => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: var(--surface-muted); border-radius: 8px;">
                    <span style="font-weight: 500; color: var(--ink); text-align: left;">${escapeXml(c.name)}</span>
                    <button class="restore-btn" data-id="${c.id}" style="background: transparent; color: var(--ok); border: 1px solid var(--ok); border-radius: 6px; padding: 6px 12px; cursor: pointer; font-weight: 600;">
                        Restaurer
                    </button>
                </div>
            `).join('')}
        </div>
    `;

    const modal = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('custom-modal-title');
    const msgEl = document.getElementById('custom-modal-message');
    const actionsEl = document.getElementById('custom-modal-actions');

    if (!modal) return;

    titleEl.textContent = "Corbeille";
    msgEl.innerHTML = html;
    actionsEl.innerHTML = `<button class="custom-modal-btn secondary" id="btn-close-restore">Fermer</button>`;

    modal.classList.add('active');

    const closeBtn = document.getElementById('btn-close-restore');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('active');

    msgEl.querySelectorAll('.restore-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const id = e.currentTarget.dataset.id;
            await restoreCircuit(id);
            const c = state.myCircuits.find(cir => cir.id === id);
            if(c) c.isDeleted = false;

            modal.classList.remove('active');
            eventBus.emit('circuit:list-updated');
        };
    });
}

// --- FONCTION DE SUPPRESSION DOUCE (Déplacée de main.js) ---
export async function requestSoftDelete(idOrIndex) {
    let feature;
    if (typeof idOrIndex === 'number' && state.loadedFeatures[idOrIndex]) {
        feature = state.loadedFeatures[idOrIndex];
    } else {
        feature = state.loadedFeatures[state.currentFeatureId];
    }
    if (!feature) return;

    let poiId;
    try { poiId = getPoiId(feature); } catch (e) { poiId = feature.properties.HW_ID || feature.id; }
    const poiName = getPoiName(feature);

    const msg = isMobileView()
        ? `ATTENTION !\n\nVoulez-vous vraiment placer "${poiName}" dans la corbeille ?`
        : `ATTENTION !\n\nVoulez-vous vraiment signaler "${poiName}" pour suppression ?`;

    if (await showConfirm("Suppression", msg, "Supprimer", "Garder", true)) {
        if (!state.hiddenPoiIds) state.hiddenPoiIds = [];
        if (!state.hiddenPoiIds.includes(poiId)) {
            state.hiddenPoiIds.push(poiId);
        }
        await saveAppState(`hiddenPois_${state.currentMapId}`, state.hiddenPoiIds);

        // On ferme le panneau
        closeDetailsPanel(true);

        // Refresh selon mode
        if (isMobileView()) {
            switchMobileView('circuits'); // Refresh liste
        } else {
            applyFilters();
        }
    }
}
