import { state, POI_CATEGORIES } from './state.js';
import { applyFilters } from './data.js';
import { getZonesData } from './circuit-actions.js';
import { escapeXml } from './utils.js';
import { loadCircuitById } from './circuit.js';
import { switchSidebarTab } from './ui-sidebar.js';

export function populateZonesMenu() {
    const zonesMenu = document.getElementById('zonesMenu');
    const zonesLabel = document.getElementById('zonesLabel');
    if (!zonesMenu) return;

    zonesMenu.innerHTML = '';

    // On demande les données calculées au spécialiste
    const data = getZonesData();

    if (!data || data.sortedZones.length === 0) {
        zonesMenu.innerHTML = '<button disabled>Aucune zone visible</button>';
        return;
    }

    // Création du bouton "Toutes"
    const allZonesBtn = document.createElement('button');
    allZonesBtn.textContent = `Toutes les zones (${data.totalVisible})`;
    allZonesBtn.onclick = () => {
        state.activeFilters.zone = null;
        if(zonesLabel) zonesLabel.textContent = 'Zone';
        zonesMenu.style.display = 'none';
        applyFilters();
    };
    zonesMenu.appendChild(allZonesBtn);

    // Création des boutons par zone
    data.sortedZones.forEach(zone => {
        const zoneBtn = document.createElement('button');
        zoneBtn.textContent = `${zone} (${data.zoneCounts[zone]})`;
        zoneBtn.onclick = () => {
            state.activeFilters.zone = zone;
            if(zonesLabel) zonesLabel.textContent = zone;
            zonesMenu.style.display = 'none';
            applyFilters();
        };
        zonesMenu.appendChild(zoneBtn);
    });
}

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

// --- NOTIFICATIONS (TOASTS) ---

export function populateAddPoiModalCategories() {
    const select = document.getElementById('new-poi-category');
    if (!select) return;

    select.innerHTML = POI_CATEGORIES.map(c =>
        `<option value="${c}">${c}</option>`
    ).join('');

    select.value = "A définir";
}

export function populateCategoriesMenu() {
    const menu = document.getElementById('categoriesMenu');
    if (!menu) return;

    // 1. Déterminer les catégories disponibles (Data Source)
    let categories = [];
    if (state.loadedFeatures && state.loadedFeatures.length > 0) {
        const cats = new Set(
            state.loadedFeatures
                .map(f => f.properties['Catégorie'])
                .filter(c => c && c.trim() !== '')
        );
        categories = Array.from(cats).sort();
    } else {
        categories = POI_CATEGORIES;
    }

    // 2. Vérifier si on doit reconstruire le DOM
    // On regarde les labels existants pour éviter les rebuilds inutiles (clignotements, scroll reset)
    const existingLabels = Array.from(menu.querySelectorAll('label')).map(l => l.innerText.trim());
    const needsRebuild = existingLabels.length !== categories.length ||
                         !existingLabels.every((l, i) => l === categories[i]);

    if (!needsRebuild) {
        // MAJ des checkboxes uniquement (Sync avec activeFilters)
        const checkboxes = menu.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.checked = state.activeFilters.categories.includes(cb.value);
        });
        return;
    }

    // 3. Reconstruction (Si nécessaire)
    menu.innerHTML = '';

    // --- "TOUT VOIR" (Option par défaut) ---
    const allWrapper = document.createElement('label');
    allWrapper.style.display = 'flex';
    allWrapper.style.alignItems = 'center';
    allWrapper.style.padding = '8px 16px';
    allWrapper.style.cursor = 'pointer';
    allWrapper.style.userSelect = 'none';
    allWrapper.style.borderBottom = '1px solid var(--surface-muted)';

    const allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.value = 'ALL';
    allCb.style.marginRight = '10px';
    // Coché si aucun filtre n'est actif
    allCb.checked = state.activeFilters.categories.length === 0;

    allCb.addEventListener('change', (e) => {
        if (e.target.checked) {
            // Si on coche "Tout voir", on vide la liste des filtres
            state.activeFilters.categories = [];
            // Et on décoche visuellement les autres
            menu.querySelectorAll('input[type="checkbox"]:not([value="ALL"])').forEach(c => c.checked = false);
        } else {
            // On empêche de décocher "Tout voir" si c'est la seule option active (pour éviter état vide)
            // Sauf si une autre catégorie est cochée (géré par la logique inverse)
            if (state.activeFilters.categories.length === 0) {
                e.target.checked = true;
                return;
            }
        }
        applyFilters();
    });

    allWrapper.appendChild(allCb);
    allWrapper.appendChild(document.createTextNode("Tout voir"));
    allWrapper.addEventListener('mouseenter', () => allWrapper.style.backgroundColor = 'var(--surface-muted)');
    allWrapper.addEventListener('mouseleave', () => allWrapper.style.backgroundColor = 'transparent');
    menu.appendChild(allWrapper);

    // --- LISTE DES CATÉGORIES ---
    categories.forEach(cat => {
        const wrapper = document.createElement('label');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.padding = '8px 16px';
        wrapper.style.cursor = 'pointer';
        wrapper.style.userSelect = 'none';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = cat;
        cb.style.marginRight = '10px';

        if (state.activeFilters.categories.includes(cat)) {
            cb.checked = true;
        }

        cb.addEventListener('change', (e) => {
            if (e.target.checked) {
                state.activeFilters.categories.push(cat);
                // Si on coche une catégorie, on décoche "Tout voir"
                allCb.checked = false;
            } else {
                state.activeFilters.categories = state.activeFilters.categories.filter(c => c !== cat);
                // Si plus aucune catégorie n'est cochée, on recoche "Tout voir"
                if (state.activeFilters.categories.length === 0) {
                    allCb.checked = true;
                }
            }
            applyFilters();
        });

        wrapper.appendChild(cb);
        wrapper.appendChild(document.createTextNode(cat));

        wrapper.addEventListener('mouseenter', () => wrapper.style.backgroundColor = 'var(--surface-muted)');
        wrapper.addEventListener('mouseleave', () => wrapper.style.backgroundColor = 'transparent');

        menu.appendChild(wrapper);
    });
}
