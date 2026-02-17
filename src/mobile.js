// mobile.js
import { state } from './state.js';
import { DOM, openDetailsPanel } from './ui.js';
import { getPoiId, getPoiName, addPoiFeature } from './data.js';
import { loadCircuitById, clearCircuit, setCircuitVisitedState, loadCircuitFromIds } from './circuit.js';
import { createIcons, icons } from 'lucide';
import { saveUserData } from './fileManager.js'; 
import { deleteDatabase, saveAppState } from './database.js';
import { getIconForFeature, getRealDistance, getOrthodromicDistance } from './map.js';
import { isPointInPolygon, escapeHtml, getZoneFromCoords } from './utils.js';
import { generateSyncQR, startGenericScanner } from './sync.js';
import QRCode from 'qrcode';
import { zonesData } from './zones.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { getSearchResults } from './search.js';

let currentView = 'circuits'; 
let mobileSort = 'date_desc'; // date_desc, date_asc, dist_asc, dist_desc
// Note: state.activeFilters.zone is used for Zone filtering

export function isMobileView() {
    return window.innerWidth <= 768;
}

export function initMobileMode() {
    document.body.classList.add('mobile-mode');
    
    // Tentative de masquage de la barre d'adresse (Hack Android/iOS)
    setTimeout(() => {
        window.scrollTo(0, 1);
    }, 0);

    // Gestion des boutons de navigation
    const navButtons = document.querySelectorAll('.mobile-nav-btn[data-view]');
    navButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const view = btn.dataset.view;
            switchMobileView(view);
        });
    });

    // --- GESTION DU BOUTON FILTRE (Oeil) ---
    const filterBtn = document.getElementById('btn-mobile-filter');
    
    // On clone le bouton pour supprimer les anciens écouteurs et éviter les bugs
    if (filterBtn) {
        const newFilterBtn = filterBtn.cloneNode(true);
        filterBtn.parentNode.replaceChild(newFilterBtn, filterBtn);
        
        newFilterBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // 1. On inverse l'état
            state.filterCompleted = !state.filterCompleted;
            
            // 2. Définition des valeurs
            const iconName = state.filterCompleted ? 'list-check' : 'list';
            const labelText = state.filterCompleted ? 'A faire' : 'Tout';
            const colorStyle = state.filterCompleted ? 'color:var(--brand);' : '';

            // 3. Reconstruction du bouton
            newFilterBtn.style = colorStyle;
            newFilterBtn.innerHTML = `
                <i data-lucide="${iconName}"></i>
                <span>${labelText}</span>
            `;

            // 5. Rafraîchissement
            if (currentView === 'circuits') {
                renderMobileCircuitsList();
            } else {
                switchMobileView('circuits');
            }
            
            // 6. DESSIN DES ICÔNES ICI (À l'intérieur du clic)
            createIcons({ icons, root: newFilterBtn });

        }); // <-- FIN DU CLIC DÉPLACÉE ICI
    }

    switchMobileView('circuits');
}
       

