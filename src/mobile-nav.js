// mobile-nav.js
// Orchestrateur de navigation mobile : initialisation, routeur de vues et recherche

import { state } from './state.js';
import { DOM } from './ui.js';
import { openDetailsPanel, closeDetailsPanel } from './ui-details.js';
import { getPoiId, getPoiName, addPoiFeature } from './data.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { saveAppState } from './database.js';
import { getIconForFeature } from './map.js';
import { escapeHtml, sanitizeHTML, isPointInPolygon } from './utils.js';
import { zonesData } from './zones.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { getSearchResults } from './search.js';
import { navigatePoiDetails, loadCircuitById, clearCircuit } from './circuit.js';
import { showAdminLoginModal } from './admin.js';
import {
    isMobileView,
    getCurrentView, setCurrentView,
    getMobileCurrentPage, setMobileCurrentPage,
    getAllCircuitsOrdered,
    animateContainer,
} from './mobile-state.js';
import { renderMobileCircuitsList } from './mobile-circuits.js';
import { renderMobileMenu } from './mobile-menu.js';
import { initBackButtonDebug, debugLog } from './back-button-debug.js';

// ─── Re-export depuis mobile-state.js (compatibilité barrel) ─────────────────

export { isMobileView } from './mobile-state.js';

// ─── Initialisation ───────────────────────────────────────────────────────────

