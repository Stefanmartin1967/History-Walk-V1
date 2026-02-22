import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateStats, GLOBAL_RANKS, ANIMAL_RANKS, MATERIAL_RANKS } from '../src/statistics.js';
import * as mapModule from '../src/map.js';
import { state } from '../src/state.js';

// Mock dependencies
vi.mock('../src/map.js', () => ({
    getRealDistance: vi.fn(),
    getOrthodromicDistance: vi.fn()
}));

vi.mock('../src/state.js', () => ({
    state: {
        loadedFeatures: [],
        userData: {},
        officialCircuits: [],
        officialCircuitsStatus: {},
        myCircuits: []
    },
    getCurrentCurrency: vi.fn(() => 'TND'),
    POI_CATEGORIES: []
}));

vi.mock('../src/data.js', () => ({
    getPoiId: vi.fn(f => f.id)
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

        const stats = calculateStats();

        expect(stats.totalXP).toBe(0);
        expect(stats.globalRank.min).toBe(0);
        expect(stats.globalRank.title).toBe(GLOBAL_RANKS[GLOBAL_RANKS.length - 1].title); // "Premier Souffle"

        expect(stats.distancePercent).toBe(0);
        expect(stats.circuitPercent).toBe(0);

        expect(stats.animalRank.min).toBe(0); // Colibri (0-10%)
        expect(stats.materialRank.min).toBe(0); // Bois (0-10%)
    });

    it('should calculate 50% XP correctly', () => {
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

        // Rank for 10000 XP is "Regard d'Horizon"
        expect(stats.globalRank.title).toBe("Regard d'Horizon");

        expect(stats.distancePercent).toBe(50);
        expect(stats.circuitPercent).toBe(50);

        // Animal Rank for 50%: "Loup" (min: 50)
        expect(stats.animalRank.title).toBe("Loup");

        // Material Rank for 50%: "Argent" (min: 50)
        expect(stats.materialRank.title).toBe("Argent");
    });

    it('should calculate 100% XP correctly (Max Level)', () => {
        state.officialCircuits = [
            { id: 'c1', distance: '10.0 km' }
        ];
        state.officialCircuitsStatus = { 'c1': true };

        const stats = calculateStats();

        expect(stats.totalXP).toBe(20000);
        expect(stats.globalRank.title).toBe("Lueur d'Éternité");

        expect(stats.animalRank.title).toBe("Phénix"); // 90-100%
        expect(stats.materialRank.title).toBe("Diamant"); // 90-100%
    });

    it('should handle mixed progress (e.g. small circuit done)', () => {
        // c1: 10km, c2: 90km. Total 100km.
        state.officialCircuits = [
            { id: 'c1', distance: '10.0 km' },
            { id: 'c2', distance: '90.0 km' }
        ];

        // User done c1 only.
        // Circuits: 1/2 = 50% -> 5000 XP.
        // Distance: 10/100 = 10% -> 1000 XP.
        // Total XP = 6000.
        state.officialCircuitsStatus = { 'c1': true };

        const stats = calculateStats();

        expect(stats.totalXP).toBe(6000);
        // Rank for 6000 XP: > 4500 (Âme Vagabonde) but < 7000 (Sillage d'Argent)
        expect(stats.globalRank.title).toBe("Âme Vagabonde");

        expect(stats.circuitPercent).toBe(50);
        expect(stats.distancePercent).toBe(10);

        expect(stats.materialRank.title).toBe("Argent"); // 50%
        expect(stats.animalRank.title).toBe("Hérisson"); // 10%
    });

    it('should handle zero official circuits gracefully', () => {
        state.officialCircuits = [];
        const stats = calculateStats();

        expect(stats.totalXP).toBe(0);
        expect(stats.distancePercent).toBe(0);
        expect(stats.circuitPercent).toBe(0);
    });

    it('should use fallback distance calculation if string is missing', () => {
        // Setup circuit with no string distance but realTrack
        state.officialCircuits = [
            { id: 'c1', realTrack: [[0,0], [0,1]] } // 1 degree lat ~ 111km
        ];

        // Mock getRealDistance to return 1000 meters
        mapModule.getRealDistance.mockReturnValue(1000);

        state.officialCircuitsStatus = { 'c1': true };

        const stats = calculateStats();

        // Total Distance 1000m. User 1000m. 100%
        expect(stats.distancePercent).toBe(100);
        expect(stats.totalXP).toBe(20000);
    });
});
