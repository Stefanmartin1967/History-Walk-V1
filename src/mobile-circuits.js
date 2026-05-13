// mobile-circuits.js
// Vue Mes Circuits mobile (refonte chantier mobile design — handoff Claude Design).
// Structure : .m-top header + .mc-search-row + .mc-list scrollable de .mc-card.
// Plus de pagination « 1/n » : la liste est scrollable. Toolbar 5-boutons remplacée
// par le bouton filtres (sliders icon) qui ouvre une modale unifiée (tri + zone
// + état + reset).

import { state, setActiveFilter, setFilterCompleted } from './state.js';
import { getPoiId, getPoiName } from './data.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { escapeHtml, sanitizeHTML, getZoneFromCoords } from './utils.js';
import { isCircuitTested, loadCircuitById } from './circuit.js';
import { handleCircuitVisitedToggle } from './circuit-actions.js';
import { getProcessedCircuits } from './circuit-list-service.js';
import { showCustomModal, closeModal } from './modal.js';
import { showToast } from './toast.js';
import {
    getMobileSort, setMobileSort,
    setCurrentView, setAllCircuitsOrdered,
    pushMobileLevel,
    setMobileHeaderSlot,
    clearMobileViewFooter,
} from './mobile-state.js';
import { eventBus } from './events.js';

export function initMobileCircuitsListeners() {
    eventBus.on('mobile:render-circuits-list', () => renderMobileCircuitsList());
}

// Filtre POI clearable via chip (même logique que ui-circuit-list.js).
let mobilePoiFilterActive = true;
let mobileLastPoiId = null;

