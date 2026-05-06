// src/table.js
import { deleteFeature, getUniqueValues } from './storage.js';

const columnsConfig = [
    { key: 'HW_ID', label: 'ID', hidden: true },
    { key: 'verified', label: '✓', widthClass: 'col-verif', type: 'verified' },
    { key: 'Nom du site FR', label: 'Nom', widthClass: 'col-nom', type: 'search' },
    { key: 'Catégorie', label: 'Catégorie', widthClass: 'col-cat' },
    { key: 'Zone', label: 'Zone', widthClass: 'col-zone' },
    { key: 'actions', label: '', widthClass: 'col-actions', type: 'actions' }
];

// État des filtres centralisé (lu par main.js, mis à jour via setFilter).
// Les filtres "avancés" (noDesc, noPhoto, notVerified) sont des booléens.
const activeFilters = {
    nom: '',
    categorie: '',
    zone: '',
    noDesc: false,
    noPhoto: false,
    notVerified: false
};

const tableBody = document.querySelector('#data-table tbody');
const tableHead = document.querySelector('#data-table thead');
const resultCounter = document.getElementById('result-counter');

let lastFeatures = [];

export function initTable() { renderHeader(); }

function renderHeader() {
    tableHead.innerHTML = '';
    const trTitle = document.createElement('tr');

    columnsConfig.forEach(col => {
        if (col.hidden) return;
        const th = document.createElement('th');
        th.textContent = col.label;
        th.className = col.widthClass || '';
        trTitle.appendChild(th);
    });

    tableHead.appendChild(trTitle);
}

export function setFilter(key, value) {
    if (!(key in activeFilters)) return;
    activeFilters[key] = value;
    applyFilters();
}

export function getActiveFilters() {
    return { ...activeFilters };
}

export function getAdvancedFilterCounts() {
    const features = lastFeatures;
    return {
        noDesc: features.filter(f => !hasDescription(f.properties)).length,
        noPhoto: features.filter(f => !hasPhoto(f.properties)).length,
        notVerified: features.filter(f => !f.properties.verified).length
    };
}

function hasDescription(props) {
    const d = (props.Description || props.Description_courte || '').trim();
    return d !== '';
}
function hasPhoto(props) {
    return Array.isArray(props.photos) && props.photos.length > 0;
}

function passesFilters(props) {
    const f = activeFilters;
    if (f.nom && !(props['Nom du site FR'] || '').toLowerCase().includes(f.nom.toLowerCase())) return false;
    if (f.categorie && props['Catégorie'] !== f.categorie) return false;
    if (f.zone && props['Zone'] !== f.zone) return false;
    if (f.noDesc && hasDescription(props)) return false;
    if (f.noPhoto && hasPhoto(props)) return false;
    if (f.notVerified && props.verified) return false;
    return true;
}

export function renderTableRows(features) {
    lastFeatures = features;
    tableBody.innerHTML = '';
    const fragment = document.createDocumentFragment();

    features.forEach((feature, index) => {
        const props = feature.properties;
        const tr = document.createElement('tr');
        tr.dataset.index = index;
        tr.addEventListener('click', (e) => {
            if (e.target.closest('button, a')) return;
            document.querySelectorAll('#data-table tbody tr').forEach(r => r.classList.remove('row-active'));
            tr.classList.add('row-active');
            document.dispatchEvent(new CustomEvent('request:preview', { detail: { index } }));
        });

        columnsConfig.forEach(col => {
            if (col.hidden) return;

            const td = document.createElement('td');
            td.className = col.widthClass || '';
            td.dataset.col = col.key;

            const wrapper = document.createElement('div');
            wrapper.className = 'cell-content';

            if (col.type === 'verified') {
                const isVerified = !!props['verified'];
                const badge = document.createElement('span');
                badge.className = isVerified ? 'verif-badge verif-yes' : 'verif-badge verif-no';
                badge.title = isVerified ? 'Vérifié' : 'Non vérifié';
                badge.textContent = isVerified ? '✓' : '–';
                wrapper.appendChild(badge);
            } else if (col.type === 'actions') {
                const btnEdit = document.createElement('button');
                btnEdit.className = 'icon-btn-shared btn-edit';
                btnEdit.innerHTML = `<i data-lucide="pencil"></i>`;
                btnEdit.title = 'Modifier';
                btnEdit.onclick = () => {
                    document.dispatchEvent(new CustomEvent('request:edit', { detail: { index } }));
                };

                const btnDel = document.createElement('button');
                btnDel.className = 'icon-btn-shared btn-delete';
                btnDel.innerHTML = `<i data-lucide="trash-2"></i>`;
                btnDel.title = 'Supprimer';
                btnDel.onclick = () => deleteFeature(index);

                wrapper.appendChild(btnEdit);
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
    document.dispatchEvent(new CustomEvent('table:filters-applied', { detail: { visibleCount, total: lastFeatures.length } }));
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
