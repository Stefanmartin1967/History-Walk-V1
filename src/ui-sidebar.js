import { DOM } from './ui-dom.js';
import { state } from './state.js';
import { getPoiId } from './data.js';
import { eventBus } from './events.js';

export function switchSidebarTab(tabName, isNavigating = false) {
    if (!isNavigating && window.speechSynthesis && window.speechSynthesis.speaking) window.speechSynthesis.cancel();

    if (DOM.sidebarPanels) {
        DOM.sidebarPanels.forEach(panel => {
            if(panel) panel.classList.toggle('active', panel.dataset.panel === tabName);
        });
    }
    if (DOM.tabButtons) {
        DOM.tabButtons.forEach(button => {
            if(button) button.classList.toggle('active', button.dataset.tab === tabName);
        });
    }

    // FIX AUTOMATISÉ : Le redessin de la carte est maintenant géré automatiquement par ResizeObserver dans map.js
}

export function setupTabs() {
    if (!DOM.tabButtons) return;

    DOM.tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;
            if (tabName === 'explorer') {
                eventBus.emit('ui:render-explorer-list');
                switchSidebarTab('explorer');
            } else if (tabName === 'details') {
                if (state.currentFeatureId !== null) {
                    // Si on revient sur l'onglet détails, on essaie de garder le contexte
                    const currentFeature = state.loadedFeatures[state.currentFeatureId];
                    if (currentFeature) {
                        const id = getPoiId(currentFeature);
                        const circuitIndex = state.currentCircuit ? state.currentCircuit.findIndex(f => getPoiId(f) === id) : -1;

                        eventBus.emit('poi:open-details', { featureId: state.currentFeatureId, circuitIndex: circuitIndex !== -1 ? circuitIndex : null });
                    }
                } else if (state.currentCircuit && state.currentCircuit.length > 0) {
                    const firstFeature = state.currentCircuit[0];
                    const featureId = state.loadedFeatures.indexOf(firstFeature);
                    if (featureId > -1) {
                         eventBus.emit('poi:open-details', { featureId, circuitIndex: 0 });
                    } else {
                        switchSidebarTab(tabName);
                    }
                } else {
                    switchSidebarTab(tabName);
                }
            } else {
                switchSidebarTab(tabName);
            }
        });
    });
}
