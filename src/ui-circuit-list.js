// ui-circuit-list.js
// Onglet "Mes Circuits" — refonte Claude Design (PR B).
// Rendu du panneau PC : toolbar (recherche + filtres + nouveau + menu + close),
// chips de filtres dépliables, liste de cartes 2 lignes (.mc-card) avec
// badge officiel/testé + check toggle "fait".
//
// Le menu ⋮ regroupe les options secondaires (tris, filtre "à faire", reset).
// Le filtre Zone vit dans le panneau de filtres global (cf. filter-panel.js)
// — pas dupliqué ici. Les chips locales : Tous · Officiels · Avec resto.

import { state, setActiveFilters } from './state.js';
import { isCircuitTested } from './circuit.js';
import { escapeXml } from './utils.js';
import { eventBus } from './events.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { getProcessedCircuits } from './circuit-list-service.js';
import { handleCircuitVisitedToggle } from './circuit-actions.js';
import { applyFilters, getPoiId, getPoiName } from './data.js';
import { showToast } from './toast.js';
import { switchSidebarTab } from './ui-sidebar.js';

// ─── Local state ──────────────────────────────────────────────────────────
let currentSort = 'proximity_asc';
let filterTodo = false;
let activeChip = 'all'; // 'all' | 'official' | 'with-resto'
let searchQuery = '';
let filtersOpen = false;
let menuOpen = false;
let explorerPoiFilterActive = true;
let explorerLastPoiId = null;

export function initCircuitListUI() {
    eventBus.on('circuit:list-updated', () => {
        if (document.getElementById('explorer-list')) renderAll();
    });
    eventBus.on('admin:mode-toggled', () => {
        if (document.getElementById('explorer-list')) renderAll();
    });
    eventBus.on('data:filtered', () => {
        if (document.getElementById('explorer-list')) renderAll();
    });
    eventBus.on('ui:render-explorer-list', () => renderAll());

    // Click extérieur ferme le menu ⋮
    document.addEventListener('click', (e) => {
        if (!menuOpen) return;
        if (e.target.closest('#mc-menu-dropdown')) return;
        if (e.target.closest('#mc-btn-menu')) return;
        closeMenu();
    });

    renderAll();
}

function renderAll() {
    renderToolbar();
    renderFilterChips();
    renderExplorerList();
}

// ─── Toolbar ──────────────────────────────────────────────────────────────
function renderToolbar() {
    const toolbar = document.getElementById('mc-toolbar');
    if (!toolbar) return;

    const hasActiveFilter = activeChip !== 'all';

    toolbar.innerHTML = `
        <label class="mc-search">
            <i data-lucide="search"></i>
            <input type="text" id="mc-search-input" placeholder="Rechercher un circuit…" value="${escapeXml(searchQuery)}">
        </label>
        <button class="mc-tool-btn ${filtersOpen ? 'is-active' : ''}" id="mc-btn-filters" title="Filtres" aria-label="Filtres">
            <i data-lucide="sliders-horizontal"></i>
            ${hasActiveFilter ? '<span class="badge-dot"></span>' : ''}
        </button>
        <button class="mc-tool-btn" id="mc-btn-new" title="Nouveau circuit" aria-label="Nouveau circuit">
            <i data-lucide="plus"></i>
        </button>
        <button class="mc-tool-btn ${menuOpen ? 'is-active' : ''}" id="mc-btn-menu" title="Plus d'options" aria-label="Plus d'options">
            <i data-lucide="more-vertical"></i>
        </button>
        <button class="mc-tool-btn" id="mc-btn-close" title="Cacher le panneau" aria-label="Cacher le panneau">
            <i data-lucide="x"></i>
        </button>
    `;
    createIcons({ icons: appIcons, root: toolbar });

    // Recherche en temps réel
    const searchInput = document.getElementById('mc-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            renderExplorerList();
        });
    }

    // Toggle filtres dépliables
    document.getElementById('mc-btn-filters')?.addEventListener('click', () => {
        filtersOpen = !filtersOpen;
        const filtersEl = document.getElementById('mc-filters');
        if (filtersEl) filtersEl.classList.toggle('is-collapsed', !filtersOpen);
        // Re-render uniquement le bouton (badge actif)
        document.getElementById('mc-btn-filters')?.classList.toggle('is-active', filtersOpen);
    });

    // Nouveau circuit → mode sélection
    document.getElementById('mc-btn-new')?.addEventListener('click', () => {
        document.getElementById('btn-mode-selection')?.click();
    });

    // Menu ⋮
    document.getElementById('mc-btn-menu')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMenu();
    });

    // Fermer panneau
    document.getElementById('mc-btn-close')?.addEventListener('click', () => {
        const sidebar = document.getElementById('right-sidebar');
        if (sidebar) sidebar.style.display = 'none';
        document.body.classList.remove('sidebar-open');
    });
}

