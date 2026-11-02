import { describe, it, expect } from 'vitest';
import { state, getDestinationLabel } from '../src/state.js';

// Libellé d'une destination dans l'interface (titre, sélecteur, Centre de
// Contrôle) : son nom, pas son identifiant. La destination `charleroi` est
// renommée « Wallonie » (02/11/2026) ; le sélecteur affichait encore
// « Charleroi » (identifiant avec une majuscule).

describe('getDestinationLabel', () => {
    it('le nom de destinations.json, sinon l\'identifiant avec une majuscule', () => {
        state.destinations = { maps: { charleroi: { name: 'Wallonie' }, sozopol: {} } };
        expect(getDestinationLabel('charleroi')).toBe('Wallonie');
        expect(getDestinationLabel('sozopol')).toBe('Sozopol');
        expect(getDestinationLabel('')).toBe('');
    });
});
