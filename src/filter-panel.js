// filter-panel.js
// Panneau de filtres unifié — refonte Claude Design.
// PR 1 (foundation) : structure + section Localisation câblée.
// PR 2 (cette PR)   : Catégories + Mon parcours (3-states + incontournables) +
//                     État de la fiche (non vérifiés / sans photo / sans description).
// La topbar actuelle reste intacte — l'ouverture du panneau se fait via une
// entrée temporaire dans le menu Outils. PR 3 fera la bascule visuelle.

import { state, setActiveFilters, POI_CATEGORIES } from './state.js';
import { applyFilters } from './data.js';
import { getZonesData } from './circuit-actions.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { eventBus } from './events.js';

const PANEL_ID = 'hw-filter-panel';
const VISIT_OPTIONS = [
    { value: 'all',  label: 'Tous'     },
    { value: 'hide', label: 'Masquer'  },
    { value: 'only', label: 'Afficher' },
];

// ─── Rendu HTML (squelette) ───────────────────────────────────────────────

function buildPanelHtml() {
    return `
        <div class="hw-fp-header">
            <span class="hw-fp-header-icon"><i data-lucide="filter"></i></span>
            <div class="hw-fp-header-text">
                <h2 class="hw-fp-title">Filtres</h2>
                <div class="hw-fp-subtitle" id="hw-fp-subtitle">Aucun filtre actif</div>
            </div>
            <button class="hw-fp-close" id="hw-fp-close" title="Fermer" aria-label="Fermer">
                <i data-lucide="x"></i>
            </button>
        </div>

        <div class="hw-fp-body">
            ${buildSection('localisation', 'Localisation', `
                <button class="hw-fp-select" id="hw-fp-zone-select">
                    <span class="hw-fp-select-icon"><i data-lucide="map-pin"></i></span>
                    <span class="hw-fp-select-value" id="hw-fp-zone-value">Toutes les zones</span>
                    <span class="hw-fp-select-icon"><i data-lucide="chevron-down"></i></span>
                </button>
                <div class="hw-fp-zones-list" id="hw-fp-zones-list"></div>
            `)}

            ${buildSection('categories', 'Type de lieu', `
                <div class="hw-fp-checklist" id="hw-fp-categories-list"></div>
            `)}

            ${buildSection('parcours', 'Mon parcours', `
                <div id="hw-fp-parcours-content"></div>
            `)}

            ${buildSection('fiche', 'État de la fiche', `
                <div id="hw-fp-fiche-content"></div>
            `, { collapsed: true })}
        </div>

        <div class="hw-fp-footer">
            <span class="hw-fp-footer-status">Mise à jour temps réel</span>
            <button class="hw-fp-reset-btn" id="hw-fp-reset" disabled>Tout réinitialiser</button>
        </div>
    `;
}

function buildSection(id, title, content, { collapsed = false, active = false } = {}) {
    const classes = ['hw-fp-section'];
    if (collapsed) classes.push('is-collapsed');
    if (active) classes.push('is-active');
    return `
        <div class="${classes.join(' ')}" data-section="${id}">
            <button class="hw-fp-section-header" data-section-toggle="${id}">
                <span class="hw-fp-chevron"><i data-lucide="chevron-down"></i></span>
                <span class="hw-fp-section-title">${title}</span>
                <span class="hw-fp-section-badges" id="hw-fp-badges-${id}"></span>
            </button>
            <div class="hw-fp-section-content">${content}</div>
        </div>
    `;
}

// ─── Section Localisation ─────────────────────────────────────────────────

