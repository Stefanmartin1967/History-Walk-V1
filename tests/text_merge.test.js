import { describe, it, expect } from 'vitest';
import { splitSentences, markChanges, mergeTexts } from '../src/text-merge.js';

// Conflits à la publication, écran « Texte : trois zones » (18/11/2026).
const BASE = 'Église classée depuis 1942. Transformée en 1956.';
const HERE = 'Église classée depuis 1942. Transformée en 1956, selon Wikipédia.';
const ONLINE = "Église classée depuis 1942. Transformée en 1956. La porte d'entrée, rue Charles II, porte une sculpture d'Oscar Jespers.";

describe('splitSentences', () => {
    it('découpe en phrases et rend le texte à la concaténation', () => {
        const s = splitSentences(ONLINE);
        expect(s).toHaveLength(3);
        expect(s.join('')).toBe(ONLINE);
        expect(splitSentences('Ligne 1\nLigne 2').join('')).toBe('Ligne 1\nLigne 2');
        expect(splitSentences('')).toEqual([]);
    });
});

describe('markChanges', () => {
    it('surligne ce qui ne vient pas du départ', () => {
        const m = markChanges(BASE, ONLINE);
        expect(m.map(x => x.changed)).toEqual([false, false, true]);
        expect(markChanges(BASE, HERE).map(x => x.changed)).toEqual([false, true]);
    });
});

describe('mergeTexts', () => {
    it('phrases différentes : les deux changements réunis', () => {
        const r = mergeTexts(BASE, HERE, ONLINE);
        expect(r.clean).toBe(true);
        expect(r.text).toBe("Église classée depuis 1942. Transformée en 1956, selon Wikipédia. La porte d'entrée, rue Charles II, porte une sculpture d'Oscar Jespers.");
    });

    it('même phrase changée des deux côtés : version d’ici gardée, passage signalé', () => {
        const r = mergeTexts(BASE, HERE, 'Église classée depuis 1942. Profondément remaniée en 1956.');
        expect(r.clean).toBe(false);
        expect(r.text).toBe(HERE);
        expect(r.conflicts).toEqual([{ here: 'Transformée en 1956, selon Wikipédia.', online: 'Profondément remaniée en 1956.' }]);
    });

    it('même changement des deux côtés : pas de conflit', () => {
        const r = mergeTexts(BASE, HERE, HERE);
        expect(r).toEqual({ text: HERE, clean: true, conflicts: [] });
    });

    it('phrase supprimée d’un côté, ajout de l’autre', () => {
        const r = mergeTexts('A. B. C.', 'A. C.', 'A. B. C. D.');
        expect(r.clean).toBe(true);
        expect(r.text).toBe('A. C. D.');
    });

    it('retours à la ligne gardés dans un passage disputé (Grotte des Sarrasins, 18/11)', () => {
        const here = "Grotte visitable seulement sur quelques mètres\nCette grotte est noire à l'intérieur";
        const online = "Grotte visitable\nSombre à l'intérieur";
        const r = mergeTexts('', here, online);
        expect(r.clean).toBe(false);
        expect(r.text).toBe(here);
        expect(r.conflicts).toEqual([{ here, online }]);
    });

    it('retours à la ligne gardés quand les deux changements sont réunis', () => {
        const r = mergeTexts('A.\nB.', 'A modifié.\nB.', 'A.\nB.\nC ajouté.');
        expect(r).toEqual({ text: 'A modifié.\nB.\nC ajouté.', clean: true, conflicts: [] });
    });

    it('départ vide (champ nouveau des deux côtés) : conflit si différents', () => {
        const r = mergeTexts('', 'Texte ici.', 'Texte en ligne.');
        expect(r.clean).toBe(false);
        expect(r.text).toBe('Texte ici.');
    });
});
