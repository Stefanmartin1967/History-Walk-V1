import { describe, it, expect, beforeEach, vi } from 'vitest';

// État partagé entre les mocks state.js et data.js : passesUserFilters lit
// l'état pour reproduire le comportement réel. vi.hoisted garantit que la
// référence est créée AVANT les factories mockés.
const { sharedState, getPoiIdImpl } = vi.hoisted(() => ({
    sharedState: {
        loadedFeatures: [],
        hiddenPoiIds: [],
        activeFilters: { vus: 'all', planifies: 'all', nonVerifies: false, zone: null, categories: [], incontournablesOnly: false, noPhoto: false, noDesc: false },
        isSelectionModeActive: false,
        selectionModeFilters: { hideVisited: false, hidePlanned: false },
        activeCircuitId: null,
        currentCircuit: null
    },
    getPoiIdImpl: (f) => f?.properties?.HW_ID || f?.id || null
}));

vi.mock('../src/state.js', () => ({
    state: sharedState,
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
// passesUserFilters mocké : réimplémente la logique de data.js, lit sharedState.
// Le test reste centré sur getZonesData (comptage par zone) sans dépendre de
// l'import réel de data.js (qui tire IndexedDB, gist-sync, etc.).
vi.mock('../src/data.js', () => ({
    applyFilters: vi.fn(),
    getPoiId: getPoiIdImpl,
    passesStructuralFilters(feature, { skipZone = false } = {}) {
        if (!feature) return false;
        const props = { ...feature.properties, ...feature.properties.userData };
        const s = sharedState;
        if (!skipZone && s.activeFilters.zone && props.Zone !== s.activeFilters.zone) return false;
        if (s.activeFilters.categories && s.activeFilters.categories.length > 0) {
            if (!s.activeFilters.categories.includes(props['Catégorie'])) return false;
        }
        return true;
    },
    passesUserFilters(feature) {
        if (!feature) return false;
        const props = { ...feature.properties, ...feature.properties.userData };
        const poiId = getPoiIdImpl(feature);
        const s = sharedState;
        if (s.hiddenPoiIds && s.hiddenPoiIds.includes(poiId)) return false;
        if (props.incontournable) return true;
        if (s.activeCircuitId && s.currentCircuit && s.currentCircuit.some(f => getPoiIdImpl(f) === poiId)) {
            return true;
        }
        if (s.activeFilters.nonVerifies && props.verified) return false;
        if (s.isSelectionModeActive) {
            if (s.selectionModeFilters?.hideVisited && props.vu) return false;
            if (s.selectionModeFilters?.hidePlanned && (props.planifieCounter || 0) > 0) return false;
        } else {
            if (s.activeFilters.vus && props.vu) return false;
            if (s.activeFilters.planifies && (props.planifieCounter || 0) > 0) return false;
        }
        return true;
    }
}));
vi.mock('../src/mobile-state.js', () => ({ isMobileView: vi.fn(() => false) }));
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
        state.activeFilters = { vus: false, planifies: false, nonVerifies: false, zone: null, categories: [] };
        state.isSelectionModeActive = false;
        state.selectionModeFilters = { hideVisited: false, hidePlanned: false };
        state.activeCircuitId = null;
        state.currentCircuit = null;
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

    describe('Filtre catégorie multi (appliqué)', () => {
        it('ne compte que les POI dont Catégorie est dans activeFilters.categories', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Ajim', { categorie: 'Mosquée' }),
                makeFeature('B', 'Ajim', { categorie: 'Mosquée' }),
                makeFeature('C', 'Ajim', { categorie: 'Plage' }),
                makeFeature('D', 'El Groa', { categorie: 'Mosquée' }),
                makeFeature('E', 'El Groa', { categorie: 'Restaurant' })
            ];
            state.activeFilters.categories = ['Mosquée'];
            const r = getZonesData();
            expect(r.totalVisible).toBe(3);
            expect(r.zoneCounts).toEqual({ Ajim: 2, 'El Groa': 1 });
        });

        it('categories=[] équivaut à aucun filtre catégorie', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Ajim', { categorie: 'Mosquée' }),
                makeFeature('B', 'Ajim', { categorie: 'Plage' })
            ];
            state.activeFilters.categories = [];
            const r = getZonesData();
            expect(r.totalVisible).toBe(2);
        });
    });

    describe('Filtre Zone (skipZone:true → ignoré)', () => {
        it('un filtre Zone actif n\'affecte PAS les compteurs (chaque zone garde son propre compte)', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Ajim'),
                makeFeature('B', 'Ajim'),
                makeFeature('C', 'Houmt Souk'),
                makeFeature('D', 'Houmt Souk'),
                makeFeature('E', 'Houmt Souk')
            ];
            state.activeFilters.zone = 'Ajim'; // ne doit RIEN changer ici
            const r = getZonesData();
            expect(r.totalVisible).toBe(5);
            expect(r.zoneCounts).toEqual({ Ajim: 2, 'Houmt Souk': 3 });
        });
    });

    describe('Combinaison de filtres', () => {
        it('applique vus + planifies simultanément', () => {
            state.loadedFeatures = [
                makeFeature('A', 'Nord', { userData: { vu: false } }),
                makeFeature('B', 'Nord', { userData: { vu: true } }),
                makeFeature('C', 'Sud', { userData: { planifieCounter: 1 } }),
                makeFeature('D', 'Est')
            ];
            state.activeFilters = { vus: 'hide', planifies: 'hide', nonVerifies: false };
            const r = getZonesData();
            // A et D passent ; B (vu) et C (planifié) sont filtrés
            expect(r.totalVisible).toBe(2);
            expect(r.zoneCounts).toEqual({ Nord: 1, Est: 1 });
        });
    });
});
