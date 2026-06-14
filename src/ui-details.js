import { state, setCurrentFeatureId, setCurrentCircuitIndex, setPoiFilterFromSearch } from './state.js';
import { getPoiId, getPoiName, getPatrimonialName, updatePoiData, updatePoiCoordinates, isPendingPoi, discardPendingPoi } from './data.js';
import { setPatrimonialLang, getCurrentPatrimonialLang } from './patrimonial-names.js';
import { eventBus } from './events.js';
import { speakText } from './tts.js';
import { isMobileView, pushMobileLevel, animateContainer, setMobileHeaderSlot, setMobileViewFooter } from './mobile-state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { buildDetailsPanelHtml as buildHTML } from './templates.js';
import { sanitizeHTML, openPoiOnMap } from './utils.js';
import { openPhotoGrid } from './ui-photo-grid.js';
import { showConfirm } from './modal.js';
import { switchSidebarTab } from './ui-sidebar.js';
import { DOM } from './ui-dom.js';
import { getPoiPhotos, getPendingAdminPhotos } from './database.js';
import { startAccessPointPlacement } from './access-point-editor.js';
import { configureHelp, attachHelp } from './help-popover.js';
import { GUIDE_LIRE_LIEU } from './help-content.js';

// Aide « ? » général de la fiche d'un lieu : le patron rend l'icône via createIcons.
// Idempotent (configureHelp est déjà appelé par ui-photo-batch et ui-circuit-list ;
// double appel inoffensif — on garde la trace ici pour si ces modules disparaissent).
configureHelp({ renderIcons: (root) => createIcons({ icons: appIcons, root }) });

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

// Re-render la fiche ouverte quand la langue des noms change (bascule topbar OU
// pilule .cartel-namebtn). Listener UNIQUE (module importé une fois). Sans fiche
// ouverte → refreshCurrentDetailsPanel sort tôt (no-op).
eventBus.on('patrimony:lang-changed', refreshCurrentDetailsPanel);

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

    // Pas de rebind ici : le listener posé par setupHeroClick teste .has-photo
    // AU MOMENT du clic. On vient d'ajouter .has-photo → ce clic ouvrira donc le
    // viewer de consultation (et non la grille). Supprime aussi le double-listener
    // qui existait avant (setupHeroClick + ce bloc liaient tous deux le hero).
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

// Rassemble TOUTES les photos consultables d'un POI pour le viewer : URLs
// publiées/draft d'abord (urls[0] = la photo affichée par le hero), puis blobs
// locaux (pending admin / perso user) en objectURL. Retourne { urls, revoke } —
// l'appelant DOIT appeler revoke() à la fermeture du viewer (libère les objectURL).
// Exportée : circuit.js l'enchaîne sur tous les POIs pour la galerie de circuit.
export async function collectPoiPhotoUrls(poiId) {
    const objectUrls = [];
    const urls = [];
    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);

    const pool = [
        ...(feature?.properties?.photos || []),
        ...(feature?.properties?.userData?.photos || []),
    ];
    const seen = new Set();
    for (const p of pool) {
        if (typeof p !== 'string' || p.startsWith('data:') || seen.has(p)) continue;
        seen.add(p);
        urls.push(p);
    }

    const mapId = state.currentMapId;
    if (mapId && poiId) {
        const items = state.isAdmin
            ? await getPendingAdminPhotos(mapId, poiId)
            : await getPoiPhotos(mapId, poiId);
        for (const item of (items || [])) {
            if (item?.blob) {
                const u = URL.createObjectURL(item.blob);
                objectUrls.push(u);
                urls.push(u);
            }
        }
    }

    return { urls, revoke: () => objectUrls.forEach(u => URL.revokeObjectURL(u)) };
}

// Ouvre le viewer de consultation depuis le hero (import dynamique : évite un
// cycle ui-details ↔ ui-photo-viewer, comme le fait déjà ui-photo-grid).
async function openHeroViewer(poiId) {
    const { urls, revoke } = await collectPoiPhotoUrls(poiId);
    if (urls.length === 0) { revoke(); return; }
    const { openPhotoViewer } = await import('./ui-photo-viewer.js');
    openPhotoViewer(urls, 0).finally(revoke);
}

