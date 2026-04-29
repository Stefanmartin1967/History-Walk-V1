import { state, setCurrentFeatureId, setCurrentCircuitIndex } from './state.js';
import { getPoiId, getPoiName, updatePoiData, updatePoiCoordinates, isPendingPoi, discardPendingPoi } from './data.js';
import { eventBus } from './events.js';
import { speakText } from './tts.js';
import { isMobileView, pushMobileLevel } from './mobile-state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { buildDetailsPanelHtml as buildHTML } from './templates.js';
import { sanitizeHTML } from './utils.js';
import { openPhotoGrid } from './ui-photo-grid.js';
import { showConfirm } from './modal.js';
import { switchSidebarTab } from './ui-sidebar.js';
import { DOM } from './ui-dom.js';

export function initUiDetailsListeners() {
    eventBus.on('poi:open-details', ({ featureId, circuitIndex = null }) => openDetailsPanel(featureId, circuitIndex));
}

function setupGlobalEditButton(poiId) {
    const editBtns = document.querySelectorAll('#btn-global-edit');
    editBtns.forEach(btn => {
        btn.addEventListener('click', () => {
             eventBus.emit('richEditor:open-for-edit', poiId);
        });
    });
}

// Applique le background-image du hero via CSSOM (CSP-safe : 'unsafe-inline' style retiré).
function applyHeroBackground() {
    const hero = document.getElementById('poi-hero');
    if (!hero) return;
    const url = hero.dataset.bgUrl;
    if (!url) return;
    const safe = String(url).replace(/['"\\]/g, encodeURIComponent);
    hero.style.setProperty('--poi-hero-bg', `url("${safe}")`);
    hero.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.35)), url("${safe}")`;
}

function setupToolsDrawer() {
    const trigger = document.getElementById('poi-tools-trigger');
    if (!trigger) return;

    if (isMobileView()) {
        const sheet = document.getElementById('poi-mobile-tools-sheet');
        const close = () => {
            sheet?.classList.remove('is-open');
            sheet?.setAttribute('aria-hidden', 'true');
            trigger.setAttribute('aria-expanded', 'false');
            document.querySelector('.poi-panel.is-mobile')?.classList.remove('tools-open');
        };
        trigger.addEventListener('click', () => {
            const open = !sheet.classList.contains('is-open');
            sheet.classList.toggle('is-open', open);
            sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
            trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
            document.querySelector('.poi-panel.is-mobile')?.classList.toggle('tools-open', open);
        });
        // Tap hors du panneau → fermer
        sheet?.addEventListener('click', (e) => {
            if (!e.target.closest('.sheet-panel')) close();
        });
        // Tap sur un bouton du tiroir → fermer après l'action
        sheet?.querySelectorAll('.poi-tool-btn').forEach(btn => {
            btn.addEventListener('click', () => setTimeout(close, 50));
        });
        return;
    }

    // Desktop : drawer en pied de panneau, mémorise l'état dans localStorage
    const tools = document.getElementById('poi-tools');
    const panel = document.getElementById('poi-tools-panel');
    if (!tools || !panel) return;

    const STORAGE_KEY = 'hw_poi_tools_open';
    const initialOpen = localStorage.getItem(STORAGE_KEY) === '1';
    if (initialOpen) {
        tools.classList.add('is-open');
        panel.classList.remove('is-hidden');
        trigger.setAttribute('aria-expanded', 'true');
    }
    trigger.addEventListener('click', () => {
        const open = !tools.classList.contains('is-open');
        tools.classList.toggle('is-open', open);
        panel.classList.toggle('is-hidden', !open);
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    });
}

function setupSuiviToggles(poiId) {
    document.querySelectorAll('[data-toggle]').forEach(toggleEl => {
        const field = toggleEl.dataset.toggle; // 'vu' ou 'incontournable'
        toggleEl.addEventListener('click', async () => {
            const willBeOn = !toggleEl.classList.contains('is-on');
            toggleEl.classList.toggle('is-on', willBeOn);
            // Hint update (libellé sous le toggle)
            const hint = toggleEl.querySelector('.lab-hint');
            if (hint) {
                if (field === 'vu') {
                    hint.textContent = willBeOn ? 'Ajouté à mon carnet de voyage' : 'Cocher après visite sur place';
                } else if (field === 'incontournable') {
                    hint.textContent = willBeOn ? 'Mis en avant sur la carte' : 'Mettre en avant sur la carte';
                }
            }
            // Swap d'icône lucide pour refléter l'état (audit #1) :
            // 'vu' → circle / check-circle-2 ; 'incontournable' → star-off / star
            const iconEl = toggleEl.querySelector('.poi-toggle-icon');
            if (iconEl) {
                let nextIcon;
                if (field === 'vu') nextIcon = willBeOn ? 'check-circle-2' : 'circle';
                else if (field === 'incontournable') nextIcon = willBeOn ? 'star' : 'star-off';
                if (nextIcon) {
                    const newI = document.createElement('i');
                    newI.className = 'poi-toggle-icon';
                    newI.setAttribute('data-lucide', nextIcon);
                    iconEl.replaceWith(newI);
                    createIcons({ icons: appIcons });
                }
            }
            await updatePoiData(poiId, field, willBeOn);
        });
    });
}

function setupNotesAutosave(poiId) {
    const notesEl = document.getElementById('poi-notes-area');
    if (!notesEl) return;
    let debounce = null;
    notesEl.addEventListener('input', (e) => {
        clearTimeout(debounce);
        const value = e.target.value;
        debounce = setTimeout(() => updatePoiData(poiId, 'notes', value), 350);
    });
    notesEl.addEventListener('blur', (e) => {
        clearTimeout(debounce);
        updatePoiData(poiId, 'notes', e.target.value);
    });
}

function setupHeroClick(poiId) {
    const hero = document.getElementById('poi-hero');
    if (!hero || !hero.classList.contains('has-photo')) return;
    hero.addEventListener('click', (e) => {
        // Évite les clics sur le bouton close interne
        if (e.target.closest('.poi-back-pill')) return;
        openPhotoGrid(poiId);
    });
}

function setupCtaItinerary() {
    const cta = document.getElementById('poi-cta-itinerary');
    if (!cta) return;
    cta.addEventListener('click', () => {
        const feature = state.loadedFeatures[state.currentFeatureId];
        if (!feature || !feature.geometry) {
            showToast('Coordonnées introuvables.', 'error');
            return;
        }
        const [lng, lat] = feature.geometry.coordinates;
        // Google Maps directions
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank', 'noopener,noreferrer');
    });
}

function setupGpxDescToggle() {
    // Bouton "Desc. GPX" du tiroir → toggle visibilité de la section poi-gpx-section
    const toggleBtn = document.getElementById('btn-toggle-gpx-desc') || document.getElementById('mobile-btn-toggle-gpx-desc');
    const section = document.getElementById('section-gpx-desc') || document.getElementById('mobile-section-gpx-desc');
    if (!toggleBtn || !section) return;
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        section.classList.toggle('is-hidden');
        // Scroll into view si on vient d'ouvrir
        if (!section.classList.contains('is-hidden')) {
            section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}

function setupDetailsEventListeners(poiId) {
    setupSuiviToggles(poiId);
    setupNotesAutosave(poiId);
    setupHeroClick(poiId);
    setupCtaItinerary();
    setupToolsDrawer();
    setupGpxDescToggle();

    // --- Bouton "Vérifier sur Google Maps" (lookup, ancien open-gmaps-btn) ---
    const gmapsBtn = document.getElementById('open-gmaps-btn');
    if (gmapsBtn) {
        gmapsBtn.addEventListener('click', () => {
            const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
            if (feature && feature.geometry && feature.geometry.coordinates) {
                const [lng, lat] = feature.geometry.coordinates;
                window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank', 'noopener,noreferrer');
            } else {
                showToast('Coordonnées introuvables.', 'error');
            }
        });
    }

    // --- Bouton "Déplacer marqueur" (PC drag pin) ---
    const moveMarkerBtn = document.getElementById('btn-move-marker');
    if (moveMarkerBtn) {
        moveMarkerBtn.addEventListener('click', () => {
             eventBus.emit('map:start-marker-drag', {
                 poiId,
                 onDrag: (lat, lng) => {
                     const latInput = document.getElementById('poi-lat');
                     const lngInput = document.getElementById('poi-lng');
                     if (latInput) latInput.value = lat.toFixed(5);
                     if (lngInput) lngInput.value = lng.toFixed(5);
                 },
                 onEnd: async (lat, lng, revert) => {
                     const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
                     const [prevLng, prevLat] = feature.geometry.coordinates;
                     if (await showConfirm('Déplacement', 'Valider la nouvelle position ?', 'Valider', 'Annuler')) {
                         await updatePoiCoordinates(poiId, lat, lng);
                         showToast('Position mise à jour.', 'success', 8000, {
                             label: 'Annuler',
                             onClick: async () => {
                                 revert();
                                 await updatePoiCoordinates(poiId, prevLat, prevLng);
                                 showToast('Position restaurée.', 'info');
                             }
                         });
                     } else {
                         revert();
                     }
                 }
             });
        });
    }

    // --- Bouton "Capturer position" (Mobile getCurrentPosition) ---
    const moveBtnMobile = document.getElementById('mobile-move-poi-btn');
    if (moveBtnMobile) {
        moveBtnMobile.addEventListener('click', async () => {
            if (await showConfirm('Mise à jour GPS', 'Mettre à jour avec votre position GPS actuelle ?', 'Mettre à jour', 'Annuler')) {
                eventBus.emit('mobile:update-poi-position', poiId);
            }
        });
    }

    // --- Bouton recherche Google ---
    const searchBtns = document.querySelectorAll('.btn-web-search, #btn-web-search');
    searchBtns.forEach(btn => {
        btn.addEventListener('click', () => {
             const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
             if (feature) {
                 const name = getPoiName(feature);
                 const query = encodeURIComponent(name);
                 window.open(`https://www.google.com/search?q=${query}`, '_blank', 'noopener,noreferrer');
             }
        });
    });

    // --- Toggle FR / AR ---
    const toggleLangBtn = document.getElementById('btn-toggle-lang') || document.getElementById('mobile-btn-toggle-lang');
    if (toggleLangBtn && !toggleLangBtn.disabled) {
        toggleLangBtn.addEventListener('click', () => {
            const fr = document.getElementById('panel-title-fr') || document.getElementById('mobile-title-fr');
            const ar = document.getElementById('panel-title-ar') || document.getElementById('mobile-title-ar');
            if (fr && ar) {
                fr.classList.toggle('is-hidden');
                ar.classList.toggle('is-hidden');
            }
        });
    }

    // --- TTS lecture description ---
    const speakBtns = document.querySelectorAll('.speak-btn');
    speakBtns.forEach(btn => {
        btn.addEventListener('click', () => {
             const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
             if (!feature) return;
             const props = feature.properties || {};
             const userData = props.userData || {};
             const textToRead = userData.description || props.Description || userData.Description || 'Pas de description.';
             speakText(textToRead, btn);
        });
    });

    // --- Bouton "Photos" (galerie) ---
    const btnPhotoGrid = document.getElementById('btn-open-photo-grid');
    if (btnPhotoGrid) {
        btnPhotoGrid.addEventListener('click', (e) => {
            e.stopPropagation();
            openPhotoGrid(poiId);
        });
    }

    // --- Bouton soft delete ---
    const softDeleteBtn = document.getElementById('btn-soft-delete');
    if (softDeleteBtn) {
        softDeleteBtn.addEventListener('click', () => {
            eventBus.emit('poi:request-soft-delete', state.currentFeatureId);
        });
    }

    // --- Navigation prev/next + close ---
    if (isMobileView()) {
        document.getElementById('details-prev-btn')?.addEventListener('click', () => eventBus.emit('poi:navigate', -1));
        document.getElementById('details-next-btn')?.addEventListener('click', () => eventBus.emit('poi:navigate', 1));
        document.getElementById('details-close-btn')?.addEventListener('click', () => closeDetailsPanel(true));
    } else {
        document.getElementById('prev-poi-button')?.addEventListener('click', () => eventBus.emit('poi:navigate', -1));
        document.getElementById('next-poi-button')?.addEventListener('click', () => eventBus.emit('poi:navigate', 1));
        document.getElementById('close-details-button')?.addEventListener('click', () => closeDetailsPanel());
    }
}

