import { DOM } from './ui.js';
import { renderExplorerList } from './ui-circuit-list.js';
import { state } from './state.js';
import { getPoiId } from './data.js';
import { openDetailsPanel } from './ui.js'; // Circular dependency risk?
import { eventBus } from './events.js';
import { stopDictation, isDictationActive } from './voice.js';
import { invalidateMapSize } from './map.js';

// We need to be careful with circular dependencies.
// ui.js exports openDetailsPanel, which is needed here?
// switchSidebarTab is used by openDetailsPanel in ui.js.
// If I move switchSidebarTab here, ui.js will import it.
// openDetailsPanel is in ui.js.
// It seems better to keep openDetailsPanel in ui.js for now or move it too.
// openDetailsPanel uses buildHTML (templates) and setupDetailsEventListeners.

// Let's start with just the tab switching logic.

export function switchSidebarTab(tabName, isNavigating = false) {
    if (!isNavigating && window.speechSynthesis && window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    if (isDictationActive()) stopDictation();

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

    // FIX: On force le redessin de la carte quand le panneau change (pour corriger le bug d'affichage partiel)
    invalidateMapSize();
}

export function setupTabs() {
    if (!DOM.tabButtons) return;

    DOM.tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;
            if (tabName === 'explorer') {
                renderExplorerList();
                switchSidebarTab('explorer');
            } else if (tabName === 'details') {
                if (state.currentFeatureId !== null) {
                    // Si on revient sur l'onglet détails, on essaie de garder le contexte
                    const currentFeature = state.loadedFeatures[state.currentFeatureId];
                    if (currentFeature) {
                        const id = getPoiId(currentFeature);
                        const circuitIndex = state.currentCircuit ? state.currentCircuit.findIndex(f => getPoiId(f) === id) : -1;

                        // We need openDetailsPanel here.
                        // To avoid circular dependency during module evaluation, we can import it dynamically or assume it's available via a shared module or pass it.
                        // However, cyclic imports are allowed in ES modules if handled correctly (functions are hoisted).
                        // Let's try importing openDetailsPanel from ui.js.
                        import('./ui.js').then(m => m.openDetailsPanel(state.currentFeatureId, circuitIndex !== -1 ? circuitIndex : null));
                    }
                } else if (state.currentCircuit && state.currentCircuit.length > 0) {
                    const firstFeature = state.currentCircuit[0];
                    const featureId = state.loadedFeatures.indexOf(firstFeature);
                    if (featureId > -1) {
                         import('./ui.js').then(m => m.openDetailsPanel(featureId, 0));
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
