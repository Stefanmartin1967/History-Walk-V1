// src/table.js
import { deleteFeature, saveStateToHistory, getUniqueValues } from './storage.js';
import { decodeText } from './utils.js';

const columnsConfig = [
    { key: 'HW_ID', label: 'ID', hidden: true },
    { key: 'verified', label: '✓', widthClass: 'col-verif', type: 'verified' },
    { key: 'Nom du site FR', label: 'Nom', widthClass: 'col-nom', type: 'search' },
    { key: 'Catégorie', label: 'Catégorie', widthClass: 'col-cat', type: 'dropdown' },
    { key: 'Zone', label: 'Zone', widthClass: 'col-zone', type: 'dropdown' },
    { key: 'actions', label: '', widthClass: 'col-actions', type: 'actions' }
];

let activeFilters = {};
const tableBody = document.querySelector('#data-table tbody');
const tableHead = document.querySelector('#data-table thead');
const resultCounter = document.getElementById('result-counter');

export function initTable() { renderHeader(); }

function renderHeader() {
    tableHead.innerHTML = '';
    const trTitle = document.createElement('tr');
    const trFilter = document.createElement('tr');
    trFilter.className = 'filter-row';

    columnsConfig.forEach(col => {
        if (col.hidden) return;

        const th = document.createElement('th');
        th.textContent = col.label;
        th.className = col.widthClass || '';
        trTitle.appendChild(th);

        const thFilter = document.createElement('th');

        if (col.type === 'actions' || col.type === 'verified') {
            thFilter.innerHTML = '';
        } else if (col.type === 'dropdown') {
            const select = document.createElement('select');
            select.className = 'filter-input filter-select';
            select.dataset.filterKey = col.key;
            select.innerHTML = '<option value="">Tous</option>';
            if (activeFilters[col.key]) select.value = activeFilters[col.key];

            select.addEventListener('change', (e) => {
                activeFilters[col.key] = e.target.value;
                applyFilters();
            });
            thFilter.appendChild(select);
        } else {
            const wrapper = document.createElement('div');
            wrapper.className = 'filter-wrapper';

            const input = document.createElement('input');
            input.className = 'filter-input';
            input.placeholder = '...';
            if (activeFilters[col.key]) input.value = activeFilters[col.key];

            input.addEventListener('input', (e) => {
                activeFilters[col.key] = e.target.value;
                applyFilters();
            });

            const reset = document.createElement('span');
            reset.className = 'filter-reset';
            reset.textContent = '×';
            reset.onclick = () => { input.value = ''; activeFilters[col.key] = ''; applyFilters(); };

            wrapper.appendChild(input);
            wrapper.appendChild(reset);
            thFilter.appendChild(wrapper);
        }

        trFilter.appendChild(thFilter);
    });

    tableHead.appendChild(trTitle);
    tableHead.appendChild(trFilter);
}

function refreshFilterDropdowns() {
    columnsConfig.filter(c => c.type === 'dropdown').forEach(col => {
        const select = tableHead.querySelector(`select[data-filter-key="${col.key}"]`);
        if (!select) return;
        const current = select.value;
        const values = getUniqueValues(col.key);
        select.innerHTML = '<option value="">Tous</option>';
        values.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            if (v === current) opt.selected = true;
            select.appendChild(opt);
        });
    });
}

export function renderTableRows(features) {
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
    refreshFilterDropdowns();
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
    let c = 0;
    rows.forEach(row => {
        let visible = true;
        for (const [key, val] of Object.entries(activeFilters)) {
            if (!val) continue;
            const cell = row.querySelector(`td[data-col="${key}"]`);
            const cellText = cell ? (cell.textContent || '').toLowerCase() : '';
            if (!cellText.includes(val.toLowerCase())) { visible = false; break; }
        }
        row.style.display = visible ? '' : 'none';
        if (visible) c++;
    });
    resultCounter.textContent = `${c} visible(s)`;
    resultCounter.classList.remove('hidden');
}
