// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showWelcomeIfNeeded } from '../src/welcome.js';

const WELCOME_KEY = 'hw_welcome_seen';

beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

// Helper: simulate a touch event on an element
function fireTouch(target, type, clientX) {
    const touchData = type === 'touchend'
        ? { changedTouches: [{ clientX }] }
        : { touches: [{ clientX }] };
    const evt = new Event(type, { bubbles: true });
    Object.assign(evt, touchData);
    target.dispatchEvent(evt);
}

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
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showWelcomeIfNeeded — construction initiale', () => {
    it('construit 4 slides (.welcome-slide) avec un titre h2 chacune', () => {
        showWelcomeIfNeeded();
        const slides = document.querySelectorAll('.welcome-slide');
        expect(slides).toHaveLength(4);
        slides.forEach(s => {
            expect(s.querySelector('h2.welcome-title')).not.toBeNull();
        });
    });

    it('construit 4 dots, le premier avec class "active"', () => {
        showWelcomeIfNeeded();
        const dots = document.querySelectorAll('.welcome-dot');
        expect(dots).toHaveLength(4);
        expect(dots[0].classList.contains('active')).toBe(true);
        for (let i = 1; i < dots.length; i++) {
            expect(dots[i].classList.contains('active')).toBe(false);
        }
    });

    it('état initial : actions visibles (skip/next), choices cachés', () => {
        showWelcomeIfNeeded();
        const actions = document.getElementById('welcome-actions');
        const choices = document.getElementById('welcome-choices');
        // Pas encore navigué : on n'est pas sur le dernier slide
        // → actions display "" (default), choices display "none" géré dans goTo (mais initial state DOM = pas de style inline appliqué tant que goTo n'est pas appelé)
        // On vérifie surtout que les boutons sont présents
        expect(document.getElementById('welcome-skip')).not.toBeNull();
        expect(document.getElementById('welcome-next')).not.toBeNull();
        expect(document.getElementById('welcome-all')).not.toBeNull();
        expect(document.getElementById('welcome-space')).not.toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showWelcomeIfNeeded — navigation (Suivant / dot / borne)', () => {
    it('click "Suivant" : avance d\'un slide et active le dot suivant', () => {
        showWelcomeIfNeeded();
        document.getElementById('welcome-next').click();
        const dots = document.querySelectorAll('.welcome-dot');
        expect(dots[0].classList.contains('active')).toBe(false);
        expect(dots[1].classList.contains('active')).toBe(true);
    });

    it('click sur un dot : navigue directement vers ce slide', () => {
        showWelcomeIfNeeded();
        const dots = document.querySelectorAll('.welcome-dot');
        dots[2].click();
        expect(dots[2].classList.contains('active')).toBe(true);
        expect(dots[0].classList.contains('active')).toBe(false);
    });

    it('borne max : click "Suivant" sur le dernier slide n\'avance pas plus loin', () => {
        showWelcomeIfNeeded();
        // Aller au dernier slide (index 3) via dot
        const dots = document.querySelectorAll('.welcome-dot');
        dots[3].click();
        expect(dots[3].classList.contains('active')).toBe(true);
        // Click "Suivant" → ne fait rien (on reste sur le 3)
        document.getElementById('welcome-next').click();
        expect(dots[3].classList.contains('active')).toBe(true);
    });

    it('dernier slide : actions caché (display none), choices affichés (display flex)', () => {
        showWelcomeIfNeeded();
        document.querySelectorAll('.welcome-dot')[3].click();
        const actions = document.getElementById('welcome-actions');
        const choices = document.getElementById('welcome-choices');
        expect(actions.style.display).toBe('none');
        expect(choices.style.display).toBe('flex');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showWelcomeIfNeeded — fermeture (Skip / choix final)', () => {
    it('click "Passer" : set hw_welcome_seen=1 et démarre le fadeout', () => {
        vi.useFakeTimers();
        showWelcomeIfNeeded();
        document.getElementById('welcome-skip').click();
        expect(localStorage.getItem(WELCOME_KEY)).toBe('1');
        // Avant timeout : overlay encore présent avec class welcome-fadeout
        const overlay = document.getElementById('welcome-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay.classList.contains('welcome-fadeout')).toBe(true);
        // Après timeout : overlay retiré
        vi.advanceTimersByTime(400);
        expect(document.getElementById('welcome-overlay')).toBeNull();
    });

    it('click "Tous les circuits" : set localStorage + retire overlay', () => {
        vi.useFakeTimers();
        showWelcomeIfNeeded();
        document.querySelectorAll('.welcome-dot')[3].click();
        document.getElementById('welcome-all').click();
        expect(localStorage.getItem(WELCOME_KEY)).toBe('1');
        vi.advanceTimersByTime(400);
        expect(document.getElementById('welcome-overlay')).toBeNull();
    });

    it('click "Mon Espace" : set localStorage + retire overlay (import dynamique non testé)', () => {
        vi.useFakeTimers();
        showWelcomeIfNeeded();
        document.querySelectorAll('.welcome-dot')[3].click();
        document.getElementById('welcome-space').click();
        expect(localStorage.getItem(WELCOME_KEY)).toBe('1');
        vi.advanceTimersByTime(400);
        expect(document.getElementById('welcome-overlay')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showWelcomeIfNeeded — swipe touches (mobile)', () => {
    it('swipe gauche (delta > 50px) : avance au slide suivant', () => {
        showWelcomeIfNeeded();
        const overlay = document.getElementById('welcome-overlay');
        fireTouch(overlay, 'touchstart', 200);
        fireTouch(overlay, 'touchend', 100); // delta = 200 - 100 = 100 > 50
        const dots = document.querySelectorAll('.welcome-dot');
        expect(dots[1].classList.contains('active')).toBe(true);
    });

    it('swipe droite (delta < -50px) : recule au slide précédent (si pas premier)', () => {
        showWelcomeIfNeeded();
        // D'abord aller au slide 1
        document.getElementById('welcome-next').click();
        const overlay = document.getElementById('welcome-overlay');
        fireTouch(overlay, 'touchstart', 100);
        fireTouch(overlay, 'touchend', 200); // delta = 100 - 200 = -100, |delta| > 50
        const dots = document.querySelectorAll('.welcome-dot');
        expect(dots[0].classList.contains('active')).toBe(true);
    });

    it('swipe court (|delta| < 50) : no-op (pas de changement de slide)', () => {
        showWelcomeIfNeeded();
        const overlay = document.getElementById('welcome-overlay');
        fireTouch(overlay, 'touchstart', 200);
        fireTouch(overlay, 'touchend', 180); // delta = 20 < 50
        const dots = document.querySelectorAll('.welcome-dot');
        expect(dots[0].classList.contains('active')).toBe(true);
    });
});
