// ui-circuit-list.js
// Onglet "Mes Circuits" V2 Lot 2 (refonte Claude Design — variante A sobre).
//
// Toolbar 4 boutons : recherche / filtres (avec badge n) / nouveau / fermer.
// Panneau filtres : dropdown ancré dans le panneau, sections empilées :
//   - Type de circuit (3 checkboxes : Officiels / Vérifiés / Avec resto)
//   - Distance maximum (slider 0-20 km)
//   - Tri (segmented control : Proximité / Distance / Vérifiés)
//   - Mon parcours (checkbox : À faire uniquement)
// Cartes Variante A : ruban gauche coloré + flag textuel monospace en pied.
//
// Logique métier :
//   - Cocher "Vérifiés" auto-coche "Officiels" (Vérifiés ⊂ Officiels)
//   - Sort 'verified_first' : tri base proximité puis reorder vérifiés en tête
//   - Slider distance : applique aux _dist (en mètres)
//   - Recherche : matche nom de circuit OU nom d'un POI du circuit

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

// ─── État local ───────────────────────────────────────────────────────────
const DIST_MAX_KM = 20;
let currentSort = 'proximity_asc'; // 'proximity_asc' | 'dist_asc' | 'verified_first'
let filterTypeOfficial = false;
let filterTypeVerified = false;
let filterTypeResto    = false;
let filterTodo         = false;
let filterMaxKm        = DIST_MAX_KM;
let searchQuery        = '';
let filterOpen         = false;
let explorerPoiFilterActive = true;
let explorerLastPoiId = null;

// ─── Init ─────────────────────────────────────────────────────────────────
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

    // Click extérieur ferme le panneau filtres
    document.addEventListener('click', (e) => {
        if (!filterOpen) return;
        if (e.target.closest('#mc-filter-pop')) return;
        if (e.target.closest('#mc-btn-filters')) return;
        closeFilterPanel();
    });

    // Échap ferme aussi
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && filterOpen) closeFilterPanel();
    });

    renderAll();
}

function renderAll() {
    renderToolbar();
    renderFilterPanel();
    renderExplorerList();
}

// ─── Toolbar ──────────────────────────────────────────────────────────────
function renderToolbar() {
    const toolbar = document.getElementById('mc-toolbar');
    if (!toolbar) return;

    const n = countActiveFilters();
    const filtersBtnClass = filterOpen ? 'is-active' : '';

    toolbar.innerHTML = `
        <label class="mc-search">
            <i data-lucide="search"></i>
            <input type="text" id="mc-search-input" placeholder="Rechercher un circuit ou un POI…" value="${escapeXml(searchQuery)}">
            <button type="button" class="mc-search-clear ${searchQuery ? '' : 'is-hidden'}" id="mc-search-clear" title="Effacer" aria-label="Effacer la recherche">
                <i data-lucide="x"></i>
            </button>
        </label>
        <button class="mc-tool-btn ${filtersBtnClass}" id="mc-btn-filters" title="Filtres" aria-label="Filtres">
            <i data-lucide="sliders-horizontal"></i>
            ${n > 0 ? `<span class="badge-n">${n}</span>` : ''}
        </button>
        <button class="mc-tool-btn" id="mc-btn-new" title="Nouveau circuit" aria-label="Nouveau circuit">
            <i data-lucide="plus"></i>
        </button>
        <button class="mc-tool-btn" id="mc-btn-close" title="Cacher le panneau" aria-label="Cacher le panneau">
            <i data-lucide="x"></i>
        </button>
    `;
    createIcons({ icons: appIcons, root: toolbar });

    // Recherche temps réel
    const input = document.getElementById('mc-search-input');
    const clear = document.getElementById('mc-search-clear');
    if (input) {
        input.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            if (clear) clear.classList.toggle('is-hidden', !searchQuery);
            renderExplorerList();
        });
    }
    if (clear) {
        clear.addEventListener('click', () => {
            searchQuery = '';
            if (input) { input.value = ''; input.focus(); }
            clear.classList.add('is-hidden');
            renderExplorerList();
        });
    }

    document.getElementById('mc-btn-filters')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFilterPanel();
    });
    document.getElementById('mc-btn-new')?.addEventListener('click', () => {
        document.getElementById('btn-mode-selection')?.click();
    });
    document.getElementById('mc-btn-close')?.addEventListener('click', () => {
        const sidebar = document.getElementById('right-sidebar');
        if (sidebar) sidebar.style.display = 'none';
        document.body.classList.remove('sidebar-open');
    });
}