// ─── Filter chips dépliables ──────────────────────────────────────────────
function renderFilterChips() {
    const container = document.getElementById('mc-filters');
    if (!container) return;

    const chips = [
        { value: 'all', label: 'Tous', icon: null },
        { value: 'official', label: 'Officiels', icon: 'badge-check' },
        { value: 'with-resto', label: 'Avec resto', icon: 'utensils' },
    ];

    container.innerHTML = chips.map(c => `
        <button class="mc-filter-chip ${activeChip === c.value ? 'is-on' : ''}" data-chip="${c.value}">
            ${c.icon ? `<i data-lucide="${c.icon}"></i>` : ''}
            ${c.label}
        </button>
    `).join('');

    createIcons({ icons: appIcons, root: container });

    container.querySelectorAll('.mc-filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            activeChip = chip.dataset.chip;
            renderFilterChips();
            renderExplorerList();
            // Mise à jour du badge-dot sur le bouton filtres
            const filtersBtn = document.getElementById('mc-btn-filters');
            if (filtersBtn) {
                const dot = filtersBtn.querySelector('.badge-dot');
                if (activeChip !== 'all' && !dot) {
                    const span = document.createElement('span');
                    span.className = 'badge-dot';
                    filtersBtn.appendChild(span);
                } else if (activeChip === 'all' && dot) {
                    dot.remove();
                }
            }
        });
    });
}

// ─── Menu ⋮ (dropdown overlay) ────────────────────────────────────────────
function toggleMenu() {
    if (menuOpen) {
        closeMenu();
    } else {
        openMenu();
    }
}

function openMenu() {
    menuOpen = true;
    let menu = document.getElementById('mc-menu-dropdown');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'mc-menu-dropdown';
        menu.className = 'mc-menu-dropdown';
        document.getElementById('panel-explorer')?.appendChild(menu);
    }

    const distIcon = currentSort === 'dist_desc' ? 'arrow-up-1-0' :
                     currentSort === 'dist_asc' ? 'arrow-down-0-1' : 'ruler';

    menu.innerHTML = `
        <button class="mc-menu-item ${currentSort === 'proximity_asc' ? 'is-active' : ''}" data-action="sort-proximity">
            <i data-lucide="home"></i><span>Tri par proximité</span>
        </button>
        <button class="mc-menu-item ${currentSort.startsWith('dist') ? 'is-active' : ''}" data-action="sort-dist">
            <i data-lucide="${distIcon}"></i><span>Tri par distance</span>
        </button>
        <div class="mc-menu-sep"></div>
        <button class="mc-menu-item ${filterTodo ? 'is-active' : ''}" data-action="toggle-todo">
            <i data-lucide="${filterTodo ? 'list-todo' : 'list-checks'}"></i>
            <span>${filterTodo ? 'Tous les circuits' : 'À faire uniquement'}</span>
        </button>
        <div class="mc-menu-sep"></div>
        <button class="mc-menu-item" data-action="reset">
            <i data-lucide="rotate-ccw"></i><span>Réinitialiser</span>
        </button>
    `;
    createIcons({ icons: appIcons, root: menu });

    menu.querySelectorAll('.mc-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            handleMenuAction(action);
            closeMenu();
        });
    });

    document.getElementById('mc-btn-menu')?.classList.add('is-active');
}

