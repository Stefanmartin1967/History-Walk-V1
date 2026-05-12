import { state, setCurrentFeatureId, setCurrentCircuitIndex, setPoiFilterFromSearch } from './state.js';
import { getPoiId, getPoiName, updatePoiData, updatePoiCoordinates, isPendingPoi, discardPendingPoi } from './data.js';
import { eventBus } from './events.js';
import { speakText } from './tts.js';
import { isMobileView, pushMobileLevel, animateContainer } from './mobile-state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { buildDetailsPanelHtml as buildHTML } from './templates.js';
import { sanitizeHTML } from './utils.js';
import { openPhotoGrid } from './ui-photo-grid.js';
import { showConfirm } from './modal.js';
import { switchSidebarTab } from './ui-sidebar.js';
import { DOM } from './ui-dom.js';
import { getPoiPhotos, getPendingAdminPhotos } from './database.js';

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

// Re-render la fiche POI courante après save de la modale Photos (le hero
// passera en has-photo via hydrateHeroFromBlobs si un blob pending existe).
function refreshCurrentDetailsPanel() {
    const id = state.currentFeatureId;
    if (id === null || id === undefined) return;
    openDetailsPanel(id, state.currentCircuitIndex);
}

// Tracking de l'objectURL utilisé par le hero pour pouvoir le révoquer au prochain render.
let activeHeroObjectUrl = null;

function revokeHeroObjectUrl() {
    if (activeHeroObjectUrl) {
        URL.revokeObjectURL(activeHeroObjectUrl);
        activeHeroObjectUrl = null;
    }
}