function refreshZonesList() {
    const list = document.getElementById('hw-fp-zones-list');
    const valueEl = document.getElementById('hw-fp-zone-value');
    if (!list || !valueEl) return;

    const data = getZonesData();
    const currentZone = state.activeFilters.zone;

    list.innerHTML = '';
    if (!data || data.sortedZones.length === 0) {
        list.innerHTML = '<button class="hw-fp-zone-btn" disabled>Aucune zone visible</button>';
        valueEl.textContent = 'Toutes les zones';
        return;
    }

    const allBtn = document.createElement('button');
    allBtn.className = 'hw-fp-zone-btn' + (currentZone === null ? ' is-current' : '');
    allBtn.innerHTML = `<span>Toutes les zones</span><span class="hw-fp-zone-count">${data.totalVisible}</span>`;
    allBtn.addEventListener('click', () => selectZone(null));
    list.appendChild(allBtn);

    data.sortedZones.forEach(zone => {
        const btn = document.createElement('button');
        btn.className = 'hw-fp-zone-btn' + (currentZone === zone ? ' is-current' : '');
        btn.innerHTML = `<span>${escapeHtml(zone)}</span><span class="hw-fp-zone-count">${data.zoneCounts[zone]}</span>`;
        btn.addEventListener('click', () => selectZone(zone));
        list.appendChild(btn);
    });

    valueEl.textContent = currentZone || 'Toutes les zones';
}

function selectZone(zone) {
    setActiveFilters({ ...state.activeFilters, zone });
    applyFilters();
    refreshZonesList();
    closeZonesList();
    refreshAllMeta();
}

function toggleZonesList() {
    const list = document.getElementById('hw-fp-zones-list');
    if (!list) return;
    list.classList.toggle('is-open');
    if (list.classList.contains('is-open')) refreshZonesList();
}

function closeZonesList() {
    document.getElementById('hw-fp-zones-list')?.classList.remove('is-open');
}

// ─── Section Catégories ───────────────────────────────────────────────────

function getAvailableCategories() {
    if (state.loadedFeatures && state.loadedFeatures.length > 0) {
        const cats = new Set(
            state.loadedFeatures
                .map(f => f.properties['Catégorie'])
                .filter(c => c && c.trim() !== '')
        );
        return Array.from(cats).sort();
    }
    return POI_CATEGORIES;
}

function getCategoryCounts() {
    const counts = {};
    if (!state.loadedFeatures) return counts;
    state.loadedFeatures.forEach(f => {
        const cat = f.properties['Catégorie'];
        if (cat && cat.trim() !== '') {
            counts[cat] = (counts[cat] || 0) + 1;
        }
    });
    return counts;
}

function populateCategoriesSection() {
    const list = document.getElementById('hw-fp-categories-list');
    if (!list) return;

    const categories = getAvailableCategories();
    const counts = getCategoryCounts();
    const selected = state.activeFilters.categories || [];

    list.innerHTML = '';
    categories.forEach(cat => {
        const row = renderCheckbox({
            label: cat,
            count: counts[cat],
            checked: selected.includes(cat),
            onChange: (isChecked) => {
                const current = state.activeFilters.categories || [];
                const next = isChecked
                    ? [...current, cat]
                    : current.filter(c => c !== cat);
                setActiveFilters({ ...state.activeFilters, categories: next });
                applyFilters();
                refreshAllMeta();
                // Refresh checkbox visual state in place
                row.classList.toggle('is-checked', isChecked);
            },
        });
        list.appendChild(row);
    });
}

// ─── Section Mon parcours ─────────────────────────────────────────────────

function populateParcoursSection() {
    const wrap = document.getElementById('hw-fp-parcours-content');
    if (!wrap) return;
    wrap.innerHTML = '';

    wrap.appendChild(renderRadioGroup({
        label: 'Lieux visités',
        value: state.activeFilters.vus || 'all',
        options: VISIT_OPTIONS,
        onChange: (val) => {
            setActiveFilters({ ...state.activeFilters, vus: val });
            applyFilters();
            populateParcoursSection();
            refreshAllMeta();
        },
    }));

    wrap.appendChild(renderRadioGroup({
        label: 'Lieux planifiés',
        value: state.activeFilters.planifies || 'all',
        options: VISIT_OPTIONS,
        onChange: (val) => {
            setActiveFilters({ ...state.activeFilters, planifies: val });
            applyFilters();
            populateParcoursSection();
            refreshAllMeta();
        },
    }));

    wrap.appendChild(renderIncontournableToggle({
        checked: !!state.activeFilters.incontournablesOnly,
        onChange: (isChecked) => {
            setActiveFilters({ ...state.activeFilters, incontournablesOnly: isChecked });
            applyFilters();
            populateParcoursSection();
            refreshAllMeta();
        },
    }));
}

