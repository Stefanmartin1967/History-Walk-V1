// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showWelcomeIfNeeded, showWelcomeAgain } from '../src/welcome.js';
import { eventBus } from '../src/events.js';

const WELCOME_KEY = 'hw_welcome_seen';

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
describe('showWelcomeIfNeeded — gate localStorage', () => {
    it('no-op si hw_welcome_seen déjà dans localStorage (pas d\'overlay créé)', () => {
        localStorage.setItem(WELCOME_KEY, '1');
        showWelcomeIfNeeded();
        expect(document.getElementById('welcome-overlay')).toBeNull();
    });

    it('crée #welcome-overlay si localStorage vide', () => {
        showWelcomeIfNeeded();
        expect(document.getElementById('welcome-overlay')).not.toBeNull();
    });

    it('appel répété ne duplique pas l\'overlay', () => {
        showWelcomeIfNeeded();
        // Simuler appel direct interne (showWelcomeAgain force l'affichage même si seen)
        showWelcomeAgain();
        expect(document.querySelectorAll('#welcome-overlay')).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showWelcomeIfNeeded — 1er démarrage : 3 cartes', () => {
    it('affiche 3 cartes au 1er démarrage', () => {
        showWelcomeIfNeeded();
        const cards = document.querySelectorAll('.welcome-card');
        expect(cards).toHaveLength(3);
    });

    it('cartes ont les data-choice attendus (discover, import, create) dans cet ordre', () => {
        showWelcomeIfNeeded();
        const choices = Array.from(document.querySelectorAll('.welcome-card'))
            .map(c => c.dataset.choice);
        expect(choices).toEqual(['discover', 'import', 'create']);
    });

    it('chaque carte a un titre et un sous-titre', () => {
        showWelcomeIfNeeded();
        const cards = document.querySelectorAll('.welcome-card');
        cards.forEach(card => {
            expect(card.querySelector('.welcome-card-title')).not.toBeNull();
            expect(card.querySelector('.welcome-card-subtitle')).not.toBeNull();
        });
    });

    it('le bouton "Passer" est présent', () => {
        showWelcomeIfNeeded();
        expect(document.getElementById('welcome-skip')).not.toBeNull();
    });

    it('titre et sous-titre de la modal sont présents', () => {
        showWelcomeIfNeeded();
        expect(document.querySelector('.welcome-modal-title')).not.toBeNull();
        expect(document.querySelector('.welcome-modal-subtitle')).not.toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showWelcomeAgain — mode "revoir" : 4 cartes', () => {
    it('affiche 4 cartes (les 3 + photos)', () => {
        showWelcomeAgain();
        const cards = document.querySelectorAll('.welcome-card');
        expect(cards).toHaveLength(4);
    });

    it('la 4e carte a data-choice="photos"', () => {
        showWelcomeAgain();
        const choices = Array.from(document.querySelectorAll('.welcome-card'))
            .map(c => c.dataset.choice);
        expect(choices).toEqual(['discover', 'import', 'create', 'photos']);
    });

    it('s\'affiche même si hw_welcome_seen est déjà à 1 (réaffichage forcé)', () => {
        localStorage.setItem(WELCOME_KEY, '1');
        showWelcomeAgain();
        expect(document.getElementById('welcome-overlay')).not.toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('choix utilisateur — émission eventBus + persistance + fadeout', () => {
    it('clic sur une carte émet welcome:choice avec le bon id', () => {
        showWelcomeIfNeeded();
        const received = vi.fn();
        eventBus.on('welcome:choice', received);
        document.querySelector('[data-choice="create"]').click();
        expect(received).toHaveBeenCalledWith({ choice: 'create' });
    });

    it('clic sur une carte set hw_welcome_seen=1', () => {
        showWelcomeIfNeeded();
        document.querySelector('[data-choice="discover"]').click();
        expect(localStorage.getItem(WELCOME_KEY)).toBe('1');
    });

    it('clic sur "Passer" émet welcome:choice avec choice=discover (skip = découvrir)', () => {
        showWelcomeIfNeeded();
        const received = vi.fn();
        eventBus.on('welcome:choice', received);
        document.getElementById('welcome-skip').click();
        expect(received).toHaveBeenCalledWith({ choice: 'discover' });
    });

    it('clic déclenche le fadeout puis retire l\'overlay après 350ms', () => {
        vi.useFakeTimers();
        showWelcomeIfNeeded();
        document.querySelector('[data-choice="import"]').click();
        const overlay = document.getElementById('welcome-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay.classList.contains('welcome-fadeout')).toBe(true);
        vi.advanceTimersByTime(400);
        expect(document.getElementById('welcome-overlay')).toBeNull();
    });

    it('en mode "revoir", clic sur photos émet welcome:choice avec choice=photos', () => {
        showWelcomeAgain();
        const received = vi.fn();
        eventBus.on('welcome:choice', received);
        document.querySelector('[data-choice="photos"]').click();
        expect(received).toHaveBeenCalledWith({ choice: 'photos' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('accessibilité — attributs ARIA', () => {
    it('la modal a role=dialog et aria-modal=true', () => {
        showWelcomeIfNeeded();
        const modal = document.querySelector('.welcome-modal');
        expect(modal.getAttribute('role')).toBe('dialog');
        expect(modal.getAttribute('aria-modal')).toBe('true');
    });

    it('la modal est labellisée par son titre', () => {
        showWelcomeIfNeeded();
        const modal = document.querySelector('.welcome-modal');
        const labelledById = modal.getAttribute('aria-labelledby');
        expect(labelledById).toBeTruthy();
        expect(document.getElementById(labelledById)).not.toBeNull();
    });
});