// ─── Panneau filtres ──────────────────────────────────────────────────────
function renderFilterPanel() {
    const pop = document.getElementById('mc-filter-pop');
    if (!pop) return;

    const n = countActiveFilters();
    const slidPct = (filterMaxKm / DIST_MAX_KM) * 100;

    pop.innerHTML = `
        <div class="filter-pop-head">
            <div class="ttl">
                <i data-lucide="sliders-horizontal"></i>
                Filtres
                ${n > 0 ? `<span class="badge-n">${n}</span>` : ''}
            </div>
            <button class="x" id="mc-fp-close" title="Fermer" aria-label="Fermer"><i data-lucide="x"></i></button>
        </div>

        <div class="filter-section">
            <div class="lbl">Type de circuit</div>
            <button class="fchk ${filterTypeOfficial ? 'is-on' : ''}" data-fchk="official">
                <span class="ico-leading brand"><i data-lucide="badge-check"></i></span>
                <span class="lab-text">
                    <span class="lab-main">Officiels uniquement</span>
                    <span class="lab-hint">Circuits édités par l'équipe History Walk</span>
                </span>
                <span class="box"><i data-lucide="check"></i></span>
            </button>
            <button class="fchk ${filterTypeVerified ? 'is-on' : ''}" data-fchk="verified">
                <span class="ico-leading ok"><i data-lucide="shield-check"></i></span>
                <span class="lab-text">
                    <span class="lab-main">Vérifiés sur le terrain</span>
                    <span class="lab-hint">Sous-ensemble des officiels, testés à pied</span>
                </span>
                <span class="box"><i data-lucide="check"></i></span>
            </button>
            <button class="fchk ${filterTypeResto ? 'is-on' : ''}" data-fchk="resto">
                <span class="ico-leading amber"><i data-lucide="utensils"></i></span>
                <span class="lab-text">
                    <span class="lab-main">Avec restaurant en fin</span>
                </span>
                <span class="box"><i data-lucide="check"></i></span>
            </button>
        </div>

        <div class="filter-section">
            <div class="lbl"><span>Distance maximum</span><span class="v" id="mc-fslider-value">${filterMaxKm} km${filterMaxKm === DIST_MAX_KM ? ' (tous)' : ''}</span></div>
            <div class="fslider">
                <div class="fslider-track-wrap" id="mc-fslider">
                    <div class="fslider-track"></div>
                    <div class="fslider-fill" id="mc-fslider-fill" style="width:${slidPct}%"></div>
                    <div class="fslider-handle" id="mc-fslider-handle" style="left:${slidPct}%">
                        <div class="fslider-bubble" id="mc-fslider-bubble">${filterMaxKm} km</div>
                    </div>
                </div>
                <div class="fslider-scale"><span>0 km</span><span>10 km</span><span>${DIST_MAX_KM} km</span></div>
            </div>
        </div>

        <div class="filter-section">
            <div class="lbl">Tri</div>
            <div class="fseg" id="mc-fseg">
                <button class="${currentSort === 'proximity_asc' ? 'is-on' : ''}" data-sort="proximity_asc">
                    <i data-lucide="home"></i>Proximité
                </button>
                <button class="${currentSort === 'dist_asc' ? 'is-on' : ''}" data-sort="dist_asc">
                    <i data-lucide="ruler"></i>Distance
                </button>
                <button class="${currentSort === 'verified_first' ? 'is-on' : ''}" data-sort="verified_first">
                    <i data-lucide="shield-check"></i>Vérifiés
                </button>
            </div>
        </div>

        <div class="filter-section">
            <div class="lbl">Mon parcours</div>
            <button class="fchk ${filterTodo ? 'is-on' : ''}" data-fchk="todo">
                <span class="ico-leading"><i data-lucide="list-todo"></i></span>
                <span class="lab-text">
                    <span class="lab-main">À faire uniquement</span>
                    <span class="lab-hint">Masque les circuits déjà marqués « fait »</span>
                </span>
                <span class="box"><i data-lucide="check"></i></span>
            </button>
        </div>

        <div class="filter-pop-foot">
            <button class="filter-reset" id="mc-fp-reset" type="button">
                <i data-lucide="rotate-ccw"></i>Tout réinitialiser
            </button>
        </div>
    `;
    createIcons({ icons: appIcons, root: pop });

    // Listeners checkboxes
    pop.querySelectorAll('.fchk').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.fchk;
            handleFchkToggle(key);
        });
    });

    // Listener segmented tri
    pop.querySelectorAll('.fseg button').forEach(btn => {
        btn.addEventListener('click', () => {
            const v = btn.dataset.sort;
            if (v === 'proximity_asc' && !state.homeLocation) {
                showToast(
                    "Définissez votre lieu de résidence dans Mon Espace pour activer ce tri.",
                    'info', 4500
                );
                return;
            }
            currentSort = v;
            renderFilterPanel();
            renderExplorerList();
            renderToolbar();
        });
    });

    // Slider distance
    const slider = document.getElementById('mc-fslider');
    if (slider) setupSlider(slider);

    // Close + reset
    document.getElementById('mc-fp-close')?.addEventListener('click', closeFilterPanel);
    document.getElementById('mc-fp-reset')?.addEventListener('click', resetAllFilters);
}

