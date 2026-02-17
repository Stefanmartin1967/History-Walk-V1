// src/table.js
import { deleteFeature, saveStateToHistory } from './storage.js'; 
import { decodeText } from './utils.js';

const columnsConfig = [
    { key: 'HW_ID', label: 'ID', hidden: true },
    { key: 'Nom du site FR', label: 'Nom', widthClass: 'col-nom', editable: false, type: 'search' },
    { key: 'Catégorie', label: 'Catégorie', widthClass: 'col-cat', editable: false },
    { key: 'Coordonnées GPS', label: 'GPS', widthClass: 'col-gps', editable: false, type: 'gps' },
    { key: 'Description', label: 'Description', widthClass: 'col-desc', editable: false },
    { key: 'Source', label: 'Source', widthClass: 'col-source', editable: false, type: 'url' },
    { key: 'actions', label: '', widthClass: 'col-actions', type: 'actions', editable: false }
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
        if (col.type !== 'actions' && col.key !== 'Source') { 
            const wrapper = document.createElement('div');
            wrapper.className = 'filter-wrapper';
            const input = document.createElement('input');
            input.className = "filter-input";
            input.placeholder = "...";
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
        } else {
             thFilter.innerHTML = ''; 
        }
        trFilter.appendChild(thFilter);
    });
    tableHead.appendChild(trTitle);
    tableHead.appendChild(trFilter);
}

export function renderTableRows(features) {
    tableBody.innerHTML = '';
    const fragment = document.createDocumentFragment();

    features.forEach((feature, index) => {
        const props = feature.properties;
        const tr = document.createElement('tr');
        tr.dataset.index = index;

        columnsConfig.forEach(col => {
            if (col.hidden) return;
            
            const td = document.createElement('td');
            td.className = col.widthClass || '';

            // --- CHANGEMENT MAJEUR ---
            // On crée un wrapper (conteneur) pour le contenu Flexbox
            // Cela permet au TD de rester un TD normal (pour la largeur)
            // et au contenu d'être flexible (pour l'alignement)
            const wrapper = document.createElement('div');
            wrapper.className = 'cell-content';

            if (col.type === 'actions') {
                // Actions (Edit/Delete)
                // Ici on ajoute une classe spécifique si besoin, mais cell-content fait déjà le job
                const btnEdit = document.createElement('button');
                btnEdit.className = 'icon-btn-shared btn-edit';
                btnEdit.innerHTML = `<i data-lucide="pencil"></i>`;
                btnEdit.title = "Modifier";
                btnEdit.onclick = () => {
                    document.dispatchEvent(new CustomEvent('request:edit', { detail: { index } }));
                };

                const btnDel = document.createElement('button');
                btnDel.className = 'icon-btn-shared btn-delete'; 
                btnDel.innerHTML = `<i data-lucide="trash-2"></i>`;
                btnDel.title = "Supprimer";
                btnDel.onclick = () => deleteFeature(index);

                wrapper.appendChild(btnEdit);
                wrapper.appendChild(btnDel);
                
            } else {
                // Contenu standard (Texte + Icone)
                const val = props[col.key];
                
                // 1. AJOUT DU TEXTE (sauf pour Source)
                if (col.key !== 'Source') {
                    let displayVal = val;
                    if (col.type === 'url') displayVal = decodeText(val);

                    const spanContent = document.createElement('span');
                    spanContent.className = 'editable-cell'; 
                    spanContent.textContent = displayVal || '';
                    spanContent.title = val || ''; 
                    wrapper.appendChild(spanContent);
                }

                // 2. AJOUT DES ICÔNES
                if (col.type === 'search' && val) {
                    appendLink(wrapper, `https://www.google.com/search?q=${encodeURIComponent(val + ' Djerba')}`, 'search', 'Rechercher');
                }
                
                if (col.type === 'gps' && val) {
                    const parts = val.split(',');
                    if(parts.length === 2) {
                        const lat = parts[0].trim();
                        const lon = parts[1].trim();
                        appendLink(wrapper, `https://www.google.com/maps?q=${lat},${lon}`, 'map-pin', 'Voir sur Maps');
                    }
                }

                if (col.type === 'url' && val) {
                    appendLink(wrapper, val, 'external-link', 'Ouvrir le lien');
                }
            }
            
            // On met le wrapper DANS le td
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
    a.href = href; a.target = "_blank"; 
    a.className = 'icon-btn-shared'; 
    a.title = title || "";
    a.innerHTML = `<i data-lucide="${icon}"></i>`;
    parent.appendChild(a);
}

function applyFilters() {
    const rows = tableBody.querySelectorAll('tr');
    let c = 0;
    rows.forEach(row => {
        let visible = true;
        const txt = row.innerText.toLowerCase(); 
        for (const [key, val] of Object.entries(activeFilters)) {
            if (val && !txt.includes(val.toLowerCase())) visible = false;
        }
        row.style.display = visible ? '' : 'none';
        if(visible) c++;
    });
    resultCounter.textContent = `${c} visible(s)`;
    resultCounter.classList.remove('hidden');
}