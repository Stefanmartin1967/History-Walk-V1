// filter-panel.js
// Panneau de filtres unifié — refonte Claude Design (PR 1 foundation).
// Cette PR met en place la structure visuelle + câble UNIQUEMENT la section
// Localisation au filtre Zone existant. Les autres sections (Catégories,
// Mon parcours, État de la fiche) sont rendues comme stubs visuels et seront
// câblées en PR 2. La topbar actuelle reste intacte — l'ouverture du panneau
// se fait via une entrée temporaire dans le menu Outils.

import { state, setActiveFilters } from './state.js';
import { applyFilters } from './data.js';
import { getZonesData } from './circuit-actions.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { eventBus } from './events.js';

const PANEL_ID = 'hw-filter-panel';

// ─── Rendu HTML ───────────────────────────────────────────────────────────

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
                <div class="hw-fp-stub">Câblage en PR 2 — UI ci-dessus reste fonctionnelle</div>
            `)}

            ${buildSection('parcours', 'Mon parcours', `
                <div class="hw-fp-stub">Câblage en PR 2 — Visités / Planifiés / Incontournables</div>
            `)}

            ${buildSection('fiche', 'État de la fiche', `
                <div class="hw-fp-stub">Câblage en PR 2 — Non vérifiés / Sans photo / Sans description</div>
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

// ─── Câblage Localisation (zone) ──────────────────────────────────────────

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

    // Bouton "Toutes les zones"
    const allBtn = document.createElement('button');
    allBtn.className = 'hw-fp-zone-btn' + (currentZone === null ? ' is-current' : '');
    allBtn.innerHTML = `<span>Toutes les zones</span><span class="hw-fp-zone-count">${data.totalVisible}</span>`;
    allBtn.addEventListener('click', () => selectZone(null));
    list.appendChild(allBtn);

    // Boutons par zone
    data.sortedZones.forEach(zone => {
        const btn = document.createElement('button');
        btn.className = 'hw-fp-zone-btn' + (currentZone === zone ? ' is-current' : '');
        btn.innerHTML = `<span>${escapeHtml(zone)}</span><span class="hw-fp-zone-count">${data.zoneCounts[zone]}</span>`;
        btn.addEventListener('click', () => selectZone(zone));
        list.appendChild(btn);
    });

    // Mise à jour du label du select
    valueEl.textContent = currentZone || 'Toutes les zones';
}

function selectZone(zone) {
    setActiveFilters({ ...state.activeFilters, zone });
    applyFilters();
    refreshZonesList();
    closeZonesList();
    refreshHeaderSubtitle();
    refreshSectionStates();
    refreshResetButton();
}

function toggleZonesList() {
    const list = document.getElementById('hw-fp-zones-list');
    if (!list) return;
    list.classList.toggle('is-open');
    if (list.classList.contains('is-open')) refreshZonesList();
}

function closeZonesList() {
    const list = document.getElementById('hw-fp-zones-list');
    list?.classList.remove('is-open');
}

// ─── Méta : sous-titre + état des sections + reset ────────────────────────

function countActiveSections() {
    let n = 0;
    if (state.activeFilters.zone) n++;
    // Catégories / Mon parcours / Fiche → wired en PR 2
    return n;
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
    const localisation = document.querySelector('[data-section="localisation"]');
    if (localisation) {
        localisation.classList.toggle('is-active', state.activeFilters.zone !== null);
        const badges = document.getElementById('hw-fp-badges-localisation');
        if (badges) {
            badges.innerHTML = state.activeFilters.zone
                ? '<span class="hw-fp-section-badge-active">Actif</span>'
                : '';
        }
    }
}

function refreshResetButton() {
    const btn = document.getElementById('hw-fp-reset');
    if (!btn) return;
    btn.disabled = countActiveSections() === 0;
}

function resetAll() {
    setActiveFilters({ ...state.activeFilters, zone: null });
    applyFilters();
    refreshZonesList();
    closeZonesList();
    refreshHeaderSubtitle();
    refreshSectionStates();
    refreshResetButton();
}

// ─── Toggle section (pliage) ──────────────────────────────────────────────

function toggleSection(id) {
    const section = document.querySelector(`[data-section="${id}"]`);
    section?.classList.toggle('is-collapsed');
}

// ─── Open / Close panel ───────────────────────────────────────────────────

export function openFilterPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.add('is-open');
    refreshZonesList();
    refreshHeaderSubtitle();
    refreshSectionStates();
    refreshResetButton();
}

export function closeFilterPanel() {
    const panel = document.getElementById(PANEL_ID);
    panel?.classList.remove('is-open');
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
    if (!panel) return; // conteneur pas encore dans le DOM

    panel.innerHTML = buildPanelHtml();
    createIcons({ icons: appIcons });

    // Close
    panel.querySelector('#hw-fp-close')?.addEventListener('click', closeFilterPanel);

    // Sections : toggle pli / dépli au clic du header
    panel.querySelectorAll('[data-section-toggle]').forEach(header => {
        header.addEventListener('click', () => {
            toggleSection(header.dataset.sectionToggle);
        });
    });

    // Localisation : ouverture de la liste des zones au clic du select
    panel.querySelector('#hw-fp-zone-select')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleZonesList();
    });

    // Reset
    panel.querySelector('#hw-fp-reset')?.addEventListener('click', resetAll);

    // Si le filtre Zone change ailleurs (ex: ancien dropdown), on rafraîchit
    eventBus.on('data:filtered', () => {
        if (panel.classList.contains('is-open')) {
            refreshZonesList();
            refreshHeaderSubtitle();
            refreshSectionStates();
            refreshResetButton();
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
