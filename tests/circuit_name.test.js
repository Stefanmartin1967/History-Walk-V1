// Noms de circuit uniques (src/circuit-name.js, 12/11/2026).
// Un nom = un fichier GPX publié : deux circuits au même nom s'écrasaient
// (boucles de Rym Beach). Cas tirés des vrais circuits.
import { describe, it, expect } from 'vitest';
import {
    normalizeCircuitName, takenCircuitNames, findCircuitWithSameName, uniqueAutoCircuitName,
} from '../src/circuit-name.js';

const TAGUERMESS = ['Rym Beach', 'Phare de Taguermess', 'Mosquée Ibn Abbas', 'Mosquée Elmaghfira',
    'Mosquée Ténafsa', 'Mausolée Cheikh Sidi Slimen', 'Rym Beach'];
const LELLA = ['Rym Beach', 'Mausolée Lella Hadhria', 'Rym Beach'];

describe('normalizeCircuitName', () => {
    it('ignore la casse, les accents et les espaces en trop', () => {
        expect(normalizeCircuitName('  Boucle  autour de Rym BEACH ')).toBe('boucle autour de rym beach');
        expect(normalizeCircuitName('Mosquée Ténafsa')).toBe(normalizeCircuitName('mosquee tenafsa'));
    });
});

describe('takenCircuitNames / findCircuitWithSameName', () => {
    const circuits = [
        { id: 'a', name: 'Boucle autour de Rym Beach' },
        { id: 'b', name: 'Circuit de X à Y', isDeleted: true },
    ];
    it('exclut le circuit en cours et ceux de la corbeille', () => {
        expect(takenCircuitNames(circuits, 'a').size).toBe(0);
        expect(takenCircuitNames(circuits, null).has('boucle autour de rym beach')).toBe(true);
        expect(takenCircuitNames(circuits, null).has('circuit de x a y')).toBe(false);
    });
    it('trouve un homonyme, casse et accents ignorés', () => {
        expect(findCircuitWithSameName('boucle autour de RYM beach', circuits, 'z')?.id).toBe('a');
        expect(findCircuitWithSameName('Boucle autour de Rym Beach', circuits, 'a')).toBeNull();
        expect(findCircuitWithSameName('Circuit de X à Y', circuits, 'z')).toBeNull(); // à la corbeille
    });
});

describe('uniqueAutoCircuitName', () => {
    it('nom libre : inchangé (pas de « via » inutile)', () => {
        expect(uniqueAutoCircuitName('Boucle autour de Rym Beach', LELLA, new Set())).toBe('Boucle autour de Rym Beach');
    });

    it('2e boucle de Rym Beach : « via » le lieu du milieu', () => {
        const taken = new Set(['boucle autour de rym beach']);
        expect(uniqueAutoCircuitName('Boucle autour de Rym Beach', LELLA, taken))
            .toBe('Boucle autour de Rym Beach via Mausolée Lella Hadhria');
        // 7 lieux : 5 au milieu, le 3e d'entre eux.
        expect(uniqueAutoCircuitName('Boucle autour de Rym Beach', TAGUERMESS, taken))
            .toBe('Boucle autour de Rym Beach via Mosquée Elmaghfira');
    });

    it('« via » déjà pris : lieu voisin du milieu', () => {
        const taken = new Set(['boucle autour de rym beach', 'boucle autour de rym beach via mosquee elmaghfira']);
        expect(uniqueAutoCircuitName('Boucle autour de Rym Beach', TAGUERMESS, taken))
            .toBe('Boucle autour de Rym Beach via Mosquée Ténafsa');
    });

    it('circuit linéaire : « via » aussi', () => {
        const taken = new Set(['circuit de a a b']);
        expect(uniqueAutoCircuitName('Circuit de A à B', ['A', 'M', 'B'], taken)).toBe('Circuit de A à B via M');
    });

    it('aucun lieu du milieu utilisable : « (2) », puis « (3) »', () => {
        expect(uniqueAutoCircuitName('Circuit de A à B', ['A', 'B'], new Set(['circuit de a a b']))).toBe('Circuit de A à B (2)');
        expect(uniqueAutoCircuitName('Circuit de A à B', ['A', 'B'], new Set(['circuit de a a b', 'circuit de a a b (2)']))).toBe('Circuit de A à B (3)');
    });

    it('ne prend jamais une extrémité ni un lieu répété comme « via »', () => {
        // Le milieu est le départ (passage répété) : on passe au lieu suivant.
        const taken = new Set(['boucle autour de a']);
        expect(uniqueAutoCircuitName('Boucle autour de A', ['A', 'X', 'A', 'Y', 'A'], taken)).toBe('Boucle autour de A via Y');
    });
});
