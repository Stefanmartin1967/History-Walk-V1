import { describe, it, expect } from 'vitest';
import { decideNote, isPreRuleLegacyConflict } from '../src/note-plan.js';

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
        // jamais synchronisée mais modifiée ici depuis (noteEdited) : envoyée
        expect(decideNote('Nouvelle note.', { dirty: true }, null).action).toBe('push');
    });

    // 19/11/2026 : le dépôt gagne pour une note d'avant le chantier, jamais touchée depuis.
    it('ancienne note absente du dépôt : supprimée ailleurs, retirée ici (plus de résurrection)', () => {
        expect(decideNote('Pas de trace dans le répertoire de Jalel', undefined, null).action).toBe('clear');
    });

    it('ancienne note différente du dépôt : la version du dépôt est prise', () => {
        expect(decideNote('Pas de traces sur OSM', undefined, { text: 'Pas de traces sur OSM (bâtiment) ; hameau…', sha: A }).action).toBe('take');
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

    it('nouvelle note écrite des deux côtés (jamais synchronisée, modifiée ici) : conflit, départ vide', () => {
        expect(decideNote('Ici.', { dirty: true }, { text: 'Ailleurs.', sha: A })).toEqual({ action: 'conflict', base: '' });
    });

    it('conflit d’ancienne note enregistré avant la règle : reconnu ; un conflit récent ne l’est pas', () => {
        expect(isPreRuleLegacyConflict({ sha: null, base: '', dirty: true, remote: 'x', remoteSha: A })).toBe(true);
        expect(isPreRuleLegacyConflict({ sha: null, base: '', dirty: true, remote: 'x', remoteSha: A, legacy: false })).toBe(false);
        expect(isPreRuleLegacyConflict({ sha: A, base: 'Départ.', dirty: true, remote: 'x', remoteSha: B })).toBe(false);
        expect(isPreRuleLegacyConflict({ sha: A, base: 'Départ.', dirty: false })).toBe(false);
    });

    it('vide des deux côtés : rien', () => {
        expect(decideNote('', sync({ sha: null, base: '' }), null).action).toBe('none');
    });
});
