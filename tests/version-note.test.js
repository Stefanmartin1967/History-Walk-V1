// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// « Avant de continuer » (version-note.js). Depuis le 23/11/2026 (PR 9 « synchro
// users », écrans 11-12 validés le 19/11) : paragraphe « Vos données restent sur
// cet appareil » et boutons « Plus tard » / « Relier à mon compte Google » ; en
// admin, le bouton « J'ai compris » d'avant (pas de proposition Google).

const h = vi.hoisted(() => ({ resolve: null, opened: [], state: { isAdmin: false } }));
vi.mock('../src/modal.js', () => ({
    openHwModal: vi.fn((opts) => { h.opened.push(opts); return new Promise(r => { h.resolve = r; }); }),
    closeHwModal: vi.fn((v) => h.resolve?.(v)),
}));
vi.mock('../src/state.js', () => ({ state: h.state }));
const linkNow = vi.fn();
vi.mock('../src/sync-reminders.js', () => ({ linkNow: () => linkNow() }));

const NOTE_KEY = 'hw_version_note_seen';
let showVersionNoteIfNeeded;

beforeEach(async () => {
    localStorage.clear();
    h.opened = []; h.resolve = null; h.state.isAdmin = false;
    linkNow.mockClear();
    document.body.innerHTML = '';
    ({ showVersionNoteIfNeeded } = await import('../src/version-note.js'));
});

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('showVersionNoteIfNeeded — gate de version', () => {
    it('affiche la note quand aucune version n’a été vue', () => {
        showVersionNoteIfNeeded();
        expect(h.opened).toHaveLength(1);
    });
    it('n’affiche rien si la version courante a déjà été vue', () => {
        localStorage.setItem(NOTE_KEY, '2');
        showVersionNoteIfNeeded();
        expect(h.opened).toHaveLength(0);
    });
    it('réaffiche si la version vue est antérieure (1 → 2 : le paragraphe sur les données)', () => {
        localStorage.setItem(NOTE_KEY, '1');
        showVersionNoteIfNeeded();
        expect(h.opened).toHaveLength(1);
    });
    it('une valeur illisible en localStorage ne bloque pas l’affichage', () => {
        localStorage.setItem(NOTE_KEY, 'nimportequoi');
        showVersionNoteIfNeeded();
        expect(h.opened).toHaveLength(1);
    });
});

describe('showVersionNoteIfNeeded — persistance et boutons', () => {
    it('mémorise la version vue APRÈS fermeture', async () => {
        showVersionNoteIfNeeded();
        expect(localStorage.getItem(NOTE_KEY)).toBeNull();
        h.resolve();
        await flush();
        expect(localStorage.getItem(NOTE_KEY)).toBe('2');
    });
    it('« Relier à mon compte Google » lance la liaison', async () => {
        showVersionNoteIfNeeded();
        h.resolve('link');
        await vi.waitFor(() => expect(linkNow).toHaveBeenCalled());
    });
    it('boutons « Plus tard » et « Relier à mon compte Google » (user)', () => {
        showVersionNoteIfNeeded();
        expect(h.opened[0].footer).toContain('Plus tard');
        expect(h.opened[0].footer).toContain('Relier à mon compte Google');
    });
    it('admin : « J’ai compris », sans proposition Google ni paragraphe sur les données', () => {
        h.state.isAdmin = true;
        showVersionNoteIfNeeded();
        expect(h.opened[0].footer).toContain("J'ai compris");
        expect(h.opened[0].body).not.toContain('Vos données restent sur cet appareil');
    });
});

describe('showVersionNoteIfNeeded — contenu', () => {
    const body = () => { showVersionNoteIfNeeded(); return h.opened[0].body; };

    it('titre « Avant de continuer »', () => {
        showVersionNoteIfNeeded();
        expect(h.opened[0].title).toBe('Avant de continuer');
    });
    it('annonce la phase d’amélioration et les deux réserves sur les données', () => {
        const b = body();
        expect(b).toContain('phase d\'amélioration');
        expect(b).toContain('Google Maps');
        expect(b).toContain('OpenStreetMap');
        expect(b).toContain('imprécis');
    });
    it('dit la vérité sur les sources (texte validé le 11/10/2026)', () => {
        const b = body();
        expect(b).toContain('Chaque site patrimonial');
        expect(b).not.toContain('Chaque lieu a été vérifié');
        expect(b).toContain('Wikipédia');
    });
    it('« Vos données restent sur cet appareil » AVANT « Pour commencer » (écrans 11-12)', () => {
        const b = body();
        expect(b).toContain('<strong>Vos données restent sur cet appareil.</strong>');
        expect(b).toContain('Heripia ne les reçoit jamais');
        expect(b).toContain('Sauvegarder mes photos');
        expect(b).not.toContain('sauvegarde complète'); // plus de « complète » depuis la PR 3
        expect(b.indexOf('Vos données restent')).toBeLessThan(b.indexOf('Pour commencer'));
    });
    it('« Pour commencer » (texte validé le 11/10/2026)', () => {
        expect(body()).toMatch(/<strong>Pour commencer :<\/strong> ouvrez un circuit, ou cherchez un lieu\s+par son nom\./);
    });
    it('ne cite pas la boussole, ni « ces services »', () => {
        const b = body();
        expect(b).not.toMatch(/boussole/i);
        expect(b).not.toContain('ces services');
        expect(b).toMatch(/l'ouvrir\s+directement sur Google Maps ou OpenStreetMap/);
    });
});
