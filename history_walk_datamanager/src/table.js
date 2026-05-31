// src/table.js
import { deleteFeature, getUniqueValues } from './storage.js';

const columnsConfig = [
    { key: 'select', label: '', widthClass: 'col-select', type: 'select' },
    { key: 'HW_ID', label: 'ID', hidden: true },
    { key: 'verified', label: '✓', widthClass: 'col-verif', type: 'verified' },
    { key: 'Nom du site FR', label: 'Nom', widthClass: 'col-nom', type: 'search' },
    { key: 'actions', label: '', widthClass: 'col-actions', type: 'actions' }
];

// État des filtres centralisé (lu par main.js, mis à jour via setFilter).
// Les filtres "avancés" `description` et `verified` sont en 3 états
// ('all' | 'hide' | 'only') alignés sur le pattern HW (PR #446).
//   - 'hide' : cache les POIs qui ont la propriété (ex: cache ceux qui ont une description)
//   - 'only' : montre uniquement ceux qui ont la propriété
const activeFilters = {
    nom: '',
    categorie: '',
    zone: '',
    description: 'all',
    verified: 'all'
};

const tableBody = document.querySelector('#data-table tbody');
const tableHead = document.querySelector('#data-table thead');
const resultCounter = document.getElementById('result-counter');

let lastFeatures = [];

// Sélection multi-lignes pour le bulk-edit (PR4 catégorisation). Stocke les
// index dans lastFeatures (= globalGeoJSON.features). Vidée à chaque re-render
// complet et à chaque changement du filtre Catégorie (les sous-types proposés
// dans la barre bulk dépendent de la catégorie filtrée).
const selectedIndices = new Set();
let headerCheckbox = null;

export function initTable() { renderHeader(); }

function renderHeader() {
    tableHead.innerHTML = '';
    const trTitle = document.createElement('tr');

    columnsConfig.forEach(col => {
        if (col.hidden) return;
        const th = document.createElement('th');
        th.className = col.widthClass || '';
        if (col.type === 'select') {
            headerCheckbox = document.createElement('input');
            headerCheckbox.type = 'checkbox';
            headerCheckbox.className = 'bulk-select-all';
            headerCheckbox.title = 'Tout sélectionner (lignes visibles)';
            headerCheckbox.addEventListener('change', onHeaderCheckboxToggle);
            th.appendChild(headerCheckbox);
        } else {
            th.textContent = col.label;
        }
        trTitle.appendChild(th);
    });

    tableHead.appendChild(trTitle);
}

// --- SÉLECTION MULTI-LIGNES (bulk-edit PR4) ---

function emitSelectionChanged() {
    document.dispatchEvent(new CustomEvent('table:selection-changed', {
        detail: { count: selectedIndices.size }
    }));
}

function visibleRowEls() {
    return [...tableBody.querySelectorAll('tr')].filter(r => r.style.display !== 'none');
}

// Reflète l'état de la checkbox d'en-tête : cochée si toutes les lignes
// visibles sont sélectionnées, indéterminée si une partie seulement l'est.
function refreshHeaderCheckbox() {
    if (!headerCheckbox) return;
    const visible = visibleRowEls();
    const selectedVisible = visible.filter(r => selectedIndices.has(Number(r.dataset.index)));
    headerCheckbox.checked = visible.length > 0 && selectedVisible.length === visible.length;
    headerCheckbox.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visible.length;
}

// La checkbox d'en-tête opère sur les lignes visibles uniquement (cohérent
// avec un filtre actif : on (dé)sélectionne ce qu'on voit).
function onHeaderCheckboxToggle() {
    const select = headerCheckbox.checked;
    visibleRowEls().forEach(r => {
        const idx = Number(r.dataset.index);
        if (select) selectedIndices.add(idx);
        else selectedIndices.delete(idx);
        const cb = r.querySelector('.row-select-checkbox');
        if (cb) cb.checked = select;
    });
    refreshHeaderCheckbox();
    emitSelectionChanged();
}

function onRowCheckboxToggle(index, checked) {
    if (checked) selectedIndices.add(index);
    else selectedIndices.delete(index);
    refreshHeaderCheckbox();
    emitSelectionChanged();
}

export function getSelectedIndices() {
    return [...selectedIndices];
}

export function clearSelection() {
    selectedIndices.clear();
    tableBody.querySelectorAll('.row-select-checkbox').forEach(cb => { cb.checked = false; });
    refreshHeaderCheckbox();
    emitSelectionChanged();
}

export function setFilter(key, value) {
    if (!(key in activeFilters)) return;
    activeFilters[key] = value;
    // Changer de catégorie invalide la sélection : les sous-types proposés
    // dans la barre bulk ne valent que pour la catégorie filtrée.
    if (key === 'categorie') clearSelection();
    applyFilters();
}

export function getActiveFilters() {
    return { ...activeFilters };
}

export function getAdvancedFilterCounts() {
    const features = lastFeatures;
    // Compteurs informatifs : nombre de POIs en état "manquant" pour chaque
    // critère. Aide à savoir d'un coup d'œil combien il reste à traiter.
    return {
        noDesc: features.filter(f => !hasDescription(f.properties)).length,
        notVerified: features.filter(f => !f.properties.verified).length
    };
}

function hasDescription(props) {
    const d = (props.description || props.Description_courte || '').trim();
    return d !== '';
}

