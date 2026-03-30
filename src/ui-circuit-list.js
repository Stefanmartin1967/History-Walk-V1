import { state, setActiveFilters } from './state.js';
import { escapeXml, sanitizeHTML } from './utils.js';
import { eventBus } from './events.js';
import { showConfirm, showCustomModal, closeModal } from './modal.js';
import { createIcons, icons } from 'lucide';
import { getProcessedCircuits, getAvailableZonesFromCircuits } from './circuit-list-service.js';
import { handleCircuitVisitedToggle } from './circuit-actions.js';
import { applyFilters, getPoiId } from './data.js';

// --- LOCAL STATE ---
// Sort: 'date_desc', 'date_asc', 'dist_asc', 'dist_desc'
let currentSort = 'date_desc';
let filterTodo = false; // true = Show only circuits with unvisited points
let explorerCurrentPage = 1;

export function initCircuitListUI() {
    eventBus.on('circuit:list-updated', () => {
        // Also refresh explorer list if it exists
        if (document.getElementById('explorer-list')) {
            renderExplorerList();
        }
    });

    // Écouter le changement de mode Admin pour afficher/masquer les poubelles
    eventBus.on('admin:mode-toggled', () => {
        if (document.getElementById('explorer-list')) {
            renderExplorerList();
        }
    });

    // Listen for global filter changes (like Zone) to refresh list
    eventBus.on('data:filtered', () => {
         if (document.getElementById('explorer-list')) {
            explorerCurrentPage = 1;
            renderExplorerList();
        }
    });

    // Initial render of header and toolbar
    renderExplorerHeader();
    renderExplorerToolbar();
}

// --- EXPLORER HEADER (SIMPLIFIED) ---
function renderExplorerHeader() {
    const header = document.querySelector('.explorer-header');
    if (!header) return;

    const mapName = state.currentMapId ? (state.currentMapId.charAt(0).toUpperCase() + state.currentMapId.slice(1)) : 'Circuits';

    header.innerHTML = `
        <div class="explorer-header-inner">
            <div class="explorer-pagination-group">
                <button class="action-button" id="explorer-prev-page" title="Page précédente" aria-label="Page précédente" disabled>
                    <i data-lucide="chevron-left" class="icon-20"></i>
                </button>
                <span id="explorer-page-info" class="explorer-page-info">- / -</span>
                <button class="action-button" id="explorer-next-page" title="Page suivante" aria-label="Page suivante" disabled>
                    <i data-lucide="chevron-right" class="icon-20"></i>
                </button>
            </div>

            <h2 class="explorer-header-title">${mapName}</h2>

            <button class="action-button" id="close-explorer-btn" title="Fermer" aria-label="Fermer">
                <i data-lucide="x" class="icon-20"></i>
            </button>
        </div>
    `;

    const closeBtn = header.querySelector('#close-explorer-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
             const sidebar = document.getElementById('right-sidebar');
             if(sidebar) sidebar.style.display = 'none';
             document.body.classList.remove('sidebar-open');
        });
    }

    const prevBtn = header.querySelector('#explorer-prev-page');
    const nextBtn = header.querySelector('#explorer-next-page');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (explorerCurrentPage > 1) {
                explorerCurrentPage--;
                renderExplorerList();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            explorerCurrentPage++;
            renderExplorerList();
        });
    }

    createIcons({ icons });
}

