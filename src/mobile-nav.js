// mobile-nav.js
// Orchestrateur de navigation mobile : initialisation, routeur de vues et recherche

import { state, setFilterCompleted } from './state.js';
import { DOM } from './ui-dom.js';
import { openDetailsPanel, closeDetailsPanel } from './ui-details.js';
import { getPoiId, getPoiName, addPoiFeature, addPendingPoiFeature } from './data.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { getIconForFeature } from './poi-icons.js';
import { escapeHtml, sanitizeHTML, isPointInPolygon, getZoneFromCoords } from './utils.js';
import { zonesData } from './zones.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { getSearchResults } from './search.js';
import { eventBus } from './events.js';
import { showAdminLoginModal } from './admin.js';
import {
    isMobileView,
    getCurrentView, setCurrentView,
    getMobileCurrentPage, setMobileCurrentPage,
    getAllCircuitsOrdered,
    animateContainer,
    pushMobileLevel,
    resetMobileSlots,
    setMobileHeaderSlot,
} from './mobile-state.js';
import { renderMobileCircuitsList } from './mobile-circuits.js';
import { renderMobileMenu } from './mobile-menu.js';

// ─── Bouton Retour Android (pattern proactif) ────────────────────────────────
// Chaque navigation descendante (clic sur circuit, ouverture POI, bouton
// dock non-circuits) pousse une entrée d'historique avec un hash distinct
// via pushMobileLevel() dans mobile-state.js. Le Back matériel pop alors
// cette entrée, popstate fire, et onHwBack() ci-dessous lit l'état de
// l'app et rend le niveau correspondant — sans rien re-pousser dans le
// handler (évite le lock Chrome Android mid-popstate observé lors des
// tentatives précédentes du pattern réactif).
//
// Niveaux :
//   racine (circuits)        : pas de hash
//   circuit-details (POIs)   : #c
//   poi (fiche)              : #p
//   search/actions/add-poi   : #<view>
let _backHandled = false;
export function onHwBack() {
    // Déduplication : popstate + hashchange peuvent firer pour un même Back
    if (_backHandled) return;
    _backHandled = true;
    setTimeout(() => { _backHandled = false; }, 100);

    if (!isMobileView()) return;

    const hasPoi = state.currentFeatureId !== null;
    const view = getCurrentView();

    // Niveau 3 : POI ouvert → fermer le panneau (retour liste POIs ou circuits)
    if (hasPoi) {
        closeDetailsPanel(!!state.activeCircuitId);
        return;
    }

    // Niveau 2 : circuit-details → retour Mes Circuits
    if (view === 'circuit-details') {
        eventBus.emit('circuit:clear', false);
        switchMobileView('circuits');
        return;
    }

    // Niveau 2 bis : search/actions/add-poi → retour Mes Circuits
    if (view !== 'circuits') {
        switchMobileView('circuits');
        return;
    }

    // Racine : plus rien à pop → prochain Back minimise (comportement natif)
}

// ─── Initialisation ───────────────────────────────────────────────────────────

export function initMobileNavListeners() {
    eventBus.on('mobile:switch-view', (view) => switchMobileView(view));
}