export function renderMobileCircuitsList() {
    const container = document.getElementById('mobile-main-container');

    // Vue Mes Circuits : pas de footer custom → clear le view-footer pour
    // restaurer le dock.
    clearMobileViewFooter();

    // Filtre POI courant (si on revient d'une fiche POI avec un POI sélectionné)
    let filterPoiId = null;
    let currentPoiFeature = null;
    let currentPoiId = null;
    if (state.currentFeatureId !== null && state.loadedFeatures[state.currentFeatureId]) {
        currentPoiFeature = state.loadedFeatures[state.currentFeatureId];
        currentPoiId = getPoiId(currentPoiFeature);
    }
    if (currentPoiId !== mobileLastPoiId) {
        mobilePoiFilterActive = true;
        mobileLastPoiId = currentPoiId;
    }
    if (currentPoiId && mobilePoiFilterActive) {
        filterPoiId = currentPoiId;
    }

    const circuitsToDisplay = getProcessedCircuits(
        getMobileSort(),
        state.filterCompleted,
        state.activeFilters.zone || null,
        filterPoiId
    );
    setAllCircuitsOrdered(circuitsToDisplay); // Mémorise pour le swipe entre circuits

    // ─── Header slot : .m-top + .mc-search-row ────────────────────────────────
    // .m-top-trail des deux côtés pour équilibrer (pas de croix « Fermer » —
    // Mes Circuits est la vue racine, rien à fermer). Le bouton filtres ouvre
    // la modale unifiée qui remplace l'ancienne toolbar 5-boutons.
    // Le champ recherche est un placeholder visuel pour cette PR — il sera
    // câblé fonctionnellement en PR 5 (Refonte Recherche).
    const headerHtml = `
        <div class="m-top">
            <div class="m-top-trail"></div>
            <div class="m-top-title">Mes Circuits</div>
            <div class="m-top-trail"></div>
        </div>
        <div class="mc-search-row">
            <div class="mc-search" role="search">
                <i data-lucide="search"></i>
                <span class="mc-search-placeholder">Rechercher un circuit ou un POI…</span>
            </div>
            <button class="mc-icon-btn" id="mobile-mc-filter-btn" aria-label="Filtres">
                <i data-lucide="sliders-horizontal"></i>
            </button>
        </div>
    `;
    setMobileHeaderSlot(sanitizeHTML(headerHtml));

    // ─── Body : liste des cartes circuit ──────────────────────────────────────
    let html = `<div class="mobile-list-container" id="mobile-circuits-list">`;

    // Chip « Filtré par : [POI] ✕ » au-dessus de la liste
    if (filterPoiId && currentPoiFeature) {
        const poiName = getPoiName(currentPoiFeature);
        html += `
            <div class="explorer-poi-filter-chip" id="mobile-poi-filter-chip">
                <i data-lucide="map-pin" class="icon-16"></i>
                <span class="explorer-poi-filter-chip-label">Filtré par : <strong>${escapeHtml(poiName)}</strong></span>
                <button type="button" class="explorer-poi-filter-chip-clear" id="mobile-poi-filter-chip-clear" title="Retirer le filtre" aria-label="Retirer le filtre">
                    <i data-lucide="x" class="icon-16"></i>
                </button>
            </div>
        `;
    }

    const hasAnyCircuits = (state.officialCircuits?.length || 0) + (state.myCircuits?.length || 0) > 0;

    if (!hasAnyCircuits) {
        html += `<p class="mobile-empty-state">
            Aucun circuit enregistré.<br>
            Utilisez le menu <b>Menu &gt; Restaurer</b> pour charger une sauvegarde.
        </p>`;
    } else if (circuitsToDisplay.length === 0) {
        html += `<div class="mobile-finished-state">
            <i data-lucide="check-circle" class="mobile-check-icon-large"></i>
            <p>Bravo ! Tout est terminé.</p>
            <button id="btn-reset-filter-inline" class="mobile-reset-filter-btn">
                Tout afficher
            </button>
        </div>`;
    } else {
        html += `<div class="mc-list">`;
        circuitsToDisplay.forEach(circuit => {
            const displayName = circuit.name
                .split(' via ')[0]
                .replace(/^(Circuit de |Boucle de )/i, '');
            const isDone = circuit._isCompleted;
            const isActive = state.activeCircuitId === circuit.id;
            const isTested = circuit.isOfficial && isCircuitTested(circuit.id);
            const flag = circuit.isOfficial
                ? (isTested ? 'verified' : 'official')
                : 'none';
            const flagText = flag === 'verified' ? 'OFFICIEL · VÉRIFIÉ'
                          : flag === 'official' ? 'OFFICIEL'
                          : '';
            const kmNum = (circuit._distDisplay || '').replace(/\s*km\s*$/i, '');

            html += `
                <article class="mc-card${isDone ? ' is-done' : ''}${isActive ? ' is-active' : ''}" data-flag="${flag}" data-id="${circuit.id}" role="button" tabindex="0">
                    <div class="mc-line1">
                        <h3 class="mc-title">${escapeHtml(displayName)}</h3>
                        <button type="button" class="mc-done mobile-toggle-visited" data-id="${circuit.id}" data-visited="${isDone}" aria-label="Marquer comme visité" title="Marquer comme visité">
                            <i data-lucide="${isDone ? 'check-circle' : 'circle'}"></i>
                        </button>
                    </div>
                    <div class="mc-meta">
                        <span class="mc-stat"><b>${circuit._poiCount}</b> POI</span>
                        <span class="mc-stat"><b>${kmNum}</b> km</span>
                        ${circuit._zoneName ? `<span class="mc-zone">${escapeHtml(circuit._zoneName)}</span>` : ''}
                        ${circuit._hasRestaurant ? `<span class="mc-resto"><i data-lucide="utensils"></i>Resto</span>` : ''}
                    </div>
                    ${flagText ? `<div class="mc-flag"><span class="dot"></span>${flagText}</div>` : ''}
                </article>
            `;
        });
        html += `</div>`;
    }

    html += `</div>`;
    container.innerHTML = sanitizeHTML(html);

    // ─── Icons + event listeners ──────────────────────────────────────────────
    const headerSlot = document.getElementById('mobile-header-slot');
    if (headerSlot) createIcons({ icons: appIcons, root: headerSlot });
    createIcons({ icons: appIcons, root: container });

    // Filtres : ouvre la modale unifiée (tri + zone + état + reset)
    const filterBtn = document.getElementById('mobile-mc-filter-btn');
    if (filterBtn) filterBtn.addEventListener('click', () => renderMobileFiltersMenu());

    // Chip POI : clear
    const chipClearBtn = document.getElementById('mobile-poi-filter-chip-clear');
    if (chipClearBtn) {
        chipClearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            mobilePoiFilterActive = false;
            renderMobileCircuitsList();
        });
    }

    // Bouton « Tout afficher » de l'état « tout terminé »
    const resetBtn = document.getElementById('btn-reset-filter-inline');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            setFilterCompleted(false);
            setMobileSort('date_desc');
            renderMobileCircuitsList();
        });
    }

    // Clic sur une carte : ouvre le circuit (sauf clic sur le toggle « fait »)
    container.querySelectorAll('.mc-card').forEach(card => {
        card.addEventListener('click', async (e) => {
            const toggleBtn = e.target.closest('.mobile-toggle-visited');
            if (toggleBtn) {
                e.stopPropagation();
                const id = toggleBtn.dataset.id;
                const isVisited = toggleBtn.dataset.visited === 'true';
                const result = await handleCircuitVisitedToggle(id, isVisited);
                if (result.success) {
                    renderMobileCircuitsList();
                }
                return;
            }
            if (e.target.closest('a')) return;
            const id = card.dataset.id;
            pushMobileLevel('c'); // Proactif C7 : pousser entrée avant descente
            setCurrentView('circuit-details'); // Autorise renderMobilePoiList
            await loadCircuitById(id);
        });
    });
}