// ─── Section État de la fiche ─────────────────────────────────────────────

function populateFicheSection() {
    const wrap = document.getElementById('hw-fp-fiche-content');
    if (!wrap) return;
    wrap.innerHTML = '';

    const fiche = [
        { key: 'nonVerifies', label: 'Lieux non vérifiés uniquement' },
        { key: 'noPhoto',     label: 'Lieux sans photo'              },
        { key: 'noDesc',      label: 'Lieux sans description'        },
    ];

    fiche.forEach(({ key, label }) => {
        const row = renderCheckbox({
            label,
            checked: !!state.activeFilters[key],
            onChange: (isChecked) => {
                setActiveFilters({ ...state.activeFilters, [key]: isChecked });
                applyFilters();
                refreshAllMeta();
                row.classList.toggle('is-checked', isChecked);
            },
        });
        wrap.appendChild(row);
    });
}

// ─── Atoms : checkbox / radio group / incontournable ──────────────────────

function renderCheckbox({ label, count, checked, onChange }) {
    const row = document.createElement('label');
    row.className = 'hw-fp-checkbox' + (checked ? ' is-checked' : '');

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));

    const box = document.createElement('span');
    box.className = 'hw-fp-checkbox-box';
    box.innerHTML = '<i data-lucide="check"></i>';

    const labelEl = document.createElement('span');
    labelEl.className = 'hw-fp-checkbox-label';
    labelEl.textContent = label;

    row.appendChild(input);
    row.appendChild(box);
    row.appendChild(labelEl);

    if (count != null) {
        const countEl = document.createElement('span');
        countEl.className = 'hw-fp-checkbox-count';
        countEl.textContent = String(count);
        row.appendChild(countEl);
    }

    return row;
}

function renderRadioGroup({ label, value, options, onChange }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'hw-fp-radio-wrapper';

    const labelEl = document.createElement('div');
    labelEl.className = 'hw-fp-radio-label';
    labelEl.textContent = label;
    wrapper.appendChild(labelEl);

    const group = document.createElement('div');
    group.className = 'hw-fp-radio-group';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hw-fp-radio-btn' + (opt.value === value ? ' is-selected' : '');
        btn.textContent = opt.label;
        btn.dataset.value = opt.value;
        btn.addEventListener('click', () => onChange(opt.value));
        group.appendChild(btn);
    });

    wrapper.appendChild(group);
    return wrapper;
}

function renderIncontournableToggle({ checked, onChange }) {
    const row = document.createElement('label');
    row.className = 'hw-fp-incontournable' + (checked ? ' is-checked' : '');

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));

    const box = document.createElement('span');
    box.className = 'hw-fp-checkbox-box';
    box.innerHTML = '<i data-lucide="check"></i>';

    const label = document.createElement('span');
    label.className = 'hw-fp-incontournable-label';
    label.innerHTML = '<i data-lucide="star"></i>Afficher uniquement les incontournables';

    row.appendChild(input);
    row.appendChild(box);
    row.appendChild(label);
    return row;
}

// ─── Méta : sous-titre + badges sections + reset ──────────────────────────

