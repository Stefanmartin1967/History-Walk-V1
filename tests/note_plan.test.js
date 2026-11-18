import { describe, it, expect } from 'vitest';
import { decideNote } from '../src/note-plan.js';

// Notes privées entre appareils (18/11/2026, point 3).
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const sync = (o) => ({ sha: A, base: 'Départ.', dirty: false, ...o });

describe('decideNote', () => {
    it('identiques : on retient la version, rien à envoyer', () => {
        expect(decideNote('Note.', undefined, { text: 'Note.', sha: A }).action).toBe('adopt');
    });

    it('changée seulement dans le dépôt : on la prend', () => {
        expect(decideNote('Départ.', sync(), { text: 'Départ. Ajout.', sha: B }).action).toBe('take');
    });

    it('changée seulement ici : on l’envoie', () => {
        expect(decideNote('Départ. Ici.', sync({ dirty: true }), { text: 'Départ.', sha: A }).action).toBe('push');
    });

    it('changée des deux côtés : conflit, avec le départ commun', () => {
        expect(decideNote('Départ. Ici.', sync({ dirty: true }), { text: 'Départ. Ailleurs.', sha: B }))
            .toEqual({ action: 'conflict', base: 'Départ.' });
    });

    it('envoi raté sur le terrain (pas de fichier, note ici) : on l’envoie', () => {
        expect(decideNote('Écrite sans réseau.', sync({ sha: null, base: '', dirty: true }), null).action).toBe('push');
        expect(decideNote('Note d’avant le chantier.', undefined, null).action).toBe('push');
    });

    it('supprimée ailleurs, intacte ici : on la retire ici', () => {
        expect(decideNote('Départ.', sync(), null).action).toBe('clear');
    });

    it('supprimée ailleurs mais modifiée ici : on la renvoie', () => {
        expect(decideNote('Départ. Ici.', sync({ dirty: true }), null).action).toBe('push');
    });

    it('vidée ici, dépôt inchangé : envoi (suppression)', () => {
        expect(decideNote('', sync({ dirty: true }), { text: 'Départ.', sha: A }).action).toBe('push');
    });

    it('rien ici, note dans le dépôt : on la prend (nouvel appareil)', () => {
        expect(decideNote('', undefined, { text: 'Note.', sha: A }).action).toBe('take');
    });

    it('note d’avant le chantier différente du dépôt : conflit, départ vide', () => {
        expect(decideNote('Ici.', undefined, { text: 'Ailleurs.', sha: A })).toEqual({ action: 'conflict', base: '' });
    });

    it('vide des deux côtés : rien', () => {
        expect(decideNote('', sync({ sha: null, base: '' }), null).action).toBe('none');
    });
});