function closeMenu() {
    menuOpen = false;
    document.getElementById('mc-menu-dropdown')?.remove();
    document.getElementById('mc-btn-menu')?.classList.remove('is-active');
}

function handleMenuAction(action) {
    if (action === 'sort-proximity') {
        if (!state.homeLocation) {
            showToast(
                "Définissez votre lieu de résidence dans Mon Espace pour activer ce tri.",
                'info', 4500
            );
            return;
        }
        currentSort = 'proximity_asc';
        renderExplorerList();
    } else if (action === 'sort-dist') {
        currentSort = currentSort === 'dist_asc' ? 'dist_desc' : 'dist_asc';
        renderExplorerList();
    } else if (action === 'toggle-todo') {
        filterTodo = !filterTodo;
        renderExplorerList();
    } else if (action === 'reset') {
        currentSort = 'proximity_asc';
        filterTodo = false;
        activeChip = 'all';
        searchQuery = '';
        if (state.activeFilters) {
            setActiveFilters({ ...state.activeFilters, zone: null });
        }
        applyFilters();
        renderAll();
    }
}

// ─── Liste circuits ───────────────────────────────────────────────────────
export function renderExplorerList() {
    const listContainer = document.getElementById('explorer-list');
    if (!listContainer) return;

    // Garantit la toolbar/chips rendus (premier appel via renderAll)
    if (!document.getElementById('mc-search-input')) renderToolbar();
    if (!document.querySelector('#mc-filters .mc-filter-chip')) renderFilterChips();

    // Source : on délègue le filtre Zone global au filter-panel ; ici on combine
    // tri + "à faire" + zone globale + filtre POI courant.
    const globalZoneFilter = (state.activeFilters && state.activeFilters.zone) || null;

    // Filtre POI courant (chip dynamique "Filtré par : [POI]")
    let filterPoiId = null;
    let currentPoiFeature = null;
    let currentPoiId = null;
    if (state.currentFeatureId !== null && state.loadedFeatures[state.currentFeatureId]) {
        currentPoiFeature = state.loadedFeatures[state.currentFeatureId];
        currentPoiId = getPoiId(currentPoiFeature);
    }
    if (currentPoiId !== explorerLastPoiId) {
        explorerPoiFilterActive = true;
        explorerLastPoiId = currentPoiId;
    }
    if (currentPoiId && explorerPoiFilterActive) {
        filterPoiId = currentPoiId;
    }

    let circuits = getProcessedCircuits(currentSort, filterTodo, globalZoneFilter, filterPoiId);

    // Recherche locale (case-insensitive) : matche le nom du circuit OU
    // le nom d'un POI contenu dans le circuit.
    // Permet de taper "Borj" pour trouver tous les circuits contenant
    // "Borj el Kebir", par exemple.
    if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        circuits = circuits.filter(c => {
            if ((c.name || '').toLowerCase().includes(q)) return true;
            // Match aussi sur les noms de POI du circuit
            if (Array.isArray(c.poiIds)) {
                return c.poiIds.some(id => {
                    const f = state.loadedFeatures.find(g => getPoiId(g) === id);
                    if (!f) return false;
                    return getPoiName(f).toLowerCase().includes(q);
                });
            }
            return false;
        });
    }

    // Chips locales
    if (activeChip === 'official') {
        circuits = circuits.filter(c => c.isOfficial);
    } else if (activeChip === 'with-resto') {
        circuits = circuits.filter(c => c._hasRestaurant);
    }

    listContainer.innerHTML = '';

    // Chip "Filtré par : [POI]" (dynamique, dismissable)
    if (filterPoiId && currentPoiFeature) {
        const poiName = getPoiName(currentPoiFeature);
        const chip = document.createElement('div');
        chip.className = 'mc-poi-filter-chip';
        chip.innerHTML = `
            <i data-lucide="map-pin"></i>
            <span>Filtré par <strong>${escapeXml(poiName)}</strong></span>
            <button type="button" class="mc-poi-filter-chip-clear" title="Retirer le filtre" aria-label="Retirer le filtre">
                <i data-lucide="x"></i>
            </button>
        `;
        chip.querySelector('.mc-poi-filter-chip-clear')?.addEventListener('click', (e) => {
            e.stopPropagation();
            explorerPoiFilterActive = false;
            renderExplorerList();
        });
        listContainer.appendChild(chip);
    }

    if (circuits.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'mc-empty';
        const hasActiveFilters = !!searchQuery || activeChip !== 'all' || filterTodo;
        empty.innerHTML = `
            <div class="icon-wrap"><i data-lucide="map"></i></div>
            <h4>Aucun circuit</h4>
            <p>${hasActiveFilters ? 'Aucun résultat avec ces filtres.' : 'Cliquez sur + pour créer un circuit, ou explorez la carte pour ajouter des POI.'}</p>
        `;
        listContainer.appendChild(empty);
        createIcons({ icons: appIcons, root: listContainer });
        return;
    }

    const list = document.createElement('div');
    list.className = 'mc-list';
    circuits.forEach(c => list.appendChild(createCircuitCard(c)));
    listContainer.appendChild(list);

    createIcons({ icons: appIcons, root: listContainer });
}