function isSectionActive(id) {
    const f = state.activeFilters;
    switch (id) {
        case 'localisation': return f.zone !== null;
        case 'categories':   return Array.isArray(f.categories) && f.categories.length > 0;
        case 'parcours':     return (f.vus && f.vus !== 'all')
                                  || (f.planifies && f.planifies !== 'all')
                                  || !!f.incontournablesOnly;
        case 'fiche':        return !!f.nonVerifies || !!f.noPhoto || !!f.noDesc;
        default:             return false;
    }
}

function countActiveSections() {
    return ['localisation', 'categories', 'parcours', 'fiche']
        .reduce((n, id) => n + (isSectionActive(id) ? 1 : 0), 0);
}

function refreshHeaderSubtitle() {
    const sub = document.getElementById('hw-fp-subtitle');
    if (!sub) return;
    const n = countActiveSections();
    sub.textContent = n === 0
        ? 'Aucun filtre actif'
        : `${n} section${n > 1 ? 's' : ''} active${n > 1 ? 's' : ''}`;
}

function refreshSectionStates() {
    ['localisation', 'categories', 'parcours', 'fiche'].forEach(id => {
        const section = document.querySelector(`[data-section="${id}"]`);
        if (!section) return;
        const active = isSectionActive(id);
        section.classList.toggle('is-active', active);
        const badges = document.getElementById(`hw-fp-badges-${id}`);
        if (badges) {
            badges.innerHTML = active
                ? '<span class="hw-fp-section-badge-active">Actif</span>'
                : '';
        }
    });
}

function refreshResetButton() {
    const btn = document.getElementById('hw-fp-reset');
    if (btn) btn.disabled = countActiveSections() === 0;
}

function refreshAllMeta() {
    refreshHeaderSubtitle();
    refreshSectionStates();
    refreshResetButton();
}

function resetAll() {
    setActiveFilters({
        ...state.activeFilters,
        zone: null,
        categories: [],
        vus: 'all',
        planifies: 'all',
        nonVerifies: false,
        incontournablesOnly: false,
        noPhoto: false,
        noDesc: false,
    });
    applyFilters();
    refreshZonesList();
    closeZonesList();
    populateCategoriesSection();
    populateParcoursSection();
    populateFicheSection();
    refreshAllMeta();
    createIcons({ icons: appIcons });
}

// ─── Toggle pli sections ──────────────────────────────────────────────────

function toggleSection(id) {
    document.querySelector(`[data-section="${id}"]`)?.classList.toggle('is-collapsed');
}

// ─── Open / Close panel ───────────────────────────────────────────────────

export function openFilterPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.add('is-open');
    populateCategoriesSection();
    populateParcoursSection();
    populateFicheSection();
    refreshZonesList();
    refreshAllMeta();
    createIcons({ icons: appIcons });
}

export function closeFilterPanel() {
    document.getElementById(PANEL_ID)?.classList.remove('is-open');
    closeZonesList();
}

export function toggleFilterPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.contains('is-open') ? closeFilterPanel() : openFilterPanel();
}

// ─── Init ─────────────────────────────────────────────────────────────────

export function setupFilterPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    panel.innerHTML = buildPanelHtml();
    createIcons({ icons: appIcons });

    panel.querySelector('#hw-fp-close')?.addEventListener('click', closeFilterPanel);

    panel.querySelectorAll('[data-section-toggle]').forEach(header => {
        header.addEventListener('click', () => {
            toggleSection(header.dataset.sectionToggle);
        });
    });

    panel.querySelector('#hw-fp-zone-select')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleZonesList();
    });

    panel.querySelector('#hw-fp-reset')?.addEventListener('click', resetAll);

    // Si l'état des filtres change ailleurs (ex: anciens boutons topbar),
    // on rafraîchit le panneau si ouvert pour rester en sync.
    eventBus.on('data:filtered', () => {
        if (panel.classList.contains('is-open')) {
            refreshZonesList();
            populateCategoriesSection();
            populateParcoursSection();
            populateFicheSection();
            refreshAllMeta();
            createIcons({ icons: appIcons });
        }
    });
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
