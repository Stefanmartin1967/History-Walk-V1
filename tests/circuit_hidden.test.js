import { describe, it, expect, beforeEach, vi } from 'vitest';

// setCircuitHidden (Mon Espace V2 — Phase 1c) mute la blacklist hiddenCircuitIds,
// persiste (saveAppState), programme la sync Gist (schedulePush), notifie la
// liste (eventBus) et réapplique les filtres. Même surface de mocks que
// circuit_actions_deletion.test.js + gist-sync + events.

vi.mock('../src/state.js', () => ({
    state: {
        isAdmin: false,
        activeCircuitId: null,
        currentMapId: 'djerba',
        myCircuits: [],
        officialCircuits: [],
        loadedFeatures: [],
        hiddenCircuitIds: []
    },
    addMyCircuit: vi.fn(),
    updateMyCircuit: vi.fn(),
    setActiveCircuitId: vi.fn(),
    setHasUnexportedChanges: vi.fn(),
    setUserData: vi.fn(),
    setOfficialCircuits: vi.fn(),
    setHiddenCircuitIds: vi.fn((ids) => { state.hiddenCircuitIds = Array.isArray(ids) ? ids.map(String) : []; })
}));

vi.mock('../src/database.js', async () => {
    const { createDatabaseMock } = await import('./helpers/mocks.js');
    return createDatabaseMock();
});
vi.mock('../src/backup-auto-local.js', async () => {
    const { createBackupAutoLocalMock } = await import('./helpers/mocks.js');
    return createBackupAutoLocalMock();
});
vi.mock('../src/circuit.js', () => ({
    clearCircuit: vi.fn(() => Promise.resolve()),
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
vi.mock('../src/utils.js', () => ({ generateHWID: vi.fn() }));
vi.mock('../src/gpx.js', () => ({ generateAndDownloadGPX: vi.fn() }));
vi.mock('../src/ui.js', () => ({ DOM: {} }));
vi.mock('../src/gist-sync.js', () => ({ schedulePush: vi.fn(), pushToGist: vi.fn() }));
vi.mock('../src/events.js', () => ({ eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }));

import { state, setHiddenCircuitIds } from '../src/state.js';
import { saveAppState } from '../src/database.js';
import { schedulePush } from '../src/gist-sync.js';
import { eventBus } from '../src/events.js';
import { applyFilters } from '../src/data.js';
import { setCircuitHidden } from '../src/circuit-actions.js';

describe('setCircuitHidden (blacklist Mon Espace V2)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.hiddenCircuitIds = [];
        setHiddenCircuitIds.mockImplementation((ids) => {
            state.hiddenCircuitIds = Array.isArray(ids) ? ids.map(String) : [];
        });
    });

    it('cacher : ajoute l\'id + persiste + notifie + réapplique les filtres', async () => {
        const next = await setCircuitHidden('c1', true);
        expect(next).toEqual(['c1']);
        expect(state.hiddenCircuitIds).toEqual(['c1']);
        expect(saveAppState).toHaveBeenCalledWith('hiddenCircuitIds', ['c1']);
        expect(schedulePush).toHaveBeenCalled();
        expect(eventBus.emit).toHaveBeenCalledWith('circuit:list-updated');
        expect(applyFilters).toHaveBeenCalled();
    });

    it('réafficher : retire l\'id de la blacklist', async () => {
        state.hiddenCircuitIds = ['c1', 'c2'];
        const next = await setCircuitHidden('c1', false);
        expect(next).toEqual(['c2']);
        expect(state.hiddenCircuitIds).toEqual(['c2']);
        expect(saveAppState).toHaveBeenCalledWith('hiddenCircuitIds', ['c2']);
    });

    it('cacher est idempotent (pas de doublon)', async () => {
        state.hiddenCircuitIds = ['c1'];
        const next = await setCircuitHidden('c1', true);
        expect(next).toEqual(['c1']);
    });

    it('réafficher un circuit non caché = no-op sûr', async () => {
        state.hiddenCircuitIds = ['c2'];
        const next = await setCircuitHidden('c1', false);
        expect(next).toEqual(['c2']);
    });

    it('normalise l\'id en chaîne (number → string)', async () => {
        const next = await setCircuitHidden(42, true);
        expect(next).toEqual(['42']);
    });
});
