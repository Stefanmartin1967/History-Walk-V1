// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// version-note.js n'a qu'une dépendance : hwAlert. On la mocke pour piloter
// la résolution (l'écriture localStorage n'a lieu qu'à la FERMETURE) et pour
// inspecter le contenu passé à la modale.
const hwAlert = vi.fn(() => Promise.resolve());
vi.mock('../src/modal.js', () => ({ hwAlert: (...args) => hwAlert(...args) }));

const NOTE_KEY = 'hw_version_note_seen';

let showVersionNoteIfNeeded;

beforeEach(async () => {
    localStorage.clear();
    hwAlert.mockClear();
    hwAlert.mockImplementation(() => Promise.resolve());
    ({ showVersionNoteIfNeeded } = await import('../src/version-note.js'));
});

describe('showVersionNoteIfNeeded — gate de version', () => {
    it('affiche la note quand aucune version n\'a été vue', () => {
        showVersionNoteIfNeeded();
        expect(hwAlert).toHaveBeenCalledTimes(1);
    });

    it('n\'affiche rien si la version courante a déjà été vue', () => {
        localStorage.setItem(NOTE_KEY, '1');
        showVersionNoteIfNeeded();
        expect(hwAlert).not.toHaveBeenCalled();
    });

    it('réaffiche si la version vue est antérieure à la version courante', () => {
        localStorage.setItem(NOTE_KEY, '0');
        showVersionNoteIfNeeded();
        expect(hwAlert).toHaveBeenCalledTimes(1);
    });

    it('une valeur illisible en localStorage ne bloque pas l\'affichage', () => {
        localStorage.setItem(NOTE_KEY, 'nimportequoi');
        showVersionNoteIfNeeded();
        expect(hwAlert).toHaveBeenCalledTimes(1);
    });
});

describe('showVersionNoteIfNeeded — persistance', () => {
    it('mémorise la version vue APRÈS fermeture de la modale', async () => {
        showVersionNoteIfNeeded();
        // Rien n'est écrit tant que l'utilisateur n'a pas fermé.
        expect(localStorage.getItem(NOTE_KEY)).toBeNull();
        await Promise.resolve();
        await Promise.resolve();
        expect(localStorage.getItem(NOTE_KEY)).toBe('1');
    });

    it('ne réaffiche plus après une fermeture', async () => {
        showVersionNoteIfNeeded();
        await Promise.resolve();
        await Promise.resolve();
        hwAlert.mockClear();
        showVersionNoteIfNeeded();
        expect(hwAlert).not.toHaveBeenCalled();
    });
});

describe('showVersionNoteIfNeeded — contenu', () => {
    it('titre « Avant de continuer » et bouton « J\'ai compris »', () => {
        showVersionNoteIfNeeded();
        const opts = hwAlert.mock.calls[0][0];
        expect(opts.title).toBe('Avant de continuer');
        expect(opts.label).toBe("J'ai compris");
    });

    it('annonce la phase d\'amélioration et les deux réserves sur les données', () => {
        showVersionNoteIfNeeded();
        const { body } = hwAlert.mock.calls[0][0];
        expect(body).toContain('phase d\'amélioration');
        expect(body).toContain('Google Maps');
        expect(body).toContain('OpenStreetMap');
        expect(body).toContain('imprécis');
    });
});
