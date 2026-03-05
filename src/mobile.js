// mobile.js
import { state } from './state.js';
import { DOM } from './ui.js';
import { openDetailsPanel } from './ui-details.js';
import { getPoiId, getPoiName, addPoiFeature } from './data.js';
import { loadCircuitById, clearCircuit, setCircuitVisitedState, loadCircuitFromIds, isCircuitCompleted } from './circuit.js';
import { createIcons, icons } from 'lucide';
import { saveUserData } from './fileManager.js'; 
import { deleteDatabase, saveAppState } from './database.js';
import { getIconForFeature, getRealDistance, getOrthodromicDistance } from './map.js';
import { isPointInPolygon, escapeHtml, getZoneFromCoords, sanitizeHTML } from './utils.js';
import { generateSyncQR, startGenericScanner } from './sync.js';
import QRCode from 'qrcode';
import { zonesData } from './zones.js';
import { showToast } from './toast.js';
import { showConfirm, showCustomModal, closeModal } from './modal.js';
import { getSearchResults } from './search.js';
import { showStatisticsModal } from './statistics.js';
import { getProcessedCircuits } from './circuit-list-service.js';
import { handleCircuitVisitedToggle } from './circuit-actions.js';
import { generateCircuitQR } from './ui-circuit-editor.js';
import { showAdminLoginModal, logoutAdmin } from './admin.js';
import { eventBus } from './events.js';

let currentView = 'circuits'; 
let mobileSort = 'date_desc'; // date_desc, date_asc, dist_asc, dist_desc
let mobileCurrentPage = 1;
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

        });
    }

    switchMobileView('circuits');
}
       

