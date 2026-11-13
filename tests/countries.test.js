import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../src/state.js';
import { countryName, countryFlag, destinationCurrency, getActiveDestinationCurrency } from '../src/countries.js';

describe('countries — pays, drapeau, devise d\'une destination', () => {
    it('nomme le pays en français, sinon affiche le code', () => {
        expect(countryName('be')).toBe('Belgique');
        expect(countryName('TN')).toBe('Tunisie');
        expect(countryName('bg')).toBe('BG');
        expect(countryName('')).toBe('');
    });

    it('calcule le drapeau depuis le code, pour tout pays', () => {
        expect(countryFlag('be')).toBe('🇧🇪');
        expect(countryFlag('tn')).toBe('🇹🇳');
        expect(countryFlag('bg')).toBe('🇧🇬');
        expect(countryFlag('')).toBe('');
        expect(countryFlag('bel')).toBe('');
    });

    it('prend la devise de la destination, sinon celle du pays', () => {
        expect(destinationCurrency({ country: 'be', currency: '' })).toBe('EUR');
        expect(destinationCurrency({ country: 'tn' })).toBe('TND');
        expect(destinationCurrency({ country: 'be', currency: 'XYZ' })).toBe('XYZ');
        expect(destinationCurrency({ country: 'bg', currency: '' })).toBe('');
        expect(destinationCurrency(undefined)).toBe('');
    });

    describe('destination active', () => {
        let saved;
        beforeEach(() => {
            saved = { d: state.destinations, id: state.currentMapId };
            return () => { state.destinations = saved.d; state.currentMapId = saved.id; };
        });

        it('Wallonie sans devise renseignée → EUR (et non TND)', () => {
            state.destinations = { maps: {
                djerba: { country: 'tn', currency: 'TND' },
                charleroi: { country: 'be', currency: '' },
            } };
            state.currentMapId = 'charleroi';
            expect(getActiveDestinationCurrency()).toBe('EUR');
            state.currentMapId = 'djerba';
            expect(getActiveDestinationCurrency()).toBe('TND');
        });
    });
});
