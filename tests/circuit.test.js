// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (hoisted par vitest) ---
vi.mock('../src/state.js', () => {
    const state = {
        currentMapId: 'djerba',
        currentCircuit: [],
        activeCircuitId: null,
        myCircuits: [],
        officialCircuits: [],
        loadedFeatures: [],
        userData: {},
        testedCircuits: {},
        officialCircuitsStatus: {},
        currentFeatureId: null,
        currentCircuitIndex: null,
        customDraftName: null,
        isAdmin: false
    };
    return {
        state,
        MAX_CIRCUIT_POINTS: 15,
        setSelectionMode: vi.fn(),
        addPoiToCurrentCircuit: vi.fn(f => { state.currentCircuit.push(f); }),
        resetCurrentCircuit: vi.fn(() => { state.currentCircuit = []; }),
        addMyCircuit: vi.fn(),
        updateMyCircuit: vi.fn(),
        setTestedCircuits: vi.fn(),
        setActiveCircuitId: vi.fn(id => { state.activeCircuitId = id; }),
        setTestedCircuit: vi.fn(),
        setOfficialCircuitStatus: vi.fn(),
        setCustomDraftName: vi.fn(name => { state.customDraftName = name; }),
        setCurrentFeatureId: vi.fn(),
        setCurrentCircuitIndex: vi.fn(),
        setCurrentCircuit: vi.fn()
    };
});

vi.mock('../src/ui-dom.js', () => ({
    DOM: {
        circuitDescription: null,
        circuitTitleText: null
    }
}));

vi.mock('../src/ui-details.js', () => ({
    openDetailsPanel: vi.fn()
}));

vi.mock('../src/ui-sidebar.js', () => ({
    switchSidebarTab: vi.fn()
}));

vi.mock('../src/data.js', () => ({
    getPoiId: vi.fn(f => f?.properties?.HW_ID || f?.id),
    getPoiName: vi.fn(f => f?.properties?.name || 'Unknown'),
    applyFilters: vi.fn(),
    recomputeVu: vi.fn()
}));

vi.mock('../src/utils.js', () => ({
    getRealDistance: vi.fn(() => 0),
    getOrthodromicDistance: vi.fn(() => 0)
}));

vi.mock('../src/database.js', () => ({
    getAppState: vi.fn(),
    saveAppState: vi.fn(),
    saveCircuit: vi.fn(),
    batchSavePoiData: vi.fn()
}));

vi.mock('../src/mobile-state.js', () => ({
    isMobileView: vi.fn(() => false)
}));

vi.mock('../src/circuit-view.js', () => ({
    renderCircuitList: vi.fn(),
    updateControlButtons: vi.fn(),
    updateCircuitHeader: vi.fn()
}));

vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../src/modal.js', () => ({
    showConfirm: vi.fn()
}));

vi.mock('../src/events.js', () => ({
    eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() }
}));

vi.mock('../src/gist-sync.js', () => ({
    pushToGist: vi.fn()
}));

import { state } from '../src/state.js';
import { DOM } from '../src/ui-dom.js';
import { showToast } from '../src/toast.js';
import { saveAppState } from '../src/database.js';
import {
    isCircuitTested,
    isCircuitCompleted,
    notifyCircuitChanged,
    generateCircuitName,
    addPoiToCircuit,
    convertToDraft
} from '../src/circuit.js';

function resetState() {
    state.currentMapId = 'djerba';
    state.currentCircuit = [];
    state.activeCircuitId = null;
    state.myCircuits = [];
    state.officialCircuits = [];
    state.loadedFeatures = [];
    state.userData = {};
    state.testedCircuits = {};
    state.officialCircuitsStatus = {};
    state.currentFeatureId = null;
    state.currentCircuitIndex = null;
    state.customDraftName = null;
    state.isAdmin = false;
    DOM.circuitDescription = null;
    DOM.circuitTitleText = null;
}

beforeEach(() => {
    resetState();
    vi.clearAllMocks();
});