function setupHeroClick(poiId) {
    const hero = document.getElementById('poi-hero');
    if (!hero) return;
    // Hero AVEC photo → viewer de CONSULTATION. Hero VIDE (.is-clickable, F1) →
    // grille d'édition pour AJOUTER une photo (on ne consulte pas zéro photo).
    // On teste .has-photo AU CLIC : hydrateHeroFromBlobs peut faire passer un
    // hero is-empty → has-photo après le rendu.
    if (!hero.classList.contains('has-photo') && !hero.classList.contains('is-clickable')) return;
    const handleOpen = async (e) => {
        if (e.target.closest('.poi-back-pill')) return;
        if (hero.classList.contains('has-photo')) {
            openHeroViewer(poiId);
            return;
        }
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

function setupHelpButton() {
    // v3 : l'aide « ? » est désormais une affordance du cartel (.cartel-help,
    // posée dans la rangée utilitaire par templates.js, dé-empilée du titre).
    // On la câble au patron d'aide partagé — plus de wrapper flex injecté autour
    // du titre (l'ancien hack inline-style a disparu).
    const btn = document.querySelector('.cartel-help');
    if (btn) attachHelp(btn, GUIDE_LIRE_LIEU);
}

function setupDetailsEventListeners(poiId) {
    setupSuiviToggles(poiId);
    setupNotesAutosave(poiId);
    setupHeroClick(poiId);
    setupKebab();
    setupEyebrowNav();
    setupGpxDescToggle();
    setupHelpButton();

    // --- Boutons "Voir sur Maps / OSM" (par coordonnées, cf. openPoiOnMap) ---
    const gmapsBtn = document.getElementById('open-gmaps-btn');
    if (gmapsBtn) {
        gmapsBtn.addEventListener('click', () => {
            const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
            if (!openPoiOnMap(feature, 'gmaps')) showToast('Coordonnées introuvables.', 'error');
        });
    }
    const osmBtn = document.getElementById('open-osm-btn');
    if (osmBtn) {
        osmBtn.addEventListener('click', () => {
            const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
            if (!openPoiOnMap(feature, 'osm')) showToast('Coordonnées introuvables.', 'error');
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

    // --- Bouton "Point d'accès au tracé" (admin desktop — pose d'un drapeau) ---
    const accessPtBtn = document.getElementById('btn-set-access-point');
    if (accessPtBtn) {
        accessPtBtn.addEventListener('click', () => {
            const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
            if (feature) startAccessPointPlacement(feature);
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
                 const name = getPatrimonialName(feature);
                 const query = encodeURIComponent(name);
                 window.open(`https://www.google.com/search?q=${query}`, '_blank', 'noopener,noreferrer');
             }
        });
    });

    // --- Bascule de nom FR/AR de la fiche (.cartel-namebtn) → pilote la pref
    // GLOBALE de langue des noms (présente seulement si le lieu a un nom arabe).
    // Le flip émet 'patrimony:lang-changed' → re-render de la fiche (listener
    // module) + resync du segmenté topbar.
    const nameBtn = document.querySelector('.cartel-namebtn');
    if (nameBtn) {
        nameBtn.addEventListener('click', () => {
            setPatrimonialLang(getCurrentPatrimonialLang() === 'ar' ? 'fr' : 'ar');
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
             // Clé canonique depuis l'unification : `description` lowercase
             // (cf. scripts/migrate-description-case.mjs + migration runtime
             // data.js). userData prioritaire sur props comme partout.
             const all = { ...props, ...userData };
             const textToRead = (all.description || '').trim() || 'Pas de description.';
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

export function openDetailsPanel(featureId, circuitIndex = null, fromSearch = false) {
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

    // Filtre POI sur la liste « Mes Circuits » : actif UNIQUEMENT quand
    // l'ouverture vient de la searchbar (fromSearch=true). Un clic carte /
    // marker / timeline (fromSearch=false) ne doit PAS filtrer les circuits.
    setPoiFilterFromSearch(fromSearch);
    setCurrentFeatureId(featureId);
    setCurrentCircuitIndex(circuitIndex);

    // Notifie les modules qui suivent le POI courant (ex : access-point-editor
    // qui ferme sa barre de pose si on bascule sur un autre POI, sinon la
    // barre reste figée sur l'ancien POI — bug signalé par Stefan sur PR #708).
    eventBus.emit('details-panel:opened', { poiId: getPoiId(feature) });

    // Injection du HTML — révoque l'objectURL du hero précédent (évite leak).
    revokeHeroObjectUrl();
    const targetPanel = isMobileView() ? DOM.mobileMainContainer : DOM.detailsPanel;
    const html = buildHTML(feature, circuitIndex);
    if (isMobileView()) {
        // Refonte étape 5 : buildHTML mobile retourne { header, body, footer }.
        // On rend dans les 3 slots du #mobile-container — plus de wrapper
        // .poi-panel.is-mobile, plus de position:fixed sur la mini-barre
        // (qui devient un simple flex element dans le view-footer-slot).
        setMobileHeaderSlot(html.header);
        targetPanel.innerHTML = html.body;
        setMobileViewFooter(html.footer);
    } else {
        targetPanel.innerHTML = html;
    }

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

    // Pair de l'émission dans openDetailsPanel : cf. access-point-editor qui
    // ferme sa barre de pose dès que la fiche du POI cible n'est plus active.
    eventBus.emit('details-panel:closed');

    if (isMobileView()) {
        if (goBackToList && state.activeCircuitId) {
            eventBus.emit('mobile:render-poi-list', state.currentCircuit);
        } else {
             eventBus.emit('mobile:render-circuits-list');
        }
    } else {
        if (state.isCircuitCreationMode) {
            switchSidebarTab('circuit');
        } else {
            eventBus.emit('ui:render-explorer-list');
            switchSidebarTab('explorer');
        }
    }
}
