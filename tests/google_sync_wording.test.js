// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { changedSentence } from '../src/google-sync-ui.js';

// Texte du toast « modifié sur deux appareils » (20/11/2026) : le lieu n'est
// plus le sujet (« « Restaurant chez Moktar » a été modifiée » sonnait faux),
// c'est le champ, avec le bon accord.
describe('changedSentence', () => {
    it('accorde avec le champ', () => {
        expect(changedSentence('notes', 'Restaurant chez Moktar')).toBe('La note de « Restaurant chez Moktar » a été modifiée sur deux appareils.');
        expect(changedSentence('Nom du site FR', 'Borj Ajim')).toBe('Le nom de « Borj Ajim » a été modifié sur deux appareils.');
        expect(changedSentence('description', 'Fadhloun')).toBe('La description de « Fadhloun » a été modifiée sur deux appareils.');
    });
    it('champ inconnu : « Le champ … » au masculin', () => {
        expect(changedSentence('Horaires', 'X')).toBe('Le champ « Horaires » de « X » a été modifié sur deux appareils.');
    });
});