export function initMobileMode() {
    document.body.classList.add('mobile-mode');

    // Hack Android/iOS : masquer la barre d'adresse
    setTimeout(() => { window.scrollTo(0, 1); }, 0);

    // ─── Diagnostic C7 ────────────────────────────────────────────────────────
    // Logger on-screen des événements navigation (popstate / hashchange /
    // Navigation API / pageshow / visibilitychange). Activé en mode admin ou
    // via ?debug-back=1. À retirer une fois C7 résolu.
    initBackButtonDebug();

    // ─── Bouton Retour Android ────────────────────────────────────────────────
    // Cause : pushState avec URL vide ('' ) n'est pas reconnu comme une vraie
    // navigation par Android Chrome PWA → popstate ne se déclenche pas.
    // Solution : pushState avec un fragment (#back) crée une vraie diff d'URL,
    // ce qui inscrit l'entrée dans la pile native Android et déclenche hashchange.
    const HW_BACK_HASH = '#back';

    function _pushBackSentinel() {
        history.pushState({ hwSentinel: true }, '', HW_BACK_HASH);
    }

    // Installation initiale
    _pushBackSentinel();

    // Gestionnaire unique appelé par popstate OU hashchange
    // Navigation à 3 niveaux :
    //   POI ouvert          → retour à la liste POIs du circuit (ou circuits)
    //   circuit-details     → retour à Mes Circuits
    //   search / actions    → retour à Mes Circuits
    //   circuits (racine)   → sentinelle non réinjectée → prochain Back minimise
    let _backHandled = false;
    function _onHwBack(evt) {
        try {
            debugLog('handler:enter', { via: evt?.type || '?', handled: _backHandled });
            // Déduplication : les deux événements peuvent se déclencher ensemble
            if (_backHandled) { debugLog('handler:skip-dedup'); return; }
            _backHandled = true;
            setTimeout(() => { _backHandled = false; }, 100);

            if (!isMobileView()) { debugLog('handler:skip-desktop'); return; }

            const view = getCurrentView();
            const hasPoi = state.currentFeatureId !== null;
            debugLog('handler:view-check', { view, poi: hasPoi });

            // Niveau 3 : POI ouvert → fermer le panneau et revenir à la liste
            // précédente (POIs du circuit si on était dans un circuit, sinon
            // liste des circuits). closeDetailsPanel réinitialise
            // state.currentFeatureId = null pour nous.
            if (hasPoi) {
                _pushBackSentinel();
                closeDetailsPanel(!!state.activeCircuitId);
                debugLog('handler:poi-closed', { toList: !!state.activeCircuitId });
                return;
            }

            // Niveau 2 : dans un circuit → retour à Mes Circuits
            if (view === 'circuit-details') {
                _pushBackSentinel();
                clearCircuit(false);
                switchMobileView('circuits');
                debugLog('handler:circuit-cleared');
                return;
            }

            // Niveau 2 bis : search / actions / add-poi → retour Mes Circuits
            if (view !== 'circuits') {
                _pushBackSentinel();
                switchMobileView('circuits');
                debugLog('handler:switched-to-root');
                return;
            }

            // Niveau 1 (racine) : sentinelle non ré-injectée → prochain Back minimise
            debugLog('handler:at-root');
        } catch (err) {
            debugLog('handler:ERROR', { msg: String(err?.message || err).slice(0, 60) });
        }
    }

    window.addEventListener('popstate', _onHwBack);
    window.addEventListener('hashchange', _onHwBack);

    // ─── Swipe horizontal sur le container mobile ─────────────────────────────

    let _swipeStartX = 0, _swipeStartY = 0;
    DOM.mobileMainContainer.addEventListener('touchstart', e => {
        _swipeStartX = e.touches[0].clientX;
        _swipeStartY = e.touches[0].clientY;
    }, { passive: true });

    DOM.mobileMainContainer.addEventListener('touchend', e => {
        const dx = _swipeStartX - e.changedTouches[0].clientX;
        const dy = _swipeStartY - e.changedTouches[0].clientY;
        if (Math.abs(dx) <= 60 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;

        if (state.currentFeatureId !== null && state.currentCircuit?.length > 1) {
            // Vue détail POI → naviguer entre POIs
            navigatePoiDetails(dx > 0 ? 1 : -1);
        } else if (
            getCurrentView() === 'circuit-details' &&
            state.activeCircuitId &&
            getAllCircuitsOrdered().length > 1
        ) {
            // Vue liste POI d'un circuit → naviguer entre circuits
            const ordered = getAllCircuitsOrdered();
            const idx = ordered.findIndex(c => c.id === state.activeCircuitId);
            const nextIdx = idx + (dx > 0 ? 1 : -1);
            if (nextIdx >= 0 && nextIdx < ordered.length) {
                loadCircuitById(ordered[nextIdx].id);
            }
        }
    });

    // ─── Boutons de navigation du dock ────────────────────────────────────────

    const navButtons = document.querySelectorAll('.mobile-nav-btn[data-view]');
    navButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            switchMobileView(btn.dataset.view);
        });

        // Appui long (600 ms) sur ⚙ Menu → login admin
        if (btn.dataset.view === 'actions') {
            let longPressTimer = null;
            btn.addEventListener('touchstart', () => {
                longPressTimer = setTimeout(() => {
                    longPressTimer = null;
                    if (!state.isAdmin) showAdminLoginModal();
                }, 600);
            }, { passive: true });
            btn.addEventListener('touchend', () => {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            });
            btn.addEventListener('touchmove', () => {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            }, { passive: true });
        }
    });

    // ─── Bouton filtre (Œil / liste) ──────────────────────────────────────────

    const filterBtn = document.getElementById('btn-mobile-filter');
    if (filterBtn) {
        // Clone pour supprimer les anciens écouteurs
        const newFilterBtn = filterBtn.cloneNode(true);
        filterBtn.parentNode.replaceChild(newFilterBtn, filterBtn);

        newFilterBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            state.filterCompleted = !state.filterCompleted;

            const iconName = state.filterCompleted ? 'list-check' : 'list';
            const labelText = state.filterCompleted ? 'A faire' : 'Tout';
            const colorStyle = state.filterCompleted ? 'color:var(--brand);' : '';

            newFilterBtn.style = colorStyle;
            newFilterBtn.innerHTML = `
                <i data-lucide="${iconName}"></i>
                <span>${labelText}</span>
            `;

            if (getCurrentView() === 'circuits') {
                renderMobileCircuitsList();
            } else {
                switchMobileView('circuits');
            }

            createIcons({ icons: appIcons, root: newFilterBtn });
        });
    }

    switchMobileView('circuits');
}

// ─── Routeur de vues ──────────────────────────────────────────────────────────