function createCircuitCard(c) {
    let displayName = (c.name || '').split(' via ')[0];
    displayName = displayName.replace(/^(Circuit de |Boucle de )/i, '');

    const isCompleted = c._isCompleted;
    const isTested = c.isOfficial && isCircuitTested(c.id);
    const isActive = state.activeCircuitId === c.id;

    const card = document.createElement('article');
    card.className = `mc-card${isActive ? ' is-active' : ''}${isCompleted ? ' is-completed' : ''}`;
    card.dataset.id = c.id;

    // Click sur la carte → activer + bascule onglet "Circuit"
    // (switchSidebarTab direct car aucun listener n'écoute 'ui:request-tab-change'
    //  — pattern utilisé partout ailleurs dans la code base : circuit.js, ui-details.js, etc.)
    card.addEventListener('click', (e) => {
        if (e.target.closest('.mc-card-action-check')) return;
        eventBus.emit('circuit:request-load', c.id);
        switchSidebarTab('circuit');
    });

    // ─ Ligne 1 : titre + badge officiel/testé + check toggle ─
    const line1 = document.createElement('div');
    line1.className = 'mc-card-line1';

    const title = document.createElement('h3');
    title.className = 'mc-card-title';
    title.textContent = displayName;
    title.title = c.name || '';
    line1.appendChild(title);

    if (c.isOfficial) {
        const badge = document.createElement('span');
        badge.className = `mc-badge-official${isTested ? ' is-tested' : ''}`;
        badge.title = isTested ? 'Vérifié sur le terrain' : 'Circuit officiel';
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', isTested ? 'shield-check' : 'check');
        badge.appendChild(icon);
        line1.appendChild(badge);
    }

    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = `mc-card-action-check${isCompleted ? ' is-completed' : ''}`;
    checkBtn.title = isCompleted ? 'Marquer comme non fait' : 'Marquer comme fait';
    checkBtn.dataset.id = c.id;
    const checkIcon = document.createElement('i');
    checkIcon.setAttribute('data-lucide', isCompleted ? 'check' : 'circle');
    checkBtn.appendChild(checkIcon);
    checkBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const result = await handleCircuitVisitedToggle(c.id, isCompleted);
        if (result.success) eventBus.emit('circuit:list-updated');
    });
    line1.appendChild(checkBtn);

    card.appendChild(line1);

    // ─ Ligne 2 : pastilles meta ─
    const line2 = document.createElement('div');
    line2.className = 'mc-card-line2';
    line2.innerHTML = `
        <span class="mc-meta"><i data-lucide="map-pin"></i>${c._poiCount}</span>
        <span class="mc-meta"><i data-lucide="route"></i>${escapeXml(c._distDisplay)}</span>
        ${c._zoneName ? `<span class="mc-meta zone">${escapeXml(c._zoneName)}</span>` : ''}
        ${c._hasRestaurant ? `<span class="mc-meta resto" title="Restaurant en fin de circuit"><i data-lucide="utensils"></i></span>` : ''}
    `;
    card.appendChild(line2);

    return card;
}
