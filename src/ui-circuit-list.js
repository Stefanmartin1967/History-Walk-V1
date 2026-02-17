import { state } from './state.js';
import { getPoiId } from './data.js';
import { escapeXml } from './utils.js';
import { eventBus } from './events.js';
import { showConfirm } from './modal.js';
import { getZoneFromCoords } from './utils.js';
import { getOrthodromicDistance, getRealDistance } from './map.js';
import { isCircuitCompleted } from './circuit.js';
import { createIcons, icons } from 'lucide';

// --- LOCAL STATE ---
// Sort: 'date_desc' (Recents first), 'date_asc', 'dist_asc' (Shortest first), 'dist_desc'
let currentSort = 'date_desc';
let filterTodo = false; // true = Show only circuits with unvisited points

export function initCircuitListUI() {
    eventBus.on('circuit:list-updated', () => {
        // Also refresh explorer list if it exists
        if (document.getElementById('explorer-list')) {
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

    // Header with Title and Close Button
    header.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%; height: 100%; padding: 0 10px;">
            <div style="width: 32px;"></div> <!-- Spacer to center title visually -->
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
        // Specific styling override will be in CSS, but structure is here
        panel.appendChild(footer);
    }

    // Determine Icons based on state
    const dateIcon = currentSort.startsWith('date')
        ? (currentSort === 'date_asc' ? 'calendar-arrow-up' : 'calendar-arrow-down')
        : 'calendar';

    const distIcon = currentSort.startsWith('dist')
        ? (currentSort === 'dist_desc' ? 'arrow-up-1-0' : 'arrow-down-0-1') // 1-0 = Long to Short? No.
        // Lucide: arrow-down-0-1 means 0 at top, 1 at bottom (Ascending).
        // We want: Shortest first (Ascending) -> arrow-down-0-1
        // Longest first (Descending) -> arrow-up-1-0
        : 'ruler';

    footer.innerHTML = `
        <button id="btn-sort-date" class="footer-btn icon-only ${currentSort.startsWith('date') ? 'active' : ''}" title="Trier par date">
            <i data-lucide="${dateIcon}"></i>
        </button>
        <button id="btn-sort-dist" class="footer-btn icon-only ${currentSort.startsWith('dist') ? 'active' : ''}" title="Trier par distance">
            <i data-lucide="${distIcon}"></i>
        </button>

        <div class="separator-vertical"></div>

        <button id="btn-filter-todo" class="footer-btn icon-only ${filterTodo ? 'active' : ''}" title="A faire">
            <i data-lucide="${filterTodo ? 'list-todo' : 'list-checks'}"></i>
        </button>

        <div class="separator-vertical"></div>

        <button id="btn-reset-filters" class="footer-btn icon-only" title="Réinitialiser">
            <i data-lucide="rotate-ccw"></i>
        </button>
    `;

    createIcons({ icons });

    // Event Listeners
    footer.querySelector('#btn-sort-date').addEventListener('click', () => {
        if (currentSort === 'date_desc') currentSort = 'date_asc';
        else currentSort = 'date_desc';
        refreshExplorer();
    });

    footer.querySelector('#btn-sort-dist').addEventListener('click', () => {
        if (currentSort === 'dist_asc') currentSort = 'dist_desc';
        else currentSort = 'dist_asc';
        refreshExplorer();
    });

    footer.querySelector('#btn-filter-todo').addEventListener('click', () => {
        filterTodo = !filterTodo;
        refreshExplorer();
    });

    footer.querySelector('#btn-reset-filters').addEventListener('click', () => {
        currentSort = 'date_desc';
        filterTodo = false;
        refreshExplorer();
    });
}

function refreshExplorer() {
    renderExplorerToolbar(); // Update icons/states
    renderExplorerList(); // Update list
}

export function renderExplorerList() {
    // Ensure header/toolbar are up to date (e.g. Map Name loaded late)
    const headerTitle = document.querySelector('.explorer-header h2');
    if (headerTitle && state.currentMapId && !headerTitle.textContent.includes(state.currentMapId.charAt(0).toUpperCase())) {
         renderExplorerHeader();
    }
    // Ensure toolbar exists
    if (!document.querySelector('.explorer-footer')) {
        renderExplorerToolbar();
    }

    const listContainer = document.getElementById('explorer-list');
    if (!listContainer) return;

    // 1. Data Prep : Fusion des circuits officiels et utilisateur (Sans doublons)
    const officials = state.officialCircuits || [];

    // On filtre les circuits locaux qui existent déjà en version officielle (par ID ou par Nom exact)
    const locals = (state.myCircuits || []).filter(c => {
        if (c.isDeleted) return false;

        // FILTRE DE SÉCURITÉ : On cache les "Fantômes" (Officiels en double ou Vides)
        if (c.isOfficial) return false; // Un local ne devrait jamais être 'official' (doublon DB)
        if (!c.poiIds || c.poiIds.length === 0) return false; // Circuit vide

        // Vérification si une version officielle existe déjà
        const existsInOfficial = officials.some(off =>
            String(off.id) === String(c.id) ||
            (off.name && c.name && off.name.trim() === c.name.trim())
        );
        return !existsInOfficial;
    });

    const allCircuits = [...officials, ...locals];

    // 2. Enrichment
    const enrichedCircuits = allCircuits.map(c => {
        const ids = c.poiIds || [];
        const features = ids
            .map(id => state.loadedFeatures.find(f => String(getPoiId(f)) === String(id)))
            .filter(Boolean);

        let distance = 0;
        if (c.realTrack) {
            distance = getRealDistance(c);
        } else {
            distance = getOrthodromicDistance(features);
        }

        // Legacy distance fix
        let sortDistance = distance;

        // Only use the static JSON string if we DON'T have the real track loaded
        // (Real track calculation is always more accurate than the cached string)
        if (!c.realTrack && c.distance && typeof c.distance === 'string') {
            const parsed = parseFloat(c.distance.replace(',', '.'));
            if (!isNaN(parsed)) sortDistance = parsed * 1000;
        }

        const hasRestaurant = features.some(f => {
            const cat = f.properties['Catégorie'] || f.properties.userData?.Catégorie;
            return cat === 'Restaurant';
        });

        // Check if circuit is marked as completed
        const isCompleted = isCircuitCompleted(c);

        // Zone
        let zoneName = "Inconnue";
        if (features.length > 0) {
             const firstPoi = features[0];
             const [lng, lat] = firstPoi.geometry.coordinates;
             zoneName = getZoneFromCoords(lat, lng);
        }

        return {
            ...c,
            features,
            distVal: sortDistance,
            hasRestaurant,
            isCompleted,
            zoneName,
            poiCount: ids.length,
            created: c.created || 0 // Assuming 'created' timestamp exists or we treat as old
        };
    });

    // 3. Filter
    let processedCircuits = enrichedCircuits;

    if (filterTodo) {
        // Show only those NOT completed
        processedCircuits = processedCircuits.filter(c => !c.isCompleted);
    }

    // 4. Sort
    if (currentSort === 'date_desc') {
        // Default: Newest first (assuming array is pushed in order, or use created timestamp if available)
        // If we don't have reliable timestamps, we rely on array order (last = new)
        // So we reverse.
        processedCircuits.reverse();
    } else if (currentSort === 'date_asc') {
        // Oldest first -> Keep array order
        // No action needed if we assume array is chronological
    } else if (currentSort === 'dist_asc') {
        processedCircuits.sort((a, b) => a.distVal - b.distVal);
    } else if (currentSort === 'dist_desc') {
        processedCircuits.sort((a, b) => b.distVal - a.distVal);
    }

    // 5. Render
    listContainer.innerHTML = (processedCircuits.length === 0)
        ? '<div style="padding:20px; text-align:center; color:var(--ink-soft);">Aucun circuit correspondant.</div>'
        : processedCircuits.map(c => {
            const displayName = c.name.split(' via ')[0];
            const distDisplay = (c.distVal / 1000).toFixed(1) + ' km';

            // PRIORITÉ ICÔNE :
            // 1. Si on a des données de trace chargées (realTrack) -> FOOT
            // 2. Si on a un flag dans le JSON disant qu'il y a une trace (hasRealTrack) -> FOOT
            // 3. Sinon -> BIRD
            let iconName = 'bird';
            if (c.realTrack && c.realTrack.length > 0) {
                iconName = 'footprints';
            } else if (c.hasRealTrack) {
                iconName = 'footprints';
            }

            // Indicateur POI
            const metaInfo = `${c.poiCount} POI`;

            // Indicateur Officiel
            const officialIcon = c.isOfficial
                ? `<i data-lucide="star" style="width:14px; height:14px; color:var(--primary); fill:var(--primary); margin-left:4px;"></i>`
                : '';

            // Actions : Suppression interdite pour les officiels (sauf Admin)
            const deleteBtn = (!c.isOfficial || state.isAdmin)
                ? `<button class="explorer-item-delete" data-id="${c.id}" title="Supprimer">
                        <i data-lucide="trash-2"></i>
                   </button>`
                : '';

            const toggleVisitedBtn = `
                <button class="explorer-item-action btn-toggle-visited" data-id="${c.id}" data-visited="${c.isCompleted}" title="${c.isCompleted ? 'Marquer comme non fait' : 'Marquer comme fait'}" style="color: ${c.isCompleted ? 'var(--ok)' : 'var(--ink-soft)'}">
                    <i data-lucide="${c.isCompleted ? 'check-circle' : 'circle'}"></i>
                </button>
            `;

            const actionsHtml = `
                <div style="display:flex; align-items:center; gap:0;">
                    ${deleteBtn}
                </div>
            `;

            const restoIcon = c.hasRestaurant
                ? `<i data-lucide="utensils" style="width:14px; height:14px; vertical-align:text-bottom; margin-left:4px;" title="Restaurant présent"></i>`
                : '';

            return `
            <div class="explorer-item" data-id="${c.id}">
                ${toggleVisitedBtn}
                <div class="explorer-item-content">
                    <div class="explorer-item-name" title="${escapeXml(c.name)}">
                        ${escapeXml(displayName)}
                        ${officialIcon}
                    </div>
                    <div class="explorer-item-meta">
                        ${metaInfo} • ${distDisplay} <i data-lucide="${iconName}" style="width:14px; height:14px; vertical-align:text-bottom; margin:0 2px;"></i> • ${c.zoneName}${restoIcon}
                    </div>
                </div>
                ${actionsHtml}
            </div>
            `;
        }).join('');

    createIcons({ icons });

    // Event Listeners
    listContainer.querySelectorAll('.explorer-item').forEach(item => {
        item.addEventListener('click', (e) => {
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
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const isVisited = btn.dataset.visited === 'true';
            // Immediate action, no confirmation
            eventBus.emit('circuit:request-toggle-visited', { id: id, isChecked: !isVisited });
        });
    });
}