export function initMobileMode() {
    document.body.classList.add('mobile-mode');

    // Hack Android/iOS : masquer la barre d'adresse
    setTimeout(() => { window.scrollTo(0, 1); }, 0);

    window.addEventListener('popstate', onHwBack);
    window.addEventListener('hashchange', onHwBack);

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
            eventBus.emit('circuit:navigate-poi', dx > 0 ? 1 : -1);
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
                eventBus.emit('circuit:request-load', ordered[nextIdx].id);
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

            setFilterCompleted(!state.filterCompleted);

            const iconName = state.filterCompleted ? 'list-check' : 'list';
            const labelText = state.filterCompleted ? 'A faire' : 'Tout';

            newFilterBtn.classList.toggle('is-filter-active', state.filterCompleted);
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
    // Proactif C7 : pousser une entrée d'historique pour toute navigation
    // depuis la racine vers un niveau 2 (search/actions/add-poi). Le Back
    // Android pop alors l'entrée et popstate handler rend la racine.
    // Ne rien pousser si on est déjà sur cette vue (anti-doublon) ou si on
    // redescend à 'circuits' (qui EST la racine).
    if (viewName !== 'circuits' && viewName !== getCurrentView()) {
        pushMobileLevel(viewName);
    }

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

    // Reset des slots dynamiques (header + view-footer) avant chaque switch.
    // Vider le view-footer restaure automatiquement le dock via CSS
    // (sélecteur `.mobile-view-footer:not(:empty) ~ #mobile-dock`).
    resetMobileSlots();

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

            // Persistance différée : on ajoute le POI en mémoire seulement.
            // La sauvegarde disque (customPois + lastGeoJSON) aura lieu uniquement
            // lorsque l'utilisateur aura édité au moins un champ. Si la fiche est
            // fermée sans modification, `closeDetailsPanel` jette le POI fantôme.
            addPendingPoiFeature(newFeature);

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

// ─── Vue Recherche (refonte PR 5 chantier design) ────────────────────────────
// Header dans le slot (.m-top + .search-bar). Body alterne entre 2 états :
//   - vide  : .search-empty-body avec catégories en grid 2 colonnes
//   - actif : .search-results avec highlight <mark> du terme tapé
// Sur input vide → empty state. Sur input non vide → results state (avec
// matches de getSearchResults). Clic sur une catégorie → résultats de la
// catégorie cliquée. Pas de section « Récents » (décision Stefan).

const SEARCH_CAT_VARIANTS = {
    'Mosquée':    ['mosquée', 'mosquee', 'synagogue', 'église', 'eglise'],
    'Curiosité':  ['curiosité', 'curiosite', 'site historique', 'panorama', 'point de vue'],
    'Hôtel':      ['hôtel', 'hotel'],
    'Restaurant': ['restaurant', 'café', 'cafe', 'pâtisserie', 'salon de thé'],
};

function getMobileSearchCatIcon(cat) {
    const lower = (cat || '').toLowerCase();
    if (lower === 'mosquée' || lower === 'mosquee') return 'moon-star';
    if (lower === 'synagogue' || lower === 'église' || lower === 'eglise') return 'landmark';
    if (lower === 'restaurant') return 'utensils';
    if (lower === 'café' || lower === 'cafe') return 'coffee';
    if (lower === 'curiosité' || lower === 'curiosite') return 'binoculars';
    if (lower === 'hôtel' || lower === 'hotel') return 'bed';
    if (lower === 'phare') return 'lightbulb';
    if (lower === 'panorama' || lower === 'point de vue') return 'mountain';
    if (lower === 'site historique' || lower === 'place historique') return 'landmark';
    return 'map-pin';
}

function countByCategory(label) {
    const variants = SEARCH_CAT_VARIANTS[label] || [label.toLowerCase()];
    return (state.loadedFeatures || []).filter(f => {
        const cat = (f?.properties?.['Catégorie'] || '').toLowerCase();
        return variants.includes(cat);
    }).length;
}

function getCategoryMatches(label) {
    const variants = SEARCH_CAT_VARIANTS[label] || [label.toLowerCase()];
    return (state.loadedFeatures || []).filter(f => {
        const cat = (f?.properties?.['Catégorie'] || '').toLowerCase();
        return variants.includes(cat);
    });
}

function highlightSearchTerm(name, term) {
    if (!term || term.length < 2) return escapeHtml(name);
    const lowerName = name.toLowerCase();
    const lowerTerm = term.toLowerCase();
    const idx = lowerName.indexOf(lowerTerm);
    if (idx < 0) return escapeHtml(name);
    return `${escapeHtml(name.slice(0, idx))}<mark>${escapeHtml(name.slice(idx, idx + term.length))}</mark>${escapeHtml(name.slice(idx + term.length))}`;
}

function renderMobileSearchEmpty(container) {
    const categories = [
        { id: 'Mosquée',    label: 'Lieux de culte',  icon: 'moon-star',  tone: 'brand' },
        { id: 'Curiosité',  label: 'Curiosités',      icon: 'binoculars', tone: 'amber' },
        { id: 'Hôtel',      label: 'Hôtels',          icon: 'bed',        tone: 'muted' },
        { id: 'Restaurant', label: 'Restos & cafés',  icon: 'utensils',   tone: 'amber' },
    ];

    let html = '<div class="search-empty-body"><div>';
    html += '<div class="search-section-title">Parcourir par catégorie</div>';
    html += '<div class="search-cat-grid">';
    categories.forEach(c => {
        const count = countByCategory(c.id);
        if (count === 0) return;
        html += `
            <button type="button" class="search-cat" data-cat="${escapeHtml(c.id)}">
                <div class="search-cat-ico ${c.tone}"><i data-lucide="${c.icon}"></i></div>
                <div>
                    <div class="search-cat-label">${escapeHtml(c.label)}</div>
                    <div class="search-cat-count">${count} lieu${count > 1 ? 'x' : ''}</div>
                </div>
            </button>
        `;
    });
    html += '</div></div></div>';
    container.innerHTML = html;
    createIcons({ icons: appIcons, root: container });

    container.querySelectorAll('.search-cat').forEach(btn => {
        btn.addEventListener('click', () => {
            const cat = btn.dataset.cat;
            const matches = getCategoryMatches(cat);
            // Reflète la sélection dans le champ pour cohérence visuelle + clear.
            const input = document.getElementById('mobile-search-input');
            const clearBtn = document.getElementById('mobile-search-clear');
            if (input) input.value = cat;
            if (clearBtn) clearBtn.hidden = false;
            // Pas de highlight pour les recherches par catégorie (le terme n'est
            // pas une sous-chaîne du nom du POI dans le cas général).
            renderMobileSearchResults(container, matches, null);
        });
    });
}

function renderMobileSearchResults(container, matches, term) {
    if (!matches || matches.length === 0) {
        container.innerHTML = `
            <div class="search-empty-body">
                <div class="search-no-result">
                    <i data-lucide="search-x"></i>
                    <p>Aucun résultat${term ? ` pour « ${escapeHtml(term)} »` : ''}</p>
                </div>
            </div>
        `;
        // search-x peut ne pas être dans appIcons — fallback en text si manquant
        createIcons({ icons: appIcons, root: container });
        return;
    }

    let html = `<div class="ms-results">`;
    html += `<div class="search-results-count">${matches.length} résultat${matches.length > 1 ? 's' : ''}</div>`;
    matches.forEach(f => {
        const poiId = getPoiId(f);
        const name = getPoiName(f);
        const cat = f?.properties?.['Catégorie'] || '';
        let zone = '';
        const coords = f?.geometry?.coordinates;
        if (coords && coords.length >= 2) {
            zone = getZoneFromCoords(coords[1], coords[0]) || '';
        }
        const meta = [zone, cat].filter(Boolean).join(' · ');
        const iconForCat = getMobileSearchCatIcon(cat);
        const highlightedName = term ? highlightSearchTerm(name, term) : escapeHtml(name);
        html += `
            <button type="button" class="search-result" data-id="${poiId}">
                <div class="search-result-ico"><i data-lucide="${iconForCat}"></i></div>
                <div class="search-result-main">
                    <div class="search-result-name">${highlightedName}</div>
                    ${meta ? `<div class="search-result-meta">${escapeHtml(meta)}</div>` : ''}
                </div>
                <span class="search-result-chev"><i data-lucide="chevron-right"></i></span>
            </button>
        `;
    });
    html += `</div>`;
    container.innerHTML = sanitizeHTML(html);
    createIcons({ icons: appIcons, root: container });

    container.querySelectorAll('.search-result').forEach(btn => {
        btn.addEventListener('click', () => {
            const feature = state.loadedFeatures.find(f => getPoiId(f) === btn.dataset.id);
            const index = state.loadedFeatures.indexOf(feature);
            if (index > -1) openDetailsPanel(index);
        });
    });
}

export function renderMobileSearch() {
    const container = document.getElementById('mobile-main-container');
    if (!container) return;
    container.style.display = '';
    container.style.flexDirection = '';
    container.style.overflow = '';

    // Vue Recherche : pas de footer custom → clear pour restaurer le dock.
    const viewFooter = document.getElementById('mobile-view-footer');
    if (viewFooter) viewFooter.innerHTML = '';

    const headerHtml = `
        <div class="m-top">
            <div class="m-top-trail"></div>
            <div class="m-top-title">Rechercher</div>
            <div class="m-top-trail"></div>
        </div>
        <div class="search-bar">
            <div class="search-input">
                <i data-lucide="search"></i>
                <input type="text" id="mobile-search-input" placeholder="Nom du lieu, circuit, zone…" autocomplete="off">
                <button type="button" class="search-clear" id="mobile-search-clear" aria-label="Effacer la recherche" hidden>
                    <i data-lucide="x"></i>
                </button>
            </div>
        </div>
    `;
    setMobileHeaderSlot(headerHtml);
    const headerSlot = document.getElementById('mobile-header-slot');
    if (headerSlot) createIcons({ icons: appIcons, root: headerSlot });

    // Empty state initial (catégories)
    renderMobileSearchEmpty(container);

    const input = document.getElementById('mobile-search-input');
    const clearBtn = document.getElementById('mobile-search-clear');

    input.addEventListener('input', (e) => {
        const term = e.target.value;
        const hasTerm = term.length > 0;
        clearBtn.hidden = !hasTerm;
        if (!hasTerm) {
            renderMobileSearchEmpty(container);
            return;
        }
        // Sous 2 caractères : on n'invoque pas la recherche (bruit) mais on
        // affiche un état neutre (les catégories disparaissent pour signaler
        // que l'utilisateur est en train de taper).
        if (term.length < 2) {
            container.innerHTML = '';
            return;
        }
        const matches = getSearchResults(term);
        renderMobileSearchResults(container, matches, term);
    });

    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.hidden = true;
        renderMobileSearchEmpty(container);
        input.focus();
    });

    input.focus();
}
