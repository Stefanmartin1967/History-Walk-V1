// Contrat de `circuit-lookup.js` — le module feuille qui résout un circuit par
// id dans les DEUX listes (perso + officiels).
//
// Pourquoi ce fichier existe : deux correctifs du 12/09/2026 (distance/titre du
// bandeau dans circuit.js, export GPX dans ui-circuit-editor.js) reposent sur ce
// helper. Le piège qu'il neutralise est récurrent — un site d'appel qui ne
// cherche que dans `state.myCircuits` ne trouvera JAMAIS un circuit officiel,
// puisque app-startup le retire de cette liste au boot pour le placer dans
// `state.officialCircuits`.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/state.js', () => {
    const state = { myCircuits: [], officialCircuits: [], activeCircuitId: null };
    return { state };
});

import { state } from '../src/state.js';
import { findCircuitById, getActiveCircuit } from '../src/circuit-lookup.js';

const PERSO = { id: 'HW-perso', name: 'Mon circuit' };
const OFFICIEL = { id: 'HW-off', name: 'Circuit officiel', realTrack: [[1, 1], [2, 2]] };

beforeEach(() => {
    state.myCircuits = [];
    state.officialCircuits = [];
    state.activeCircuitId = null;
});

describe('findCircuitById', () => {
    it('trouve un circuit perso', () => {
        state.myCircuits = [PERSO];
        expect(findCircuitById('HW-perso')).toBe(PERSO);
    });

    it('trouve un circuit OFFICIEL — le cas que les sites d\'appel oubliaient', () => {
        state.officialCircuits = [OFFICIEL];
        expect(findCircuitById('HW-off')).toBe(OFFICIEL);
    });

    it('donne la priorité au perso quand le même id existe dans les deux listes', () => {
        const shadow = { id: 'HW-off', name: 'Copie locale' };
        state.myCircuits = [shadow];
        state.officialCircuits = [OFFICIEL];
        expect(findCircuitById('HW-off')).toBe(shadow);
    });

    it('compare en String — un id numérique retrouve un id chaîne', () => {
        state.officialCircuits = [{ id: '1771316521571', name: 'Ancien format' }];
        expect(findCircuitById(1771316521571)?.name).toBe('Ancien format');
    });

    it('renvoie null pour un id inconnu, null ou undefined', () => {
        state.myCircuits = [PERSO];
        expect(findCircuitById('HW-absent')).toBeNull();
        expect(findCircuitById(null)).toBeNull();
        expect(findCircuitById(undefined)).toBeNull();
    });

    it('tolère des listes absentes de l\'état', () => {
        state.myCircuits = undefined;
        state.officialCircuits = undefined;
        expect(findCircuitById('HW-off')).toBeNull();
    });
});

describe('getActiveCircuit', () => {
    it('résout un officiel actif — sans quoi distance, titre et export retombent en vol d\'oiseau', () => {
        state.officialCircuits = [OFFICIEL];
        state.activeCircuitId = 'HW-off';
        const actif = getActiveCircuit();
        expect(actif).toBe(OFFICIEL);
        expect(actif.realTrack).toHaveLength(2);
    });

    it('renvoie null si aucun circuit n\'est actif', () => {
        state.officialCircuits = [OFFICIEL];
        state.activeCircuitId = null;
        expect(getActiveCircuit()).toBeNull();
    });
});
