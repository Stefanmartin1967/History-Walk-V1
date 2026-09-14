// Rapatriement de la copie globale `appState.userData` vers `poiUserData`.
//
// Régression du 14/09/2026 : deux lieux effacés du store revenaient à chaque boot
// depuis cette copie globale, fusionnée par data.js. Le store devient le seul
// domicile ; la copie est rapatriée par destination puis allégée.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
    appState: {},
    store: {},
    getAppState: vi.fn(),
    saveAppState: vi.fn(),
    deleteAppState: vi.fn(),
    getAllPoiDataForMap: vi.fn(),
    batchSavePoiData: vi.fn(),
}));

vi.mock('../src/database.js', () => ({
    getAppState: (...a) => db.getAppState(...a),
    saveAppState: (...a) => db.saveAppState(...a),
    deleteAppState: (...a) => db.deleteAppState(...a),
    getAllPoiDataForMap: (...a) => db.getAllPoiDataForMap(...a),
    batchSavePoiData: (...a) => db.batchSavePoiData(...a),
}));

import { migrateLegacyUserData } from '../src/legacy-user-data.js';

beforeEach(() => {
    vi.clearAllMocks();
    db.appState = {};
    db.store = {};
    db.getAppState.mockImplementation(async (k) => db.appState[k]);
    db.saveAppState.mockImplementation(async (k, v) => { db.appState[k] = v; });
    db.deleteAppState.mockImplementation(async (k) => { delete db.appState[k]; });
    db.getAllPoiDataForMap.mockImplementation(async () => db.store);
    db.batchSavePoiData.mockImplementation(async () => {});
});

describe('migrateLegacyUserData', () => {
    it('ne fait rien sans copie globale', async () => {
        const r = await migrateLegacyUserData('djerba', ['A']);

        expect(r).toEqual({ rapatries: 0, retires: 0, restants: 0 });
        expect(db.batchSavePoiData).not.toHaveBeenCalled();
        expect(db.deleteAppState).not.toHaveBeenCalled();
    });

    it("rapatrie les clés ABSENTES du store, sans jamais écraser une clé présente", async () => {
        db.store = { A: { notes: 'note du store', vu: true } };
        db.appState.userData = { A: { notes: 'ancienne note', incontournable: true } };

        await migrateLegacyUserData('djerba', ['A']);

        expect(db.batchSavePoiData).toHaveBeenCalledWith('djerba', [{ poiId: 'A', data: { incontournable: true } }]);
    });

    it("n'écrit rien pour une entrée identique au store, mais la retire de la copie", async () => {
        db.store = { A: { vu: true } };
        db.appState.userData = { A: { vu: true } };

        const r = await migrateLegacyUserData('djerba', ['A']);

        expect(db.batchSavePoiData).not.toHaveBeenCalled();
        expect(r).toEqual({ rapatries: 0, retires: 1, restants: 0 });
        expect(db.deleteAppState).toHaveBeenCalledWith('userData');
    });

    it("CONSERVE les entrées d'autres destinations ou de lieux disparus (option A), sans les rapatrier", async () => {
        db.appState.userData = {
            A: { notes: 'Djerba' },
            H: { notes: 'Hammamet' },
            DISPARU: { accessPoint: [10, 33], accessPointStatus: 'osm' },
        };

        const r = await migrateLegacyUserData('djerba', ['A']);

        expect(db.batchSavePoiData).toHaveBeenCalledWith('djerba', [{ poiId: 'A', data: { notes: 'Djerba' } }]);
        expect(db.appState.userData).toEqual({
            H: { notes: 'Hammamet' },
            DISPARU: { accessPoint: [10, 33], accessPointStatus: 'osm' },
        });
        expect(r).toEqual({ rapatries: 1, retires: 1, restants: 2 });
        expect(db.deleteAppState).not.toHaveBeenCalled();
    });

    it('retire les entrées VIDES, quelle que soit la destination', async () => {
        db.appState.userData = { X: {}, Y: {}, H: { vu: true } };

        const r = await migrateLegacyUserData('djerba', []);

        expect(db.appState.userData).toEqual({ H: { vu: true } });
        expect(r.retires).toBe(2);
    });

    it("supprime la copie quand il ne reste plus rien", async () => {
        db.appState.userData = { A: { vu: true }, X: {} };

        await migrateLegacyUserData('djerba', new Set(['A']));

        expect(db.deleteAppState).toHaveBeenCalledWith('userData');
        expect(db.appState.userData).toBeUndefined();
    });

    it('normalise les anciennes clés (Description, Description_courte) au rapatriement', async () => {
        db.appState.userData = { A: { Description: 'Texte', Description_courte: 'Court', HW_ID: 'A' } };

        await migrateLegacyUserData('djerba', ['A']);

        expect(db.batchSavePoiData).toHaveBeenCalledWith('djerba', [{ poiId: 'A', data: { description: 'Texte', info_gpx: 'Court' } }]);
    });

    it("écrit le store AVANT de réécrire la copie (un échec laisse la copie intacte)", async () => {
        db.appState.userData = { A: { notes: 'x' } };
        db.batchSavePoiData.mockRejectedValueOnce(new Error('IDB down'));

        await expect(migrateLegacyUserData('djerba', ['A'])).rejects.toThrow('IDB down');

        expect(db.appState.userData).toEqual({ A: { notes: 'x' } });
        expect(db.deleteAppState).not.toHaveBeenCalled();
    });
});