// --- OUVERTURE/FERMETURE ---

export function openDetailsPanel(featureId, circuitIndex = null) {
    if (featureId === undefined || featureId < 0) return;
    if (!isMobileView()) eventBus.emit('map:close-popup');

    const feature = state.loadedFeatures[featureId];
    if (!feature) return;

    // Auto-détection du circuit
    if (circuitIndex === null && state.currentCircuit && state.currentCircuit.length > 0) {
        const currentId = getPoiId(feature);
        const foundIndex = state.currentCircuit.findIndex(f => getPoiId(f) === currentId);
        if (foundIndex !== -1) circuitIndex = foundIndex;
    }

    // Proactif Back Android (C7)
    const isFreshOpen = state.currentFeatureId === null;
    if (isFreshOpen && isMobileView()) {
        pushMobileLevel('p');
    }

    setCurrentFeatureId(featureId);
    setCurrentCircuitIndex(circuitIndex);

    // Injection du HTML
    const targetPanel = isMobileView() ? DOM.mobileMainContainer : DOM.detailsPanel;
    targetPanel.innerHTML = buildHTML(feature, circuitIndex);

    // Background hero (CSSOM, CSP-safe)
    applyHeroBackground();

    // Bindings
    const poiId = getPoiId(feature);
    setupGlobalEditButton(poiId);
    setupDetailsEventListeners(poiId);

    // Icônes Lucide
    createIcons({ icons: appIcons });

    if (isMobileView()) {
        targetPanel.style.display = 'block';
        targetPanel.style.overflowY = 'auto';
        targetPanel.classList.add('mobile-standard-padding');
        targetPanel.classList.remove('view-enter');
        void targetPanel.offsetWidth;
        targetPanel.classList.add('view-enter');
    } else {
        DOM.rightSidebar.style.display = 'flex';
        document.body.classList.add('sidebar-open');
        switchSidebarTab('details', true);
        eventBus.emit('ui:render-explorer-list');
    }
}

export function closeDetailsPanel(goBackToList = false) {
    eventBus.emit('map:clear-highlights');
    if (window.speechSynthesis && window.speechSynthesis.speaking) window.speechSynthesis.cancel();

    // Rollback POI fantôme
    if (state.currentFeatureId !== null && state.currentFeatureId !== undefined) {
        const pendingFeature = state.loadedFeatures[state.currentFeatureId];
        if (pendingFeature) {
            const pendingId = getPoiId(pendingFeature);
            if (isPendingPoi(pendingId)) {
                discardPendingPoi(pendingId);
                showToast('Lieu non validé : création annulée.', 'info', 2500);
            }
        }
    }

    setCurrentFeatureId(null);

    if (isMobileView()) {
        if (goBackToList && state.activeCircuitId) {
            eventBus.emit('mobile:render-poi-list', state.currentCircuit);
        } else {
             eventBus.emit('mobile:render-circuits-list');
        }
    } else {
        if (state.isSelectionModeActive) {
            switchSidebarTab('circuit');
        } else {
            eventBus.emit('ui:render-explorer-list');
            switchSidebarTab('explorer');
        }
    }
}
