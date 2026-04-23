import { describe, it, expect, vi } from 'vitest';

// computeCircuitCounters est quasi-pure, mais vit dans circuit-actions.js
// qui importe un gros arbre de dépendances. On mock tout sauf getPoiId.
vi.mock('../src/state.js', () => ({
    state: { officialCircuits: [], loadedFeatures: [], currentMapId: null },
    addMyCircuit: vi.fn(),
    updateMyCircuit: vi.fn(),
    setActiveCircuitId: vi.fn(),
    setHasUnexportedChanges: vi.fn(),
    setUserData: vi.fn(),
    setOfficialCircuits: vi.fn()
}));
vi.mock('../src/database.js', () => ({
    deleteCircuitById: vi.fn(),
    softDeleteCircuit: vi.fn(),
    getAllPoiDataForMap: vi.fn(),
    getAllCircuitsForMap: vi.fn(),
    batchSavePoiData: vi.fn(),
    getAppState: vi.fn(),
    saveCircuit: vi.fn()
}));
vi.mock('../src/circuit.js', () => ({
    clearCircuit: vi.fn(),
    setCircuitVisitedState: vi.fn(),
    generateCircuitName: vi.fn()
}));
vi.mock('../src/data.js', () => ({
    applyFilters: vi.fn(),
    getPoiId: (f) => f?.properties?.HW_ID || f?.id || null
}));
vi.mock('../src/mobile-state.js', () => ({ isMobileView: vi.fn(() => false) }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn() }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/utils.js', () => ({ generateHWID: vi.fn(() => 'HW-TEST') }));
vi.mock('../src/gpx.js', () => ({ generateAndDownloadGPX: vi.fn() }));
vi.mock('../src/ui.js', () => ({ DOM: {} }));

import { computeCircuitCounters } from '../src/circuit-actions.js';

function feat(id, userData = {}) {
    return { properties: { HW_ID: id, userData } };
}

describe('computeCircuitCounters', () => {
    describe('Cas triviaux', () => {
        it('retourne un objet vide si aucun feature', () => {
            const counters = computeCircuitCounters([], []);
            expect(counters).toEqual({});
        });

        it('initialise tous les counters à 0 si aucun circuit', () => {
            const counters = computeCircuitCounters([feat('A'), feat('B')], []);
            expect(counters).toEqual({ A: 0, B: 0 });
        });

        it('tolère circuits avec poiIds absent', () => {
            const counters = computeCircuitCounters(
                [feat('A')],
                [{ id: 'c1' }, { id: 'c2', poiIds: undefined }]
            );
            expect(counters).toEqual({ A: 0 });
        });
    });

    describe('Comptage dans circuits', () => {
        it('compte 1 quand un POI est dans 1 circuit', () => {
            const counters = computeCircuitCounters(
                [feat('A'), feat('B')],
                [{ id: 'c1', poiIds: ['A'] }]
            );
            expect(counters).toEqual({ A: 1, B: 0 });
        });

        it('compte N quand un POI est dans N circuits', () => {
            const counters = computeCircuitCounters(
                [feat('A')],
                [
                    { id: 'c1', poiIds: ['A'] },
                    { id: 'c2', poiIds: ['A'] },
                    { id: 'c3', poiIds: ['A'] }
                ]
            );
            expect(counters.A).toBe(3);
        });

        it('dédoublonne les occurrences dans un même circuit', () => {
            const counters = computeCircuitCounters(
                [feat('A')],
                [{ id: 'c1', poiIds: ['A', 'A', 'A'] }]
            );
            expect(counters.A).toBe(1); // le Set déduplique
        });

        it('compte indépendamment plusieurs POI dans le même circuit', () => {
            const counters = computeCircuitCounters(
                [feat('A'), feat('B'), feat('C')],
                [{ id: 'c1', poiIds: ['A', 'B', 'C'] }]
            );
            expect(counters).toEqual({ A: 1, B: 1, C: 1 });
        });
    });

    describe('Exclusions', () => {
        it('exclut les circuits isDeleted (corbeille)', () => {
            const counters = computeCircuitCounters(
                [feat('A')],
                [
                    { id: 'c1', poiIds: ['A'] },
                    { id: 'c2', poiIds: ['A'], isDeleted: true }
                ]
            );
            expect(counters.A).toBe(1); // seul c1 compte
        });

        it('n\'incrémente pas un POI marqué userData.deleted', () => {
            const counters = computeCircuitCounters(
                [feat('A', { deleted: true }), feat('B')],
                [{ id: 'c1', poiIds: ['A', 'B'] }]
            );
            expect(counters).toEqual({ A: 0, B: 1 });
        });

        it('ignore les poiIds qui ne correspondent à aucun feature', () => {
            const counters = computeCircuitCounters(
                [feat('A')],
                [{ id: 'c1', poiIds: ['A', 'ghost1', 'ghost2'] }]
            );
            expect(counters).toEqual({ A: 1 }); // ghost1/ghost2 absents du résultat
        });
    });

    describe('Scénarios mixtes', () => {
        it('combine circuits actifs, supprimés, POI partagés et deleted', () => {
            const features = [feat('A'), feat('B'), feat('C', { deleted: true })];
            const circuits = [
                { id: 'c1', poiIds: ['A', 'B', 'C'] },           // actif
                { id: 'c2', poiIds: ['A'] },                     // actif
                { id: 'c3', poiIds: ['A', 'B'], isDeleted: true }// supprimé
            ];
            const counters = computeCircuitCounters(features, circuits);
            expect(counters).toEqual({ A: 2, B: 1, C: 0 });
        });
    });
});
