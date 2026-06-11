// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Tests dédiés à `computePlanifieCounter` (data.js) — refonte Mon Espace V2
// (14/05/2026). La fonction est passée du système whitelist
// (`selectedOfficialCircuitIds`) au système blacklist (`hiddenCircuitIds`).
// ============================================================================

// Mocks pour éviter de charger toute la chaîne data.js → database.js → modal.js
// (modal.js requiert document au top-level, donc jsdom suffit côté env).
vi.mock('../src/state.js', () => ({
    state: {
        officialCircuits: [],
        myCircuits: [],
        hiddenCircuitIds: [],
        loadedFeatures: [],
        userData: {},
        hiddenPoiIds: [],
        activeFilters: {}
    }
}));

vi.mock('../src/database.js', () => ({
    getAllPoiDataForMap: vi.fn(),
    getAllCircuitsForMap: vi.fn(),
    savePoiData: vi.fn(),
    getAppState: vi.fn(),
    saveAppState: vi.fn(),
    saveCircuit: vi.fn()
}));

vi.mock('../src/events.js', () => ({
    eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() }
}));

vi.mock('../src/logger.js', () => ({
    logModification: vi.fn()
}));

vi.mock('../src/gist-sync.js', () => ({
    schedulePush: vi.fn()
}));

vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));

import { state } from '../src/state.js';
import { computePlanifieCounter, buildPlannedPoiSet } from '../src/data.js';

describe('computePlanifieCounter (blacklist refonte V2)', () => {
    beforeEach(() => {
        state.officialCircuits = [];
        state.myCircuits = [];
        state.hiddenCircuitIds = [];
    });

    it('retourne 0 pour un poiId falsy', () => {
        expect(computePlanifieCounter(null)).toBe(0);
        expect(computePlanifieCounter(undefined)).toBe(0);
        expect(computePlanifieCounter('')).toBe(0);
    });

    it('compte les officiels et les perso non supprimés qui contiennent le POI', () => {
        state.officialCircuits = [
            { id: 'o1', poiIds: ['p1', 'p2'] },
            { id: 'o2', poiIds: ['p1'] }
        ];
        state.myCircuits = [
            { id: 'm1', poiIds: ['p1'] },
            { id: 'm2', poiIds: ['p3'] }
        ];

        expect(computePlanifieCounter('p1')).toBe(3); // o1 + o2 + m1
        expect(computePlanifieCounter('p2')).toBe(1); // o1
        expect(computePlanifieCounter('p3')).toBe(1); // m2
    });

    it('exclut les circuits perso supprimés (isDeleted)', () => {
        state.myCircuits = [
            { id: 'm1', poiIds: ['p1'] },
            { id: 'm2', poiIds: ['p1'], isDeleted: true }
        ];

        expect(computePlanifieCounter('p1')).toBe(1);
    });

    it('exclut les circuits officiels présents dans hiddenCircuitIds', () => {
        state.officialCircuits = [
            { id: 'o1', poiIds: ['p1'] },
            { id: 'o2', poiIds: ['p1'] }
        ];
        state.hiddenCircuitIds = ['o2'];

        expect(computePlanifieCounter('p1')).toBe(1);
    });

    it('exclut les circuits perso présents dans hiddenCircuitIds', () => {
        state.myCircuits = [
            { id: 'm1', poiIds: ['p1'] },
            { id: 'm2', poiIds: ['p1'] }
        ];
        state.hiddenCircuitIds = ['m2'];

        expect(computePlanifieCounter('p1')).toBe(1);
    });

    it('hiddenCircuitIds vide → tous les circuits comptent', () => {
        state.officialCircuits = [{ id: 'o1', poiIds: ['p1'] }];
        state.myCircuits = [{ id: 'm1', poiIds: ['p1'] }];
        state.hiddenCircuitIds = [];

        expect(computePlanifieCounter('p1')).toBe(2);
    });

    it('compare les IDs en String (résistant aux types mixtes)', () => {
        state.officialCircuits = [{ id: 1, poiIds: ['p1'] }];
        state.hiddenCircuitIds = ['1']; // string vs number

        expect(computePlanifieCounter('p1')).toBe(0);
    });

    it('ignore les circuits sans poiIds (champ absent ou non-array)', () => {
        state.officialCircuits = [
            { id: 'o1' }, // pas de poiIds
            { id: 'o2', poiIds: null },
            { id: 'o3', poiIds: ['p1'] }
        ];

        expect(computePlanifieCounter('p1')).toBe(1);
    });
});

// ============================================================================
// buildPlannedPoiSet (P4, 11/06/2026) — version « ensemble » de la même logique
// de circuits actifs : un Set des POI planifiés, construit une fois par passe de
// filtrage. Doit appliquer EXACTEMENT les mêmes exclusions que computePlanifieCounter.
// ============================================================================
describe('buildPlannedPoiSet (perf P4)', () => {
    beforeEach(() => {
        state.officialCircuits = [];
        state.myCircuits = [];
        state.hiddenCircuitIds = [];
    });

    it('aucun circuit → Set vide', () => {
        expect(buildPlannedPoiSet().size).toBe(0);
    });

    it('réunit les POI des officiels + perso actifs (sans doublon)', () => {
        state.officialCircuits = [{ id: 'o1', poiIds: ['p1', 'p2'] }, { id: 'o2', poiIds: ['p1'] }];
        state.myCircuits = [{ id: 'm1', poiIds: ['p3'] }];
        const set = buildPlannedPoiSet();
        expect([...set].sort()).toEqual(['p1', 'p2', 'p3']); // p1 dédupliqué
        expect(set.has('p1')).toBe(true);
        expect(set.has('p4')).toBe(false);
    });

    it('exclut perso supprimés et circuits cachés (officiels + perso)', () => {
        state.officialCircuits = [{ id: 'o1', poiIds: ['p1'] }, { id: 'o2', poiIds: ['p2'] }];
        state.myCircuits = [{ id: 'm1', poiIds: ['p3'] }, { id: 'm2', poiIds: ['p4'], isDeleted: true }];
        state.hiddenCircuitIds = ['o2'];
        const set = buildPlannedPoiSet();
        expect([...set].sort()).toEqual(['p1', 'p3']); // p2 caché, p4 supprimé
    });

    it('cohérent avec computePlanifieCounter (même définition de circuit actif)', () => {
        state.officialCircuits = [{ id: 'o1', poiIds: ['p1'] }, { id: 1, poiIds: ['p2'] }];
        state.hiddenCircuitIds = ['1']; // String vs number → o(id:1) caché
        const set = buildPlannedPoiSet();
        expect(set.has('p1')).toBe(true);
        expect(set.has('p2')).toBe(false);
        expect(computePlanifieCounter('p2')).toBe(0); // même exclusion
    });
});