function handleFchkToggle(key) {
    if (key === 'official') {
        filterTypeOfficial = !filterTypeOfficial;
        if (!filterTypeOfficial) filterTypeVerified = false;
    } else if (key === 'verified') {
        filterTypeVerified = !filterTypeVerified;
        if (filterTypeVerified) filterTypeOfficial = true;
    } else if (key === 'resto') {
        filterTypeResto = !filterTypeResto;
    } else if (key === 'todo') {
        filterTodo = !filterTodo;
    }
    // Toggle in-place les classes is-on (pas de rerender HTML — préserve les
    // listeners et l'identité DOM, plus stable pour clicks rapides successifs).
    syncFchkClasses();
    syncFiltersBadge();
    renderExplorerList();
}

function syncFchkClasses() {
    document.querySelector('.fchk[data-fchk="official"]')?.classList.toggle('is-on', filterTypeOfficial);
    document.querySelector('.fchk[data-fchk="verified"]')?.classList.toggle('is-on', filterTypeVerified);
    document.querySelector('.fchk[data-fchk="resto"]')?.classList.toggle('is-on', filterTypeResto);
    document.querySelector('.fchk[data-fchk="todo"]')?.classList.toggle('is-on', filterTodo);
}

function syncFiltersBadge() {
    // Met à jour le badge n du bouton Filtres (toolbar) + de l'en-tête du panneau
    const n = countActiveFilters();
    const btn = document.getElementById('mc-btn-filters');
    if (btn) {
        let badge = btn.querySelector('.badge-n');
        if (n > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'badge-n';
                btn.appendChild(badge);
            }
            badge.textContent = String(n);
        } else if (badge) {
            badge.remove();
        }
    }
    const popBadge = document.querySelector('.filter-pop-head .badge-n');
    if (popBadge) {
        if (n > 0) popBadge.textContent = String(n);
        else popBadge.remove();
    } else if (n > 0) {
        const ttl = document.querySelector('.filter-pop-head .ttl');
        if (ttl) {
            const b = document.createElement('span');
            b.className = 'badge-n';
            b.textContent = String(n);
            ttl.appendChild(b);
        }
    }
}

// Slider drag (pointer events, touch-friendly)
function setupSlider(track) {
    const fill = document.getElementById('mc-fslider-fill');
    const handle = document.getElementById('mc-fslider-handle');
    const valueLabel = document.getElementById('mc-fslider-value');
    const bubble = document.getElementById('mc-fslider-bubble');

    function updateFromX(clientX) {
        const rect = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const km = Math.round(pct * DIST_MAX_KM);
        if (km !== filterMaxKm) {
            filterMaxKm = km;
            const p = (km / DIST_MAX_KM) * 100;
            if (fill) fill.style.width = p + '%';
            if (handle) handle.style.left = p + '%';
            if (valueLabel) valueLabel.textContent = `${km} km${km === DIST_MAX_KM ? ' (tous)' : ''}`;
            if (bubble) bubble.textContent = `${km} km`;
            renderExplorerList();
            renderToolbar();
        }
    }

    track.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        track.setPointerCapture(e.pointerId);
        track.classList.add('is-active');
        updateFromX(e.clientX);
    });
    track.addEventListener('pointermove', (e) => {
        if (track.hasPointerCapture(e.pointerId)) updateFromX(e.clientX);
    });
    track.addEventListener('pointerup', (e) => {
        track.releasePointerCapture(e.pointerId);
        track.classList.remove('is-active');
    });
    track.addEventListener('pointercancel', () => {
        track.classList.remove('is-active');
    });
}