// ─── Modale filtres unifiée (remplace l'ancienne toolbar 5-boutons) ──────────
// Trois sections : Tri / Zone / État. Footer : bouton « Réinitialiser » qui
// rétablit les valeurs par défaut. Chaque sélection ferme la modale et
// re-render la liste.
function renderMobileFiltersMenu() {
    const content = document.createElement('div');
    content.className = 'mobile-filters-menu';

    // ── Section 1 : Tri ────────────────────────────────────────────────
    const sortSection = document.createElement('div');
    sortSection.className = 'mobile-filters-section';
    sortSection.innerHTML = '<h4 class="mobile-filters-section-title">Tri</h4>';
    const currentSort = getMobileSort();
    const sortOptions = [
        { id: 'date_desc',     label: 'Plus récents',           icon: 'arrow-down-narrow-wide' },
        { id: 'dist_asc',      label: 'Distance croissante',    icon: 'arrow-down-0-1' },
        { id: 'dist_desc',     label: 'Distance décroissante',  icon: 'arrow-up-1-0' },
        { id: 'proximity_asc', label: 'Proximité (résidence)',  icon: 'home', requiresHome: true },
    ];
    sortOptions.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = `mobile-list-item${currentSort === opt.id ? ' mobile-filters-item--active' : ''}`;
        btn.innerHTML = `<i data-lucide="${opt.icon}"></i><span>${opt.label}</span>`;
        btn.onclick = () => {
            if (opt.requiresHome && !state.homeLocation) {
                showToast("Définissez votre lieu de résidence dans Mon Espace pour activer ce tri.", 'info', 4500);
                return;
            }
            setMobileSort(opt.id);
            closeModal();
            renderMobileCircuitsList();
        };
        sortSection.appendChild(btn);
    });
    content.appendChild(sortSection);

    // ── Section 2 : Zone ────────────────────────────────────────────────
    const zonesMap = {};
    const allCircuits = [...(state.officialCircuits || []), ...(state.myCircuits || [])];
    allCircuits.forEach(c => {
        const validPois = (c.poiIds || [])
            .map(id => state.loadedFeatures.find(f => getPoiId(f) === id))
            .filter(f => f);
        if (validPois.length > 0) {
            const [lng, lat] = validPois[0].geometry.coordinates;
            const z = getZoneFromCoords(lat, lng);
            if (z) zonesMap[z] = (zonesMap[z] || 0) + 1;
        }
    });
    const sortedZones = Object.keys(zonesMap).sort();

    const zoneSection = document.createElement('div');
    zoneSection.className = 'mobile-filters-section';
    zoneSection.innerHTML = '<h4 class="mobile-filters-section-title">Zone</h4>';

    const btnAllZones = document.createElement('button');
    btnAllZones.className = `mobile-list-item${!state.activeFilters.zone ? ' mobile-filters-item--active' : ''}`;
    btnAllZones.innerHTML = `<i data-lucide="map-pin"></i><span>Toutes les zones</span>`;
    btnAllZones.onclick = () => {
        setActiveFilter('zone', null);
        closeModal();
        renderMobileCircuitsList();
    };
    zoneSection.appendChild(btnAllZones);

    sortedZones.forEach(zone => {
        const btn = document.createElement('button');
        btn.className = `mobile-list-item${state.activeFilters.zone === zone ? ' mobile-filters-item--active' : ''}`;
        btn.innerHTML = `<i data-lucide="map-pin"></i><span class="mobile-zone-btn-inner">${escapeHtml(zone)}</span><span class="mobile-zone-btn-count">${zonesMap[zone]}</span>`;
        btn.onclick = () => {
            setActiveFilter('zone', zone);
            closeModal();
            renderMobileCircuitsList();
        };
        zoneSection.appendChild(btn);
    });
    content.appendChild(zoneSection);

    // ── Section 3 : État (À faire uniquement) ──────────────────────────
    const todoSection = document.createElement('div');
    todoSection.className = 'mobile-filters-section';
    todoSection.innerHTML = '<h4 class="mobile-filters-section-title">État</h4>';
    const btnTodo = document.createElement('button');
    btnTodo.className = `mobile-list-item${state.filterCompleted ? ' mobile-filters-item--active' : ''}`;
    btnTodo.innerHTML = `<i data-lucide="${state.filterCompleted ? 'list-checks' : 'list-todo'}"></i><span>${state.filterCompleted ? 'Tout afficher' : 'À faire uniquement'}</span>`;
    btnTodo.onclick = () => {
        setFilterCompleted(!state.filterCompleted);
        closeModal();
        renderMobileCircuitsList();
    };
    todoSection.appendChild(btnTodo);
    content.appendChild(todoSection);

    // Footer : bouton Réinitialiser
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn-ghost';
    resetBtn.innerHTML = '<i data-lucide="rotate-ccw"></i> Réinitialiser';
    resetBtn.onclick = () => {
        setMobileSort('date_desc');
        setFilterCompleted(false);
        setActiveFilter('zone', null);
        closeModal();
        renderMobileCircuitsList();
    };

    showCustomModal("Filtres", content, resetBtn);

    // Les icônes Lucide ne sont rendues que lorsque le contenu est dans le DOM
    // (showCustomModal attache content puis affiche). On hydrate après la frame.
    requestAnimationFrame(() => {
        createIcons({ icons: appIcons, root: content });
        if (resetBtn.isConnected) createIcons({ icons: appIcons, root: resetBtn });
    });
}
