// Contrat de `circuit-store.js` — le point d'écriture unique d'un circuit.
//
// Règles protégées (audit du cycle circuits, 12/09/2026) :
//  - un id n'existe qu'UNE fois en mémoire (officiel s'il l'est, sinon perso) ;
//  - tout circuit écrit porte un `mapId` (sinon invisible au rechargement) ;
//  - l'écriture passe AVANT la mémoire : un échec ne laisse pas l'état en avance.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { state, saveCircuit, deleteCircuitById, getAppState, saveAppState } = vi.hoisted(() => ({
    state: { currentMapId: 'djerba', myCircuits: [], officialCircuits: [] },
    saveCircuit: vi.fn(async () => {}),
    deleteCircuitById: vi.fn(async () => {}),
    getAppState: vi.fn(async () => null),
    saveAppState: vi.fn(async () => {}),
}));

vi.mock('../src/state.js', () => ({
    state,
    setOfficialCircuits: (l) => { state.officialCircuits = l; },
    addMyCircuit: (c) => { state.myCircuits.push(c); },
    updateMyCircuit: (c) => {
        const i = state.myCircuits.findIndex(x => String(x.id) === String(c.id));
        if (i > -1) state.myCircuits[i] = c;
    },
    removeMyCircuit: (id) => { state.myCircuits = state.myCircuits.filter(c => String(c.id) !== String(id)); },
}));
vi.mock('../src/database.js', () => ({
    saveCircuit: (...a) => saveCircuit(...a),
    deleteCircuitById: (...a) => deleteCircuitById(...a),
    getAppState: (...a) => getAppState(...a),
    saveAppState: (...a) => saveAppState(...a),
}));

import { persistCircuit, forgetDeletedCircuit, revertCircuitToPublished } from '../src/circuit-store.js';

beforeEach(() => {
    saveCircuit.mockReset();
    saveCircuit.mockImplementation(async () => {});
    state.currentMapId = 'djerba';
    state.myCircuits = [];
    state.officialCircuits = [];
});

describe('persistCircuit', () => {
    it('remplace un OFFICIEL dans sa liste, sans en créer de copie perso', async () => {
        state.officialCircuits = [{ id: 'HW-off', name: 'Ancien', poiIds: ['a'], isOfficial: true }];

        await persistCircuit({ id: 'HW-off', name: 'Nouveau', poiIds: ['a', 'b'] });

        expect(state.officialCircuits).toHaveLength(1);
        expect(state.officialCircuits[0].name).toBe('Nouveau');
        expect(state.officialCircuits[0].isOfficial).toBe(true);
        expect(state.myCircuits).toHaveLength(0);
    });

    it("retire une copie résiduelle du même id dans myCircuits", async () => {
        state.officialCircuits = [{ id: 'HW-off', name: 'Ancien' }];
        state.myCircuits = [{ id: 'HW-off', name: 'Copie', isOfficial: true }, { id: 'HW-perso' }];

        await persistCircuit({ id: 'HW-off', name: 'Nouveau' });

        expect(state.myCircuits.map(c => c.id)).toEqual(['HW-perso']);
    });

    it('met à jour un circuit perso existant, ajoute un circuit neuf', async () => {
        state.myCircuits = [{ id: 'HW-p1', name: 'Avant', mapId: 'djerba' }];

        await persistCircuit({ id: 'HW-p1', name: 'Après', mapId: 'djerba' });
        await persistCircuit({ id: 'HW-p2', name: 'Neuf' });

        expect(state.myCircuits.map(c => c.name)).toEqual(['Après', 'Neuf']);
        expect(state.officialCircuits).toHaveLength(0);
    });

    it('pose le mapId manquant, ne réécrit pas un mapId existant', async () => {
        await persistCircuit({ id: 'HW-a' });
        await persistCircuit({ id: 'HW-b', mapId: 'hammamet' });

        expect(saveCircuit.mock.calls[0][0].mapId).toBe('djerba');
        expect(saveCircuit.mock.calls[1][0].mapId).toBe('hammamet');
    });

    it("n'altère pas la mémoire si l'écriture IndexedDB échoue", async () => {
        const original = { id: 'HW-off', name: 'Ancien' };
        state.officialCircuits = [original];
        saveCircuit.mockRejectedValueOnce(new Error('IDB down'));

        await expect(persistCircuit({ id: 'HW-off', name: 'Nouveau' })).rejects.toThrow('IDB down');

        expect(state.officialCircuits[0]).toBe(original);
    });

    it('refuse un circuit sans id', async () => {
        await expect(persistCircuit({ name: 'Sans id' })).rejects.toThrow();
        expect(saveCircuit).not.toHaveBeenCalled();
    });
});

