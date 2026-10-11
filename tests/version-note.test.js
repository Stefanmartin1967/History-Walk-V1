// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// version-note.js n'a qu'une dépendance : hwAlert. On la mocke pour piloter
// la résolution (l'écriture localStorage n'a lieu qu'à la FERMETURE) et pour
// inspecter le contenu passé à la modale.
const hwAlert = vi.fn(() => Promise.resolve());
vi.mock('../src/modal.js', () => ({ hwAlert: (...args) => hwAlert(...args) }));
// PC ou téléphone : la phrase sur la boussole n'est montrée que sur PC.
const viewMock = { mobile: false };
vi.mock('../src/mobile-state.js', () => ({ isMobileView: () => viewMock.mobile }));

const NOTE_KEY = 'hw_version_note_seen';

let showVersionNoteIfNeeded;

beforeEach(async () => {
    viewMock.mobile = false;
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

    it('dit la vérité sur les sources (note de test 1, texte validé par Stefan le 11/10/2026)', () => {
        showVersionNoteIfNeeded();
        const { body } = hwAlert.mock.calls[0][0];
        // Mesuré le 11/10 : 17 lieux visibles sur 433 (tous des commerces) n'ont
        // ni OSM ni Maps — « chaque LIEU » était faux, « chaque SITE PATRIMONIAL » est vrai.
        expect(body).toContain('Chaque site patrimonial');
        expect(body).not.toContain('Chaque lieu a été vérifié');
        expect(body).toContain('Wikipédia');
    });

    it('PC : « Pour commencer » + la boussole (note de test 13, texte validé le 11/10/2026)', () => {
        showVersionNoteIfNeeded();
        const { body } = hwAlert.mock.calls[0][0];
        expect(body).toMatch(/<strong>Pour commencer :<\/strong> ouvrez un circuit, ou\s+cherchez un lieu par son nom\./);
        expect(body).toContain("La boussole, en haut, propose d'autres façons de commencer.");
    });

    it('téléphone : « Pour commencer » sans la boussole, qui n\'existe que sur PC', () => {
        viewMock.mobile = true;
        showVersionNoteIfNeeded();
        const { body } = hwAlert.mock.calls[0][0];
        expect(body).toContain('Pour commencer :');
        expect(body).not.toContain('boussole');
    });

    it('nomme les deux services qu\'on peut ouvrir depuis la fiche — pas Wikipédia (remarque de Stefan, 11/10/2026)', () => {
        showVersionNoteIfNeeded();
        const { body } = hwAlert.mock.calls[0][0];
        // « sur ces services », placé juste après Wikipédia, laissait croire
        // qu'on pouvait aussi y ouvrir le lieu : la fiche n'a que Maps et OSM.
        expect(body).not.toContain('ces services');
        expect(body).toMatch(/l'ouvrir\s+directement sur Google Maps ou OpenStreetMap/);
    });
});
