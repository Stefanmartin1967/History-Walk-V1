// events-bus.js
// Listeners du bus événementiel métier (eventBus) — pas de DOM direct ici.
// Relie les événements logiques (data:filtered, circuit:request-*, data:apply-filters)
// à leurs handlers (render map/mobile, load/delete/import/toggle circuit, toasts).

import { eventBus } from './events.js';
import { isMobileView } from './mobile-state.js';
import { renderMobilePoiList } from './mobile-poi.js';
import { refreshMapMarkers } from './map.js';
import { populateCircuitsMenu } from './ui-filters.js';
import { loadCircuitById, clearCircuit, navigatePoiDetails, renderCircuitPanel } from './circuit.js';
import { performCircuitDeletion } from './circuit-actions.js';
import { setCircuitIdToImportFor, state } from './state.js';
import { DOM } from './ui-dom.js';
import { showToast } from './toast.js';
import { applyFilters } from './data.js';

export function setupEventBusListeners() {
    eventBus.on('data:filtered', (visibleFeatures) => {
        if (isMobileView()) {
            renderMobilePoiList(visibleFeatures);
        } else {
            refreshMapMarkers(visibleFeatures);
            // Anciens menus dropdown #zonesMenu / #categoriesMenu retirés en
            // PR 3 (refonte topbar). Le panneau de filtres unifié se rafraîchit
            // tout seul via son propre listener data:filtered.
        }
    });

    // i18n : la langue des noms patrimoniaux a changé → re-peindre les surfaces
    // visiteur qui affichent des noms de POI. La fiche ouverte se re-rend via
    // ui-details ; le segmenté topbar via topbar-v2. applyFilters() couvre les
    // marqueurs (PC) + les listes qui écoutent data:filtered (explorer PC, liste
    // Lieux mobile). Reste le panneau circuit (timeline), qui n'écoute PAS
    // data:filtered → on le re-rend explicitement.
    eventBus.on('patrimony:lang-changed', () => {
        applyFilters();
        if (isMobileView()) {
            eventBus.emit('mobile:render-circuits-list');
            if (state.currentCircuit && state.currentCircuit.length) {
                eventBus.emit('mobile:render-poi-list', state.currentCircuit);
            }
        } else if (state.currentCircuit && state.currentCircuit.length) {
            renderCircuitPanel();
        }
    });

    eventBus.on('circuit:request-load', async (id) => await loadCircuitById(id));
    eventBus.on('circuit:clear', (silent) => clearCircuit(silent));
    eventBus.on('circuit:navigate-poi', (dir) => navigatePoiDetails(dir));
    eventBus.on('circuit:request-delete', async (id) => {
        const result = await performCircuitDeletion(id);
        if (result.success) {
            showToast(result.message, 'success');
            eventBus.emit('circuit:list-updated');
        } else {
            showToast(result.message, 'error');
        }
    });
    eventBus.on('circuit:request-import', (id) => {
        setCircuitIdToImportFor(id);
        if (DOM.gpxImporter) DOM.gpxImporter.click();
    });
    eventBus.on('circuit:list-updated', () => populateCircuitsMenu());
    eventBus.on('data:apply-filters', () => applyFilters());
}