// Hydrate le hero avec un blob local quand aucune URL publiée n'est disponible
// (ex: photo qui vient d'être ajoutée à un POI avant publication GitHub admin,
// ou photo perso côté user). Lit depuis pendingAdminPhotos (admin) ou poiPhotos (user).
async function hydrateHeroFromBlobs(poiId) {
    const hero = document.getElementById('poi-hero');
    if (!hero || !hero.classList.contains('is-empty')) return;

    const mapId = state.currentMapId;
    if (!mapId || !poiId) return;

    const items = state.isAdmin
        ? await getPendingAdminPhotos(mapId, poiId)
        : await getPoiPhotos(mapId, poiId);
    if (!items || items.length === 0) return;

    // Le panel a pu être re-rendu pendant l'await (autre POI ouvert).
    // On vérifie que le hero ciblé est toujours dans le DOM courant.
    const currentHero = document.getElementById('poi-hero');
    if (currentHero !== hero) return;

    const blob = items[0]?.blob;
    if (!blob) return;

    revokeHeroObjectUrl();
    activeHeroObjectUrl = URL.createObjectURL(blob);

    // Switch is-empty → has-photo : retire icône/label vides, ajoute compteur.
    hero.classList.remove('is-empty');
    hero.classList.add('has-photo');
    hero.querySelector('.empty-icon')?.remove();
    hero.querySelector('.empty-label')?.remove();

    const count = items.length;
    const badge = document.createElement('span');
    badge.className = 'poi-photo-count';
    badge.innerHTML = `<i data-lucide="image"></i>${count} ${count > 1 ? 'photos' : 'photo'}`;
    hero.appendChild(badge);

    const safe = activeHeroObjectUrl.replace(/['"\\]/g, encodeURIComponent);
    hero.style.setProperty('--poi-hero-bg', `url("${safe}")`);
    hero.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.35)), url("${safe}")`;

    createIcons({ icons: appIcons, root: hero });

    // Le clic sur le hero (gérée par setupHeroClick) early-return si pas
    // .has-photo. Comme la classe vient d'être ajoutée, on rebind ici.
    hero.addEventListener('click', (e) => {
        if (e.target.closest('.poi-back-pill')) return;
        openPhotoGrid(poiId);
    });
}

// Kebab + popover : remplace l'ancien drawer (PC) et bottom-sheet (mobile).
// WAI-ARIA menu pattern : focus 1er item à l'ouverture, ↑↓/Home/End navigue,
// Esc/Tab ferme et restaure le focus sur le trigger.
// Pas de persistence : le popover est fermé par défaut à chaque rendu de fiche
// (re-render innerHTML ⇒ DOM neuf, état initial fermé "gratuit").
function setupKebab() {
    const trigger = document.getElementById('poi-tools-trigger');
    const pop = document.getElementById('poi-tools-pop');
    if (!trigger || !pop) return;

    let isOpen = false;

    const open = () => {
        if (isOpen) return;
        isOpen = true;
        pop.classList.remove('is-hidden');
        trigger.setAttribute('aria-expanded', 'true');
        const first = pop.querySelector('.poi-pop-item:not([aria-disabled="true"])');
        first?.focus();
    };

    const close = ({ restoreFocus = true } = {}) => {
        if (!isOpen) return;
        isOpen = false;
        pop.classList.add('is-hidden');
        trigger.setAttribute('aria-expanded', 'false');
        if (restoreFocus) trigger.focus();
    };

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        isOpen ? close({ restoreFocus: false }) : open();
    });

    // Clic extérieur → fermer (pas de restore focus, l'utilisateur est ailleurs)
    document.addEventListener('click', (e) => {
        if (!isOpen) return;
        if (pop.contains(e.target) || trigger.contains(e.target)) return;
        close({ restoreFocus: false });
    });

    // Clic sur un item : exécute le handler attaché par setupDetailsEventListeners
    // et ferme le popover juste après. aria-disabled coupe l'action.
    pop.querySelectorAll('.poi-pop-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (item.getAttribute('aria-disabled') === 'true') {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            setTimeout(() => close({ restoreFocus: false }), 50);
        });
    });

    // Clavier
    trigger.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!isOpen) open();
        }
    });
    pop.addEventListener('keydown', (e) => {
        const items = [...pop.querySelectorAll('.poi-pop-item:not([aria-disabled="true"])')];
        const idx = items.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
        else if (e.key === 'ArrowUp')   { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
        else if (e.key === 'Home')      { e.preventDefault(); items[0]?.focus(); }
        else if (e.key === 'End')       { e.preventDefault(); items[items.length - 1]?.focus(); }
        else if (e.key === 'Tab')       { close({ restoreFocus: false }); /* Tab agit naturellement après fermeture */ }
    });
}

// Chevrons inline dans l'eyebrow (‹ 3/12 ›) — remplace les anciens
// boutons prev/next du footer (PC) et pills mobile (couvert aussi par le swipe global).
function setupEyebrowNav() {
    document.getElementById('poi-eyebrow-prev')
        ?.addEventListener('click', () => eventBus.emit('poi:navigate', -1));
    document.getElementById('poi-eyebrow-next')
        ?.addEventListener('click', () => eventBus.emit('poi:navigate', 1));
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
    if (!hero) return;
    // Hero avec photo : clic ouvre la grid (galerie). Hero vide marqué
    // .is-clickable (F1) : clic ouvre aussi la grid en upload direct.
    if (!hero.classList.contains('has-photo') && !hero.classList.contains('is-clickable')) return;
    const handleOpen = async (e) => {
        if (e.target.closest('.poi-back-pill')) return;
        const result = await openPhotoGrid(poiId);
        if (result?.saved) refreshCurrentDetailsPanel();
    };
    hero.addEventListener('click', handleOpen);
    // Clavier sur hero vide (role="button" tabindex="0")
    if (hero.classList.contains('is-empty')) {
        hero.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleOpen(e);
            }
        });
    }
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
    setupKebab();
    setupEyebrowNav();
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

    // --- Bouton soft delete ---
    const softDeleteBtn = document.getElementById('btn-soft-delete');
    if (softDeleteBtn) {
        softDeleteBtn.addEventListener('click', () => {
            eventBus.emit('poi:request-soft-delete', state.currentFeatureId);
        });
    }

    // --- Close fiche ---
    // Mobile : bouton X dans le header. PC : bouton X dans le hero (si présent).
    // Nav prev/next : eyebrow chevrons (PC + mobile, cf. setupEyebrowNav)
    // + swipe horizontal sur mobile (cf. mobile-nav.js).
    if (isMobileView()) {
        document.getElementById('details-close-btn')?.addEventListener('click', () => closeDetailsPanel(true));
    } else {
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

    // Reset le flag : ce changement de POI ne vient PAS de la searchbar
    // (clic carte / marker / timeline). Le filtre POI sur la liste des
    // circuits ne doit donc pas s'activer.
    setPoiFilterFromSearch(false);
    setCurrentFeatureId(featureId);
    setCurrentCircuitIndex(circuitIndex);

    // Injection du HTML — révoque l'objectURL du hero précédent (évite leak).
    revokeHeroObjectUrl();
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

    // Hero "is-empty" malgré la présence de blobs locaux : hydratation async
    // (photo créée mais pas encore publiée GitHub admin, ou photo perso user).
    hydrateHeroFromBlobs(poiId);

    if (isMobileView()) {
        targetPanel.style.display = 'block';
        targetPanel.style.overflowY = 'auto';
        targetPanel.classList.add('mobile-standard-padding');
        animateContainer(targetPanel); // remove/reflow/add + animationend cleanup
    } else {
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
