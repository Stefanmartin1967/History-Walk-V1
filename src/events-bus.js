// events-bus.js
// Listeners du bus événementiel métier (eventBus) — pas de DOM direct ici.
// Relie les événements logiques (data:filtered, circuit:request-*, data:apply-filters)
// à leurs handlers (render map/mobile, load/delete/import/toggle circuit, toasts).

import { eventBus } from './events.js';
import { isMobileView, renderMobilePoiList } from './mobile.js';
import { refreshMapMarkers } from './map.js';
import { populateZonesMenu, populateCategoriesMenu, populateCircuitsMenu } from './ui-filters.js';
import { loadCircuitById } from './circuit.js';
import { performCircuitDeletion, toggleCircuitVisitedStatus } from './circuit-actions.js';
import { setCircuitIdToImportFor } from './state.js';
import { DOM } from './ui.js';
import { showToast } from './toast.js';
import { applyFilters } from './data.js';

export function setupEventBusListeners() {
    eventBus.on('data:filtered', (visibleFeatures) => {
        if (isMobileView()) {
            renderMobilePoiList(visibleFeatures);
        } else {
            refreshMapMarkers(visibleFeatures);
            populateZonesMenu();
            populateCategoriesMenu();
        }
    });

    eventBus.on('circuit:request-load', async (id) => await loadCircuitById(id));
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
    eventBus.on('circuit:request-toggle-visited', async ({ id, isChecked }) => {
        const result = await toggleCircuitVisitedStatus(id, isChecked);
        if (result.success) eventBus.emit('circuit:list-updated');
    });
    eventBus.on('circuit:list-updated', () => populateCircuitsMenu());
    eventBus.on('data:apply-filters', () => applyFilters());
}
