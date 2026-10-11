// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showWelcomeAgain } from '../src/welcome.js';
import { eventBus } from '../src/events.js';

beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    // Vider les listeners pour éviter les fuites entre tests
    eventBus.listeners = {};
});

afterEach(() => {
    vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Le déclenchement automatique au 1er lancement a été retiré : welcome.js ne
// sert plus que le bouton « Visite guidée » (la note de version prend le relais
// au boot — cf. version-note.test.js). Il n'y a donc plus qu'un seul mode
// d'affichage, et plus de gate localStorage dans ce module.
describe('showWelcomeAgain — affichage', () => {
    it('crée #welcome-overlay', () => {
        showWelcomeAgain();
        expect(document.getElementById('welcome-overlay')).not.toBeNull();
    });

    it('appel répété ne duplique pas l\'overlay', () => {
        showWelcomeAgain();
        showWelcomeAgain();
        expect(document.querySelectorAll('#welcome-overlay')).toHaveLength(1);
    });

    it('s\'affiche sans condition (aucune gate localStorage)', () => {
        localStorage.setItem('hw_version_note_seen', '1');
        showWelcomeAgain();
        expect(document.getElementById('welcome-overlay')).not.toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showWelcomeAgain — les 4 cartes', () => {
    it('affiche 4 cartes', () => {
        showWelcomeAgain();
        expect(document.querySelectorAll('.welcome-card')).toHaveLength(4);
    });

    it('cartes ont les data-choice attendus dans cet ordre', () => {
        showWelcomeAgain();
        const choices = Array.from(document.querySelectorAll('.welcome-card'))
            .map(c => c.dataset.choice);
        expect(choices).toEqual(['legend', 'new-place', 'create', 'photos']);
    });

    it('textes validés par Stefan le 11/10/2026 (titres + sous-titres)', () => {
        showWelcomeAgain();
        const texts = Array.from(document.querySelectorAll('.welcome-card'))
            .map(c => `${c.querySelector('.welcome-card-title').textContent} — ${c.querySelector('.welcome-card-subtitle').textContent}`);
        expect(texts).toEqual([
            "Voir la légende des icônes — Je comprends ce que signifie chaque symbole",
            "Créer un nouveau lieu — J'ajoute un lieu qui manque, je peux le signaler",
            "Créer mon propre circuit — Je m'aventure, je trace mon parcours",
            "Associer mes photos aux lieux — Je personnalise, j'ajoute mes photos à mes visites",
        ]);
    });

    it('chaque carte a un titre et un sous-titre', () => {
        showWelcomeAgain();
        const cards = document.querySelectorAll('.welcome-card');
        cards.forEach(card => {
            expect(card.querySelector('.welcome-card-title')).not.toBeNull();
            expect(card.querySelector('.welcome-card-subtitle')).not.toBeNull();
        });
    });

    it('le bouton "Fermer" est présent', () => {
        showWelcomeAgain();
        expect(document.getElementById('welcome-skip').textContent).toBe('Fermer');
    });

    it('titre présent, plus de sous-titre « Bienvenue » (écran ouvert à la demande, pas un accueil)', () => {
        showWelcomeAgain();
        expect(document.querySelector('.welcome-modal-title').textContent).toBe('Que voulez-vous faire ?');
        expect(document.querySelector('.welcome-modal-subtitle')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('choix utilisateur — émission eventBus + fadeout', () => {
    it('clic sur une carte émet welcome:choice avec le bon id', () => {
        showWelcomeAgain();
        const received = vi.fn();
        eventBus.on('welcome:choice', received);
        document.querySelector('[data-choice="create"]').click();
        expect(received).toHaveBeenCalledWith({ choice: 'create' });
    });

    it('clic sur "Fermer" ferme sans émettre de choix', () => {
        vi.useFakeTimers();
        showWelcomeAgain();
        const received = vi.fn();
        eventBus.on('welcome:choice', received);
        document.getElementById('welcome-skip').click();
        expect(received).not.toHaveBeenCalled();
        vi.advanceTimersByTime(400);
        expect(document.getElementById('welcome-overlay')).toBeNull();
    });

    it('clic sur photos émet welcome:choice avec choice=photos', () => {
        showWelcomeAgain();
        const received = vi.fn();
        eventBus.on('welcome:choice', received);
        document.querySelector('[data-choice="photos"]').click();
        expect(received).toHaveBeenCalledWith({ choice: 'photos' });
    });

    it('clic déclenche le fadeout puis retire l\'overlay après 350ms', () => {
        vi.useFakeTimers();
        showWelcomeAgain();
        document.querySelector('[data-choice="legend"]').click();
        const overlay = document.getElementById('welcome-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay.classList.contains('welcome-fadeout')).toBe(true);
        vi.advanceTimersByTime(400);
        expect(document.getElementById('welcome-overlay')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('accessibilité — attributs ARIA', () => {
    it('la modal a role=dialog et aria-modal=true', () => {
        showWelcomeAgain();
        const modal = document.querySelector('.welcome-modal');
        expect(modal.getAttribute('role')).toBe('dialog');
        expect(modal.getAttribute('aria-modal')).toBe('true');
    });

    it('la modal est labellisée par son titre', () => {
        showWelcomeAgain();
        const modal = document.querySelector('.welcome-modal');
        const labelledById = modal.getAttribute('aria-labelledby');
        expect(labelledById).toBeTruthy();
        expect(document.getElementById(labelledById)).not.toBeNull();
    });
});
