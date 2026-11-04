import { describe, it, expect } from 'vitest';
import { webSearchTerms } from '../src/web-search.js';

describe('webSearchTerms — bouton Google de la fiche', () => {
    it('destination ordinaire : nom + destination, le quartier est ignoré', () => {
        expect(webSearchTerms({ name: 'Mosquée Sidi Yati', zone: 'Midoun', destinationName: 'Djerba', territory: false }))
            .toBe('Mosquée Sidi Yati Djerba');
    });

    it('destination à territoire : nom + commune, au lieu du nom de la destination', () => {
        expect(webSearchTerms({ name: 'Chapelle Saint-Roch', zone: 'Aiseau-Presles', destinationName: 'Wallonie', territory: true }))
            .toBe('Chapelle Saint-Roch Aiseau-Presles');
    });

    it.each(['Hors zone', 'A définir', '', '  ', undefined])(
        'territoire sans quartier utilisable (%j) : repli sur la destination',
        (zone) => {
            expect(webSearchTerms({ name: 'Chapelle Saint-Roch', zone, destinationName: 'Wallonie', territory: true }))
                .toBe('Chapelle Saint-Roch Wallonie');
        },
    );

    it('contexte inconnu : le nom seul, sans mot parasite', () => {
        expect(webSearchTerms({ name: 'Mosquée Sidi Yati', zone: '', destinationName: '', territory: false }))
            .toBe('Mosquée Sidi Yati');
    });
});
