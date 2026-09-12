import { describe, it, expect, beforeEach, vi } from 'vitest';

// Invariant : tout circuit écrit dans le store `savedCircuits` DOIT porter un
// `mapId`. La relecture passe par `index('mapId_index')` (database.js
// getAllCircuitsForMap) et un index IndexedDB IGNORE les enregistrements où la
// clé indexée est absente — un circuit sans `mapId` est écrit, stocké, et
// invisible au rechargement.
//
// Régression réelle (12/09/2026) : éditer un circuit OFFICIEL perdait
// silencieusement la modification au F5. L'objet édité vient de l'index publié
// (public/circuits/<map>.json), dont les entrées ne portent pas de `mapId`,
// contrairement à un circuit créé dans saveAndExportCircuit.
//
// ⚠️ Ces tests ont été rejoués sur le code d'avant le correctif : le cas
// « officiel » échoue (mapId undefined), les deux autres passent. Sans ça un
// test ne prouverait que sa propre implémentation.

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
    const mod = {
        state: sharedState,
        addMyCircuit: vi.fn(),
        updateMyCircuit: vi.fn(),
        setActiveCircuitId: vi.fn(),
        setHasUnexportedChanges: vi.fn(),
        setOfficialCircuits: vi.fn(),
        setHiddenCircuitIds: vi.fn(),
        setCircuitCreationMode: vi.fn(),
        setEditingMode: vi.fn(),
        DEFAULT_MAP_ID: 'djerba',
    };
    mod.getActiveMapId = () => mod.state.currentMapId || 'djerba';
    return mod;
});

const saveCircuit = vi.fn();
vi.mock('../src/database.js', () => ({
    deleteCircuitById: vi.fn(),
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
vi.mock('../src/config.js', () => ({
    RAW_BASE: 'https://x',
    GITHUB_PATHS: { circuits: () => 'c' },
}));
vi.mock('../src/backup-auto-local.js', () => ({ recordModification: vi.fn() }));
vi.mock('../src/gist-sync.js', () => ({ schedulePush: vi.fn() }));
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } }));
vi.mock('../src/circuit-flags.js', () => ({ commitDirtyFlags: vi.fn() }));
vi.mock('../src/circuit-view.js', () => ({ applyCircuitMode: vi.fn() }));
vi.mock('../src/circuit-duplicate-check.js', () => ({ checkCircuitDuplicate: vi.fn(async () => null) }));

const poi = (id) => ({ properties: { HW_ID: id } });

describe('saveAndExportCircuit — invariant mapId', () => {
    let saveAndExportCircuit;

    beforeEach(async () => {
        vi.clearAllMocks();
        saveCircuit.mockReset();
        sharedState.currentMapId = 'djerba';
        sharedState.myCircuits = [];
        sharedState.officialCircuits = [];
        sharedState.activeCircuitId = null;
        sharedState.currentCircuit = [poi('P1'), poi('P2')];
        sharedState.isAdmin = false;
        ({ saveAndExportCircuit } = await import('../src/circuit-actions.js'));
    });

    it("pose un mapId quand on édite un circuit OFFICIEL (sans mapId d'origine)", async () => {
        // Entrée telle qu'elle vient de public/circuits/<map>.json : aucun mapId.
        sharedState.officialCircuits = [{
            id: 'HW-OFFICIEL', name: 'Ancien nom', poiIds: ['P0'], isOfficial: true,
        }];
        sharedState.activeCircuitId = 'HW-OFFICIEL';

        await saveAndExportCircuit([[33.1, 10.1], [33.2, 10.2]]);

        expect(saveCircuit).toHaveBeenCalledTimes(1);
        const saved = saveCircuit.mock.calls[0][0];
        expect(saved.id).toBe('HW-OFFICIEL');          // identité préservée
        expect(saved.mapId).toBe('djerba');            // ← la régression
        expect(saved.poiIds).toEqual(['P1', 'P2']);    // l'édition est bien dedans
    });

    it('conserve le mapId existant d\'un circuit personnel', async () => {
        sharedState.myCircuits = [{
            id: 'HW-PERSO', name: 'Perso', poiIds: ['P0'], mapId: 'hammamet',
        }];
        sharedState.activeCircuitId = 'HW-PERSO';
        sharedState.currentMapId = 'djerba'; // carte active différente

        await saveAndExportCircuit();

        const saved = saveCircuit.mock.calls[0][0];
        // On ne réécrit PAS un mapId déjà posé : un circuit d'une autre carte ne
        // doit pas être happé par la carte courante.
        expect(saved.mapId).toBe('hammamet');
    });

    it('pose le mapId de la carte courante sur un circuit neuf (inchangé)', async () => {
        await saveAndExportCircuit();

        const saved = saveCircuit.mock.calls[0][0];
        expect(saved.id).toBe('HW-NOUVEAU');
        expect(saved.mapId).toBe('djerba');
    });
});