export function switchMobileView(viewName) {
    currentView = viewName;
    
    document.querySelectorAll('.mobile-nav-btn[data-view]').forEach(btn => {
        if (btn.dataset.view === viewName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const container = document.getElementById('mobile-main-container');
    container.innerHTML = ''; 
    
    // 1. On s'assure que le Dock est visible (Au cas où on vient de la vue détail masquée)
    const dock = document.getElementById('mobile-dock');
    if (dock) dock.style.display = 'flex';

    switch (viewName) {
        case 'circuits':
            renderMobileCircuitsList();
            break;
        case 'search':
            renderMobileSearch();
            break;
        case 'add-poi':
            handleAddPoiClick();
            break;
        case 'actions':
            renderMobileMenu();
            break;
    }
    
    createIcons({ icons, root: container });
}

async function handleAddPoiClick() {
    if (!await showConfirm("Nouveau Lieu", "Capturer votre position GPS actuelle pour créer un nouveau lieu ?", "Capturer", "Annuler")) {
        switchMobileView('circuits');
        return;
    }

    showToast("Acquisition GPS en cours...", "info");

    if (!navigator.geolocation) {
        showToast("GPS non supporté par ce navigateur.", "error");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const { latitude, longitude } = pos.coords;
            const newPoiId = `HW-MOB-${Date.now()}`;
            
            // --- DÉTECTION AUTOMATIQUE DE LA ZONE ---
            let detectedZone = "Hors Zone"; 
            
            // On cherche dans quel polygone on se trouve
            if (zonesData && zonesData.features) {
                for (const feature of zonesData.features) {
                    // On vérifie si la géométrie est valide
                    if (feature.geometry && feature.geometry.type === "Polygon") {
                        const polygonCoords = feature.geometry.coordinates[0];
                        // Appel de ta nouvelle fonction dans utils.js
                        if (isPointInPolygon([longitude, latitude], polygonCoords)) {
                            detectedZone = feature.properties.name; 
                            break; 
                        }
                    }
                }
            }

            const newFeature = {
                type: "Feature",
                geometry: { type: "Point", coordinates: [longitude, latitude] },
                properties: {
                    "Nom du site FR": "Nouveau Lieu",
                    "Catégorie": "A définir",
                    "Zone": detectedZone, // C'est ici que la magie opère !
                    "Description": "Créé sur le terrain",
                    "HW_ID": newPoiId,
                    "created_at": new Date().toISOString()
                }
            };

            addPoiFeature(newFeature);
            await saveAppState('lastGeoJSON', { type: 'FeatureCollection', features: state.loadedFeatures });
            
            showToast(`Lieu créé (Zone : ${detectedZone})`, "success");
            
            const index = state.loadedFeatures.length - 1;
            openDetailsPanel(index);
        },
        (err) => {
            console.error(err);
            showToast("Erreur GPS : " + err.message, "error");
            switchMobileView('circuits');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

export function renderMobileCircuitsList() {
    const container = document.getElementById('mobile-main-container');
    
    // 1. Fusion des listes (Officiels + Locaux)
    const officialCircuits = state.officialCircuits || [];
    const localCircuits = (state.myCircuits || []).filter(c => {
        if (c.isDeleted) return false;

        // DEDUPLICATION : On cache le circuit local si un officiel existe déjà avec le même ID
        // ou le même nom (au cas où l'ID aurait changé lors d'un vieil import)
        const existsInOfficial = officialCircuits.some(off =>
            String(off.id) === String(c.id) ||
            (off.name && c.name && off.name.trim() === c.name.trim())
        );
        return !existsInOfficial;
    });

    // On combine : Officiels d'abord
    let allCircuits = [...officialCircuits, ...localCircuits];

    let circuitsToDisplay = allCircuits;

    // 2. Préparation des données pour tri/filtre
    // On enrichit d'abord pour pouvoir trier
    let enrichedCircuits = circuitsToDisplay.map(c => {
        const validPois = c.poiIds
            .map(id => state.loadedFeatures.find(feat => getPoiId(feat) === id))
            .filter(f => f);
            
        // Distance
        let dist = 0;
        if (c.realTrack) {
            dist = getRealDistance(c);
        } else {
            dist = getOrthodromicDistance(validPois);
        }
        if (c.distance && typeof c.distance === 'string' && dist === 0) {
            const parsed = parseFloat(c.distance.replace(',', '.'));
            if (!isNaN(parsed)) dist = parsed * 1000;
        }

        // Restaurant
        const hasRestaurant = validPois.some(f => {
            const cat = f.properties['Catégorie'] || f.properties.userData?.Catégorie;
            return cat === 'Restaurant';
        });

        // Visited status
        const allVisited = validPois.length > 0 && validPois.every(f =>
            f.properties.userData && f.properties.userData.vu
        );

        return {
            ...c,
            _validPois: validPois,
            _dist: dist,
            _hasRestaurant: hasRestaurant,
            _allVisited: allVisited
        };
    });

    // 3. Filtrage
    if (state.filterCompleted) {
        enrichedCircuits = enrichedCircuits.filter(c => !c._allVisited);
    }
    if (state.activeFilters && state.activeFilters.zone) {
        enrichedCircuits = enrichedCircuits.filter(c => {
            if (c._validPois.length === 0) return false;
            const startPoi = c._validPois[0];
            const [lng, lat] = startPoi.geometry.coordinates;
            const z = getZoneFromCoords(lat, lng);
            return z === state.activeFilters.zone;
        });
    }

    // 4. Tri
    if (mobileSort === 'date_desc') {
        enrichedCircuits.reverse();
    } else if (mobileSort === 'date_asc') {
        // Déjà dans l'ordre chronologique (par défaut)
    } else if (mobileSort === 'dist_asc') {
        enrichedCircuits.sort((a, b) => a._dist - b._dist);
    } else if (mobileSort === 'dist_desc') {
        enrichedCircuits.sort((a, b) => b._dist - a._dist);
    }

    circuitsToDisplay = enrichedCircuits;

    let html = `
        <div class="mobile-view-header mobile-header-harmonized">
            <h1>Mes Circuits</h1>
        </div>
        <div id="mobile-toolbar-container"></div>
        <div class="panel-content mobile-standard-padding mobile-list-container">
    `;

    if (allCircuits.length === 0) {
        html += `<p class="mobile-empty-state">
            Aucun circuit enregistré.<br>
            Utilisez le menu <b>Menu > Restaurer</b> pour charger une sauvegarde.
        </p>`;
    } else if (circuitsToDisplay.length === 0) {
        html += `<div class="mobile-finished-state">
            <i data-lucide="check-circle" class="mobile-check-icon-large"></i>
            <p>Bravo ! Tout est terminé.</p>
            <button id="btn-reset-filter-inline" class="mobile-reset-filter-btn">
                Tout afficher
            </button>
        </div>`;
    } else {
        html += `<div class="mobile-list">`;
        circuitsToDisplay.forEach(circuit => {
            const validPois = circuit.poiIds.map(id => state.loadedFeatures.find(f => getPoiId(f) === id)).filter(f => f);
            const total = validPois.length;
            const done = validPois.filter(f => f.properties.userData?.vu).length;
            const isDone = (total > 0 && total === done);
            
            // Calculs Métadonnées
            let distance = 0;
            if (circuit.realTrack) {
                distance = getRealDistance(circuit);
            } else {
                distance = getOrthodromicDistance(validPois);
            }
            // Fix legacy distance string if needed
            if (circuit.distance && typeof circuit.distance === 'string' && distance === 0) {
                const parsed = parseFloat(circuit.distance.replace(',', '.'));
                if (!isNaN(parsed)) distance = parsed * 1000;
            }
            const distDisplay = (distance / 1000).toFixed(1) + ' km';

            let zoneName = "Zone Inconnue";
            if (validPois.length > 0) {
                const firstPoi = validPois[0];
                const [lng, lat] = firstPoi.geometry.coordinates;
                zoneName = getZoneFromCoords(lat, lng);
            }

            const displayName = circuit.name.split(' via ')[0];

            const statusIcon = isDone 
                ? `<i data-lucide="check-circle" style="color:var(--ok); width:20px; height:20px;"></i>`
                : `<span style="font-size:12px; color:var(--ink-soft); font-weight:600; background:var(--surface-muted); padding:2px 6px; border-radius:4px;">${done}/${total}</span>`;

            // Badge Officiel
            const badgeHtml = circuit.isOfficial
                ? '<i data-lucide="star" style="color:var(--primary); width:14px; height:14px; margin-left:5px; fill:var(--primary);"></i>'
                : '';

            const restoIcon = circuit._hasRestaurant
                ? `<i data-lucide="utensils" style="width:14px; height:14px; margin-left:4px; vertical-align:text-bottom;"></i>`
                : '';

        // Icone Bird/Foot
        // PRIORITÉ ICÔNE :
        // 1. Si on a des données de trace chargées (realTrack) -> FOOT
        // 2. Si on a un flag dans le JSON disant qu'il y a une trace (hasRealTrack) -> FOOT
        // 3. Sinon -> BIRD
        let iconName = 'bird';
        if (circuit.realTrack && circuit.realTrack.length > 0) {
            iconName = 'footprints';
        } else if (circuit.hasRealTrack) {
            iconName = 'footprints';
        }

        // Style du nom (Gras pour Officiel, Normal pour User)
        const nameStyle = circuit.isOfficial ? 'font-weight:700;' : 'font-weight:400;';

        // Action Droite (Chevron ou Téléchargement GPX pour Officiels)
        let rightActionHtml = '';
        if (circuit.isOfficial && circuit.file) {
            // Le chevron est remplacé par le bouton de téléchargement
            // NOTE: On supprime EXPLICITEMENT tout chevron ici
            rightActionHtml = `
            <a href="./circuits/${circuit.file}" download title="Télécharger GPX" class="mobile-download-btn" onclick="event.stopPropagation();">
                <i data-lucide="download" style="width:24px; height:24px;"></i>
            </a>`;
        } else {
            // Sinon, aucun chevron (Zone cliquable globale suffit)
            rightActionHtml = '';
        }

            // Bouton Visité (Gauche)
            const visitedIcon = circuit._allVisited ? 'check-circle' : 'circle';
            const visitedColor = circuit._allVisited ? 'var(--ok)' : 'var(--line)'; // Gris clair si pas fait, Vert si fait
            const toggleVisitedHtml = `
                <div class="mobile-toggle-visited mobile-check-btn" data-id="${circuit.id}" data-visited="${circuit._allVisited}" style="color:${visitedColor};" onclick="event.stopPropagation();">
                    <i data-lucide="${visitedIcon}" style="width:24px; height:24px;"></i>
                </div>
            `;

            html += `
                <div style="display:flex; align-items:center; gap:5px; margin-bottom:8px;">
                    <div class="mobile-list-item circuit-item-mobile mobile-card-layout" data-id="${circuit.id}" role="button" tabindex="0">
                        ${toggleVisitedHtml}
                        <div style="display:flex; flex-direction:column; flex:1; min-width:0; margin-right:4px;"> <!-- Marge droite réduite -->
                            <div style="display:flex; align-items:center; width:100%;">
                                <span style="${nameStyle} font-size:16px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;">${escapeHtml(displayName)}</span>
                            </div>
                            <div class="mobile-card-meta">
                                ${total} POI • ${distDisplay} <i data-lucide="${iconName}" style="width:14px; height:14px; margin:0 4px;"></i> • ${zoneName}${restoIcon}
                            </div>
                        </div>

                        <div style="display:flex; align-items:center; flex-shrink:0; align-self:center; height:100%;">
                            ${rightActionHtml}
                        </div>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
    }
    
    html += `</div>`;
    container.innerHTML = html;

    renderMobileToolbar();

    const resetBtn = document.getElementById('btn-reset-filter-inline');
    if(resetBtn) {
        resetBtn.addEventListener('click', () => {
            // Reset toolbar state
            state.filterCompleted = false;
            mobileSort = 'date_desc';
            renderMobileCircuitsList();
        });
    }

    container.querySelectorAll('.circuit-item-mobile').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (e.target.closest('.mobile-toggle-visited') || e.target.closest('a')) return;
            const id = btn.dataset.id;
            await loadCircuitById(id);
        });
    });

    container.querySelectorAll('.mobile-toggle-visited').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const isVisited = btn.dataset.visited === 'true';

            if(isVisited) {
                 if(await showConfirm("Réinitialisation", "Voulez-vous vraiment décocher tous les lieux (remettre à 'Non visité') ?", "Tout décocher", "Annuler", true)) {
                     await setCircuitVisitedState(id, false);
                     renderMobileCircuitsList(); // Refresh UI
                 }
            } else {
                 if(await showConfirm("Circuit Terminé", "Bravo ! Marquer tous les lieux de ce circuit comme visités ?", "Tout cocher", "Annuler")) {
                     await setCircuitVisitedState(id, true);
                     renderMobileCircuitsList(); // Refresh UI
                 }
            }
        });
    });
}

function renderMobileToolbar() {
    // On cible le conteneur spécifique injecté par renderMobileCircuitsList
    const container = document.getElementById('mobile-toolbar-container');
    if (!container) return;

    // Nettoyage préventif
    container.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.id = 'mobile-toolbar';
    toolbar.className = 'mobile-toolbar';
    toolbar.style.display = 'flex';

    const dateIcon = mobileSort.startsWith('date')
        ? (mobileSort === 'date_asc' ? 'calendar-arrow-up' : 'calendar-arrow-down')
        : 'calendar';
    
    const distIcon = mobileSort.startsWith('dist')
        ? (mobileSort === 'dist_desc' ? 'arrow-up-1-0' : 'arrow-down-0-1')
        : 'ruler';

    const zoneActive = !!state.activeFilters.zone;

    // Alignement Justifié (Comme le Dock)
    toolbar.style.justifyContent = 'space-around';

    toolbar.innerHTML = `
        <button id="mob-sort-date" class="toolbar-btn ${mobileSort.startsWith('date') ? 'active' : ''}">
            <i data-lucide="${dateIcon}"></i>
        </button>
        <button id="mob-sort-dist" class="toolbar-btn ${mobileSort.startsWith('dist') ? 'active' : ''}">
            <i data-lucide="${distIcon}"></i>
        </button>

        <button id="mob-filter-zone" class="toolbar-btn ${zoneActive ? 'active' : ''}">
            <i data-lucide="map-pin"></i>
        </button>
        <button id="mob-filter-todo" class="toolbar-btn ${state.filterCompleted ? 'active' : ''}">
            <i data-lucide="${state.filterCompleted ? 'list-todo' : 'list-checks'}"></i>
        </button>

        <button id="mob-reset" class="toolbar-btn">
            <i data-lucide="rotate-ccw"></i>
        </button>
    `;

    container.appendChild(toolbar);
    createIcons({ icons, root: toolbar });

    // Listeners (sur le nouvel élément toolbar)
    toolbar.querySelector('#mob-sort-date').onclick = () => {
        mobileSort = (mobileSort === 'date_desc') ? 'date_asc' : 'date_desc';
        renderMobileCircuitsList();
    };
    toolbar.querySelector('#mob-sort-dist').onclick = () => {
        mobileSort = (mobileSort === 'dist_asc') ? 'dist_desc' : 'dist_asc';
        renderMobileCircuitsList();
    };
    toolbar.querySelector('#mob-filter-zone').onclick = () => {
        renderMobileZonesMenu();
    };
    toolbar.querySelector('#mob-filter-todo').onclick = () => {
        state.filterCompleted = !state.filterCompleted;
        renderMobileCircuitsList();
    };
    toolbar.querySelector('#mob-reset').onclick = () => {
        mobileSort = 'date_desc';
        state.filterCompleted = false;
        renderMobileCircuitsList();
    };
}

function renderMobileZonesMenu() {
    // 1. Calcul des zones disponibles basées sur les circuits
    const zonesMap = {};
    const officialCircuits = state.officialCircuits || [];
    const localCircuits = state.myCircuits || [];
    const allCircuits = [...officialCircuits, ...localCircuits];

    allCircuits.forEach(c => {
        const validPois = c.poiIds
            .map(id => state.loadedFeatures.find(feat => getPoiId(feat) === id))
            .filter(f => f);

        if (validPois.length > 0) {
            const startPoi = validPois[0];
            const [lng, lat] = startPoi.geometry.coordinates;
            const z = getZoneFromCoords(lat, lng);
            if (z) {
                zonesMap[z] = (zonesMap[z] || 0) + 1;
            }
        }
    });

    const sortedZones = Object.keys(zonesMap).sort();

    // 2. Construction de la modale
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '10px';
    content.style.maxHeight = '60vh';
    content.style.overflowY = 'auto';

    // Option "Toutes"
    const btnAll = document.createElement('button');
    btnAll.className = 'mobile-list-item';
    btnAll.innerHTML = `<span>Toutes les zones</span>`;
    btnAll.onclick = () => {
        state.activeFilters.zone = null;
        renderMobileCircuitsList();
        document.getElementById('custom-modal-overlay').classList.remove('active');
    };
    content.appendChild(btnAll);

    sortedZones.forEach(zone => {
        const btn = document.createElement('button');
        btn.className = 'mobile-list-item';
        btn.innerHTML = `<span style="flex:1;">${zone}</span> <span style="font-weight:bold; color:var(--ink-soft);">${zonesMap[zone]}</span>`;
        if (state.activeFilters.zone === zone) {
            btn.style.border = '2px solid var(--brand)';
        }
        btn.onclick = () => {
            state.activeFilters.zone = zone;
            renderMobileCircuitsList();
            document.getElementById('custom-modal-overlay').classList.remove('active');
        };
        content.appendChild(btn);
    });

    // 3. Affichage via showConfirm (Hack) ou Custom Modal direct
    // On utilise le Custom Modal direct pour plus de flexibilité
    const modal = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('custom-modal-title');
    const msgEl = document.getElementById('custom-modal-message');
    const actionsEl = document.getElementById('custom-modal-actions');

    titleEl.textContent = "Filtrer par Zone";
    msgEl.innerHTML = '';
    msgEl.appendChild(content);
    actionsEl.innerHTML = `<button class="custom-modal-btn secondary" onclick="document.getElementById('custom-modal-overlay').classList.remove('active')">Fermer</button>`;

    modal.classList.add('active');
}

export function renderMobilePoiList(features) {
    const listToDisplay = features || [];
    const container = document.getElementById('mobile-main-container');
    const isCircuit = state.activeCircuitId !== null;

    // --- MASQUAGE DES MENUS (Optimisation Espace) ---
    const dock = document.getElementById('mobile-dock');
    if (dock) dock.style.display = 'none';
    // Toolbar is automatically removed as it is part of content
    
    let pageTitle = 'Lieux';
    let isAllVisited = false;

    if (isCircuit) {
        const currentCircuit = state.myCircuits.find(c => c.id === state.activeCircuitId);
        pageTitle = currentCircuit ? currentCircuit.name : 'Circuit inconnu';
        
        if(features.length > 0) {
            isAllVisited = features.every(f => f.properties.userData && f.properties.userData.vu);
        }
    }

    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.overflow = 'hidden'; 
    container.innerHTML = '';

    const headerDiv = document.createElement('div');
    headerDiv.className = 'mobile-view-header mobile-header-harmonized';
    headerDiv.style.flexShrink = '0';
    headerDiv.style.display = 'flex';
    headerDiv.style.alignItems = 'center';
    headerDiv.style.justifyContent = 'space-between';
    headerDiv.innerHTML = `
        <div style="display:flex; align-items:center;">
            ${isCircuit ? '<button id="mobile-back-btn" style="margin-right:10px;"><i data-lucide="arrow-left"></i></button>' : ''}
            <h1 style="margin:0; font-size:18px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:220px;">${escapeHtml(pageTitle)}</h1>
        </div>
    `;
    container.appendChild(headerDiv);

    const listDiv = document.createElement('div');
    listDiv.className = 'mobile-list mobile-standard-padding mobile-poi-list-container';
    
    let listHtml = '';
    listToDisplay.forEach(feature => {
        const name = getPoiName(feature);
        const poiId = getPoiId(feature);
        const iconHtml = getIconForFeature(feature);
        const isVisited = feature.properties.userData?.vu;
        const checkIcon = isVisited ? '<i data-lucide="check" style="width:20px; height:20px; margin-left:5px; color:var(--ok); stroke-width:3;"></i>' : '';

        listHtml += `
            <button class="mobile-list-item poi-item-mobile mobile-poi-item-layout" data-id="${poiId}">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="color:${isVisited ? 'var(--ok)' : 'var(--brand)'}; display:flex; align-items:center;">
                        ${iconHtml}
                    </div>
                    <span>${escapeHtml(name)}</span>
                </div>
                ${checkIcon}
            </button>
        `;
    });
    listDiv.innerHTML = listHtml;
    container.appendChild(listDiv);

    if (isCircuit) {
        const footerDiv = document.createElement('div');
        footerDiv.style.flexShrink = '0';
        // Padding réduit car le dock est masqué (80px -> 20px)
        footerDiv.style.padding = '16px 16px 20px 16px';
        footerDiv.style.borderTop = '1px solid var(--line)';
        footerDiv.style.backgroundColor = 'var(--surface)';
        footerDiv.style.zIndex = '10';
        
        // Si pas fait : Bordure de la couleur du thème (neutre/bleu). Si fait : Bordure verte douce.
        const btnStateClass = isAllVisited 
    ? 'background-color:var(--surface); color:var(--ok); border: 2px solid var(--ok);' 
    : 'background-color:var(--surface); color:var(--ink); border: 2px solid var(--brand);';

// Si c'est fait, l'icône devient une flèche de retour en arrière (undo)
        const btnIcon = isAllVisited ? 'undo-2' : 'check-circle';
        const btnText = isAllVisited ? 'Circuit terminé (Annuler)' : 'Marquer comme fait';
        
        footerDiv.innerHTML = `
            <button id="btn-toggle-visited" style="width:100%; padding:14px; border-radius:12px; font-weight:bold; display:flex; justify-content:center; align-items:center; gap:8px; cursor:pointer; font-size:16px; transition:all 0.2s; ${btnStateClass}">
                <i data-lucide="${btnIcon}"></i>
                <span>${btnText}</span>
            </button>
        `;
        container.appendChild(footerDiv);
        
        setTimeout(() => {
            const btnToggle = document.getElementById('btn-toggle-visited');
            if(btnToggle) {
                btnToggle.addEventListener('click', async () => {
                    const newState = !isAllVisited; 
                    if(newState) {
                         if(await showConfirm("Circuit Terminé", "Bravo ! Marquer tous les lieux de ce circuit comme visités ?", "Tout cocher", "Annuler")) {
                             await setCircuitVisitedState(state.activeCircuitId, true);
                         }
                    } else {
                         if(await showConfirm("Réinitialisation", "Voulez-vous vraiment décocher tous les lieux (remettre à 'Non visité') ?", "Tout décocher", "Annuler", true)) {
                             await setCircuitVisitedState(state.activeCircuitId, false);
                         }
                    }
                });
            }
        }, 0);
    }

    const backBtn = document.getElementById('mobile-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            console.log("Mobile Back Button Clicked");
            try {
                container.style.display = '';
                container.style.flexDirection = '';
                container.style.overflow = '';

                console.log("Clearing circuit...");
                clearCircuit(false);

                console.log("Rendering list...");
                renderMobileCircuitsList();

                // RESTAURATION DES MENUS (A la fin pour éviter les écrasements éventuels)
                const d = document.getElementById('mobile-dock');
                if (d) {
                    d.style.display = 'flex';
                    console.log("Dock restored to flex (Final)");
                }

            } catch (e) {
                console.error("Error in back button:", e);
            }
        });
    }

    container.querySelectorAll('.poi-item-mobile').forEach(btn => {
        btn.addEventListener('click', () => {
            const poiId = btn.dataset.id;
            const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
            const index = state.loadedFeatures.indexOf(feature);
            if (index > -1) openDetailsPanel(index);
        });
    });
    
    createIcons({ icons, root: container });
}

export function renderMobileSearch() {
    const container = document.getElementById('mobile-main-container');
    container.style.display = '';
    container.style.flexDirection = '';
    container.style.overflow = '';

    container.innerHTML = `
        <div class="mobile-view-header mobile-header-harmonized">
            <h1>Rechercher</h1>
        </div>
        <div class="mobile-search mobile-search-container mobile-standard-padding">
            <div class="mobile-search-wrapper">
                <i data-lucide="search" class="search-icon mobile-search-icon"></i>
                <input type="text" id="mobile-search-input" placeholder="Nom du lieu..." 
                    class="mobile-search-input">
            </div>
            <div id="mobile-search-results" class="mobile-list mobile-search-results"></div>
        </div>
    `;

    const input = document.getElementById('mobile-search-input');
    const resultsContainer = document.getElementById('mobile-search-results');

    input.addEventListener('input', (e) => {
        const term = e.target.value;
        if (!term || term.length < 2) {
            resultsContainer.innerHTML = '';
            return;
        }

        const matches = getSearchResults(term);

        let html = '';
        matches.forEach(f => {
            const iconHtml = getIconForFeature(f);
            html += `
                <button class="mobile-list-item result-item" data-id="${getPoiId(f)}">
                    <div style="color:var(--brand); display:flex; align-items:center; margin-right:16px;">
                        ${iconHtml}
                    </div>
                    <span>${escapeHtml(getPoiName(f))}</span>
                </button>
            `;
        });
        resultsContainer.innerHTML = html;
        createIcons({ icons, root: resultsContainer });

        resultsContainer.querySelectorAll('.result-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const feature = state.loadedFeatures.find(f => getPoiId(f) === btn.dataset.id);
                const index = state.loadedFeatures.indexOf(feature);
                openDetailsPanel(index);
            });
        });
    });
    
    input.focus();
}

export function renderMobileMenu() {
    const container = document.getElementById('mobile-main-container');
    container.style.display = '';
    container.style.flexDirection = '';
    container.style.overflow = '';
    
    container.innerHTML = `
        <div class="mobile-view-header mobile-header-harmonized">
            <h1>Menu</h1>
        </div>
        <div class="mobile-list actions-list mobile-standard-padding mobile-actions-container">
            <button class="mobile-list-item" id="mob-action-scan">
                <i data-lucide="scan-line"></i>
                <span>Scanner un circuit</span>
            </button>
            <div class="mobile-divider"></div>
            <button class="mobile-list-item" id="mob-action-restore">
                <i data-lucide="folder-down"></i>
                <span>Restaurer les données</span>
            </button>
            <button class="mobile-list-item" id="mob-action-save">
                <i data-lucide="save"></i>
                <span>Sauvegarder les données</span>
            </button>
            <div class="mobile-divider"></div>
             <button class="mobile-list-item" id="mob-action-geojson">
                <i data-lucide="map"></i>
                <span>Charger Destination (GeoJSON)</span>
            </button>
            <button class="mobile-list-item text-danger" id="mob-action-reset">
                <i data-lucide="trash-2"></i>
                <span>Vider les données locales</span>
            </button>
            <div class="mobile-divider"></div>
            <button class="mobile-list-item" id="mob-action-theme">
                <i data-lucide="palette"></i>
                <span>Changer Thème</span>
            </button>
            <div class="mobile-divider"></div>
            <button class="mobile-list-item bmc-btn-mobile" id="mob-action-bmc">
                <i data-lucide="coffee"></i>
                <span>Offrir un café</span>
                <i data-lucide="heart" class="bmc-heart-icon"></i>
            </button>
        </div>
        <div style="text-align:center; color:var(--ink-soft); font-size:12px; margin-top:20px; padding-bottom:100px;">
            History Walk Mobile v${state.appVersion || '3.5.3'}
        </div>
    `;

    document.getElementById('mob-action-scan').addEventListener('click', () => startGenericScanner());
    // document.getElementById('mob-action-sync-share').addEventListener('click', () => generateSyncQR()); // SUPPRIMÉ
    document.getElementById('mob-action-restore').addEventListener('click', () => DOM.restoreLoader.click());
    document.getElementById('mob-action-save').addEventListener('click', () => saveUserData());
    document.getElementById('mob-action-geojson').addEventListener('click', () => DOM.geojsonLoader.click());
    document.getElementById('mob-action-reset').addEventListener('click', async () => {
        if(await showConfirm("Danger Zone", "ATTENTION : Cela va effacer toutes les données locales (caches, sauvegardes automatiques). Continuez ?", "TOUT EFFACER", "Annuler", true)) {
            await deleteDatabase();
            location.reload();
        }
    });
    document.getElementById('mob-action-theme').addEventListener('click', () => {
        document.getElementById('btn-theme-selector').click(); 
    });
    // document.getElementById('mob-action-share-app').addEventListener('click', handleShareAppClick); // SUPPRIMÉ
    document.getElementById('mob-action-bmc').addEventListener('click', () => {
        window.open('https://www.buymeacoffee.com/history_walk', '_blank');
    });
}

async function handleShareAppClick() {
    const url = window.location.href.split('?')[0]; // On partage la racine de l'app
    try {
        const qrDataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2, color: { dark: "#000000", light: "#ffffff" } });

        const content = `
            <div style="display:flex; flex-direction:column; align-items:center; gap:15px;">
                <p style="text-align:center; color:var(--ink);">Scannez ce code pour installer l'application :</p>
                <img src="${qrDataUrl}" style="width:200px; height:200px; border-radius:12px; border:1px solid var(--line);">
                <p style="font-size:12px; color:var(--brand); word-break:break-all; text-align:center;">${url}</p>
            </div>
        `;

        showConfirm("Partager l'application", content, "Fermer", null, false).catch(()=>{});

    } catch (err) {
        console.error(err);
        showToast("Erreur génération QR Code", "error");
    }
}

// handleScanClick a été remplacé par startGenericScanner de sync.js

export function updatePoiPosition(poiId) {
    if (!navigator.geolocation) return showToast("GPS non supporté", "error");
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude, longitude } = pos.coords;
            showToast(`Position capturée: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        },
        (err) => showToast("Erreur GPS: " + err.message, "error")
    );
}