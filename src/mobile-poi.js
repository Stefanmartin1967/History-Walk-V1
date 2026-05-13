// mobile-poi.js
// Affichage de la liste des POIs d'un circuit

import { state } from './state.js';
import { getPoiId, getPoiName, updatePoiCoordinates, applyFilters } from './data.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { escapeHtml } from './utils.js';
import { getIconForFeature } from './poi-icons.js';
import { openDetailsPanel } from './ui-details.js';
import { generateCircuitQR } from './ui-circuit-editor.js';
import { clearCircuit, isCircuitCompleted } from './circuit.js';
import { showToast } from './toast.js';
import { animateContainer, getCurrentView, getAllCircuitsOrdered, setMobileHeaderSlot, setMobileViewFooter } from './mobile-state.js';
import { switchMobileView } from './mobile-nav.js';
import { eventBus } from './events.js';

export function initMobilePoiListeners() {
    eventBus.on('mobile:update-poi-position', (poiId) => updatePoiPosition(poiId));
    eventBus.on('mobile:render-poi-list', (features) => renderMobilePoiList(features));
}

// ─── Liste des POIs d'un circuit ─────────────────────────────────────────────

export function renderMobilePoiList(features) {
    // Si on est en vue "Circuits", on ne laisse pas les filtres globaux écraser la vue
    if (getCurrentView() === 'circuits') return;

    const listToDisplay = features || [];
    const container = document.getElementById('mobile-main-container');
    const isCircuit = state.activeCircuitId !== null;

    // Le dock se masque automatiquement quand le view-footer est rempli
    // (sélecteur CSS `.mobile-view-footer:not(:empty) ~ #mobile-dock`).
    // Cf. setMobileViewFooter() en bas de cette fonction.

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

    container.innerHTML = '';
    animateContainer(container);

    // ─── En-tête → header-slot ────────────────────────────────────────────────
    // (refonte étape 4 : header sort du #mobile-main-container vers #mobile-header-slot)

    const headerHtml = `
        <div class="mobile-view-header mobile-header-harmonized mobile-poi-header">
            <div class="mobile-poi-header-inner">
                ${isCircuit
                    ? '<button id="mobile-back-btn" class="mobile-back-btn" title="Retour" aria-label="Retour"><i data-lucide="arrow-left"></i></button>'
                    : '<div class="mobile-back-btn-phantom"></div>'}
                <div class="mobile-circuits-center">
                    <h1 class="mobile-poi-title">${escapeHtml(pageTitle)}</h1>
                    ${circuitPositionLabel ? `<span class="mobile-page-info">${circuitPositionLabel}</span>` : ''}
                </div>
                <div class="mobile-back-btn-phantom"></div>
            </div>
        </div>
    `;
    setMobileHeaderSlot(headerHtml);

    // ─── Liste des POIs (dans le main-container scrollable) ───────────────────

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
    container.innerHTML = `<div class="mobile-list mobile-standard-padding mobile-poi-list-container">${listHtml}</div>`;

    // ─── Footer circuit (partage + GPX) → view-footer-slot ────────────────────
    // (refonte étape 4 : remplir le view-footer masque AUTOMATIQUEMENT le dock
    // via le sélecteur CSS `.mobile-view-footer:not(:empty) ~ #mobile-dock`).

    if (isCircuit) {
        const activeOfficial = state.officialCircuits?.find(c => c.id === state.activeCircuitId);
        const gpxFile = activeOfficial?.file || null;
        const gpxBtnHtml = gpxFile
            ? `<a href="./circuits/${gpxFile}" download id="btn-download-gpx-mobile" class="btn-download-gpx-mobile">
                   <i data-lucide="download"></i>
                   <span>Télécharger GPX</span>
               </a>`
            : '';

        setMobileViewFooter(`
            <div class="mobile-poi-footer">
                <button id="btn-share-circuit-mobile" class="btn-share-circuit-mobile">
                    <i data-lucide="qr-code"></i>
                    <span>Partager le circuit</span>
                </button>
                ${gpxBtnHtml}
            </div>
        `);

        setTimeout(() => {
            const btnShare = document.getElementById('btn-share-circuit-mobile');
            if (btnShare) {
                btnShare.addEventListener('click', async () => {
                    await generateCircuitQR();
                });
            }
        }, 0);
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

    // Icônes Lucide : main-container (liste) + header-slot (back btn) + view-footer (Partager/GPX)
    createIcons({ icons: appIcons, root: container });
    const headerSlot = document.getElementById('mobile-header-slot');
    if (headerSlot) createIcons({ icons: appIcons, root: headerSlot });
    const viewFooter = document.getElementById('mobile-view-footer');
    if (viewFooter) createIcons({ icons: appIcons, root: viewFooter });
}

// ─── Mise à jour position GPS d'un POI ───────────────────────────────────────

export function updatePoiPosition(poiId) {
    if (!navigator.geolocation) return showToast("GPS non supporté", "error");

    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    if (!feature) return showToast("POI introuvable", "error");
    const [prevLng, prevLat] = feature.geometry.coordinates;

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const { latitude, longitude } = pos.coords;
            await updatePoiCoordinates(poiId, latitude, longitude);
            applyFilters();
            showToast(
                `Position mise à jour : ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
                'success',
                8000,
                {
                    label: 'Annuler',
                    onClick: async () => {
                        await updatePoiCoordinates(poiId, prevLat, prevLng);
                        applyFilters();
                        showToast('Position restaurée.', 'info');
                    }
                }
            );
        },
        (err) => showToast("Erreur GPS : " + err.message, "error"),
        { enableHighAccuracy: true, timeout: 10000 }
    );
}