export function switchMobileView(viewName) {
    currentView = viewName;
    if (viewName === 'circuits') {
        mobileCurrentPage = 1;
    }
    
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
    
    // --- USE SHARED SERVICE ---
    // Note: We use the local mobileSort, but we assume state.activeFilters.zone is shared or relevant
    let filterPoiId = null;
    if (state.currentFeatureId !== null && state.loadedFeatures[state.currentFeatureId]) {
        filterPoiId = getPoiId(state.loadedFeatures[state.currentFeatureId]);
    }
    const circuitsToDisplay = getProcessedCircuits(mobileSort, state.filterCompleted, state.activeFilters.zone || null, filterPoiId);

    // --- CALCULATE PAGINATION ---
    // Base estimations: Screen height minus mobile-nav (60px), header (~60px), toolbar (~50px), padding-top (~10px), padding-bottom (~100px safe area) = roughly screenHeight - 280px.
    const availableHeight = window.innerHeight - 280;

    // Item height is roughly 75px.
    // Margin-bottom is 8px.
    // N * 75 + (N - 1) * 8 <= availableHeight
    // N * 83 <= availableHeight + 8
    const itemHeight = 75;
    const gap = 8;

    let itemsPerPage = Math.max(1, Math.floor((availableHeight + gap) / (itemHeight + gap)));

    // Fallback
    if (itemsPerPage < 3) itemsPerPage = 5;

    const totalPages = Math.max(1, Math.ceil(circuitsToDisplay.length / itemsPerPage));
    if (mobileCurrentPage > totalPages) {
        mobileCurrentPage = totalPages;
    }

    const startIdx = (mobileCurrentPage - 1) * itemsPerPage;
    const paginatedCircuits = circuitsToDisplay.slice(startIdx, startIdx + itemsPerPage);

    let html = `
        <div class="mobile-view-header mobile-header-harmonized" style="justify-content: space-between; padding-right: 15px;">
            <h1 style="margin:0;">Mes Circuits</h1>
            <div style="display:flex; align-items:center; gap:5px;">
                <button class="action-button" id="mobile-prev-page" title="Page précédente" aria-label="Page précédente" style="background:none; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:4px; ${mobileCurrentPage <= 1 ? 'opacity: 0.3;' : ''}" ${mobileCurrentPage <= 1 ? 'disabled' : ''}>
                    <i data-lucide="chevron-left" style="width:24px; height:24px;"></i>
                </button>
                <span id="mobile-page-info" style="font-size:14px; font-weight:600; color:var(--ink); min-width: 30px; text-align: center;">${mobileCurrentPage} / ${totalPages}</span>
                <button class="action-button" id="mobile-next-page" title="Page suivante" aria-label="Page suivante" style="background:none; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:4px; ${mobileCurrentPage >= totalPages ? 'opacity: 0.3;' : ''}" ${mobileCurrentPage >= totalPages ? 'disabled' : ''}>
                    <i data-lucide="chevron-right" style="width:24px; height:24px;"></i>
                </button>
            </div>
        </div>
        <div id="mobile-toolbar-container"></div>
        <div class="panel-content mobile-standard-padding mobile-list-container">
    `;

    // Empty state logic is simpler now, but we need to check if *any* circuits exist before filtering to show the correct empty message
    const hasAnyCircuits = (state.officialCircuits?.length || 0) + (state.myCircuits?.length || 0) > 0;

    if (!hasAnyCircuits) {
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
        paginatedCircuits.forEach(circuit => {
            // Using enriched properties from getProcessedCircuits
            const distDisplay = circuit._distDisplay;
            const zoneName = circuit._zoneName;
            const displayName = circuit.name.split(' via ')[0];
            const total = circuit._poiCount;
            const done = circuit._visitedCount;
            const isDone = circuit._isCompleted;
            const iconName = circuit._iconName;

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

            const nameStyle = circuit.isOfficial ? 'font-weight:700;' : 'font-weight:400;';

            // Action Droite (Téléchargement GPX pour Officiels)
            let rightActionHtml = '';
            if (circuit.isOfficial && circuit.file) {
                rightActionHtml = `
                <a href="./circuits/${circuit.file}" download title="Télécharger GPX" class="mobile-download-btn">
                    <i data-lucide="download" style="width:24px; height:24px;"></i>
                </a>`;
            }

            // Bouton Visité (Gauche)
            const visitedIcon = isDone ? 'check-circle' : 'circle';
            const visitedColor = isDone ? 'var(--ok)' : 'var(--line)'; // Gris clair si pas fait, Vert si fait
            const toggleVisitedHtml = `
                <button type="button" class="mobile-toggle-visited mobile-check-btn" data-id="${circuit.id}" data-visited="${isDone}" style="color:${visitedColor};" aria-label="Marquer comme visité" title="Marquer comme visité">
                    <i data-lucide="${visitedIcon}" style="width:24px; height:24px;"></i>
                </button>
            `;

            html += `
                <div style="display:flex; align-items:center; gap:5px; margin-bottom:8px;">
                    <div class="mobile-list-item circuit-item-mobile mobile-card-layout" data-id="${circuit.id}" role="button" tabindex="0">
                        ${toggleVisitedHtml}
                        <div style="display:flex; flex-direction:column; flex:1; min-width:0; margin-right:4px;">
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
    container.innerHTML = sanitizeHTML(html);

    // Explicitly re-create icons after updating innerHTML to ensure pagination arrows render
    createIcons({ icons, root: container });

    // Pagination Event Listeners
    const prevBtn = document.getElementById('mobile-prev-page');
    const nextBtn = document.getElementById('mobile-next-page');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (mobileCurrentPage > 1) {
                mobileCurrentPage--;
                renderMobileCircuitsList();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (mobileCurrentPage < totalPages) {
                mobileCurrentPage++;
                renderMobileCircuitsList();
            }
        });
    }

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
            // Check if click is on download link (don't propagate)
            if (e.target.closest('.mobile-download-btn')) {
                e.stopPropagation();
                return;
            }

            // Check if click is on toggle visited
            const toggleBtn = e.target.closest('.mobile-toggle-visited');
            if (toggleBtn) {
                e.stopPropagation();
                const id = toggleBtn.dataset.id;
                const isVisited = toggleBtn.dataset.visited === 'true';

                // Unified Action with Confirmation
                const result = await handleCircuitVisitedToggle(id, isVisited);
                if (result.success) {
                    renderMobileCircuitsList(); // Refresh UI
                }
                return;
            }

            if (e.target.closest('a')) return;

            const id = btn.dataset.id;
            // On change de "Vue" logique pour autoriser renderMobilePoiList à s'afficher
            currentView = 'circuit-details';
            await loadCircuitById(id);
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
    // TODO: We could use getProcessedCircuits here too to be super clean, but this logic is specific for zone counting
    // Let's keep it as is for now, it iterates all circuits.
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
        closeModal();
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
            closeModal();
        };
        content.appendChild(btn);
    });

    // 3. Affichage via showCustomModal (Refactorisé)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'custom-modal-btn secondary';
    closeBtn.textContent = 'Fermer';
    closeBtn.onclick = () => closeModal();

    showCustomModal("Filtrer par Zone", content, closeBtn);
}

export function renderMobilePoiList(features) {
    // FIX: Si on est en vue "Circuits", on ne laisse pas les filtres globaux écraser la vue
    if (currentView === 'circuits') return;

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
        // Recherche robuste (Local ou Officiel)
        let currentCircuit = state.myCircuits.find(c => c.id === state.activeCircuitId);
        if (!currentCircuit && state.officialCircuits) {
            currentCircuit = state.officialCircuits.find(c => c.id === state.activeCircuitId);
        }

        pageTitle = currentCircuit ? currentCircuit.name : 'Circuit inconnu';
        
        if (currentCircuit) {
            isAllVisited = isCircuitCompleted(currentCircuit);
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
            ${isCircuit ? '<button id="mobile-back-btn" title="Retour" aria-label="Retour" style="margin-right:10px;"><i data-lucide="arrow-left"></i></button>' : ''}
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
        
        // Bouton Partager (QR Code)
        const btnStateClass = 'background-color:var(--surface); color:var(--ink); border: 2px solid var(--brand);';
        const btnIcon = 'qr-code';
        const btnText = 'Partager le circuit';
        
        footerDiv.innerHTML = `
            <button id="btn-share-circuit-mobile" style="width:100%; padding:14px; border-radius:12px; font-weight:bold; display:flex; justify-content:center; align-items:center; gap:8px; cursor:pointer; font-size:16px; transition:all 0.2s; ${btnStateClass}">
                <i data-lucide="${btnIcon}"></i>
                <span>${btnText}</span>
            </button>
        `;
        container.appendChild(footerDiv);
        
        setTimeout(() => {
            const btnShare = document.getElementById('btn-share-circuit-mobile');
            if(btnShare) {
                btnShare.addEventListener('click', async () => {
                    await generateCircuitQR();
                });
            }
        }, 0);
    }

    const backBtn = document.getElementById('mobile-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            console.log("Mobile Back Button Clicked");
            try {
                // Nettoyage de l'état circuit
                clearCircuit(false);
                // Retour propre à la vue liste via le routeur
                switchMobileView('circuits');
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
        resultsContainer.innerHTML = sanitizeHTML(html);
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
            <button class="mobile-list-item" id="mob-action-stats">
                <i data-lucide="trophy"></i>
                <span>Mon Carnet de Voyage</span>
            </button>
            <div class="mobile-divider"></div>
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
            <button class="mobile-list-item bmc-btn-mobile" id="mob-action-bmc" style="background: linear-gradient(135deg, #FFDD00 0%, #FBB03B 100%); color: #422006; font-weight: 700;">
                <i data-lucide="coffee"></i>
                <span>Offrir un café</span>
                <i data-lucide="heart" class="bmc-heart-icon" style="color:#e91e63; fill:#e91e63;"></i>
            </button>
            <div class="mobile-divider"></div>
            <button class="mobile-list-item" id="mob-action-admin-login" style="color: ${state.isAdmin ? 'var(--danger)' : 'var(--ink)'};">
                <i data-lucide="${state.isAdmin ? 'log-out' : 'lock'}"></i>
                <span>${state.isAdmin ? 'Déconnexion' : 'Connexion Admin'}</span>
            </button>
        </div>
        <div style="text-align:center; color:var(--ink-soft); font-size:12px; margin-top:20px; padding-bottom:100px;">
            History Walk Mobile v${state.appVersion || '3.5.3'}
        </div>
    `;

    document.getElementById('mob-action-stats').addEventListener('click', () => showStatisticsModal());
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
    const btnAdminLogin = document.getElementById('mob-action-admin-login');
    if (btnAdminLogin) {
        btnAdminLogin.addEventListener('click', () => {
            if (state.isAdmin) {
                logoutAdmin();
            } else {
                showAdminLoginModal();
            }
        });
    }
}

eventBus.on('admin:mode-toggled', () => {
    if (currentView === 'menu' && isMobileView()) {
        renderMobileMenu();
    }
});

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
