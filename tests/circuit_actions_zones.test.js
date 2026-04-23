import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks des dépendances lourdes (UI, DB, carte) — getZonesData ne lit que
// state + getPoiId. On garde une vraie implémentation de getPoiId.
vi.mock('../src/state.js', () => ({
    state: {
        loadedFeatures: [],
        hiddenPoiIds: [],
        activeFilters: { restaurants: false, vus: false, planifies: false }
    },
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
vi.mock('../src/mobile.js', () => ({ isMobileView: vi.fn(() => false) }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn() }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/utils.js', () => ({ generateHWID: vi.fn(() => 'HW-TEST') }));
vi.mock('../src/gpx.js', () => ({ generateAndDownloadGPX: vi.fn() }));
vi.mock('../src/ui.js', () => ({ DOM: {} }));

import { state } from '../src/state.js';
import { getZonesData } from '../src/circuit-actions.js';

// Helper : fabriquer un feature minimal
function makeFeature(id, zone, extras = {}) {
    return {
        properties: {
            HW_ID: id,
            Zone: zone,
            Catégorie: extras.categorie || 'Monument',
            userData: extras.userData || {},
            ...extras.rootProps
        }
    };
}

describe('getZonesData', () => {
    beforeEach(() => {
        state.loadedFeatures = [];
        state.hiddenPoiIds = [];
        state.activeFilters = { restaurants: false, vus: false, planifies: false };
    });

    describe('Cas triviaux', () => {
        it('retourne null si loadedFeatures est vide', () => {
            state.loadedFeatures = [];
            expect(getZonesData()).toBeNull();
        });

        it('retourne null si loadedFeatures est undefined', () => {
            state.loadedFeatures = undefined;
            expect(getZonesData()).toBeNull();
        });
    });

    describe('Comptage de base', () => {
        it('compte 1 feature dans 1 zone', () => {
            state.loadedFeatures = [makeFeature('A', 'Nord')];
            const r = getZonesData();
            expect(r.totalVisible).toBe(1);
            expect(r.zoneCounts).toEqual({ Nord: 1 });
            expect(r.sortedZones).toEqual(['Nord']);
        });

        it('compte plusieurs features dans la même zone', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Nord'),
                makeFeature('B', 'Nord'),
                makeFeature('C', 'Nord')
            ];
            const r = getZonesData();
            expect(r.zoneCounts.Nord).toBe(3);
        });

        it('compte features réparties sur plusieurs zones', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Nord'),
                makeFeature('B', 'Sud'),
                makeFeature('C', 'Sud'),
                makeFeature('D', 'Est')
            ];
            const r = getZonesData();
            expect(r.zoneCounts).toEqual({ Nord: 1, Sud: 2, Est: 1 });
            expect(r.totalVisible).toBe(4);
        });

        it('retourne les zones triées alphabétiquement', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Zuid'),
                makeFeature('B', 'Ouest'),
                makeFeature('C', 'Est'),
                makeFeature('D', 'Nord')
            ];
            const r = getZonesData();
            expect(r.sortedZones).toEqual(['Est', 'Nord', 'Ouest', 'Zuid']);
        });

        it('ignore les features sans zone (pas dans zoneCounts, mais compte en totalVisible)', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Nord'),
                makeFeature('B', null),
                makeFeature('C', undefined)
            ];
            const r = getZonesData();
            expect(r.zoneCounts).toEqual({ Nord: 1 });
            expect(r.totalVisible).toBe(3); // les 3 features passent le filtre, mais 2 n'entrent pas dans le comptage par zone
        });
    });

    describe('Filtre hiddenPoiIds', () => {
        it('exclut les POI listés dans hiddenPoiIds', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Nord'),
                makeFeature('B', 'Nord')
            ];
            state.hiddenPoiIds = ['B'];
            const r = getZonesData();
            expect(r.totalVisible).toBe(1);
            expect(r.zoneCounts.Nord).toBe(1);
        });

        it('tolère hiddenPoiIds undefined', () => {
            state.loadedFeatures = [makeFeature('A', 'Nord')];
            state.hiddenPoiIds = undefined;
            const r = getZonesData();
            expect(r.totalVisible).toBe(1);
        });
    });

    describe('Filtre restaurants', () => {
        it('ne garde que les Catégorie=Restaurant quand le filtre est actif', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Nord', { categorie: 'Restaurant' }),
                makeFeature('B', 'Nord', { categorie: 'Monument' }),
                makeFeature('C', 'Sud', { categorie: 'Restaurant' })
            ];
            state.activeFilters.restaurants = true;
            const r = getZonesData();
            expect(r.totalVisible).toBe(2);
            expect(r.zoneCounts).toEqual({ Nord: 1, Sud: 1 });
        });
    });

    describe('Filtre vus', () => {
        it('exclut les POI marqués vu quand le filtre est actif', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Nord', { userData: { vu: true } }),
                makeFeature('B', 'Nord', { userData: { vu: false } }),
                makeFeature('C', 'Sud')
            ];
            state.activeFilters.vus = true;
            const r = getZonesData();
            expect(r.totalVisible).toBe(2);
        });

        it('incontournable protège un POI vu du filtre', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Nord', { userData: { vu: true }, rootProps: { incontournable: true } }),
                makeFeature('B', 'Nord', { userData: { vu: true } })
            ];
            state.activeFilters.vus = true;
            const r = getZonesData();
            expect(r.totalVisible).toBe(1); // A reste (incontournable), B filtré
        });
    });

    describe('Filtre planifies', () => {
        it('exclut les POI avec planifieCounter > 0', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Nord', { userData: { planifieCounter: 1 } }),
                makeFeature('B', 'Nord', { userData: { planifieCounter: 0 } }),
                makeFeature('C', 'Sud', { userData: {} })
            ];
            state.activeFilters.planifies = true;
            const r = getZonesData();
            expect(r.totalVisible).toBe(2); // B (counter=0) et C (undefined) passent
        });

        it('incontournable protège un POI planifié du filtre', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Nord', {
                    userData: { planifieCounter: 2 },
                    rootProps: { incontournable: true }
                }),
                makeFeature('B', 'Nord', { userData: { planifieCounter: 3 } })
            ];
            state.activeFilters.planifies = true;
            const r = getZonesData();
            expect(r.totalVisible).toBe(1); // A reste
        });

        it('traite planifieCounter undefined comme 0', () => {
            state.loadedFeatures = [makeFeature('A', 'Nord', { userData: {} })];
            state.activeFilters.planifies = true;
            const r = getZonesData();
            expect(r.totalVisible).toBe(1);
        });
    });

    describe('Combinaison de filtres', () => {
        it('applique tous les filtres actifs simultanément', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Nord', { categorie: 'Restaurant', userData: { vu: false } }),
                makeFeature('B', 'Nord', { categorie: 'Monument' }),
                makeFeature('C', 'Sud', { categorie: 'Restaurant', userData: { vu: true } }),
                makeFeature('D', 'Est', { categorie: 'Restaurant', userData: { planifieCounter: 1 } })
            ];
            state.activeFilters = { restaurants: true, vus: true, planifies: true };
            const r = getZonesData();
            // Seul A : restaurant, pas vu, pas planifié
            expect(r.totalVisible).toBe(1);
            expect(r.zoneCounts).toEqual({ Nord: 1 });
        });
    });
});
