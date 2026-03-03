/**
 * @vitest-environment jsdom
 */
// tests/gpx_performance.test.js
import { describe, it, expect, vi } from 'vitest';
import { computeCircuitCounters } from '../src/circuit-actions';

// Mock simple getPoiId behavior
vi.mock('../src/utils.js', () => ({
    getPoiId: (feature) => feature.properties.HW_ID || feature.id,
    escapeXml: (str) => str,
    downloadFile: vi.fn(),
}));

// Mock complex state/db dependencies that might explode
vi.mock('../src/state.js', () => ({
    state: {},
    APP_VERSION: 'Test'
}));
vi.mock('../src/data.js', () => ({
    getPoiId: (feature) => feature.properties.HW_ID || feature.id,
    getPoiName: () => 'Test',
    applyFilters: vi.fn()
}));
vi.mock('../src/circuit.js', () => ({
    generateCircuitName: () => 'Test',
    loadCircuitById: vi.fn()
}));
vi.mock('../src/ui.js', () => ({
    DOM: {}
}));
vi.mock('../src/database.js', () => ({
    getAllPoiDataForMap: vi.fn(),
    getAllCircuitsForMap: vi.fn(),
    saveCircuit: vi.fn(),
    batchSavePoiData: vi.fn(),
    getAppState: vi.fn()
}));
vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));
vi.mock('../src/map.js', () => ({
    updatePolylines: vi.fn()
}));


describe('GPX Performance Optimization', () => {

    it('computeCircuitCounters should correctly count planified POIs', () => {
        // Setup Features
        const features = [
            { properties: { HW_ID: 'POI-1', userData: {} } },
            { properties: { HW_ID: 'POI-2', userData: { deleted: true } } }, // Deleted POI
            { properties: { HW_ID: 'POI-3', userData: {} } }
        ];

        // Setup Circuits
        const circuits = [
            { id: 'C1', poiIds: ['POI-1', 'POI-2'], isDeleted: false }, // Should count POI-1 (1), Ignore POI-2 (Deleted)
            { id: 'C2', poiIds: ['POI-1', 'POI-3'], isDeleted: false }, // Should count POI-1 (2), POI-3 (1)
            { id: 'C3', poiIds: ['POI-1'], isDeleted: true } // Deleted Circuit -> Should be ignored
        ];

        const counters = computeCircuitCounters(features, circuits);

        expect(counters['POI-1']).toBe(2); // C1 + C2
        expect(counters['POI-2']).toBe(0); // Deleted POI
        expect(counters['POI-3']).toBe(1); // C2
    });

    it('computeCircuitCounters should run fast on large dataset', () => {
        const NUM_FEATURES = 1000;
        const NUM_CIRCUITS = 200;
        const POIS_PER_CIRCUIT = 20;

        const features = [];
        for (let i = 0; i < NUM_FEATURES; i++) {
            features.push({
                properties: { HW_ID: `F-${i}`, userData: {} }
            });
        }

        const circuits = [];
        for (let i = 0; i < NUM_CIRCUITS; i++) {
            const poiIds = [];
            for (let j = 0; j < POIS_PER_CIRCUIT; j++) {
                poiIds.push(`F-${Math.floor(Math.random() * NUM_FEATURES)}`);
            }
            circuits.push({ id: `C-${i}`, poiIds, isDeleted: false });
        }

        const start = performance.now();
        const counters = computeCircuitCounters(features, circuits);
        const end = performance.now();

        // Should be extremely fast (< 10ms usually, but giving generous buffer for CI environment)
        expect(end - start).toBeLessThan(100);

        // Sanity check
        expect(Object.keys(counters).length).toBeGreaterThan(0);
    });

});
