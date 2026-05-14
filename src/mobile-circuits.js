// mobile-circuits.js
// Vue Mes Circuits mobile (refonte chantier mobile design — handoff Claude Design).
// Structure : .m-top header + .mc-search-row + .mc-list scrollable de .mc-card.
// Plus de pagination « 1/n » : la liste est scrollable. Toolbar 5-boutons remplacée
// par le bouton filtres (sliders icon) qui ouvre un bottom sheet aligné PC :
//   Sections : Type de circuit / Distance / Tri / Zone / Mon parcours.
// Mode instant : chaque clic applique immédiatement (la liste se met à jour
// derrière, visible quand le sheet est refermé via X / scrim).
//
// Variables module-locales (réplique PC ui-circuit-list.js) :
//   filterTypeOfficial / filterTypeVerified / filterTypeResto
//   filterMinKm / filterMaxKm
//   filterCompletion ('all' | 'todo' | 'done')
// Le sort 'verified_first' est géré comme sur PC (base proximity_asc + reorder).
// Pont vers state.filterCompleted pour préserver le shortcut "dock Filtre" mobile.

import { state, setActiveFilter, setFilterCompleted } from './state.js';
import { getPoiId, getPoiName } from './data.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { escapeHtml, sanitizeHTML, getZoneFromCoords } from './utils.js';
import { isCircuitTested, loadCircuitById } from './circuit.js';
import { handleCircuitVisitedToggle } from './circuit-actions.js';
import { getProcessedCircuits } from './circuit-list-service.js';
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

// ─── État local filtres (réplique PC) ────────────────────────────────────────
const DIST_MAX_KM = 20;
let filterTypeOfficial = false;
let filterTypeVerified = false;
let filterTypeResto    = false;
let filterMinKm        = 0;
let filterMaxKm        = DIST_MAX_KM;
let filterCompletion   = 'all'; // 'all' | 'todo' | 'done'

// Détection mutation externe de state.filterCompleted (bouton « Filtre » du dock).
// Quand le dock toggle, on reflète dans filterCompletion (binaire only, pas de 'done').
let lastSeenStateFilterCompleted = false;

// Filtre POI clearable via chip (même logique que ui-circuit-list.js).
let mobilePoiFilterActive = true;
let mobileLastPoiId = null;

// Bottom sheet handles
let sheetOpen = false;
let sheetEl = null;

export function renderMobileCircuitsList() {
    const container = document.getElementById('mobile-main-container');

    // Vue Mes Circuits : pas de footer custom → clear le view-footer pour
    // restaurer le dock.
    clearMobileViewFooter();

    // Sync depuis state.filterCompleted (dock button mobile) — préserve 'done'
    // sauf si le dock a explicitement remis à false.
    if (state.filterCompleted !== lastSeenStateFilterCompleted) {
        filterCompletion = state.filterCompleted ? 'todo' : 'all';
        lastSeenStateFilterCompleted = state.filterCompleted;
    }

    // Normalisation du tri par défaut : mobile-state.js initialise mobileSort
    // à 'proximity_asc' (cohérent avec PC), mais ce tri exige homeLocation. Sans
    // homeLocation, on retombe sur 'dist_asc' (default de resetAllMobileFilters).
    // Sans cette normalisation, le badge n se met à 1 au boot pour les users
    // sans homeLocation — confusion garantie.
    if (getMobileSort() === 'proximity_asc' && !state.homeLocation) {
        setMobileSort('dist_asc');
    }

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

    // Sort : 'verified_first' → délégué au service en 'proximity_asc' puis reorder.
    const sortMode = getMobileSort();
    const baseSortMode = sortMode === 'verified_first' ? 'proximity_asc' : sortMode;
    const legacyFilterTodo = filterCompletion === 'todo';

    let circuitsToDisplay = getProcessedCircuits(
        baseSortMode,
        legacyFilterTodo,
        state.activeFilters.zone || null,
        filterPoiId
    );

    // Filtre completion 'done' : circuits déjà marqués fait (post-service)
    if (filterCompletion === 'done') {
        circuitsToDisplay = circuitsToDisplay.filter(c => c._isCompleted);
    }

    // Filtres type (post-service, comme PC)
    if (filterTypeOfficial) circuitsToDisplay = circuitsToDisplay.filter(c => c.isOfficial);
    if (filterTypeVerified) circuitsToDisplay = circuitsToDisplay.filter(c => c.isOfficial && isCircuitTested(c.id));
    if (filterTypeResto)    circuitsToDisplay = circuitsToDisplay.filter(c => c._hasRestaurant);

    // Filtre distance (range min → max, en mètres : c._dist)
    if (filterMinKm > 0 || filterMaxKm < DIST_MAX_KM) {
        const minM = filterMinKm * 1000;
        const maxM = filterMaxKm * 1000;
        circuitsToDisplay = circuitsToDisplay.filter(c => {
            const d = c._dist || 0;
            return d >= minM && d <= maxM;
        });
    }

    // Tri 'verified_first' — vérifiés en tête, le reste conserve l'ordre
    if (sortMode === 'verified_first') {
        circuitsToDisplay = [
            ...circuitsToDisplay.filter(c => c.isOfficial && isCircuitTested(c.id)),
            ...circuitsToDisplay.filter(c => !(c.isOfficial && isCircuitTested(c.id))),
        ];
    }

    setAllCircuitsOrdered(circuitsToDisplay); // Mémorise pour le swipe entre circuits

    // ─── Header slot : .m-top + .mc-search-row ────────────────────────────────
    // Bouton filtres affiche un badge n quand au moins un filtre est actif.
    const n = countActiveFilters();
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
                ${n > 0 ? `<span class="badge-n">${n}</span>` : ''}
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
            <p>${pickEmptyHint()}</p>
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

    // Bouton filtres : ouvre le bottom sheet aligné PC.
    const filterBtn = document.getElementById('mobile-mc-filter-btn');
    if (filterBtn) filterBtn.addEventListener('click', () => openMobileFiltersSheet());

    // Chip POI : clear
    const chipClearBtn = document.getElementById('mobile-poi-filter-chip-clear');
    if (chipClearBtn) {
        chipClearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            mobilePoiFilterActive = false;
            renderMobileCircuitsList();
        });
    }

    // Bouton « Tout afficher » de l'état « tout terminé » / vide
    const resetBtn = document.getElementById('btn-reset-filter-inline');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            resetAllMobileFilters();
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