// ─── Open / close panneau filtres ────────────────────────────────────────
function openFilterPanel() {
    filterOpen = true;
    document.getElementById('panel-explorer')?.setAttribute('data-filter-open', 'true');
    document.getElementById('mc-btn-filters')?.classList.add('is-active');
}
function closeFilterPanel() {
    filterOpen = false;
    document.getElementById('panel-explorer')?.setAttribute('data-filter-open', 'false');
    document.getElementById('mc-btn-filters')?.classList.remove('is-active');
}
function toggleFilterPanel() {
    filterOpen ? closeFilterPanel() : openFilterPanel();
}

// ─── Reset ────────────────────────────────────────────────────────────────
function resetAllFilters() {
    filterTypeOfficial = false;
    filterTypeVerified = false;
    filterTypeResto    = false;
    filterTodo         = false;
    filterMaxKm        = DIST_MAX_KM;
    currentSort        = 'proximity_asc';
    searchQuery        = '';
    if (state.activeFilters) {
        setActiveFilters({ ...state.activeFilters, zone: null });
    }
    applyFilters();
    renderAll();
}

// ─── Compteurs ────────────────────────────────────────────────────────────
function countActiveFilters() {
    let n = 0;
    if (filterTypeOfficial) n++;
    if (filterTypeVerified) n++;
    if (filterTypeResto)    n++;
    if (filterTodo)         n++;
    if (filterMaxKm < DIST_MAX_KM) n++;
    if (currentSort !== 'proximity_asc') n++;
    return n;
}