// Helper to create a mock POI feature
function poi(id, name = id) {
    return { type: 'Feature', properties: { HW_ID: id, name }, geometry: null };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('isCircuitTested', () => {
    it('retourne true si testedCircuits[id] === true', () => {
        state.testedCircuits = { 'c1': true };
        expect(isCircuitTested('c1')).toBe(true);
    });

    it('retourne false si testedCircuits[id] absent ou false', () => {
        state.testedCircuits = { 'c1': false };
        expect(isCircuitTested('c1')).toBe(false);
        expect(isCircuitTested('c2')).toBe(false);
    });

    it('coerce l\'ID en string (lookup avec ID numérique)', () => {
        state.testedCircuits = { '42': true };
        expect(isCircuitTested(42)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('isCircuitCompleted', () => {
    it('retourne false pour null/undefined', () => {
        expect(isCircuitCompleted(null)).toBe(false);
        expect(isCircuitCompleted(undefined)).toBe(false);
    });

    it('officiel : lit officialCircuitsStatus[id]', () => {
        state.officialCircuitsStatus = { 'off1': true };
        expect(isCircuitCompleted({ id: 'off1', isOfficial: true })).toBe(true);
        expect(isCircuitCompleted({ id: 'off2', isOfficial: true })).toBe(false);
    });

    it('local : lit circuit.isCompleted directement', () => {
        expect(isCircuitCompleted({ id: 'loc1', isCompleted: true })).toBe(true);
        expect(isCircuitCompleted({ id: 'loc2', isCompleted: false })).toBe(false);
        expect(isCircuitCompleted({ id: 'loc3' })).toBe(false);
    });

    it('officiel ignore la propriété isCompleted directe (source = officialCircuitsStatus)', () => {
        state.officialCircuitsStatus = { 'off1': false };
        expect(isCircuitCompleted({ id: 'off1', isOfficial: true, isCompleted: true })).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('notifyCircuitChanged', () => {
    it('dispatch un CustomEvent "circuit:updated" avec detail.points et detail.activeId', () => {
        state.currentCircuit = [poi('p1')];
        state.activeCircuitId = 'c-active';

        const handler = vi.fn();
        window.addEventListener('circuit:updated', handler);
        notifyCircuitChanged();
        window.removeEventListener('circuit:updated', handler);

        expect(handler).toHaveBeenCalledTimes(1);
        const evt = handler.mock.calls[0][0];
        expect(evt.type).toBe('circuit:updated');
        expect(evt.detail.points).toEqual([poi('p1')]);
        expect(evt.detail.activeId).toBe('c-active');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('generateCircuitName', () => {
    it('retourne "Nouveau Circuit" si circuit vide', () => {
        state.currentCircuit = [];
        expect(generateCircuitName()).toBe('Nouveau Circuit');
    });

    it('retourne "Départ de X" si 1 seul POI', () => {
        state.currentCircuit = [poi('p1', 'Houmt Souk')];
        expect(generateCircuitName()).toBe('Départ de Houmt Souk');
    });

    it('retourne "Circuit de A à B" pour 2 POIs distincts (pas de milieu)', () => {
        state.currentCircuit = [poi('p1', 'A'), poi('p2', 'B')];
        expect(generateCircuitName()).toBe('Circuit de A à B');
    });

    it('retourne "Circuit de A à B via M" pour 3+ POIs distincts', () => {
        state.currentCircuit = [poi('p1', 'A'), poi('p2', 'M'), poi('p3', 'B')];
        expect(generateCircuitName()).toBe('Circuit de A à B via M');
    });

    it('retourne "Boucle autour de X" si départ === arrivée et pas de milieu distinct', () => {
        state.currentCircuit = [poi('p1', 'A'), poi('p1', 'A')];
        expect(generateCircuitName()).toBe('Boucle autour de A');
    });

    it('retourne "Boucle autour de A via M" si départ === arrivée avec milieu différent', () => {
        state.currentCircuit = [poi('p1', 'A'), poi('p2', 'M'), poi('p1', 'A')];
        expect(generateCircuitName()).toBe('Boucle autour de A via M');
    });

    it('retombe sur "Boucle autour de A" si milieu = départ', () => {
        // 5 POIs, milieu (index 2) = même que départ
        state.currentCircuit = [poi('p1', 'A'), poi('p2', 'X'), poi('p1', 'A'), poi('p3', 'Y'), poi('p1', 'A')];
        expect(generateCircuitName()).toBe('Boucle autour de A');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('addPoiToCircuit', () => {
    it('refuse l\'ajout en mode lecture seule (activeCircuitId présent) + toast info', () => {
        state.activeCircuitId = 'c1';
        const result = addPoiToCircuit(poi('p1'));
        expect(result).toBe(false);
        expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('lecture seule'),
            'info'
        );
    });

    it('refuse l\'ajout d\'un doublon (même ID que dernier POI du circuit)', () => {
        state.currentCircuit = [poi('p1')];
        const result = addPoiToCircuit(poi('p1'));
        expect(result).toBe(false);
    });

    it('refuse au-delà de MAX_CIRCUIT_POINTS (15) + toast warning', () => {
        // Remplir avec 15 POIs distincts
        state.currentCircuit = Array.from({ length: 15 }, (_, i) => poi(`p${i}`));
        const result = addPoiToCircuit(poi('p99'));
        expect(result).toBe(false);
        expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('Maximum'),
            'warning'
        );
    });

    it('ajoute un POI normal et persiste via saveAppState("currentCircuit", ...)', () => {
        const feature = poi('p1', 'A');
        const result = addPoiToCircuit(feature);
        expect(result).toBe(true);
        expect(state.currentCircuit).toContain(feature);
        expect(saveAppState).toHaveBeenCalledWith('currentCircuit', state.currentCircuit);
    });

    it('dispatch l\'event circuit:updated après ajout', () => {
        const handler = vi.fn();
        window.addEventListener('circuit:updated', handler);
        addPoiToCircuit(poi('p1'));
        window.removeEventListener('circuit:updated', handler);
        expect(handler).toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('convertToDraft', () => {
    it('no-op si aucun activeCircuitId (pas de toast, pas de side effect)', () => {
        state.activeCircuitId = null;
        convertToDraft();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('reset activeCircuitId, ajoute "(modifié)" au titre, toast info', () => {
        state.activeCircuitId = 'c1';
        DOM.circuitTitleText = { textContent: 'Mon Circuit' };

        convertToDraft();

        expect(state.activeCircuitId).toBeNull();
        expect(DOM.circuitTitleText.textContent).toBe('Mon Circuit (modifié)');
        expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('Mode édition'),
            'info'
        );
    });
});