// --- EXPLORER TOOLBAR (NEW) ---
function renderExplorerToolbar() {
    const panel = document.getElementById('panel-explorer');
    if (!panel) return;

    // Check if footer already exists
    let footer = panel.querySelector('.explorer-footer');
    if (!footer) {
        footer = document.createElement('div');
        footer.className = 'explorer-footer panel-footer'; // Reuse panel-footer style base
        panel.appendChild(footer);
    }

    // Determine Icons based on state
    const dateIcon = currentSort.startsWith('date')
        ? (currentSort === 'date_asc' ? 'calendar-arrow-up' : 'calendar-arrow-down')
        : 'calendar';

    const distIcon = currentSort.startsWith('dist')
        ? (currentSort === 'dist_desc' ? 'arrow-up-1-0' : 'arrow-down-0-1')
        : 'ruler';

    // FIX: Safely access state.activeFilters
    const zoneActive = !!(state.activeFilters && state.activeFilters.zone);

    footer.innerHTML = `
        <button id="btn-sort-date" class="footer-btn icon-only ${currentSort.startsWith('date') ? 'active' : ''}" title="Trier par date" aria-label="Trier par date">
            <i data-lucide="${dateIcon}"></i>
        </button>
        <button id="btn-sort-dist" class="footer-btn icon-only ${currentSort.startsWith('dist') ? 'active' : ''}" title="Trier par distance" aria-label="Trier par distance">
            <i data-lucide="${distIcon}"></i>
        </button>

        <div class="separator-vertical"></div>

        <button id="btn-filter-zone" class="footer-btn icon-only ${zoneActive ? 'active' : ''}" title="Filtrer par Zone" aria-label="Filtrer par Zone">
            <i data-lucide="map-pin"></i>
        </button>

        <button id="btn-filter-todo" class="footer-btn icon-only ${filterTodo ? 'active' : ''}" title="A faire" aria-label="A faire">
            <i data-lucide="${filterTodo ? 'list-todo' : 'list-checks'}"></i>
        </button>

        <div class="separator-vertical"></div>

        <button id="btn-reset-filters" class="footer-btn icon-only" title="Réinitialiser" aria-label="Réinitialiser">
            <i data-lucide="rotate-ccw"></i>
        </button>
    `;

    // Ensure icons are drawn immediately
    createIcons({ icons, root: footer });

    // Event Listeners (Must be re-attached as innerHTML cleared them)
    const btnDate = footer.querySelector('#btn-sort-date');
    if(btnDate) btnDate.onclick = () => {
        if (currentSort === 'date_desc') currentSort = 'date_asc';
        else currentSort = 'date_desc';
        refreshExplorer();
    };

    const btnDist = footer.querySelector('#btn-sort-dist');
    if(btnDist) btnDist.onclick = () => {
        if (currentSort === 'dist_asc') currentSort = 'dist_desc';
        else currentSort = 'dist_asc';
        refreshExplorer();
    };

    const btnZone = footer.querySelector('#btn-filter-zone');
    if(btnZone) btnZone.onclick = () => {
        openZonesModalPC();
    };

    const btnTodo = footer.querySelector('#btn-filter-todo');
    if(btnTodo) btnTodo.onclick = () => {
        filterTodo = !filterTodo;
        refreshExplorer();
    };

    const btnReset = footer.querySelector('#btn-reset-filters');
    if(btnReset) btnReset.onclick = () => {
        currentSort = 'date_desc';
        filterTodo = false;
        if(state.activeFilters) {
            setActiveFilters({ ...state.activeFilters, zone: null });
        }
        applyFilters();
        refreshExplorer();
    };
}