// ─── Compteur de filtres actifs (pour le badge n) ────────────────────────────
function countActiveFilters() {
    let n = 0;
    if (filterTypeOfficial) n++;
    if (filterTypeVerified) n++;
    if (filterTypeResto)    n++;
    if (filterCompletion !== 'all') n++;
    if (filterMinKm > 0 || filterMaxKm < DIST_MAX_KM) n++;
    if (state.activeFilters?.zone) n++;
    // Le tri par défaut dépend de homeLocation : 'proximity_asc' si défini, sinon
    // 'dist_asc' (cf. resetAllMobileFilters). On ne badge le tri que s'il diverge
    // de ce default — sinon le badge resterait à 1 après reset pour les users sans
    // homeLocation, ce qui serait trompeur.
    const defaultSort = state.homeLocation ? 'proximity_asc' : 'dist_asc';
    if (getMobileSort() !== defaultSort) n++;
    return n;
}

function pickEmptyHint() {
    if (filterMinKm > 0 || filterMaxKm < DIST_MAX_KM) {
        return `Aucun circuit entre ${filterMinKm} et ${filterMaxKm} km. Élargis la fourchette ou réinitialise.`;
    }
    if (filterTypeVerified) return 'Aucun circuit vérifié pour ces critères. Décoche "Vérifiés" pour élargir.';
    if (filterTypeOfficial) return 'Aucun officiel pour ces critères. Décoche "Officiels" pour voir aussi tes circuits perso.';
    if (filterTypeResto)    return 'Aucun circuit avec resto pour ces critères.';
    if (filterCompletion === 'todo') return 'Bravo ! Tout est terminé.';
    if (filterCompletion === 'done') return 'Aucun circuit n\'a encore été marqué « fait ».';
    if (state.activeFilters?.zone) return `Aucun circuit dans la zone « ${state.activeFilters.zone} ».`;
    return 'Aucun circuit avec ces filtres. Réinitialise pour tout voir.';
}

// ─── Reset global ────────────────────────────────────────────────────────────
function resetAllMobileFilters() {
    filterTypeOfficial = false;
    filterTypeVerified = false;
    filterTypeResto    = false;
    filterMinKm        = 0;
    filterMaxKm        = DIST_MAX_KM;
    filterCompletion   = 'all';
    setFilterCompleted(false);
    lastSeenStateFilterCompleted = false;
    setMobileSort(state.homeLocation ? 'proximity_asc' : 'dist_asc');
    setActiveFilter('zone', null);
    renderMobileCircuitsList();
    if (sheetOpen) renderFilterSheetBody();
}

