import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateStats, GLOBAL_RANKS, ANIMAL_RANKS, MATERIAL_RANKS } from '../src/statistics.js';
import * as mapModule from '../src/map.js';
import { state } from '../src/state.js';

// Mock dependencies
vi.mock('../src/map.js', () => ({
    getRealDistance: vi.fn(),
    getOrthodromicDistance: vi.fn()
}));

// We need to mock state in a way we can manipulate it
vi.mock('../src/state.js', () => {
    return {
        state: {
            loadedFeatures: [],
            userData: {},
            officialCircuits: [],
            officialCircuitsStatus: {},
            myCircuits: []
        },
        getCurrentCurrency: vi.fn(() => 'TND'),
        POI_CATEGORIES: []
    };
});

vi.mock('../src/data.js', () => ({
    // Mock getPoiId to simply return the ID property
    getPoiId: vi.fn(f => f.properties.HW_ID)
}));

vi.mock('../src/modal.js', () => ({
    showAlert: vi.fn()
}));

describe('Statistics System', () => {

    beforeEach(() => {
        // Reset state before each test
        state.loadedFeatures = [];
        state.userData = {};
        state.officialCircuits = [];
        state.officialCircuitsStatus = {};
        state.myCircuits = [];
        state.hiddenPoiIds = []; // Important: Reset hidden POIs
        vi.resetAllMocks();
    });

    it('should return 0 XP and lowest ranks when no progress', () => {
        // Setup official circuits
        state.officialCircuits = [
            { id: 'c1', distance: '10.0 km' },
            { id: 'c2', distance: '10.0 km' }
        ];
        // 0 progress
        state.officialCircuitsStatus = {};

        // Setup POIs (for Material Rank)
        state.loadedFeatures = [
            { properties: { HW_ID: 'p1' } },
            { properties: { HW_ID: 'p2' } }
        ];

        const stats = calculateStats();

        expect(stats.totalXP).toBe(0);
        expect(stats.globalRank.min).toBe(0);
        expect(stats.globalRank.title).toBe(GLOBAL_RANKS[GLOBAL_RANKS.length - 1].title); // "Premier Souffle"

        expect(stats.distancePercent).toBe(0);
        expect(stats.circuitPercent).toBe(0);
        expect(stats.poiPercent).toBe(0);

        expect(stats.animalRank.min).toBe(0); // Colibri (0-10%)
        expect(stats.materialRank.min).toBe(0); // Bois (0-10%)
    });

    it('should calculate Material Rank based on POI visits (NEW LOGIC)', () => {
        // Setup POIs: 10 POIs
        state.loadedFeatures = Array.from({ length: 10 }, (_, i) => ({
            properties: { HW_ID: `p${i}` }
        }));

        // Visit 5 POIs (50%)
        ['p0', 'p1', 'p2', 'p3', 'p4'].forEach(id => {
            state.userData[id] = { vu: true };
        });

        const stats = calculateStats();

        expect(stats.visitedPois).toBe(5);
        expect(stats.totalPois).toBe(10);
        expect(stats.poiPercent).toBe(50);

        // Material Rank for 50%: "Argent" (min: 50)
        expect(stats.materialRank.title).toBe("Argent");
    });

    it('should calculate XP based on Circuits and Distance (LEGACY LOGIC)', () => {
        // XP logic didn't change, only Material Rank did.
        // Setup: 2 circuits of 10km each. Total 20km.
        state.officialCircuits = [
            { id: 'c1', distance: '10.0 km' },
            { id: 'c2', distance: '10.0 km' }
        ];

        // User completed 1 circuit (50% circuits, 50% distance)
        state.officialCircuitsStatus = { 'c1': true };

        const stats = calculateStats();

        // Distance XP: (10 / 20) * 10000 = 5000
        // Circuit XP: (1 / 2) * 10000 = 5000
        // Total XP: 10000
        expect(stats.totalXP).toBe(10000);
        expect(stats.globalRank.title).toBe("Regard d'Horizon");

        // Distance Percent affects Animal Rank
        expect(stats.distancePercent).toBe(50);
        expect(stats.animalRank.title).toBe("Loup");

        // BUT Material Rank is based on POIs.
        // We have 0 POIs loaded in this test case, so 0%.
        expect(stats.poiPercent).toBe(0);
        expect(stats.materialRank.title).toBe("Bois");
    });

    it('should handle mixed progress', () => {
        // c1: 10km, c2: 90km. Total 100km.
        state.officialCircuits = [
            { id: 'c1', distance: '10.0 km' },
            { id: 'c2', distance: '90.0 km' }
        ];
        state.officialCircuitsStatus = { 'c1': true };

        // Add 100 POIs, visit 10 (10%)
        state.loadedFeatures = Array.from({ length: 100 }, (_, i) => ({
            properties: { HW_ID: `p${i}` }
        }));
        for(let i=0; i<10; i++) state.userData[`p${i}`] = { vu: true };

        const stats = calculateStats();

        // XP Calculation (Legacy)
        // Circuits: 1/2 = 50% -> 5000 XP
        // Distance: 10/100 = 10% -> 1000 XP
        // Total: 6000 XP
        expect(stats.totalXP).toBe(6000);
        expect(stats.globalRank.title).toBe("Âme Vagabonde"); // > 4500

        // Animal Rank (Distance): 10% -> Hérisson
        expect(stats.animalRank.title).toBe("Hérisson");

        // Material Rank (POIs): 10% -> Pierre
        expect(stats.poiPercent).toBe(10);
        expect(stats.materialRank.title).toBe("Pierre");
    });

    it('should include all POIs in total count (reverted hidden filter)', () => {
        // Setup 10 POIs
        state.loadedFeatures = Array.from({ length: 10 }, (_, i) => ({
            properties: { HW_ID: `p${i}` }
        }));

        // Hide 2 POIs
        state.hiddenPoiIds = ['p8', 'p9'];

        // Visit 1 visible POI
        state.userData['p0'] = { vu: true };
        // Visit 1 hidden POI (should count as visited if filtering is disabled)
        state.userData['p8'] = { vu: true };

        const stats = calculateStats();

        // Total should be 10 (hidden are NOT excluded anymore)
        expect(stats.totalPois).toBe(10);

        // Visited should be 2 (p0 and p8)
        expect(stats.visitedPois).toBe(2);

        // Percent: 2/10 = 20%
        expect(stats.poiPercent).toBe(20);
    });

    it('should count POIs from completed circuits as visited even if not marked vu', () => {
        // Setup 10 POIs
        state.loadedFeatures = Array.from({ length: 10 }, (_, i) => ({
            properties: { HW_ID: `p${i}` }
        }));

        // Setup 1 completed circuit containing p0, p1, p2
        state.officialCircuits = [
            { id: 'c1', poiIds: ['p0', 'p1', 'p2'] }
        ];
        state.officialCircuitsStatus = { 'c1': true };

        // No individual 'vu' status set in userData
        state.userData = {};

        const stats = calculateStats();

        // Should count p0, p1, p2 as visited because c1 is completed
        expect(stats.visitedPois).toBe(3);
        expect(stats.poiPercent).toBe(30);
    });
});
