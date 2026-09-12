import { describe, it, expect, beforeEach, vi } from 'vitest';

// Régression du 12/09/2026 — « commits vides » à la publication d'un officiel.
//
// Ouvrir un officiel dont le tracé n'était pas en local en créait une COPIE dans
// `myCircuits` (loadCircuitById). `saveAndExportCircuit` cherchait d'abord dans
// `myCircuits` : l'édition allait dans la copie, l'objet de `officialCircuits`
// restait ancien. Le diff voyait la copie (« MAJ »), la publication prenait
// l'officiel → GPX et index republiés identiques, +0 −0, sous l'ancien nom.
//
// Ces tests posent l'état tel que l'ancien lazy-load le laissait (officiel +
// copie) et exigent que l'édition atterrisse dans l'officiel, sans doublon.

const { sharedState } = vi.hoisted(() => ({
    sharedState: {
        currentMapId: 'djerba',
        myCircuits: [],
        officialCircuits: [],
        activeCircuitId: null,
        currentCircuit: [],
        isAdmin: false,
    },
}));

vi.mock('../src/state.js', () => {
    const s = sharedState;
    return {
        state: s,
        addMyCircuit: (c) => { s.myCircuits.push(c); },
        updateMyCircuit: (c) => {
            const i = s.myCircuits.findIndex(x => String(x.id) === String(c.id));
            if (i > -1) s.myCircuits[i] = c;
        },
        removeMyCircuit: (id) => { s.myCircuits = s.myCircuits.filter(c => String(c.id) !== String(id)); },
        setOfficialCircuits: (l) => { s.officialCircuits = l; },
        setActiveCircuitId: (id) => { s.activeCircuitId = id; },
        setHasUnexportedChanges: vi.fn(),
        setHiddenCircuitIds: vi.fn(),
        setCircuitCreationMode: vi.fn(),
        setEditingMode: vi.fn(),
        DEFAULT_MAP_ID: 'djerba',
        getActiveMapId: () => s.currentMapId,
    };
});

const saveCircuit = vi.fn(async () => {});
vi.mock('../src/database.js', () => ({
    softDeleteCircuit: vi.fn(),
    getAppState: vi.fn(async () => null),
    saveAppState: vi.fn(),
    saveCircuit: (...a) => saveCircuit(...a),
}));
vi.mock('../src/circuit.js', () => ({
    clearCircuit: vi.fn(),
    setCircuitVisitedState: vi.fn(),
    generateCircuitName: vi.fn(() => 'Nom auto'),
}));
vi.mock('../src/data.js', () => ({
    applyFilters: vi.fn(),
    getPoiId: (f) => f?.properties?.HW_ID,
    passesUserFilters: vi.fn(() => true),
    passesStructuralFilters: vi.fn(() => true),
    buildPlannedPoiSet: () => new Set(),
}));
vi.mock('../src/circuit-deletion-state.js', () => ({
    setOfficialCircuitDeleted: vi.fn(),
    withoutServerDeletedCircuits: (l) => l,
}));
vi.mock('../src/net.js', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('../src/mobile-state.js', () => ({ isMobileView: () => false }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn(async () => true) }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/utils.js', () => ({
    generateHWID: () => 'HW-NOUVEAU',
    getDerivedZone: () => '',
}));
vi.mock('../src/ui-dom.js', () => ({ DOM: {} }));
vi.mock('../src/github-sync.js', () => ({ getStoredToken: vi.fn(() => null) }));
vi.mock('../src/config.js', () => ({ RAW_BASE: 'https://x', GITHUB_PATHS: { circuits: () => 'c' } }));
vi.mock('../src/backup-auto-local.js', () => ({ recordModification: vi.fn() }));
vi.mock('../src/gist-sync.js', () => ({ schedulePush: vi.fn() }));
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } }));
vi.mock('../src/circuit-flags.js', () => ({ commitDirtyFlags: vi.fn() }));
vi.mock('../src/circuit-view.js', () => ({ applyCircuitMode: vi.fn() }));

const poi = (id) => ({ properties: { HW_ID: id } });
const NEW_TRACK = [[33.1, 10.1], [33.2, 10.2], [33.3, 10.3]];

describe("saveAndExportCircuit — édition d'un officiel : un seul objet", () => {
    let saveAndExportCircuit;

    beforeEach(async () => {
        saveCircuit.mockReset();
        saveCircuit.mockImplementation(async () => {});
        sharedState.currentMapId = 'djerba';
        sharedState.myCircuits = [];
        sharedState.officialCircuits = [];
        sharedState.activeCircuitId = 'HW-OFF';
        sharedState.currentCircuit = [poi('P1'), poi('P2')];
        sharedState.isAdmin = false;
        ({ saveAndExportCircuit } = await import('../src/circuit-actions.js'));
    });

    const official = () => ({
        id: 'HW-OFF', name: 'Ancien nom', poiIds: ['P0'], isOfficial: true,
        file: 'djerba/Ancien nom.gpx', realTrack: [[1, 1], [2, 2]],
    });

    it("l'édition atterrit dans l'OFFICIEL même si une copie traîne dans myCircuits", async () => {
        const off = official();
        sharedState.officialCircuits = [off];
        sharedState.myCircuits = [{ ...off }]; // copie laissée par l'ancien lazy-load

        await saveAndExportCircuit(NEW_TRACK);

        const inOfficials = sharedState.officialCircuits.filter(c => c.id === 'HW-OFF');
        expect(inOfficials).toHaveLength(1);
        expect(inOfficials[0].poiIds).toEqual(['P1', 'P2']);   // ← ce que la publication lit
        expect(inOfficials[0].realTrack).toBe(NEW_TRACK);
        expect(sharedState.myCircuits.some(c => c.id === 'HW-OFF')).toBe(false);
    });

    it("n'ajoute pas l'officiel édité à myCircuits", async () => {
        sharedState.officialCircuits = [official()];

        await saveAndExportCircuit(NEW_TRACK);

        expect(sharedState.myCircuits).toHaveLength(0);
        expect(sharedState.officialCircuits[0].name).toBe('Nom auto');
    });

    it("un échec d'écriture laisse l'officiel intact en mémoire", async () => {
        const off = official();
        sharedState.officialCircuits = [off];
        saveCircuit.mockRejectedValueOnce(new Error('IDB down'));

        await saveAndExportCircuit(NEW_TRACK);

        expect(sharedState.officialCircuits[0].poiIds).toEqual(['P0']);
        expect(sharedState.officialCircuits[0].realTrack).toEqual([[1, 1], [2, 2]]);
    });

    it("un circuit neuf n'est activé qu'une fois écrit", async () => {
        sharedState.activeCircuitId = null;

        await saveAndExportCircuit(NEW_TRACK);

        expect(sharedState.activeCircuitId).toBe('HW-NOUVEAU');
        expect(sharedState.myCircuits.map(c => c.id)).toEqual(['HW-NOUVEAU']);
    });
});
