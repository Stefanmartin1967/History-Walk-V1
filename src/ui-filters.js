// ui-filters.js
// PR 3 (refonte topbar Claude Design) : populateZonesMenu + populateCategoriesMenu
// retirées (anciens dropdowns du topbar). Tout passe désormais par le panneau
// de filtres unifié (cf. filter-panel.js + topbar-v2.js).
// Subsiste : populateAddPoiModalCategories (modale d'ajout POI mobile) et
// populateCircuitsMenu (menu Circuits mobile).

import { state, POI_CATEGORIES } from './state.js';
import { escapeXml } from './utils.js';
import { loadCircuitById } from './circuit.js';
import { switchSidebarTab } from './ui-sidebar.js';

export function populateCircuitsMenu() {
    const circuitsMenu = document.getElementById('circuitsMenu');
    if (!circuitsMenu) return;

    circuitsMenu.innerHTML = '';
    const visibleCircuits = state.myCircuits.filter(c => !c.isDeleted);

    if (visibleCircuits.length === 0) {
        circuitsMenu.innerHTML = '<button disabled>Aucun circuit</button>';
        return;
    }

    visibleCircuits.forEach(circuit => {
        const btn = document.createElement('button');
        btn.textContent = escapeXml(circuit.name);
        btn.onclick = () => {
            loadCircuitById(circuit.id);
            switchSidebarTab('circuit');
            circuitsMenu.style.display = 'none';
        };
        circuitsMenu.appendChild(btn);
    });
}

export function populateAddPoiModalCategories() {
    const select = document.getElementById('new-poi-category');
    if (!select) return;

    select.innerHTML = POI_CATEGORIES.map(c =>
        `<option value="${c}">${c}</option>`
    ).join('');

    select.value = "A définir";
}
