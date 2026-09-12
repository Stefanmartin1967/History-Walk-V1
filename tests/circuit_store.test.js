// Contrat de `circuit-store.js` — le point d'écriture unique d'un circuit.
//
// Règles protégées (audit du cycle circuits, 12/09/2026) :
//  - un id n'existe qu'UNE fois en mémoire (officiel s'il l'est, sinon perso) ;
//  - tout circuit écrit porte un `mapId` (sinon invisible au rechargement) ;
//  - l'écriture passe AVANT la mémoire : un échec ne laisse pas l'état en avance.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { state, saveCircuit } = vi.hoisted(() => ({
    state: { currentMapId: 'djerba', myCircuits: [], officialCircuits: [] },
    saveCircuit: vi.fn(async () => {}),
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
vi.mock('../src/database.js', () => ({ saveCircuit: (...a) => saveCircuit(...a) }));

import { persistCircuit } from '../src/circuit-store.js';

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
