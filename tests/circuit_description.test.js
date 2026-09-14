// Description d'un circuit : texte de l'auteur, signature seulement dans le GPX.
//
// Mesuré le 14/09/2026 : les 17 circuits publiés portaient la même constante
// dans l'index ; les vrais textes (3) ne vivaient que dans le <trk><desc> du GPX,
// mêlés à des signatures anciennes et nouvelles.

import { describe, it, expect } from 'vitest';
import { stripCircuitSignature, withCircuitSignature, CIRCUIT_SIGNATURE } from '../src/circuit-description.js';

describe('stripCircuitSignature', () => {
    it('retire la signature actuelle collée en fin de texte', () => {
        expect(stripCircuitSignature('Balade entre deux mosquées.\n\nCircuit généré par Heripia — heripia.com'))
            .toBe('Balade entre deux mosquées.');
    });

    it('retire les anciennes signatures', () => {
        expect(stripCircuitSignature('Les courageux peuvent aller à pied (Créé par Heripia)')).toBe('Les courageux peuvent aller à pied');
        expect(stripCircuitSignature('Une jolie balade.\n\n(Créé par History Walk)')).toBe('Une jolie balade.');
        expect(stripCircuitSignature('Circuit généré par History Walk.')).toBe('');
    });

    it("rend '' pour une description qui n'était qu'une signature, ou absente", () => {
        expect(stripCircuitSignature(CIRCUIT_SIGNATURE)).toBe('');
        expect(stripCircuitSignature('(Créé par Heripia)')).toBe('');
        expect(stripCircuitSignature(undefined)).toBe('');
        expect(stripCircuitSignature(null)).toBe('');
    });

    it("ne touche pas au texte de l'auteur (sauts de ligne internes conservés)", () => {
        const texte = 'Premier paragraphe.\n\nSecond, avec « Heripia » cité.';
        expect(stripCircuitSignature(texte)).toBe(texte);
    });
});

describe('withCircuitSignature', () => {
    it('ajoute la signature après le texte', () => {
        expect(withCircuitSignature('Belle balade.')).toBe(`Belle balade.\n\n${CIRCUIT_SIGNATURE}`);
    });

    it('ne double pas une signature déjà présente', () => {
        expect(withCircuitSignature(`Belle balade.\n\n${CIRCUIT_SIGNATURE}`)).toBe(`Belle balade.\n\n${CIRCUIT_SIGNATURE}`);
    });

    it('signature seule sans texte', () => {
        expect(withCircuitSignature('')).toBe(CIRCUIT_SIGNATURE);
        expect(withCircuitSignature(undefined)).toBe(CIRCUIT_SIGNATURE);
    });
});
