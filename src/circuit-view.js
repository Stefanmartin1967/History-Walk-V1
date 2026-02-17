// circuit-view.js
import { DOM, openDetailsPanel } from './ui.js';
import { getPoiName, getPoiId } from './data.js';
import { state } from './state.js';
import { showToast } from './toast.js';
import { createIcons, icons } from 'lucide';

/**
 * Génère le HTML pour une étape du circuit
 */
function createStepElement(feature, index, totalPoints, callbacks) {
    const poiName = getPoiName(feature);
    const stepDiv = document.createElement('div');
    stepDiv.className = 'step';
    
    stepDiv.innerHTML = `
        <div class="num">${index + 1}</div>
        <div class="step-main" title="${poiName}">${poiName}</div>
        <div class="step-actions">
            <button class="stepbtn" data-action="up" title="Monter" ${index === 0 ? 'disabled' : ''}>
                <i data-lucide="chevron-up"></i>
            </button>
            <button class="stepbtn" data-action="down" title="Descendre" ${index === totalPoints - 1 ? 'disabled' : ''}>
                <i data-lucide="chevron-down"></i>
            </button>
            <button class="stepbtn" data-action="remove" title="Retirer">
                <i data-lucide="trash-2"></i>
            </button>
        </div>`;

    // Événements
    stepDiv.querySelector('.step-actions').addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (button) callbacks.onAction(button.dataset.action, index);
    });

    stepDiv.querySelector('.step-main').addEventListener('click', () => {
        callbacks.onDetails(feature, index);
    });

    return stepDiv;
}

/**
 * Rendu complet du panneau de circuit
 */
export function renderCircuitList(points, callbacks) {
    if (!DOM.circuitStepsList) return;

    DOM.circuitStepsList.innerHTML = '';

    if (points.length === 0) {
        DOM.circuitStepsList.innerHTML = `<p class="empty-list-info">Cliquez sur les lieux sur la carte pour les ajouter à votre circuit.</p>`;
    } else {
        points.forEach((feature, index) => {
            const stepEl = createStepElement(feature, index, points.length, callbacks);
            DOM.circuitStepsList.appendChild(stepEl);
        });
    }

    // Rafraîchissement des icônes Lucide après injection HTML
    createIcons({ icons });
}

/**
 * Mise à jour des compteurs et textes
 */
export function updateCircuitHeader(data) {
    if (DOM.circuitPoiCount) DOM.circuitPoiCount.textContent = data.countText;
    if (DOM.circuitDistance) DOM.circuitDistance.textContent = data.distanceText;
    if (DOM.circuitTitleText) {
        DOM.circuitTitleText.textContent = data.title;
        DOM.circuitTitleText.title = data.title;
    }

    const distIcon = document.getElementById('distance-icon');
    if (distIcon) {
        // On remplace l'élément pour garantir que Lucide le re-génère correctement
        const newIcon = document.createElement('i');
        newIcon.id = 'distance-icon';
        newIcon.setAttribute('data-lucide', data.iconType);
        newIcon.title = data.iconTitle;

        distIcon.replaceWith(newIcon);

        createIcons({ icons });
    }

    const btnDelete = document.getElementById('btn-delete-active-circuit');
    if (btnDelete) {
        btnDelete.style.display = state.activeCircuitId ? 'flex' : 'none';
    }
}

/**
 * Gestion de l'état visuel des boutons de contrôle
 */
export function updateControlButtons(uiState) {
    const btnExport = document.getElementById('btn-export-gpx');
    const btnImport = document.getElementById('btn-import-gpx');
    const btnClear = document.getElementById('btn-clear-circuit');
    const btnLoop = document.getElementById('btn-loop-circuit');
    const btnShare = document.getElementById('btn-share-circuit');
    const btnModify = document.getElementById('btn-modify-circuit');

    if (btnLoop) {
        btnLoop.style.display = uiState.isActive ? 'none' : 'flex';
    }

    if (btnModify) {
        btnModify.style.display = uiState.isActive ? 'flex' : 'none';
        btnModify.disabled = false;
    }

    // EXPORT / PARTAGE : Actif seulement si le circuit n'est pas vide
    if (btnExport) {
        btnExport.disabled = uiState.isEmpty; 
    }
    if (btnShare) {
        btnShare.disabled = uiState.isEmpty;
    }

    // IMPORT / MODIFIER : Toujours actif (vu précédemment)
    if (btnImport) {
        btnImport.disabled = false;
        // On force l'icône d'import (Nuage) même si actif, pour permettre de charger une trace réelle
        btnImport.innerHTML = '<i data-lucide="upload-cloud"></i>';

        if (uiState.isActive) {
            btnImport.title = "Importer une trace réelle (remplace le tracé)";
        } else {
            btnImport.title = "Importer un GPX";
        }
    }

    // VIDER / FERMER
    if (btnClear) {
        if (uiState.isActive) {
             btnClear.innerHTML = '<i data-lucide="x"></i>';
             btnClear.title = "Fermer le circuit";
        } else {
             btnClear.innerHTML = '<i data-lucide="trash-2"></i>';
             btnClear.title = "Vider le circuit";
        }
    }

    createIcons({ icons });
}

export function updateCircuitForm(data) {
    if (DOM.circuitTitleText) DOM.circuitTitleText.textContent = data.name || 'Circuit chargé';
    if (DOM.circuitDescription) DOM.circuitDescription.value = data.description || '';
    
    // Remplissage des transports
    const fields = {
        'transport-aller-temps': data.transport?.allerTemps,
        'transport-aller-cout': data.transport?.allerCout,
        'transport-retour-temps': data.transport?.retourTemps,
        'transport-retour-cout': data.transport?.retourCout
    };

    for (const [id, value] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    }
}