// ─── Liste cartes ─────────────────────────────────────────────────────────
export function renderExplorerList() {
    const listContainer = document.getElementById('explorer-list');
    if (!listContainer) return;

    if (!document.getElementById('mc-search-input')) renderToolbar();

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
    if (currentPoiId && explorerPoiFilterActive) filterPoiId = currentPoiId;

    // Tri base : verified_first → on délègue 'proximity_asc' au service puis on
    // post-reorder pour mettre les vérifiés en tête.
    const baseSortMode = currentSort === 'verified_first' ? 'proximity_asc' : currentSort;
    let circuits = getProcessedCircuits(baseSortMode, filterTodo, globalZoneFilter, filterPoiId);

    // Recherche : nom de circuit OU nom d'un POI du circuit
    if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        circuits = circuits.filter(c => {
            if ((c.name || '').toLowerCase().includes(q)) return true;
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

    // Filtres type
    if (filterTypeOfficial) circuits = circuits.filter(c => c.isOfficial);
    if (filterTypeVerified) circuits = circuits.filter(c => c.isOfficial && isCircuitTested(c.id));
    if (filterTypeResto)    circuits = circuits.filter(c => c._hasRestaurant);

    // Filtre distance max (en mètres : c._dist)
    if (filterMaxKm < DIST_MAX_KM) {
        circuits = circuits.filter(c => (c._dist || 0) <= filterMaxKm * 1000);
    }

    // Tri "verified_first" — vérifiés en tête, le reste conserve l'ordre
    if (currentSort === 'verified_first') {
        circuits = [
            ...circuits.filter(c => c.isOfficial && isCircuitTested(c.id)),
            ...circuits.filter(c => !(c.isOfficial && isCircuitTested(c.id))),
        ];
    }

    listContainer.innerHTML = '';

    // Chip POI courant (dismissable)
    if (filterPoiId && currentPoiFeature) {
        const poiName = getPoiName(currentPoiFeature);
        const chip = document.createElement('div');
        chip.className = 'mc-poi-chip';
        chip.innerHTML = `
            <i data-lucide="map-pin"></i>
            <span>Filtré par <strong>${escapeXml(poiName)}</strong></span>
            <button type="button" class="clear" title="Retirer" aria-label="Retirer le filtre">
                <i data-lucide="x"></i>
            </button>
        `;
        chip.querySelector('.clear')?.addEventListener('click', (e) => {
            e.stopPropagation();
            explorerPoiFilterActive = false;
            renderExplorerList();
        });
        listContainer.appendChild(chip);
    }

    // Empty state
    if (circuits.length === 0) {
        const hasActiveFilters = countActiveFilters() > 0 || !!searchQuery.trim();
        const hint = pickEmptyHint();
        const empty = document.createElement('div');
        empty.className = 'va-empty';
        empty.innerHTML = `
            <div class="icon-wrap"><i data-lucide="map"></i></div>
            <h4>Aucun circuit</h4>
            <p>${hasActiveFilters ? hint : 'Cliquez sur + pour créer un circuit, ou explorez la carte pour ajouter des POI.'}</p>
            ${hasActiveFilters ? `<button class="btn-reset" type="button" id="mc-empty-reset">
                <i data-lucide="rotate-ccw"></i>Tout réinitialiser
            </button>` : ''}
        `;
        listContainer.appendChild(empty);
        document.getElementById('mc-empty-reset')?.addEventListener('click', resetAllFilters);
        createIcons({ icons: appIcons, root: listContainer });
        return;
    }

    circuits.forEach(c => listContainer.appendChild(createCircuitCard(c)));
    createIcons({ icons: appIcons, root: listContainer });
}

function pickEmptyHint() {
    // Suggestion ciblée selon le filtre le plus restrictif détecté
    if (filterMaxKm < DIST_MAX_KM) return `Aucun circuit ≤ ${filterMaxKm} km. Élargis la distance ou réinitialise.`;
    if (filterTypeVerified) return 'Aucun circuit vérifié pour ces critères. Décoche "Vérifiés" pour élargir.';
    if (filterTypeOfficial) return 'Aucun officiel pour ces critères. Décoche "Officiels" pour voir aussi tes circuits perso.';
    if (filterTodo) return 'Tous les circuits sont déjà marqués "fait". Décoche "À faire uniquement".';
    if (searchQuery) return `Aucun circuit ne correspond à "${escapeXml(searchQuery)}". Efface la recherche pour tout voir.`;
    return 'Aucun circuit avec ces filtres. Réinitialise pour tout voir.';
}

function createCircuitCard(c) {
    let displayName = (c.name || '').split(' via ')[0];
    displayName = displayName.replace(/^(Circuit de |Boucle de )/i, '');

    const isCompleted = c._isCompleted;
    const isOfficial  = !!c.isOfficial;
    const isTested    = isOfficial && isCircuitTested(c.id);
    const isActive    = state.activeCircuitId === c.id;

    let flag = 'none';
    if (isTested) flag = 'verified';
    else if (isOfficial) flag = 'official';

    const card = document.createElement('article');
    card.className = `va-card${isActive ? ' is-active' : ''}${isCompleted ? ' is-done' : ''}`;
    card.dataset.id = c.id;
    card.dataset.flag = flag;

    card.addEventListener('click', (e) => {
        if (e.target.closest('.va-done')) return;
        eventBus.emit('circuit:request-load', c.id);
        switchSidebarTab('circuit');
    });

    // Ligne 1 — titre + toggle "fait"
    const line1 = document.createElement('div');
    line1.className = 'va-line1';

    const title = document.createElement('h3');
    title.className = 'va-title';
    title.textContent = displayName;
    title.title = c.name || '';
    line1.appendChild(title);

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'va-done';
    doneBtn.title = isCompleted ? 'Marquer comme non fait' : 'Marquer comme fait';
    doneBtn.dataset.id = c.id;
    const doneIcon = document.createElement('i');
    doneIcon.setAttribute('data-lucide', isCompleted ? 'check' : 'circle');
    doneBtn.appendChild(doneIcon);
    doneBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const result = await handleCircuitVisitedToggle(c.id, isCompleted);
        if (result.success) eventBus.emit('circuit:list-updated');
    });
    line1.appendChild(doneBtn);

    card.appendChild(line1);

    // Ligne 2 — méta sobre avec séparateurs
    const distKm = ((c._dist || 0) / 1000).toFixed(1).replace('.', ',');
    const metaPieces = [
        `<span><span class="num">${c._poiCount}</span> POI</span>`,
        `<span class="sep">·</span>`,
        `<span><span class="num">${distKm}</span> km</span>`,
    ];
    if (c._zoneName) {
        metaPieces.push('<span class="sep">·</span>');
        metaPieces.push(`<span>${escapeXml(c._zoneName)}</span>`);
    }
    if (c._hasRestaurant) {
        metaPieces.push('<span class="sep">·</span>');
        metaPieces.push(`<span class="resto"><i data-lucide="utensils"></i>Resto</span>`);
    }
    const line2 = document.createElement('div');
    line2.className = 'va-meta';
    line2.innerHTML = metaPieces.join('');
    card.appendChild(line2);

    // Ligne 3 — flag textuel typographique (perso = caché via CSS)
    if (flag !== 'none') {
        const flagEl = document.createElement('div');
        flagEl.className = 'va-flag';
        flagEl.innerHTML = `<span class="dot"></span>${flag === 'verified' ? 'Officiel · Vérifié' : 'Officiel'}`;
        card.appendChild(flagEl);
    }

    return card;
}
