import { describe, it, expect } from 'vitest';
import { splitSentences, markChanges, mergeTexts, hasSentence, addSentence, removeSentence } from '../src/text-merge.js';

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

describe('deux ajouts au même endroit', () => {
    it('après la même phrase de départ : réunis, celui d’ici d’abord', () => {
        const base = "Position enregistrée sur le sentier d'où grimper vers la grotte.";
        const r = mergeTexts(base, base + ' Entrée 25 m plus au sud-est.', base + ' Panneau « Fond des Haies » n° 5.');
        expect(r.clean).toBe(true);
        expect(r.text).toBe(base + ' Entrée 25 m plus au sud-est. Panneau « Fond des Haies » n° 5.');
    });
});

describe('une case par phrase : ajouter / retirer', () => {
    const ICI = "Grotte\nCette grotte est noire à l'intérieur\nTable de pique nique à proximité";
    it('ajoute à la fin, sur une nouvelle ligne, une seule fois', () => {
        const t = addSentence(ICI, 'Attention, terrain glissant à la montée');
        expect(t).toBe(ICI + '\nAttention, terrain glissant à la montée');
        expect(addSentence(t, 'Attention, terrain glissant à la montée')).toBe(t);
        expect(addSentence('', 'Grotte visitable')).toBe('Grotte visitable');
    });
    it('retire une ligne entière, ou une phrase dans une ligne', () => {
        expect(removeSentence(ICI, "Cette grotte est noire à l'intérieur")).toBe('Grotte\nTable de pique nique à proximité');
        expect(removeSentence(ICI, 'Table de pique nique à proximité')).toBe("Grotte\nCette grotte est noire à l'intérieur");
        expect(removeSentence('A. B. C.', 'B.')).toBe('A. C.');
        expect(removeSentence('A. B.', 'B.')).toBe('A.');
    });
    it('phrase retouchée à la main : rien n’est retiré', () => {
        expect(removeSentence('Grotte très sombre', 'Grotte sombre')).toBe('Grotte très sombre');
    });
    it('hasSentence ignore les blancs', () => {
        expect(hasSentence('A.\n  B.', 'B.')).toBe(true);
        expect(hasSentence('A.', 'B.')).toBe(false);
        expect(hasSentence('Grotte visitable', 'Grotte')).toBe(false);
    });
    it('retirer une phrase courte ne touche pas une phrase qui la contient', () => {
        expect(removeSentence('Grotte visitable\nGrotte', 'Grotte')).toBe('Grotte visitable');
        expect(removeSentence('Grotte visitable', 'Grotte')).toBe('Grotte visitable');
    });
});

