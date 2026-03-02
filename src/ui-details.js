import { state } from './state.js';
import { getPoiId, getPoiName, applyFilters, updatePoiData, updatePoiCoordinates } from './data.js';
import { eventBus } from './events.js';
import { stopDictation, isDictationActive, speakText } from './voice.js';
import { navigatePoiDetails, toggleSelectionMode } from './circuit.js';
import { map, clearMarkerHighlights, startMarkerDrag } from './map.js';
import { isMobileView, updatePoiPosition, renderMobileCircuitsList, renderMobilePoiList } from './mobile.js';
import { createIcons, icons } from 'lucide';
import { showToast } from './toast.js';
import { buildDetailsPanelHtml as buildHTML } from './templates.js';
import { calculateAdjustedTime } from './utils.js';
import { openPhotoGrid } from './ui-photo-grid.js';
import { renderExplorerList } from './ui-circuit-list.js';
import { showConfirm } from './modal.js';
import { requestSoftDelete } from './ui-modals.js';
import { switchSidebarTab } from './ui-sidebar.js';
import { DOM } from './ui.js';

function setupGlobalEditButton(poiId) {
    const editBtns = document.querySelectorAll('#btn-global-edit'); // querySelectorAll au cas où (PC/Mobile)

    editBtns.forEach(btn => {
        btn.addEventListener('click', () => {
             // Redirection directe vers Rich Editor
             import('./richEditor.js').then(m => m.RichEditor.openForEdit(poiId));
        });
    });
}

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

    // PHOTO GRID BUTTON LISTENER
    const btnPhotoGrid = document.getElementById('btn-open-photo-grid') || document.getElementById('mobile-btn-open-photo-grid');
    if(btnPhotoGrid) {
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
                    await updatePoiPosition(poiId);
                }
            });
        }
        document.getElementById('details-prev-btn')?.addEventListener('click', () => navigatePoiDetails(-1));
        document.getElementById('details-next-btn')?.addEventListener('click', () => navigatePoiDetails(1));
        document.getElementById('details-close-btn')?.addEventListener('click', () => closeDetailsPanel(true));
    } else {
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

    // Ré-attachement des écouteurs
    const poiId = getPoiId(feature);
    setupGlobalEditButton(poiId);
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
            renderExplorerList();
            switchSidebarTab('explorer');
        }
    }
}

export function adjustTime(minutesToAdd) {
    if (state.currentFeatureId === null) return;
    const trigger = document.getElementById('panel-time-display');
    if (!trigger) return;

    const newTime = calculateAdjustedTime(
        trigger.dataset.hours,
        trigger.dataset.minutes,
        minutesToAdd
    );

    const poiId = getPoiId(state.loadedFeatures[state.currentFeatureId]);
    updatePoiData(poiId, 'timeH', newTime.h);
    updatePoiData(poiId, 'timeM', newTime.m);

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