export function switchMobileView(viewName) {
    setCurrentView(viewName);
    if (viewName === 'circuits') {
        setMobileCurrentPage(1);
    }

    // Mise à jour des boutons du dock
    document.querySelectorAll('.mobile-nav-btn[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    const container = document.getElementById('mobile-main-container');
    container.innerHTML = '';
    animateContainer(container);

    // Dock toujours visible sauf si renderMobilePoiList le masque
    const dock = document.getElementById('mobile-dock');
    if (dock) dock.style.display = 'flex';

    switch (viewName) {
        case 'circuits':
            renderMobileCircuitsList();
            break;
        case 'search':
            renderMobileSearch();
            break;
        case 'add-poi':
            handleAddPoiClick();
            break;
        case 'actions':
            renderMobileMenu();
            break;
    }

    createIcons({ icons: appIcons, root: container });
}

// ─── Ajout d'un POI par GPS ───────────────────────────────────────────────────

async function handleAddPoiClick() {
    if (!await showConfirm(
        "Nouveau Lieu",
        "Capturer votre position GPS actuelle pour créer un nouveau lieu ?",
        "Capturer", "Annuler"
    )) {
        switchMobileView('circuits');
        return;
    }

    showToast("Acquisition GPS en cours...", "info");

    if (!navigator.geolocation) {
        showToast("GPS non supporté par ce navigateur.", "error");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const { latitude, longitude } = pos.coords;
            const newPoiId = `HW-MOB-${Date.now()}`;

            // Détection automatique de la zone via les polygones
            let detectedZone = "Hors Zone";
            if (zonesData && zonesData.features) {
                for (const feature of zonesData.features) {
                    if (feature.geometry && feature.geometry.type === "Polygon") {
                        const polygonCoords = feature.geometry.coordinates[0];
                        if (isPointInPolygon([longitude, latitude], polygonCoords)) {
                            detectedZone = feature.properties.name;
                            break;
                        }
                    }
                }
            }

            const newFeature = {
                type: "Feature",
                geometry: { type: "Point", coordinates: [longitude, latitude] },
                properties: {
                    "Nom du site FR": "Nouveau Lieu",
                    "Catégorie": "A définir",
                    "Zone": detectedZone,
                    "Description": "Créé sur le terrain",
                    "HW_ID": newPoiId,
                    "created_at": new Date().toISOString()
                }
            };

            addPoiFeature(newFeature);
            await saveAppState('lastGeoJSON', {
                type: 'FeatureCollection',
                features: state.loadedFeatures
            });

            showToast(`Lieu créé (Zone : ${detectedZone})`, "success");

            const index = state.loadedFeatures.length - 1;
            openDetailsPanel(index);
        },
        (err) => {
            console.error(err);
            showToast("Erreur GPS : " + err.message, "error");
            switchMobileView('circuits');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// ─── Vue Recherche ────────────────────────────────────────────────────────────

export function renderMobileSearch() {
    const container = document.getElementById('mobile-main-container');
    container.style.display = '';
    container.style.flexDirection = '';
    container.style.overflow = '';

    container.innerHTML = `
        <div class="mobile-view-header mobile-header-harmonized">
            <h1>Rechercher</h1>
        </div>
        <div class="mobile-search mobile-search-container mobile-standard-padding">
            <div class="mobile-search-wrapper">
                <i data-lucide="search" class="search-icon mobile-search-icon"></i>
                <input type="text" id="mobile-search-input" placeholder="Nom du lieu..."
                    class="mobile-search-input">
            </div>
            <div id="mobile-search-results" class="mobile-list mobile-search-results"></div>
        </div>
    `;

    const input = document.getElementById('mobile-search-input');
    const resultsContainer = document.getElementById('mobile-search-results');

    input.addEventListener('input', (e) => {
        const term = e.target.value;
        if (!term || term.length < 2) {
            resultsContainer.innerHTML = '';
            return;
        }

        const matches = getSearchResults(term);
        let html = '';
        matches.forEach(f => {
            const iconHtml = getIconForFeature(f);
            html += `
                <button class="mobile-list-item result-item" data-id="${getPoiId(f)}">
                    <div class="mobile-search-result-icon">
                        ${iconHtml}
                    </div>
                    <span>${escapeHtml(getPoiName(f))}</span>
                </button>
            `;
        });
        resultsContainer.innerHTML = sanitizeHTML(html);
        createIcons({ icons: appIcons, root: resultsContainer });

        resultsContainer.querySelectorAll('.result-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const feature = state.loadedFeatures.find(f => getPoiId(f) === btn.dataset.id);
                const index = state.loadedFeatures.indexOf(feature);
                openDetailsPanel(index);
            });
        });
    });

    input.focus();
}
