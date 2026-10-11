// Aides — pas de vocabulaire interne dans un texte destiné à tous (notes de
// test 4 et 5, 03/10/2026). « POI » est du jargon : on dit « lieu », et le
// groupe de photos sans lieu s'appelle « Sans lieu » (validé par Stefan le
// 11/10/2026). Une mention « Admin : … » n'a rien à faire dans une aide lue
// par un visiteur.
import { describe, it, expect } from 'vitest';
import * as help from '../src/help-content.js';

// Tout le texte d'une aide (titre, html, sections imbriquées), balises retirées.
const textOf = (v) => {
    if (typeof v === 'string') return v.replace(/<[^>]+>/g, ' ');
    if (Array.isArray(v)) return v.map(textOf).join(' ');
    if (v && typeof v === 'object') return Object.values(v).map(textOf).join(' ');
    return '';
};

const entries = Object.entries(help).filter(([, v]) => v && typeof v === 'object');

describe('aides — vocabulaire', () => {
    it('le module exporte bien des aides à vérifier', () => {
        expect(entries.length).toBeGreaterThan(10);
    });

    it.each(entries)('%s : ni « POI », ni mention « Admin »', (_, value) => {
        const text = textOf(value);
        expect(text).not.toMatch(/\bPOIs?\b/);
        expect(text).not.toMatch(/\(Admin\b/);
    });

    it.each(entries)('%s : plus de « visite guidée » (bouton « Que faire ? », 11/10/2026)', (_, value) => {
        const text = textOf(value);
        expect(text).not.toMatch(/visite guidée/i);
        expect(text).not.toMatch(/Importer photos GPS/);
    });
});