function openZonesModalPC() {
    const { zoneCounts, sortedZones } = getAvailableZonesFromCircuits();

    const content = document.createElement('div');
    content.className = 'zone-modal-list';

    // Option "Toutes"
    const btnAll = document.createElement('button');
    btnAll.className = 'zone-modal-btn';
    btnAll.innerHTML = `<span>Toutes les zones</span>`;
    btnAll.onclick = () => {
        if(state.activeFilters) {
            setActiveFilters({ ...state.activeFilters, zone: null });
        }
        applyFilters();
        closeModal();
    };
    content.appendChild(btnAll);

    sortedZones.forEach(zone => {
        const btn = document.createElement('button');
        btn.className = 'zone-modal-btn';
        btn.innerHTML = `<span>${escapeHtml(zone)}</span><span class="zone-count">${zoneCounts[zone]}</span>`;

        if (state.activeFilters && state.activeFilters.zone === zone) {
            btn.classList.add('active');
        }

        btn.onclick = () => {
            if(state.activeFilters) {
                setActiveFilters({ ...state.activeFilters, zone });
            }
            applyFilters();
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

function refreshExplorer() {
    explorerCurrentPage = 1; // Reset to page 1 when sort/filters change
    renderExplorerToolbar(); // Update icons/states
    renderExplorerList(); // Update list
}

export function renderExplorerList() {
    // Ensure header/toolbar are up to date
    const headerTitle = document.querySelector('.explorer-header h2');
    if (!headerTitle || (state.currentMapId && !headerTitle.textContent.includes(state.currentMapId.charAt(0).toUpperCase()))) {
         renderExplorerHeader();
    }
    if (!document.querySelector('.explorer-footer')) {
        renderExplorerToolbar();
    }

    const listContainer = document.getElementById('explorer-list');
    if (!listContainer) return;

    // --- USE SHARED SERVICE ---
    const globalZoneFilter = (state.activeFilters && state.activeFilters.zone) ? state.activeFilters.zone : null;

    let filterPoiId = null;
    if (state.currentFeatureId !== null && state.loadedFeatures[state.currentFeatureId]) {
        filterPoiId = getPoiId(state.loadedFeatures[state.currentFeatureId]);
    }

    const processedCircuits = getProcessedCircuits(currentSort, filterTodo, globalZoneFilter, filterPoiId);

    // --- PAGINATION LOGIC ---
    let listHeight = 0;

    const sidebar = document.getElementById('right-sidebar');
    const header = document.querySelector('.explorer-header');
    const footer = document.querySelector('.explorer-footer');
    const tabs = document.querySelector('.sidebar-tabs');

    if (sidebar && header && footer && tabs) {
        listHeight = sidebar.clientHeight - tabs.clientHeight - header.clientHeight - footer.clientHeight;
    } else {
        listHeight = window.innerHeight - 70 - 40 - 56 - 56;
    }

    const availableSpaceForItems = listHeight - 24;
    const itemHeight = 72;
    const gap = 10;

    let itemsPerPage = Math.max(1, Math.floor((availableSpaceForItems + gap) / (itemHeight + gap)));
    if (itemsPerPage < 3) itemsPerPage = 6;

    const totalPages = Math.max(1, Math.ceil(processedCircuits.length / itemsPerPage));
    if (explorerCurrentPage > totalPages) {
        explorerCurrentPage = totalPages;
    }

    // Update Header Pagination UI
    const prevBtn = document.getElementById('explorer-prev-page');
    const nextBtn = document.getElementById('explorer-next-page');
    const pageInfo = document.getElementById('explorer-page-info');

    if (pageInfo) {
        pageInfo.textContent = `${explorerCurrentPage} / ${totalPages}`;
    }
    if (prevBtn) {
        prevBtn.disabled = explorerCurrentPage <= 1;
    }
    if (nextBtn) {
        nextBtn.disabled = explorerCurrentPage >= totalPages;
    }

    const startIdx = (explorerCurrentPage - 1) * itemsPerPage;
    const paginatedCircuits = processedCircuits.slice(startIdx, startIdx + itemsPerPage);

    listContainer.innerHTML = '';

    if (paginatedCircuits.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'explorer-list-empty';
        emptyState.textContent = 'Aucun circuit correspondant.';
        listContainer.appendChild(emptyState);
        return;
    }

    paginatedCircuits.forEach(c => {
        // Simplification du nom : Suppression des préfixes et du via
        let displayName = c.name.split(' via ')[0];
        displayName = displayName.replace(/^(Circuit de |Boucle de )/i, '');

        const isCompleted = c._isCompleted;

        // --- Container Principal (.explorer-item) ---
        const itemContainer = document.createElement('div');
        itemContainer.className = 'explorer-item';
        itemContainer.dataset.id = c.id;

        itemContainer.addEventListener('click', (e) => {
            if (e.target.closest('.explorer-item-delete') || e.target.closest('a') || e.target.closest('.btn-toggle-visited')) return;
            eventBus.emit('circuit:request-load', c.id);
            eventBus.emit('ui:request-tab-change', 'circuit');
        });

        // --- Left: Check (Toggle Visited) ---
        const leftDiv = document.createElement('div');
        leftDiv.className = 'explorer-item-left';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = `explorer-item-action btn-toggle-visited${isCompleted ? ' completed' : ''}`;
        toggleBtn.dataset.id = c.id;
        toggleBtn.dataset.visited = isCompleted.toString();
        toggleBtn.title = isCompleted ? 'Marquer comme non fait' : 'Marquer comme fait';

        const toggleIconName = isCompleted ? 'check-circle' : 'circle';
        toggleBtn.innerHTML = `<i data-lucide="${toggleIconName}" class="icon-md"></i>`;

        toggleBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const result = await handleCircuitVisitedToggle(c.id, isCompleted);
            if (result.success) {
                eventBus.emit('circuit:list-updated');
            }
        });

        leftDiv.appendChild(toggleBtn);
        itemContainer.appendChild(leftDiv);

        // --- Center: Info ---
        const centerDiv = document.createElement('div');
        centerDiv.className = 'explorer-item-content';

        // Nom du circuit
        const nameDiv = document.createElement('div');
        nameDiv.className = `explorer-item-name${c.isOfficial ? ' explorer-item-name--official' : ''}`;
        nameDiv.title = c.name;
        nameDiv.textContent = displayName;

        centerDiv.appendChild(nameDiv);

        // Meta infos (POI, distance, icon, zone, resto)
        const metaDiv = document.createElement('div');
        metaDiv.className = 'explorer-item-meta';

        let metaHtml = `${c._poiCount} POI • ${escapeXml(c._distDisplay)} <i data-lucide="${c._iconName}" class="icon-meta"></i> • ${escapeXml(c._zoneName)}`;
        if (c._hasRestaurant) {
            metaHtml += ` <i data-lucide="utensils" class="icon-meta-extra" title="Restaurant présent"></i>`;
        }
        metaDiv.innerHTML = metaHtml;

        centerDiv.appendChild(metaDiv);
        itemContainer.appendChild(centerDiv);

        // --- Right: Actions ---
        const rightDiv = document.createElement('div');
        rightDiv.className = 'explorer-item-right';

        // Note: La suppression est masquée dans la vue liste actuellement.
        // Si elle est réactivée, le bouton peut être créé ici avec createElement.

        itemContainer.appendChild(rightDiv);

        listContainer.appendChild(itemContainer);
    });

    // Render icons for newly created DOM elements
    createIcons({ icons, root: listContainer });
}
