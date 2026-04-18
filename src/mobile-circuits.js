// mobile-circuits.js
// Rendu de la liste des circuits, toolbar de tri/filtres et sélecteur de zones

import { state } from './state.js';
import { getPoiId, getPoiName } from './data.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { escapeHtml, sanitizeHTML, getZoneFromCoords } from './utils.js';
import { isCircuitTested, loadCircuitById } from './circuit.js';
import { handleCircuitVisitedToggle } from './circuit-actions.js';
import { getProcessedCircuits } from './circuit-list-service.js';
import { showCustomModal, closeModal } from './modal.js';
import { showToast } from './toast.js';
import {
    animateContainer,
    getMobileSort, setMobileSort,
    getMobileCurrentPage, setMobileCurrentPage,
    setCurrentView, setAllCircuitsOrdered,
    pushMobileLevel,
} from './mobile-state.js';

// ─── Liste des circuits ───────────────────────────────────────────────────────

// Bug D (mobile) : filtre POI clearable via chip.
// Cf. ui-circuit-list.js — même logique de dismissal par POI.
let mobilePoiFilterActive = true;
let mobileLastPoiId = null;

export function renderMobileCircuitsList() {
    const container = document.getElementById('mobile-main-container');

    // Calcul de la liste filtrée/triée via le service partagé
    let filterPoiId = null;
    let currentPoiFeature = null;
    let currentPoiId = null;
    if (state.currentFeatureId !== null && state.loadedFeatures[state.currentFeatureId]) {
        currentPoiFeature = state.loadedFeatures[state.currentFeatureId];
        currentPoiId = getPoiId(currentPoiFeature);
    }
    // Reset dismissal quand le POI change
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

    // ─── Pagination dynamique ─────────────────────────────────────────────────

    const availableHeight = window.innerHeight - 280;
    const itemHeight = 75;
    const gap = 8;
    let itemsPerPage = Math.max(1, Math.floor((availableHeight + gap) / (itemHeight + gap)));
    if (itemsPerPage < 3) itemsPerPage = 5;

    const totalPages = Math.max(1, Math.ceil(circuitsToDisplay.length / itemsPerPage));
    let currentPage = getMobileCurrentPage();
    if (currentPage > totalPages) {
        currentPage = totalPages;
        setMobileCurrentPage(currentPage);
    }

    const startIdx = (currentPage - 1) * itemsPerPage;
    const paginatedCircuits = circuitsToDisplay.slice(startIdx, startIdx + itemsPerPage);

    // ─── Génération HTML ──────────────────────────────────────────────────────

    let html = `
        <div class="mobile-view-header mobile-header-harmonized mobile-circuits-header">
            <button class="action-button mobile-pagination-btn" id="mobile-prev-page" title="Page précédente" aria-label="Page précédente" ${currentPage <= 1 ? 'disabled' : ''}>
                <i data-lucide="chevron-left" class="icon-24"></i>
            </button>
            <div class="mobile-circuits-center">
                <h1>Mes Circuits</h1>
                <span id="mobile-page-info" class="mobile-page-info">${currentPage} / ${totalPages}</span>
            </div>
            <button class="action-button mobile-pagination-btn" id="mobile-next-page" title="Page suivante" aria-label="Page suivante" ${currentPage >= totalPages ? 'disabled' : ''}>
                <i data-lucide="chevron-right" class="icon-24"></i>
            </button>
        </div>
        <div id="mobile-toolbar-container"></div>
        <div class="panel-content mobile-standard-padding mobile-list-container" id="mobile-circuits-list">
    `;

    // Bug D (mobile) : chip "Filtré par : [POI] ✕" au-dessus de la liste
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
            Utilisez le menu <b>Menu > Restaurer</b> pour charger une sauvegarde.
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
        html += `<div class="mobile-list">`;
        paginatedCircuits.forEach(circuit => {
            const distDisplay = circuit._distDisplay;
            const zoneName = circuit._zoneName;
            let displayName = circuit.name.split(' via ')[0];
            displayName = displayName.replace(/^(Circuit de |Boucle de )/i, '');
            const total = circuit._poiCount;
            const done = circuit._visitedCount;
            const isDone = circuit._isCompleted;
            const iconName = circuit._iconName;

            const statusIcon = isDone
                ? `<i data-lucide="check-circle" class="icon-20 lucide" style="color:var(--ok);"></i>`
                : `<span class="mobile-status-badge">${done}/${total}</span>`;

            const isTested = isCircuitTested(circuit.id);
            const badgeHtml = circuit.isOfficial
                ? (isTested
                    ? '<i data-lucide="shield-check" class="icon-official-star icon-tested lucide" title="Testé sur le terrain"></i>'
                    : '<i data-lucide="star" class="icon-official-star lucide"></i>')
                : '';

            const restoIcon = circuit._hasRestaurant
                ? `<i data-lucide="utensils" class="icon-utensils-meta lucide"></i>`
                : '';

            const nameClass = circuit.isOfficial
                ? 'mobile-circuit-name mobile-circuit-name--official'
                : 'mobile-circuit-name';

            const visitedIcon = isDone ? 'check-circle' : 'circle';
            const toggleVisitedHtml = `
                <button type="button" class="mobile-toggle-visited mobile-check-btn ${isDone ? 'done' : 'todo'}" data-id="${circuit.id}" data-visited="${isDone}" aria-label="Marquer comme visité" title="Marquer comme visité">
                    <i data-lucide="${visitedIcon}" class="icon-24 lucide"></i>
                </button>
            `;

            html += `
                <div class="mobile-circuit-card-wrapper">
                    <div class="mobile-list-item circuit-item-mobile mobile-card-layout" data-id="${circuit.id}" role="button" tabindex="0">
                        ${toggleVisitedHtml}
                        <div class="mobile-circuit-info">
                            <div class="mobile-circuit-name-row">
                                <span class="${nameClass}">${escapeHtml(displayName)}</span>
                            </div>
                            <div class="mobile-card-meta">
                                ${total} POI • ${distDisplay} <i data-lucide="${iconName}" class="icon-map-meta lucide"></i> • ${zoneName}${restoIcon}
                            </div>
                        </div>
                        <div class="mobile-circuit-right"></div>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
    }

    html += `</div>`;
    container.innerHTML = sanitizeHTML(html);

    createIcons({ icons: appIcons, root: container });

    // Bug D (mobile) : handler du ✕ sur le chip de filtre POI
    const chipClearBtn = document.getElementById('mobile-poi-filter-chip-clear');
    if (chipClearBtn) {
        chipClearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            mobilePoiFilterActive = false;
            renderMobileCircuitsList();
        });
    }

    // ─── Event listeners — pagination ─────────────────────────────────────────

    const prevBtn = document.getElementById('mobile-prev-page');
    const nextBtn = document.getElementById('mobile-next-page');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (getMobileCurrentPage() > 1) {
                setMobileCurrentPage(getMobileCurrentPage() - 1);
                renderMobileCircuitsList();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (getMobileCurrentPage() < totalPages) {
                setMobileCurrentPage(getMobileCurrentPage() + 1);
                renderMobileCircuitsList();
            }
        });
    }

    // Swipe gauche/droite pour changer de page
    const listEl = document.getElementById('mobile-circuits-list');
    if (listEl) {
        let swipeStartX = 0;
        listEl.addEventListener('touchstart', e => { swipeStartX = e.touches[0].clientX; }, { passive: true });
        listEl.addEventListener('touchend', e => {
            const delta = swipeStartX - e.changedTouches[0].clientX;
            if (Math.abs(delta) > 60) {
                if (delta > 0 && getMobileCurrentPage() < totalPages) {
                    setMobileCurrentPage(getMobileCurrentPage() + 1);
                    renderMobileCircuitsList();
                } else if (delta < 0 && getMobileCurrentPage() > 1) {
                    setMobileCurrentPage(getMobileCurrentPage() - 1);
                    renderMobileCircuitsList();
                }
            }
        });
    }

    renderMobileToolbar();

    // ─── Event listeners — filtres et circuits ────────────────────────────────

    const resetBtn = document.getElementById('btn-reset-filter-inline');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            state.filterCompleted = false;
            setMobileSort('date_desc');
            renderMobileCircuitsList();
        });
    }

    container.querySelectorAll('.circuit-item-mobile').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (e.target.closest('.mobile-download-btn')) {
                e.stopPropagation();
                return;
            }

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

            const id = btn.dataset.id;
            pushMobileLevel('c'); // Proactif C7 : pousser entrée avant descente
            setCurrentView('circuit-details'); // Autorise renderMobilePoiList
            await loadCircuitById(id);
        });
    });
}

// ─── Toolbar de tri/filtres ───────────────────────────────────────────────────

function renderMobileToolbar() {
    const container = document.getElementById('mobile-toolbar-container');
    if (!container) return;

    container.innerHTML = '';
    animateContainer(container);

    const toolbar = document.createElement('div');
    toolbar.id = 'mobile-toolbar';
    toolbar.className = 'mobile-toolbar';
    toolbar.style.display = 'flex';
    toolbar.style.justifyContent = 'space-around';

    const sort = getMobileSort();
    const proximityActive = sort === 'proximity_asc';
    const distIcon = sort.startsWith('dist')
        ? (sort === 'dist_desc' ? 'arrow-up-1-0' : 'arrow-down-0-1')
        : 'ruler';
    const zoneActive = !!state.activeFilters.zone;

    toolbar.innerHTML = `
        <button id="mob-sort-proximity" class="toolbar-btn ${proximityActive ? 'active' : ''}" title="Trier par proximité du lieu de résidence" aria-label="Trier par proximité">
            <i data-lucide="home"></i>
        </button>
        <button id="mob-sort-dist" class="toolbar-btn ${sort.startsWith('dist') ? 'active' : ''}">
            <i data-lucide="${distIcon}"></i>
        </button>
        <button id="mob-filter-zone" class="toolbar-btn ${zoneActive ? 'active' : ''}">
            <i data-lucide="map-pin"></i>
        </button>
        <button id="mob-filter-todo" class="toolbar-btn ${state.filterCompleted ? 'active' : ''}">
            <i data-lucide="${state.filterCompleted ? 'list-todo' : 'list-checks'}"></i>
        </button>
        <button id="mob-reset" class="toolbar-btn">
            <i data-lucide="rotate-ccw"></i>
        </button>
    `;

    container.appendChild(toolbar);
    createIcons({ icons: appIcons, root: toolbar });

    toolbar.querySelector('#mob-sort-proximity').onclick = () => {
        if (!state.homeLocation) {
            showToast(
                "Définissez votre lieu de résidence dans Mon Espace pour activer ce tri.",
                'info',
                4500
            );
            return;
        }
        setMobileSort('proximity_asc');
        renderMobileCircuitsList();
    };
    toolbar.querySelector('#mob-sort-dist').onclick = () => {
        setMobileSort(getMobileSort() === 'dist_asc' ? 'dist_desc' : 'dist_asc');
        renderMobileCircuitsList();
    };
    toolbar.querySelector('#mob-filter-zone').onclick = () => {
        renderMobileZonesMenu();
    };
    toolbar.querySelector('#mob-filter-todo').onclick = () => {
        state.filterCompleted = !state.filterCompleted;
        renderMobileCircuitsList();
    };
    toolbar.querySelector('#mob-reset').onclick = () => {
        setMobileSort('proximity_asc');
        state.filterCompleted = false;
        renderMobileCircuitsList();
    };
}

// ─── Sélecteur de zones ───────────────────────────────────────────────────────

function renderMobileZonesMenu() {
    // Calcul des zones disponibles à partir de l'ensemble des circuits
    const zonesMap = {};
    const allCircuits = [...(state.officialCircuits || []), ...(state.myCircuits || [])];

    allCircuits.forEach(c => {
        const validPois = c.poiIds
            .map(id => state.loadedFeatures.find(feat => getPoiId(feat) === id))
            .filter(f => f);

        if (validPois.length > 0) {
            const startPoi = validPois[0];
            const [lng, lat] = startPoi.geometry.coordinates;
            const z = getZoneFromCoords(lat, lng);
            if (z) {
                zonesMap[z] = (zonesMap[z] || 0) + 1;
            }
        }
    });

    const sortedZones = Object.keys(zonesMap).sort();

    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '10px';
    content.style.maxHeight = '60vh';
    content.style.overflowY = 'auto';

    const btnAll = document.createElement('button');
    btnAll.className = 'mobile-list-item';
    btnAll.innerHTML = `<span>Toutes les zones</span>`;
    btnAll.onclick = () => {
        state.activeFilters.zone = null;
        renderMobileCircuitsList();
        closeModal();
    };
    content.appendChild(btnAll);

    sortedZones.forEach(zone => {
        const btn = document.createElement('button');
        btn.className = 'mobile-list-item';
        btn.innerHTML = `<span class="mobile-zone-btn-inner">${escapeHtml(zone)}</span> <span class="mobile-zone-btn-count">${zonesMap[zone]}</span>`;
        if (state.activeFilters.zone === zone) {
            btn.classList.add('mobile-zone-btn--active');
        }
        btn.onclick = () => {
            state.activeFilters.zone = zone;
            renderMobileCircuitsList();
            closeModal();
        };
        content.appendChild(btn);
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'custom-modal-btn secondary';
    closeBtn.textContent = 'Fermer';
    closeBtn.onclick = () => closeModal();

    showCustomModal("Filtrer par Zone", content, closeBtn);
}
