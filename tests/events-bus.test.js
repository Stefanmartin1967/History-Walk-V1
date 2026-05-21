import { describe, it, expect, vi, beforeEach } from 'vitest';

// On mocke tous les modules de handlers, mais on garde le VRAI eventBus
// (events.js) pour vérifier le routing réel event → handler.
const h = vi.hoisted(() => ({
    isMobileView: vi.fn(() => false),
    renderMobilePoiList: vi.fn(),
    refreshMapMarkers: vi.fn(),
    populateCircuitsMenu: vi.fn(),
    loadCircuitById: vi.fn(() => Promise.resolve()),
    clearCircuit: vi.fn(),
    navigatePoiDetails: vi.fn(),
    performCircuitDeletion: vi.fn(() => Promise.resolve({ success: true, message: 'ok' })),
    setCircuitIdToImportFor: vi.fn(),
    gpxImporterClick: vi.fn(),
    showToast: vi.fn(),
    applyFilters: vi.fn(),
}));

vi.mock('../src/mobile-state.js', () => ({ isMobileView: (...a) => h.isMobileView(...a) }));
vi.mock('../src/mobile-poi.js', () => ({ renderMobilePoiList: (...a) => h.renderMobilePoiList(...a) }));
vi.mock('../src/map.js', () => ({ refreshMapMarkers: (...a) => h.refreshMapMarkers(...a) }));
vi.mock('../src/ui-filters.js', () => ({ populateCircuitsMenu: (...a) => h.populateCircuitsMenu(...a) }));
vi.mock('../src/circuit.js', () => ({
    loadCircuitById: (...a) => h.loadCircuitById(...a),
    clearCircuit: (...a) => h.clearCircuit(...a),
    navigatePoiDetails: (...a) => h.navigatePoiDetails(...a),
}));
vi.mock('../src/circuit-actions.js', () => ({ performCircuitDeletion: (...a) => h.performCircuitDeletion(...a) }));
vi.mock('../src/state.js', () => ({ setCircuitIdToImportFor: (...a) => h.setCircuitIdToImportFor(...a) }));
vi.mock('../src/ui-dom.js', () => ({ DOM: { gpxImporter: { click: (...a) => h.gpxImporterClick(...a) } } }));
vi.mock('../src/toast.js', () => ({ showToast: (...a) => h.showToast(...a) }));
vi.mock('../src/data.js', () => ({ applyFilters: (...a) => h.applyFilters(...a) }));

import { eventBus } from '../src/events.js';
import { setupEventBusListeners } from '../src/events-bus.js';

beforeEach(() => {
    vi.clearAllMocks();
    eventBus.listeners = {}; // reset le singleton entre tests
    setupEventBusListeners();
});

describe('events-bus — data:filtered', () => {
    it('mobile → rend la liste POI mobile, pas les markers carte', () => {
        h.isMobileView.mockReturnValue(true);
        const features = [{ id: 1 }];
        eventBus.emit('data:filtered', features);
        expect(h.renderMobilePoiList).toHaveBeenCalledWith(features);
        expect(h.refreshMapMarkers).not.toHaveBeenCalled();
    });

    it('desktop → rafraîchit les markers carte, pas la liste mobile', () => {
        h.isMobileView.mockReturnValue(false);
        const features = [{ id: 1 }, { id: 2 }];
        eventBus.emit('data:filtered', features);
        expect(h.refreshMapMarkers).toHaveBeenCalledWith(features);
        expect(h.renderMobilePoiList).not.toHaveBeenCalled();
    });
});

describe('events-bus — circuits', () => {
    it('circuit:request-load → loadCircuitById avec l\'id', async () => {
        eventBus.emit('circuit:request-load', 'circ-42');
        await Promise.resolve();
        expect(h.loadCircuitById).toHaveBeenCalledWith('circ-42');
    });

    it('circuit:clear → clearCircuit avec le flag silent', () => {
        eventBus.emit('circuit:clear', true);
        expect(h.clearCircuit).toHaveBeenCalledWith(true);
    });

    it('circuit:navigate-poi → navigatePoiDetails avec la direction', () => {
        eventBus.emit('circuit:navigate-poi', 'next');
        expect(h.navigatePoiDetails).toHaveBeenCalledWith('next');
    });

    it('circuit:list-updated → populateCircuitsMenu', () => {
        eventBus.emit('circuit:list-updated');
        expect(h.populateCircuitsMenu).toHaveBeenCalledTimes(1);
    });

    it('circuit:request-import → setCircuitIdToImportFor + clic sur l\'importeur GPX', () => {
        eventBus.emit('circuit:request-import', 'circ-7');
        expect(h.setCircuitIdToImportFor).toHaveBeenCalledWith('circ-7');
        expect(h.gpxImporterClick).toHaveBeenCalledTimes(1);
    });
});

describe('events-bus — circuit:request-delete', () => {
    it('succès → toast success + émet circuit:list-updated (→ populateCircuitsMenu)', async () => {
        h.performCircuitDeletion.mockResolvedValue({ success: true, message: 'Circuit supprimé' });
        eventBus.emit('circuit:request-delete', 'circ-9');
        await Promise.resolve(); await Promise.resolve(); // laisse l'async + le re-emit se dérouler

        expect(h.performCircuitDeletion).toHaveBeenCalledWith('circ-9');
        expect(h.showToast).toHaveBeenCalledWith('Circuit supprimé', 'success');
        // L'émission interne de circuit:list-updated déclenche populateCircuitsMenu.
        expect(h.populateCircuitsMenu).toHaveBeenCalledTimes(1);
    });

    it('échec → toast error, PAS de circuit:list-updated', async () => {
        h.performCircuitDeletion.mockResolvedValue({ success: false, message: 'Impossible' });
        eventBus.emit('circuit:request-delete', 'circ-10');
        await Promise.resolve(); await Promise.resolve();

        expect(h.showToast).toHaveBeenCalledWith('Impossible', 'error');
        expect(h.populateCircuitsMenu).not.toHaveBeenCalled();
    });
});

describe('events-bus — data:apply-filters', () => {
    it('→ applyFilters', () => {
        eventBus.emit('data:apply-filters');
        expect(h.applyFilters).toHaveBeenCalledTimes(1);
    });
});
