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

    // Header with Title, Pagination and Close Button
    header.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%; height: 100%; padding: 0 10px;">
            <div style="display:flex; align-items:center; gap:5px;">
                <button class="action-button" id="explorer-prev-page" title="Page précédente" style="background:none; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:4px;" disabled>
                    <i data-lucide="chevron-left" style="width:20px; height:20px;"></i>
                </button>
                <span id="explorer-page-info" style="font-size:14px; font-weight:500; color:var(--ink); min-width: 30px; text-align: center;">- / -</span>
                <button class="action-button" id="explorer-next-page" title="Page suivante" style="background:none; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:4px;" disabled>
                    <i data-lucide="chevron-right" style="width:20px; height:20px;"></i>
                </button>
            </div>

            <h2 style="margin:0; font-size:18px;">${mapName}</h2>

            <button class="action-button" id="close-explorer-btn" title="Fermer" style="background:none; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:4px;">
                <i data-lucide="x" style="width:20px; height:20px;"></i>
            </button>
        </div>
    `;

    const closeBtn = header.querySelector('#close-explorer-btn');
    if (closeBtn) {
        closeBtn.addEventListener('mouseenter', () => closeBtn.style.backgroundColor = 'var(--surface-hover)');
        closeBtn.addEventListener('mouseleave', () => closeBtn.style.backgroundColor = 'transparent');

        closeBtn.addEventListener('click', () => {
             const sidebar = document.getElementById('right-sidebar');
             if(sidebar) sidebar.style.display = 'none';
             document.body.classList.remove('sidebar-open');
        });
    }

    const prevBtn = header.querySelector('#explorer-prev-page');
    const nextBtn = header.querySelector('#explorer-next-page');

    if (prevBtn) {
        prevBtn.addEventListener('mouseenter', () => { if (!prevBtn.disabled) prevBtn.style.backgroundColor = 'var(--surface-hover)'; });
        prevBtn.addEventListener('mouseleave', () => prevBtn.style.backgroundColor = 'transparent');
        prevBtn.addEventListener('click', () => {
            if (explorerCurrentPage > 1) {
                explorerCurrentPage--;
                renderExplorerList();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('mouseenter', () => { if (!nextBtn.disabled) nextBtn.style.backgroundColor = 'var(--surface-hover)'; });
        nextBtn.addEventListener('mouseleave', () => nextBtn.style.backgroundColor = 'transparent');
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
        <button id="btn-sort-date" class="footer-btn icon-only ${currentSort.startsWith('date') ? 'active' : ''}" title="Trier par date">
            <i data-lucide="${dateIcon}"></i>
        </button>
        <button id="btn-sort-dist" class="footer-btn icon-only ${currentSort.startsWith('dist') ? 'active' : ''}" title="Trier par distance">
            <i data-lucide="${distIcon}"></i>
        </button>

        <div class="separator-vertical" style="display:block !important; height:20px; width:1px; background:var(--line); margin:0 4px;"></div>

        <button id="btn-filter-zone" class="footer-btn icon-only ${zoneActive ? 'active' : ''}" title="Filtrer par Zone" style="display:flex;">
            <i data-lucide="map-pin"></i>
        </button>

        <button id="btn-filter-todo" class="footer-btn icon-only ${filterTodo ? 'active' : ''}" title="A faire">
            <i data-lucide="${filterTodo ? 'list-todo' : 'list-checks'}"></i>
        </button>

        <div class="separator-vertical" style="display:block !important; height:20px; width:1px; background:var(--line); margin:0 4px;"></div>

        <button id="btn-reset-filters" class="footer-btn icon-only" title="Réinitialiser">
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

    // Construction de la modale
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '10px';
    content.style.maxHeight = '60vh';
    content.style.overflowY = 'auto';

    // Option "Toutes"
    const btnAll = document.createElement('button');
    btnAll.className = 'explorer-item'; // Reuse item style for buttons
    btnAll.style.padding = '10px';
    btnAll.style.textAlign = 'left';
    btnAll.style.background = 'var(--surface)';
    btnAll.style.border = '1px solid var(--line)';
    btnAll.style.borderRadius = '8px';
    btnAll.style.cursor = 'pointer';

    btnAll.innerHTML = `<span>Toutes les zones</span>`;
    btnAll.onclick = () => {
        if(state.activeFilters) {
            setActiveFilters({ ...state.activeFilters, zone: null });
        }
        applyFilters(); // Updates map and triggers list refresh
        closeModal();
    };
    content.appendChild(btnAll);

    sortedZones.forEach(zone => {
        const btn = document.createElement('button');
        btn.className = 'explorer-item';
        btn.style.padding = '10px';
        btn.style.textAlign = 'left';
        btn.style.background = 'var(--surface)';
        btn.style.border = '1px solid var(--line)';
        btn.style.borderRadius = '8px';
        btn.style.cursor = 'pointer';
        btn.style.display = 'flex';
        btn.style.justifyContent = 'space-between';

        btn.innerHTML = `<span>${zone}</span> <span style="font-weight:bold; color:var(--ink-soft);">${zoneCounts[zone]}</span>`;

        if (state.activeFilters && state.activeFilters.zone === zone) {
            btn.style.border = '2px solid var(--brand)';
            btn.style.background = 'var(--surface-muted)';
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

    // 3. Affichage via showCustomModal
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
    // Note: We use the global zone filter state here to ensure consistency
    const globalZoneFilter = (state.activeFilters && state.activeFilters.zone) ? state.activeFilters.zone : null;

    let filterPoiId = null;
    if (state.currentFeatureId !== null && state.loadedFeatures[state.currentFeatureId]) {
        filterPoiId = getPoiId(state.loadedFeatures[state.currentFeatureId]);
    }

    const processedCircuits = getProcessedCircuits(currentSort, filterTodo, globalZoneFilter, filterPoiId);

    // --- PAGINATION LOGIC ---
    let listHeight = 0;

    // Always use the fixed sidebar height as the source of truth, not the listContainer or panel itself,
    // because flex containers can shrink when their content shrinks (e.g., on the last page).
    const sidebar = document.getElementById('right-sidebar');
    const header = document.querySelector('.explorer-header');
    const footer = document.querySelector('.explorer-footer');
    const tabs = document.querySelector('.sidebar-tabs');

    // We calculate based on the rigid window/sidebar constraints to guarantee absolute stability across pages.
    if (sidebar && header && footer && tabs) {
        // Available space = fixed sidebar height - tabs - header - footer
        listHeight = sidebar.clientHeight - tabs.clientHeight - header.clientHeight - footer.clientHeight;
    } else {
        // Fallback: window height minus topbar (70px), tabs (~40px), header (~56px), footer (~56px)
        listHeight = window.innerHeight - 70 - 40 - 56 - 56;
    }

    // .explorer-list has padding: 12px (top & bottom) -> 24px total padding
    const availableSpaceForItems = listHeight - 24;

    // Item height is roughly 72px (padding 12*2 + border 1*2 + content height).
    // And .explorer-list has gap: 10px.
    // Formula for N items: N * itemHeight + (N - 1) * gap <= availableSpace
    // N * 72 + N * 10 - 10 <= availableSpace
    // N * 82 <= availableSpace + 10
    // N = Math.floor((availableSpaceForItems + 10) / 82)
    const itemHeight = 72;
    const gap = 10;

    let itemsPerPage = Math.max(1, Math.floor((availableSpaceForItems + gap) / (itemHeight + gap)));

    // Fallback just in case calculations yield 0 or something weird on tiny screens
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
        prevBtn.style.opacity = prevBtn.disabled ? '0.3' : '1';
        prevBtn.style.cursor = prevBtn.disabled ? 'default' : 'pointer';
    }
    if (nextBtn) {
        nextBtn.disabled = explorerCurrentPage >= totalPages;
        nextBtn.style.opacity = nextBtn.disabled ? '0.3' : '1';
        nextBtn.style.cursor = nextBtn.disabled ? 'default' : 'pointer';
    }

    const startIdx = (explorerCurrentPage - 1) * itemsPerPage;
    const paginatedCircuits = processedCircuits.slice(startIdx, startIdx + itemsPerPage);

    // 5. Render
    listContainer.innerHTML = '';

    if (paginatedCircuits.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.style.padding = '20px';
        emptyState.style.textAlign = 'center';
        emptyState.style.color = 'var(--ink-soft)';
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
        itemContainer.style.display = 'flex';
        itemContainer.style.alignItems = 'center';
        itemContainer.style.gap = '8px';
        itemContainer.style.padding = '10px';
        itemContainer.style.borderBottom = '1px solid var(--line)';
        itemContainer.style.cursor = 'pointer';

        // Event de clic sur l'item pour ouvrir le circuit
        itemContainer.addEventListener('click', (e) => {
            if (e.target.closest('.explorer-item-delete') || e.target.closest('a') || e.target.closest('.btn-toggle-visited')) return;
            eventBus.emit('circuit:request-load', c.id);
            eventBus.emit('ui:request-tab-change', 'circuit');
        });

        // --- Left: Check (Toggle Visited) ---
        const leftDiv = document.createElement('div');
        leftDiv.style.flexShrink = '0';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'explorer-item-action btn-toggle-visited';
        toggleBtn.dataset.id = c.id;
        toggleBtn.dataset.visited = isCompleted.toString();
        toggleBtn.title = isCompleted ? 'Marquer comme non fait' : 'Marquer comme fait';
        toggleBtn.style.color = isCompleted ? 'var(--ok)' : 'var(--line)';
        toggleBtn.style.background = 'none';
        toggleBtn.style.border = 'none';
        toggleBtn.style.padding = '4px';

        const toggleIconName = isCompleted ? 'check-circle' : 'circle';
        toggleBtn.innerHTML = `<i data-lucide="${toggleIconName}" style="width:24px; height:24px;"></i>`;

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
        centerDiv.style.flex = '1';
        centerDiv.style.minWidth = '0';

        // Nom du circuit
        const nameDiv = document.createElement('div');
        nameDiv.className = 'explorer-item-name';
        nameDiv.title = c.name;
        nameDiv.textContent = displayName;

        const nameColor = c.isOfficial ? 'var(--primary)' : 'var(--ink)';
        const nameWeight = c.isOfficial ? '500' : '400';
        nameDiv.style.fontWeight = nameWeight;
        nameDiv.style.fontSize = '14px';
        nameDiv.style.color = nameColor;
        nameDiv.style.display = '-webkit-box';
        nameDiv.style.WebkitLineClamp = '2';
        nameDiv.style.WebkitBoxOrient = 'vertical';
        nameDiv.style.overflow = 'hidden';
        nameDiv.style.whiteSpace = 'normal';
        nameDiv.style.lineHeight = '1.2';

        centerDiv.appendChild(nameDiv);

        // Meta infos (POI, distance, icon, zone, resto)
        const metaDiv = document.createElement('div');
        metaDiv.className = 'explorer-item-meta';
        metaDiv.style.fontSize = '12px';
        metaDiv.style.color = 'var(--ink-soft)';
        metaDiv.style.display = 'flex';
        metaDiv.style.alignItems = 'center';
        metaDiv.style.marginTop = '2px';

        // Construction du contenu HTML pour les meta (les spans/icons sont sûrs)
        let metaHtml = `${c._poiCount} POI • ${escapeXml(c._distDisplay)} <i data-lucide="${c._iconName}" style="width:12px; height:12px; margin:0 3px;"></i> • ${escapeXml(c._zoneName)}`;
        if (c._hasRestaurant) {
            metaHtml += ` <i data-lucide="utensils" style="width:14px; height:14px; vertical-align:text-bottom; margin-left:4px;" title="Restaurant présent"></i>`;
        }
        metaDiv.innerHTML = metaHtml;

        centerDiv.appendChild(metaDiv);
        itemContainer.appendChild(centerDiv);

        // --- Right: Actions (Delete Button placeholder) ---
        const rightDiv = document.createElement('div');
        rightDiv.style.flexShrink = '0';
        rightDiv.style.display = 'flex';
        rightDiv.style.alignItems = 'center';

        // Note: La suppression est masquée dans la vue liste actuellement,
        // le code était commenté. Si elle est réactivée, le bouton peut être
        // créé avec document.createElement et addEventListener ici.

        itemContainer.appendChild(rightDiv);

        // Ajout à la liste
        listContainer.appendChild(itemContainer);
    });

    // Render icons for newly created DOM elements
    createIcons({ icons, root: listContainer });
}
