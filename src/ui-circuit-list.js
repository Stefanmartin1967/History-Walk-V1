import { state } from './state.js';
import { escapeXml } from './utils.js';
import { eventBus } from './events.js';
import { showConfirm, showCustomModal, closeModal } from './modal.js';
import { createIcons, icons } from 'lucide';
import { getProcessedCircuits, getAvailableZonesFromCircuits } from './circuit-list-service.js';
import { handleCircuitVisitedToggle } from './circuit-actions.js';
import { applyFilters } from './data.js';

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
        if(state.activeFilters) state.activeFilters.zone = null;
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
        if(state.activeFilters) state.activeFilters.zone = null;
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
            if(state.activeFilters) state.activeFilters.zone = zone;
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

    const processedCircuits = getProcessedCircuits(currentSort, filterTodo, globalZoneFilter);

    // --- PAGINATION LOGIC ---
    let listHeight = 0;

    // Always use the panel height as the source of truth, not the listContainer itself,
    // because the listContainer shrinks when it has fewer items (e.g., on the last page).
    const panelExplorer = document.getElementById('panel-explorer');
    const header = document.querySelector('.explorer-header');
    const footer = document.querySelector('.explorer-footer');

    if (panelExplorer && header && footer) {
        // Available space = total panel - header - footer - (optional padding of container)
        // Default gap is 10px, padding is 12px (top and bottom) -> ~24px
        listHeight = panelExplorer.clientHeight - header.clientHeight - footer.clientHeight - 24;
    } else {
        // Fallback if elements aren't rendered yet
        listHeight = listContainer.clientHeight || 500;
    }

    // Item height is roughly 72px (padding 10*2 + border 1 + content height)
    const itemHeight = 72;

    // Calculate items per page, minimum 8
    let itemsPerPage = Math.max(1, Math.floor(listHeight / itemHeight));
    if (itemsPerPage < 3) itemsPerPage = 8;

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
    listContainer.innerHTML = (paginatedCircuits.length === 0)
        ? '<div style="padding:20px; text-align:center; color:var(--ink-soft);">Aucun circuit correspondant.</div>'
        : paginatedCircuits.map(c => {
            // Simplification du nom : Suppression des préfixes et du via
            let displayName = c.name.split(' via ')[0];
            displayName = displayName.replace(/^(Circuit de |Boucle de )/i, '');

            // Pas d'icône étoile pour gagner de la place (Demande utilisateur)

            // Actions : Suppression interdite pour les officiels (sauf Admin)
            // UPDATE: Masqué par défaut dans la liste pour éviter les erreurs. La suppression reste possible dans le détail.
            const deleteBtn = '';
            /*
            const deleteBtn = (!c.isOfficial || state.isAdmin)
                ? `<button class="explorer-item-delete" data-id="${c.id}" title="Supprimer" style="color:var(--danger); background:none; border:none; padding:4px;">
                        <i data-lucide="trash-2" style="width:16px; height:16px;"></i>
                   </button>`
                : '';
            */

            // Toggle Visited Logic
            const isCompleted = c._isCompleted;
            const toggleColor = isCompleted ? 'var(--ok)' : 'var(--line)'; // Gris clair si pas fait
            const toggleIcon = isCompleted ? 'check-circle' : 'circle';

            const toggleVisitedBtn = `
                <button class="explorer-item-action btn-toggle-visited" data-id="${c.id}" data-visited="${isCompleted}" title="${isCompleted ? 'Marquer comme non fait' : 'Marquer comme fait'}" style="color: ${toggleColor}; background:none; border:none; padding:4px;">
                    <i data-lucide="${toggleIcon}" style="width:24px; height:24px;"></i>
                </button>
            `;

            const restoIcon = c._hasRestaurant
                ? `<i data-lucide="utensils" style="width:14px; height:14px; vertical-align:text-bottom; margin-left:4px;" title="Restaurant présent"></i>`
                : '';

            // Style : Officiels en couleur brand, Personnels en noir. Police plus petite, 2 lignes max.
            const nameColor = c.isOfficial ? 'var(--primary)' : 'var(--ink)';
            const nameWeight = c.isOfficial ? '500' : '400';
            const nameStyle = `font-weight:${nameWeight}; font-size:14px; color:${nameColor}; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; white-space:normal; line-height:1.2;`;

            // UNIFIED "CARD" LAYOUT (Sidebar Version)
            return `
            <div class="explorer-item" data-id="${c.id}" style="display:flex; align-items:center; gap:8px; padding:10px; border-bottom:1px solid var(--line); cursor:pointer;">
                <!-- Left: Check -->
                <div style="flex-shrink:0;">
                    ${toggleVisitedBtn}
                </div>

                <!-- Center: Info -->
                <div class="explorer-item-content" style="flex:1; min-width:0;">
                    <div class="explorer-item-name" title="${escapeXml(c.name)}" style="${nameStyle}">
                        ${escapeXml(displayName)}
                    </div>
                    <div class="explorer-item-meta" style="font-size:12px; color:var(--ink-soft); display:flex; align-items:center; margin-top:2px;">
                        ${c._poiCount} POI • ${c._distDisplay} <i data-lucide="${c._iconName}" style="width:12px; height:12px; margin:0 3px;"></i> • ${c._zoneName}${restoIcon}
                    </div>
                </div>

                <!-- Right: Actions -->
                <div style="flex-shrink:0; display:flex; align-items:center;">
                    ${deleteBtn}
                </div>
            </div>
            `;
        }).join('');

    createIcons({ icons });

    // Event Listeners
    listContainer.querySelectorAll('.explorer-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Prevent triggering if clicked on action buttons
            if (e.target.closest('.explorer-item-delete') || e.target.closest('a') || e.target.closest('.btn-toggle-visited')) return;

            const id = item.dataset.id;
            eventBus.emit('circuit:request-load', id);
            eventBus.emit('ui:request-tab-change', 'circuit');
        });
    });

    listContainer.querySelectorAll('.explorer-item-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (await showConfirm("Suppression", "Voulez-vous vraiment supprimer ce circuit ?", "Supprimer", "Annuler", true)) {
                eventBus.emit('circuit:request-delete', id);
            }
        });
    });

    listContainer.querySelectorAll('.btn-toggle-visited').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const isCompleted = btn.dataset.visited === 'true';

            const result = await handleCircuitVisitedToggle(id, isCompleted);

            if (result.success) {
                // Refresh is triggered by eventBus 'circuit:list-updated' usually,
                // but handleCircuitVisitedToggle just updates the state.
                // We need to notify the app that the circuit changed.
                eventBus.emit('circuit:list-updated');
            }
        });
    });
}
