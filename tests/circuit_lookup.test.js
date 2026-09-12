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
import { findCircuitById, getActiveCircuit, getAllCircuits, mergeOfficialWithLocal } from '../src/circuit-lookup.js';

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

    // Priorité inversée le 12/09/2026 : le panneau (ce lookup) montrait la copie
    // perso quand la publication prenait l'officiel. Même règle partout désormais.
    it("donne la priorité à l'OFFICIEL quand le même id existe dans les deux listes", () => {
        const shadow = { id: 'HW-off', name: 'Copie locale' };
        state.myCircuits = [shadow];
        state.officialCircuits = [OFFICIEL];
        expect(findCircuitById('HW-off')).toBe(OFFICIEL);
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

// Source commune du diff et de la publication (12/09/2026) : le diff parcourait
// les deux listes quand l'écrivain prenait la première correspondance.
describe('getAllCircuits', () => {
    it('officiels puis perso, une seule entrée par id (officiel gagnant)', () => {
        const shadow = { id: 'HW-off', name: 'Copie locale' };
        state.officialCircuits = [OFFICIEL];
        state.myCircuits = [shadow, PERSO];

        const all = getAllCircuits();

        expect(all).toEqual([OFFICIEL, PERSO]);
    });

    it('compare les ids en String', () => {
        state.officialCircuits = [{ id: '42' }];
        state.myCircuits = [{ id: 42 }, { id: 'HW-x' }];
        expect(getAllCircuits().map(c => String(c.id))).toEqual(['42', 'HW-x']);
    });

    it('tolère des listes absentes', () => {
        state.officialCircuits = undefined;
        state.myCircuits = undefined;
        expect(getAllCircuits()).toEqual([]);
    });
});

// Régression 12/09/2026 : la fusion du boot était `{ ...off, ...loc }`, donc le
// local gagnait sur TOUT — y compris sur `distance` et `file`, que seul l'index
// recalcule à la publication. Une copie locale figée par saveCircuit prenait
// alors le pas sur sa propre source.
describe('mergeOfficialWithLocal', () => {
    const OFF = {
        id: 'HW-1', name: 'Nom publié', poiIds: ['a', 'b'],
        file: 'djerba/Nom publié.gpx', distance: '7.7 km', hasRealTrack: true
    };

    it("sans copie locale, renvoie l'entrée d'index telle quelle", () => {
        expect(mergeOfficialWithLocal(OFF, null)).toBe(OFF);
        expect(mergeOfficialWithLocal(OFF, undefined)).toBe(OFF);
    });

    it('le local prime sur nom, étapes et tracé (édition non publiée visible)', () => {
        const loc = { id: 'HW-1', name: 'Nom local', poiIds: ['a', 'b', 'c'], realTrack: [[1, 1], [2, 2]] };

        const m = mergeOfficialWithLocal(OFF, loc);

        expect(m.name).toBe('Nom local');
        expect(m.poiIds).toEqual(['a', 'b', 'c']);
        expect(m.realTrack).toHaveLength(2);
        expect(m.isOfficial).toBe(true);
    });

    it("l'INDEX prime sur `distance` — une copie locale périmée ne gagne plus", () => {
        const loc = { id: 'HW-1', distance: '5.7 km' };

        expect(mergeOfficialWithLocal(OFF, loc).distance).toBe('7.7 km');
    });

    it("l'INDEX prime sur `file` — sinon le GPX est cherché sous l'ancien nom (404)", () => {
        const loc = { id: 'HW-1', file: 'djerba/Ancien nom.gpx' };

        expect(mergeOfficialWithLocal(OFF, loc).file).toBe('djerba/Nom publié.gpx');
    });

    it("repli sur le local si l'index ne porte pas le champ", () => {
        const off = { id: 'HW-1', name: 'Nom publié' };
        const loc = { id: 'HW-1', file: 'djerba/Secours.gpx', distance: '3.3 km' };

        const m = mergeOfficialWithLocal(off, loc);

        expect(m.file).toBe('djerba/Secours.gpx');
        expect(m.distance).toBe('3.3 km');
    });
});
