import { describe, it, expect } from 'vitest';
import { normalizeCommonsCategory, commonsCategoryUrl } from '../src/utils.js';

describe('normalizeCommonsCategory', () => {
    it("extrait la catégorie de l'URL collée telle quelle", () => {
        expect(normalizeCommonsCategory('https://commons.wikimedia.org/wiki/Category:Sidi_Roubil_Mosque'))
            .toBe('Category:Sidi_Roubil_Mosque');
    });

    it('tolère espaces, query, ancre, version mobile et absence de schéma', () => {
        expect(normalizeCommonsCategory('  https://commons.wikimedia.org/wiki/Category:Sidi_Roubil_Mosque?uselang=fr#mw-pages  '))
            .toBe('Category:Sidi_Roubil_Mosque');
        expect(normalizeCommonsCategory('https://commons.m.wikimedia.org/wiki/Category:Sidi_Roubil_Mosque'))
            .toBe('Category:Sidi_Roubil_Mosque');
        expect(normalizeCommonsCategory('commons.wikimedia.org/wiki/Category:Sidi_Roubil_Mosque'))
            .toBe('Category:Sidi_Roubil_Mosque');
    });

    it('décode les caractères encodés et remplace les espaces par des _', () => {
        expect(normalizeCommonsCategory('https://commons.wikimedia.org/wiki/Category:Mosqu%C3%A9e_Sidi_Jmour'))
            .toBe('Category:Mosquée_Sidi_Jmour');
        expect(normalizeCommonsCategory('Category:Sidi Roubil Mosque')).toBe('Category:Sidi_Roubil_Mosque');
        expect(normalizeCommonsCategory('category:Sidi_Roubil_Mosque')).toBe('Category:Sidi_Roubil_Mosque');
    });

    it('ne devine jamais : nom nu, page File:, autre site, vide → ""', () => {
        expect(normalizeCommonsCategory('Sidi Roubil Mosque')).toBe('');
        expect(normalizeCommonsCategory('https://commons.wikimedia.org/wiki/File:Sidi_Roubil.jpg')).toBe('');
        expect(normalizeCommonsCategory('https://fr.wikipedia.org/wiki/Category:Sidi_Roubil_Mosque')).toBe('');
        expect(normalizeCommonsCategory('https://commons.wikimedia.org.evil.com/wiki/Category:X')).toBe('');
        expect(normalizeCommonsCategory('Category:')).toBe('');
        expect(normalizeCommonsCategory('')).toBe('');
        expect(normalizeCommonsCategory(undefined)).toBe('');
    });
});

describe('commonsCategoryUrl', () => {
    it('reconstruit la page de la catégorie', () => {
        expect(commonsCategoryUrl('Category:Sidi_Roubil_Mosque'))
            .toBe('https://commons.wikimedia.org/wiki/Category:Sidi_Roubil_Mosque');
    });

    it("encode les caractères non ASCII sans casser les parenthèses", () => {
        expect(commonsCategoryUrl('Category:Mosquée_(Djerba)'))
            .toBe('https://commons.wikimedia.org/wiki/Category:Mosqu%C3%A9e_(Djerba)');
    });

    it('renvoie null sans catégorie exploitable', () => {
        expect(commonsCategoryUrl('')).toBeNull();
        expect(commonsCategoryUrl(undefined)).toBeNull();
        expect(commonsCategoryUrl('Sidi Roubil Mosque')).toBeNull();
    });
});
