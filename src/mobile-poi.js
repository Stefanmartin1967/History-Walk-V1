// mobile-poi.js
// Affichage de la liste des POIs d'un circuit

import { state } from './state.js';
import { getPoiId, getPoiName } from './data.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { escapeHtml } from './utils.js';
import { getIconForFeature } from './map.js';
import { openDetailsPanel } from './ui-details.js';
import { generateCircuitQR } from './ui-circuit-editor.js';
import { clearCircuit, isCircuitCompleted, isCircuitTested, toggleCircuitTested } from './circuit.js';
import { showToast } from './toast.js';
import { animateContainer, getCurrentView, getAllCircuitsOrdered } from './mobile-state.js';
import { switchMobileView } from './mobile-nav.js';

// ─── Liste des POIs d'un circuit ─────────────────────────────────────────────

export function renderMobilePoiList(features) {
    // Si on est en vue "Circuits", on ne laisse pas les filtres globaux écraser la vue
    if (getCurrentView() === 'circuits') return;

    const listToDisplay = features || [];
    const container = document.getElementById('mobile-main-container');
    const isCircuit = state.activeCircuitId !== null;

    // Masquage du dock pour maximiser l'espace POIs
    const dock = document.getElementById('mobile-dock');
    if (dock) dock.style.display = 'none';

    let pageTitle = 'Lieux';
    let isAllVisited = false;
    let circuitPositionLabel = '';

    if (isCircuit) {
        let currentCircuit = state.myCircuits.find(c => c.id === state.activeCircuitId);
        if (!currentCircuit && state.officialCircuits) {
            currentCircuit = state.officialCircuits.find(c => c.id === state.activeCircuitId);
        }

        let rawName = currentCircuit ? currentCircuit.name : 'Circuit inconnu';
        pageTitle = rawName.split(' via ')[0].replace(/^(Circuit de |Boucle de )/i, '');

        if (currentCircuit) {
            isAllVisited = isCircuitCompleted(currentCircuit);
        }

        // Indicateur de position dans la liste des circuits
        const allOrdered = getAllCircuitsOrdered();
        const circuitIdx = allOrdered.findIndex(c => c.id === state.activeCircuitId);
        if (circuitIdx >= 0 && allOrdered.length > 1) {
            circuitPositionLabel = `${circuitIdx + 1} / ${allOrdered.length}`;
        }
    }

    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.overflow = 'hidden';
    container.innerHTML = '';
    animateContainer(container);

    // ─── En-tête ──────────────────────────────────────────────────────────────

    const headerDiv = document.createElement('div');
    headerDiv.className = 'mobile-view-header mobile-header-harmonized';
    headerDiv.classList.add('mobile-poi-header');

    const isTested = isCircuit ? isCircuitTested(state.activeCircuitId) : false;
    const testedBtnHtml = (isCircuit && state.isAdmin)
        ? `<button id="mobile-toggle-tested" class="mobile-toggle-tested-btn ${isTested ? 'tested' : ''}" title="${isTested ? 'Retirer badge testé' : 'Marquer comme testé sur le terrain'}" data-id="${state.activeCircuitId}">
               <i data-lucide="shield-check"></i>
           </button>`
        : '<div class="mobile-back-btn-phantom"></div>';

    headerDiv.innerHTML = `
        <div class="mobile-poi-header-inner">
            ${isCircuit
                ? '<button id="mobile-back-btn" class="mobile-back-btn" title="Retour" aria-label="Retour"><i data-lucide="arrow-left"></i></button>'
                : '<div class="mobile-back-btn-phantom"></div>'}
            <div class="mobile-circuits-center">
                <h1 class="mobile-poi-title">${escapeHtml(pageTitle)}</h1>
                ${circuitPositionLabel ? `<span class="mobile-page-info">${circuitPositionLabel}</span>` : ''}
            </div>
            ${testedBtnHtml}
        </div>
    `;
    container.appendChild(headerDiv);

    // ─── Liste des POIs ───────────────────────────────────────────────────────

    const listDiv = document.createElement('div');
    listDiv.className = 'mobile-list mobile-standard-padding mobile-poi-list-container';

    let listHtml = '';
    listToDisplay.forEach(feature => {
        const name = getPoiName(feature);
        const poiId = getPoiId(feature);
        const iconHtml = getIconForFeature(feature);
        const isVisited = feature.properties.userData?.vu;
        const checkIcon = isVisited
            ? '<i data-lucide="check" class="icon-check-visited lucide"></i>'
            : '';

        listHtml += `
            <button class="mobile-list-item poi-item-mobile mobile-poi-item-layout" data-id="${poiId}">
                <div class="mobile-poi-icon-wrapper">
                    <div class="${isVisited ? 'mobile-poi-icon--visited' : 'mobile-poi-icon--unvisited'}">
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

    // ─── Footer circuit (partage + GPX) ──────────────────────────────────────

    if (isCircuit) {
        const activeOfficial = state.officialCircuits?.find(c => c.id === state.activeCircuitId);
        const gpxFile = activeOfficial?.file || null;
        const gpxBtnHtml = gpxFile
            ? `<a href="./circuits/${gpxFile}" download id="btn-download-gpx-mobile" class="btn-download-gpx-mobile">
                   <i data-lucide="download"></i>
                   <span>Télécharger GPX</span>
               </a>`
            : '';

        const footerDiv = document.createElement('div');
        footerDiv.className = 'mobile-poi-footer';
        footerDiv.innerHTML = `
            <button id="btn-share-circuit-mobile" class="btn-share-circuit-mobile">
                <i data-lucide="qr-code"></i>
                <span>Partager le circuit</span>
            </button>
            ${gpxBtnHtml}
        `;
        container.appendChild(footerDiv);

        setTimeout(() => {
            const btnShare = document.getElementById('btn-share-circuit-mobile');
            if (btnShare) {
                btnShare.addEventListener('click', async () => {
                    await generateCircuitQR();
                });
            }
        }, 0);
    }

    // ─── Bouton "Testé sur le terrain" (admin) ────────────────────────────────

    const toggleTestedBtn = document.getElementById('mobile-toggle-tested');
    if (toggleTestedBtn) {
        toggleTestedBtn.addEventListener('click', async () => {
            const circuitId = toggleTestedBtn.dataset.id;
            const newVal = await toggleCircuitTested(circuitId);
            toggleTestedBtn.classList.toggle('tested', newVal);
            toggleTestedBtn.title = newVal
                ? 'Retirer badge testé'
                : 'Marquer comme testé sur le terrain';
            showToast(newVal ? '🛡️ Circuit marqué comme testé' : 'Badge testé retiré', 'success');
        });
    }

    // ─── Bouton Retour ────────────────────────────────────────────────────────

    const backBtn = document.getElementById('mobile-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            try {
                clearCircuit(false);
                switchMobileView('circuits');
            } catch (e) {
                console.error("Erreur bouton Retour:", e);
            }
        });
    }

    // ─── Clic POI → panneau détail ────────────────────────────────────────────

    container.querySelectorAll('.poi-item-mobile').forEach(btn => {
        btn.addEventListener('click', () => {
            const poiId = btn.dataset.id;
            const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
            const index = state.loadedFeatures.indexOf(feature);
            if (index > -1) openDetailsPanel(index);
        });
    });

    createIcons({ icons: appIcons, root: container });
}

// ─── Mise à jour position GPS d'un POI ───────────────────────────────────────

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