// Régression du 13/09/2026 : supprimer du serveur un officiel déjà édité sur ce
// poste laissait sa copie locale. Au F5, orpheline, elle devenait « NOUVEAU » au
// diff du CC (masquée de la liste) et aurait été republiée.
describe('forgetDeletedCircuit', () => {
    beforeEach(() => {
        deleteCircuitById.mockClear();
        getAppState.mockReset();
        getAppState.mockImplementation(async () => null);
        saveAppState.mockClear();
    });

    it('efface la copie locale en base (IndexedDB)', async () => {
        await forgetDeletedCircuit('HW-off');

        expect(deleteCircuitById).toHaveBeenCalledWith('HW-off');
    });

    it('retire le circuit de myCircuits s\'il y figure, sans toucher aux autres', async () => {
        state.myCircuits = [{ id: 'HW-off', isOfficial: true }, { id: 'HW-perso' }];

        await forgetDeletedCircuit('HW-off');

        expect(state.myCircuits.map(c => c.id)).toEqual(['HW-perso']);
    });

    it('vide le brouillon qui vise ce circuit', async () => {
        getAppState.mockImplementation(async () => ({ circuitId: 'HW-off', poiIds: ['a'] }));

        await forgetDeletedCircuit('HW-off');

        expect(saveAppState).toHaveBeenCalledWith('circuitDraft_djerba', null);
    });

    it("garde le brouillon d'un AUTRE circuit ou d'une création", async () => {
        getAppState.mockImplementation(async () => ({ circuitId: 'HW-autre', poiIds: ['a'] }));
        await forgetDeletedCircuit('HW-off');
        getAppState.mockImplementation(async () => ({ circuitId: null, poiIds: ['a'] }));
        await forgetDeletedCircuit('HW-off');

        expect(saveAppState).not.toHaveBeenCalled();
    });

    it('compare les ids en String', async () => {
        getAppState.mockImplementation(async () => ({ circuitId: '1771578509993', poiIds: ['a'] }));

        await forgetDeletedCircuit(1771578509993);

        expect(deleteCircuitById).toHaveBeenCalledWith('1771578509993');
        expect(saveAppState).toHaveBeenCalledWith('circuitDraft_djerba', null);
    });
});

// « Annuler » une modification non publiée d'un officiel (13/09/2026) : avant, le
// bouton ne défaisait qu'une SUPPRESSION ; l'édition locale restait.
describe('revertCircuitToPublished', () => {
    const PUBLISHED = { id: 'HW-off', name: 'Nom publié', poiIds: ['a', 'b'], file: 'djerba/Nom publié.gpx', distance: '4 km' };

    beforeEach(() => {
        deleteCircuitById.mockClear();
        getAppState.mockReset();
        getAppState.mockImplementation(async () => null);
        saveAppState.mockClear();
    });

    it("remplace l'officiel édité par l'entrée publiée (sans tracé local)", async () => {
        state.officialCircuits = [{ id: 'HW-off', name: 'Nom local', poiIds: ['a', 'b', 'c'], realTrack: [[1, 1], [2, 2]], isOfficial: true }];

        await revertCircuitToPublished(PUBLISHED);

        expect(state.officialCircuits).toHaveLength(1);
        expect(state.officialCircuits[0].name).toBe('Nom publié');
        expect(state.officialCircuits[0].poiIds).toEqual(['a', 'b']);
        expect(state.officialCircuits[0].realTrack).toBeUndefined(); // rechargé depuis le GPX à l'ouverture
        expect(state.officialCircuits[0].isOfficial).toBe(true);
    });

    it('efface la copie locale en base et vide le brouillon qui vise ce circuit', async () => {
        state.officialCircuits = [{ id: 'HW-off', name: 'Nom local', isOfficial: true }];
        getAppState.mockImplementation(async () => ({ circuitId: 'HW-off', poiIds: ['a'] }));

        await revertCircuitToPublished(PUBLISHED);

        expect(deleteCircuitById).toHaveBeenCalledWith('HW-off');
        expect(saveAppState).toHaveBeenCalledWith('circuitDraft_djerba', null);
    });

    it("rajoute l'officiel s'il n'est plus en mémoire", async () => {
        state.officialCircuits = [{ id: 'HW-autre', name: 'Autre' }];

        await revertCircuitToPublished(PUBLISHED);

        expect(state.officialCircuits.map(c => c.id)).toEqual(['HW-autre', 'HW-off']);
    });

    it('refuse une entrée sans id', async () => {
        await expect(revertCircuitToPublished({ name: 'Sans id' })).rejects.toThrow();
        expect(deleteCircuitById).not.toHaveBeenCalled();
    });
});