// ─── Bottom sheet — overlay aligné PC ────────────────────────────────────────
function openMobileFiltersSheet() {
    if (sheetOpen) return;
    sheetOpen = true;

    const overlay = document.createElement('div');
    overlay.className = 'filter-sheet-scrim';
    overlay.id = 'filter-sheet-scrim';
    overlay.innerHTML = `
        <div class="filter-sheet" role="dialog" aria-modal="true" aria-labelledby="filter-sheet-title">
            <div class="filter-sheet-handle"></div>
            <div class="filter-sheet-head">
                <div class="ttl" id="filter-sheet-title">
                    <i data-lucide="sliders-horizontal"></i>
                    Filtres
                    <span class="badge-n filter-sheet-badge" id="filter-sheet-badge" hidden></span>
                </div>
                <button class="x" id="filter-sheet-close" aria-label="Fermer">
                    <i data-lucide="x"></i>
                </button>
            </div>
            <div class="filter-sheet-body" id="filter-sheet-body"></div>
            <div class="filter-sheet-foot">
                <button class="filter-reset" id="filter-sheet-reset" type="button">
                    <i data-lucide="rotate-ccw"></i>Tout réinitialiser
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    sheetEl = overlay;

    renderFilterSheetBody();

    // Listeners globaux
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeMobileFiltersSheet();
    });
    overlay.querySelector('#filter-sheet-close')?.addEventListener('click', closeMobileFiltersSheet);
    overlay.querySelector('#filter-sheet-reset')?.addEventListener('click', () => {
        resetAllMobileFilters();
    });

    // Esc ferme aussi
    document.addEventListener('keydown', onEscClose);

    // Animation d'entrée (next frame)
    requestAnimationFrame(() => overlay.classList.add('is-open'));
}

function closeMobileFiltersSheet() {
    if (!sheetOpen || !sheetEl) return;
    sheetEl.classList.remove('is-open');
    document.removeEventListener('keydown', onEscClose);
    const el = sheetEl;
    setTimeout(() => {
        el.remove();
        if (sheetEl === el) sheetEl = null;
        sheetOpen = false;
    }, 240);
}

function onEscClose(e) {
    if (e.key === 'Escape' && sheetOpen) closeMobileFiltersSheet();
}

function updateSheetBadge() {
    if (!sheetEl) return;
    const badge = sheetEl.querySelector('#filter-sheet-badge');
    if (!badge) return;
    const n = countActiveFilters();
    if (n > 0) {
        badge.textContent = String(n);
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
}

function renderFilterSheetBody() {
    if (!sheetEl) return;
    const body = sheetEl.querySelector('#filter-sheet-body');
    if (!body) return;

    const distLabel = (filterMinKm === 0 && filterMaxKm === DIST_MAX_KM)
        ? `${DIST_MAX_KM} km (tous)`
        : `${filterMinKm} → ${filterMaxKm} km`;
    const minPct = (filterMinKm / DIST_MAX_KM) * 100;
    const maxPct = (filterMaxKm / DIST_MAX_KM) * 100;

    // Zones disponibles (un compteur par zone visible)
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
    const currentZone = state.activeFilters?.zone || null;
    const currentSort = getMobileSort();

    body.innerHTML = `
        <!-- Type de circuit -->
        <div class="filter-section">
            <div class="lbl">Type de circuit</div>
            <button class="fchk ${filterTypeOfficial ? 'is-on' : ''}" data-fchk="official" type="button">
                <span class="ico-leading brand"><i data-lucide="badge-check"></i></span>
                <span class="lab-text">
                    <span class="lab-main">Officiels uniquement</span>
                    <span class="lab-hint">Circuits édités par l'équipe History Walk</span>
                </span>
                <span class="box"><i data-lucide="check"></i></span>
            </button>
            <button class="fchk ${filterTypeVerified ? 'is-on' : ''}" data-fchk="verified" type="button">
                <span class="ico-leading ok"><i data-lucide="shield-check"></i></span>
                <span class="lab-text">
                    <span class="lab-main">Vérifiés sur le terrain</span>
                    <span class="lab-hint">Sous-ensemble des officiels, testés à pied</span>
                </span>
                <span class="box"><i data-lucide="check"></i></span>
            </button>
            <button class="fchk ${filterTypeResto ? 'is-on' : ''}" data-fchk="resto" type="button">
                <span class="ico-leading amber"><i data-lucide="utensils"></i></span>
                <span class="lab-text">
                    <span class="lab-main">Avec restaurant en fin</span>
                </span>
                <span class="box"><i data-lucide="check"></i></span>
            </button>
        </div>

        <!-- Distance -->
        <div class="filter-section">
            <div class="lbl"><span>Distance</span><span class="v" id="ms-fslider-value">${distLabel}</span></div>
            <div class="fslider">
                <div class="fslider-track-wrap" id="ms-fslider">
                    <div class="fslider-track"></div>
                    <div class="fslider-fill" id="ms-fslider-fill" style="left:${minPct}%;width:${maxPct - minPct}%"></div>
                    <div class="fslider-handle" id="ms-fslider-handle-min" data-handle="min" style="left:${minPct}%">
                        <div class="fslider-bubble" id="ms-fslider-bubble-min">${filterMinKm} km</div>
                    </div>
                    <div class="fslider-handle" id="ms-fslider-handle-max" data-handle="max" style="left:${maxPct}%">
                        <div class="fslider-bubble" id="ms-fslider-bubble-max">${filterMaxKm} km</div>
                    </div>
                </div>
                <div class="fslider-scale"><span>0 km</span><span>10 km</span><span>${DIST_MAX_KM} km</span></div>
            </div>
        </div>

        <!-- Tri -->
        <div class="filter-section">
            <div class="lbl">Tri</div>
            <div class="ms-sort-grid" id="ms-sort-grid">
                <button class="ms-sort-btn ${currentSort === 'proximity_asc' ? 'is-on' : ''}" data-sort="proximity_asc" type="button">
                    <i data-lucide="home"></i><span>Proximité</span>
                </button>
                <button class="ms-sort-btn ${currentSort === 'verified_first' ? 'is-on' : ''}" data-sort="verified_first" type="button">
                    <i data-lucide="shield-check"></i><span>Vérifiés</span>
                </button>
                <button class="ms-sort-btn ${currentSort === 'dist_asc' ? 'is-on' : ''}" data-sort="dist_asc" type="button">
                    <i data-lucide="arrow-down-0-1"></i><span>Du plus court</span>
                </button>
                <button class="ms-sort-btn ${currentSort === 'dist_desc' ? 'is-on' : ''}" data-sort="dist_desc" type="button">
                    <i data-lucide="arrow-up-1-0"></i><span>Du plus long</span>
                </button>
            </div>
        </div>

        <!-- Zone -->
        <div class="filter-section">
            <div class="lbl">Zone</div>
            <div class="ms-zone-list" id="ms-zone-list">
                <button class="ms-zone-item ${!currentZone ? 'is-on' : ''}" data-zone="" type="button">
                    <span class="ms-zone-label"><i data-lucide="globe"></i>Toutes les zones</span>
                </button>
                ${sortedZones.map(z => `
                    <button class="ms-zone-item ${currentZone === z ? 'is-on' : ''}" data-zone="${escapeHtml(z)}" type="button">
                        <span class="ms-zone-label"><i data-lucide="map-pin"></i>${escapeHtml(z)}</span>
                        <span class="ms-zone-count">${zonesMap[z]}</span>
                    </button>
                `).join('')}
            </div>
        </div>

        <!-- Mon parcours -->
        <div class="filter-section">
            <div class="lbl">Mon parcours</div>
            <div class="fseg" id="ms-fseg-completion">
                <button class="${filterCompletion === 'all' ? 'is-on' : ''}" data-completion="all" type="button">
                    Tout
                </button>
                <button class="${filterCompletion === 'todo' ? 'is-on' : ''}" data-completion="todo" type="button">
                    <i data-lucide="list-todo"></i>À faire
                </button>
                <button class="${filterCompletion === 'done' ? 'is-on' : ''}" data-completion="done" type="button">
                    <i data-lucide="check"></i>Fait
                </button>
            </div>
        </div>
    `;

    createIcons({ icons: appIcons, root: body });
    updateSheetBadge();

    // ─── Listeners ───────────────────────────────────────────────────────────

    // Type checkboxes (fchk)
    body.querySelectorAll('.fchk').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.fchk;
            handleFchkToggle(key);
        });
    });

    // Sort grid
    body.querySelectorAll('.ms-sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const v = btn.dataset.sort;
            if (v === 'proximity_asc' && !state.homeLocation) {
                showToast(
                    "Définis ton lieu de résidence dans Mon Espace pour activer ce tri.",
                    'info', 4500
                );
                return;
            }
            setMobileSort(v);
            renderFilterSheetBody();
            renderMobileCircuitsList();
        });
    });

    // Zone list
    body.querySelectorAll('.ms-zone-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const v = btn.dataset.zone || null;
            setActiveFilter('zone', v);
            renderFilterSheetBody();
            renderMobileCircuitsList();
        });
    });

    // Mon parcours (segmented)
    body.querySelectorAll('#ms-fseg-completion button[data-completion]').forEach(btn => {
        btn.addEventListener('click', () => {
            filterCompletion = btn.dataset.completion;
            setFilterCompleted(filterCompletion === 'todo');
            lastSeenStateFilterCompleted = (filterCompletion === 'todo');
            renderFilterSheetBody();
            renderMobileCircuitsList();
        });
    });

    // Slider (range)
    const slider = body.querySelector('#ms-fslider');
    if (slider) setupMobileSlider(slider);
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
    }
    // Toggle in-place les classes is-on (pas de rerender HTML — préserve les
    // listeners et l'identité DOM, plus stable pour clicks rapides successifs).
    syncFchkClasses();
    updateSheetBadge();
    renderMobileCircuitsList();
}

function syncFchkClasses() {
    if (!sheetEl) return;
    sheetEl.querySelector('.fchk[data-fchk="official"]')?.classList.toggle('is-on', filterTypeOfficial);
    sheetEl.querySelector('.fchk[data-fchk="verified"]')?.classList.toggle('is-on', filterTypeVerified);
    sheetEl.querySelector('.fchk[data-fchk="resto"]')?.classList.toggle('is-on', filterTypeResto);
}

// Slider double-handle (range min/max), pointer events, touch-friendly.
// Réplique du setupSlider PC, adapté au préfixe `ms-` côté mobile.
function setupMobileSlider(track) {
    if (!sheetEl) return;
    const fill = sheetEl.querySelector('#ms-fslider-fill');
    const handleMin = sheetEl.querySelector('#ms-fslider-handle-min');
    const handleMax = sheetEl.querySelector('#ms-fslider-handle-max');
    const bubbleMin = sheetEl.querySelector('#ms-fslider-bubble-min');
    const bubbleMax = sheetEl.querySelector('#ms-fslider-bubble-max');
    const valueLabel = sheetEl.querySelector('#ms-fslider-value');

    let activeHandle = null;

    function pickClosestHandle(clientX) {
        const rect = track.getBoundingClientRect();
        const x = clientX - rect.left;
        const minX = (filterMinKm / DIST_MAX_KM) * rect.width;
        const maxX = (filterMaxKm / DIST_MAX_KM) * rect.width;
        return Math.abs(x - minX) <= Math.abs(x - maxX) ? 'min' : 'max';
    }

    function updateFromX(clientX) {
        if (!activeHandle) return;
        const rect = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        let km = Math.round(pct * DIST_MAX_KM);
        if (activeHandle === 'min') {
            km = Math.min(km, filterMaxKm);
            if (km === filterMinKm) return;
            filterMinKm = km;
        } else {
            km = Math.max(km, filterMinKm);
            if (km === filterMaxKm) return;
            filterMaxKm = km;
        }
        applyVisualSlider();
        renderMobileCircuitsList();
        updateSheetBadge();
    }

    function applyVisualSlider() {
        const minPct = (filterMinKm / DIST_MAX_KM) * 100;
        const maxPct = (filterMaxKm / DIST_MAX_KM) * 100;
        if (fill) {
            fill.style.left = minPct + '%';
            fill.style.width = (maxPct - minPct) + '%';
        }
        if (handleMin) handleMin.style.left = minPct + '%';
        if (handleMax) handleMax.style.left = maxPct + '%';
        if (bubbleMin) bubbleMin.textContent = `${filterMinKm} km`;
        if (bubbleMax) bubbleMax.textContent = `${filterMaxKm} km`;
        if (valueLabel) {
            valueLabel.textContent = (filterMinKm === 0 && filterMaxKm === DIST_MAX_KM)
                ? `${DIST_MAX_KM} km (tous)`
                : `${filterMinKm} → ${filterMaxKm} km`;
        }
    }

    track.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { track.setPointerCapture(e.pointerId); } catch { /* iOS edge */ }
        const handleHit = e.target.closest('.fslider-handle');
        activeHandle = handleHit ? handleHit.dataset.handle : pickClosestHandle(e.clientX);
        track.classList.add('is-active');
        if (handleMin) handleMin.classList.toggle('is-active', activeHandle === 'min');
        if (handleMax) handleMax.classList.toggle('is-active', activeHandle === 'max');
        updateFromX(e.clientX);
    });
    track.addEventListener('pointermove', (e) => {
        if (track.hasPointerCapture && track.hasPointerCapture(e.pointerId)) {
            updateFromX(e.clientX);
        }
    });
    const endDrag = (e) => {
        try { track.releasePointerCapture(e.pointerId); } catch { /* ok */ }
        track.classList.remove('is-active');
        if (handleMin) handleMin.classList.remove('is-active');
        if (handleMax) handleMax.classList.remove('is-active');
        activeHandle = null;
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
}