function passesFilters(props) {
    const f = activeFilters;
    if (f.nom && !(props['Nom du site FR'] || '').toLowerCase().includes(f.nom.toLowerCase())) return false;
    if (f.categorie && props['Catégorie'] !== f.categorie) return false;
    if (f.zone && props['Zone'] !== f.zone) return false;
    // 3 états : 'hide' cache les POIs qui ONT la propriété, 'only' montre QUE ceux-là.
    const hasDesc = hasDescription(props);
    if (f.description === 'hide' && hasDesc) return false;
    if (f.description === 'only' && !hasDesc) return false;
    if (f.verified === 'hide' && props.verified) return false;
    if (f.verified === 'only' && !props.verified) return false;
    return true;
}

export function renderTableRows(features) {
    lastFeatures = features;
    tableBody.innerHTML = '';
    // Re-render complet → la sélection (par index) n'est plus fiable, on repart à zéro.
    selectedIndices.clear();
    const fragment = document.createDocumentFragment();

    features.forEach((feature, index) => {
        const props = feature.properties;
        const tr = document.createElement('tr');
        tr.dataset.index = index;
        // Master-detail : clic ligne = édition directe (le panneau central est
        // toujours visible). Le bouton ✏️ Édit n'est plus nécessaire.
        // On dispatche aussi request:preview pour focuser la carte sur le POI.
        tr.addEventListener('click', (e) => {
            if (e.target.closest('button, a, .col-select')) return;
            document.querySelectorAll('#data-table tbody tr').forEach(r => r.classList.remove('row-active'));
            tr.classList.add('row-active');
            document.dispatchEvent(new CustomEvent('request:preview', { detail: { index } }));
            document.dispatchEvent(new CustomEvent('request:edit', { detail: { index } }));
        });

        columnsConfig.forEach(col => {
            if (col.hidden) return;

            const td = document.createElement('td');
            td.className = col.widthClass || '';
            td.dataset.col = col.key;

            const wrapper = document.createElement('div');
            wrapper.className = 'cell-content';

            if (col.type === 'select') {
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'row-select-checkbox';
                cb.title = 'Sélectionner pour le bulk-edit';
                cb.addEventListener('change', () => onRowCheckboxToggle(index, cb.checked));
                wrapper.appendChild(cb);
            } else if (col.type === 'verified') {
                const isVerified = !!props['verified'];
                const badge = document.createElement('span');
                badge.className = isVerified ? 'verif-badge verif-yes' : 'verif-badge verif-no';
                badge.title = isVerified ? 'Vérifié' : 'Non vérifié';
                badge.textContent = isVerified ? '✓' : '–';
                wrapper.appendChild(badge);
            } else if (col.type === 'actions') {
                // Master-detail : plus de bouton Édit (clic ligne = édition).
                // On garde uniquement Supprimer (action destructrice qui mérite un bouton dédié).
                const btnDel = document.createElement('button');
                btnDel.className = 'icon-btn-shared btn-delete';
                btnDel.innerHTML = `<i data-lucide="trash-2"></i>`;
                btnDel.title = 'Supprimer';
                // stopPropagation : ceinture en complément du fix root cause
                // dans src/modal.js (createIcons scopé à overlay). Évite que
                // le click bubble vers le tr handler qui ouvrirait l'éditeur,
                // même si une régression future ré-introduit le bug SVG-detach.
                btnDel.onclick = (e) => {
                    e.stopPropagation();
                    deleteFeature(index);
                };
                wrapper.appendChild(btnDel);
            } else {
                const val = props[col.key];

                const spanContent = document.createElement('span');
                spanContent.className = 'editable-cell';
                spanContent.textContent = val || '';
                spanContent.title = val || '';
                wrapper.appendChild(spanContent);

                if (col.type === 'search' && val) {
                    appendLink(wrapper, `https://www.google.com/search?q=${encodeURIComponent(val + ' Djerba')}`, 'search', 'Rechercher');
                }
            }

            td.appendChild(wrapper);
            tr.appendChild(td);
        });

        fragment.appendChild(tr);
    });

    tableBody.appendChild(fragment);
    applyFilters();
    emitSelectionChanged();
    document.dispatchEvent(new Event('table:rendered'));
}

function appendLink(parent, href, icon, title) {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank';
    a.className = 'icon-btn-shared';
    a.title = title || '';
    a.innerHTML = `<i data-lucide="${icon}"></i>`;
    parent.appendChild(a);
}

function applyFilters() {
    const rows = tableBody.querySelectorAll('tr');
    let visibleCount = 0;
    rows.forEach((row) => {
        const idx = parseInt(row.dataset.index, 10);
        const feature = lastFeatures[idx];
        if (!feature) return;
        const visible = passesFilters(feature.properties);
        row.style.display = visible ? '' : 'none';
        if (visible) visibleCount++;
    });
    resultCounter.textContent = `${visibleCount} visible(s)`;
    resultCounter.classList.remove('hidden');
    refreshHeaderCheckbox();
}

// Peupler les dropdowns Catégorie / Zone côté toolbar (appelé depuis main.js)
export function refreshToolbarDropdowns() {
    const selCat = document.getElementById('filter-categorie');
    const selZone = document.getElementById('filter-zone');
    if (!selCat || !selZone) return;

    const currentCat = selCat.value;
    const currentZone = selZone.value;

    const cats = getUniqueValues('Catégorie');
    selCat.innerHTML = '<option value="">Toutes catégories</option>';
    cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        if (c === currentCat) opt.selected = true;
        selCat.appendChild(opt);
    });

    const zones = getUniqueValues('Zone');
    selZone.innerHTML = '<option value="">Toutes zones</option>';
    zones.forEach(z => {
        const opt = document.createElement('option');
        opt.value = z;
        opt.textContent = z;
        if (z === currentZone) opt.selected = true;
        selZone.appendChild(opt);
    });
}
