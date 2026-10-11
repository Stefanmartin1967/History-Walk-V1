// @vitest-environment jsdom
//
// Entrée « Plein écran » du menu Outils (déplacée de la barre du haut le
// 11/10/2026). Le libellé visible suit l'état réel : il porte aussi le nom
// accessible, l'entrée n'a plus besoin d'aria-label ni d'info-bulle.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));

import { setupFullscreenToggle } from '../src/fullscreen-toggle.js';

let fullscreenEl = null;
beforeEach(() => {
    fullscreenEl = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenEl });
    document.documentElement.requestFullscreen = vi.fn();
    document.body.innerHTML = `
        <button class="tools-menu-item" id="btn-fullscreen-toggle" aria-pressed="false">
            <i data-lucide="maximize"></i> Plein écran
        </button>`;
    setupFullscreenToggle();
});

const entry = () => document.getElementById('btn-fullscreen-toggle');

describe('entrée « Plein écran » du menu Outils', () => {
    it('en plein écran : « Quitter le plein écran », icône minimize, aria-pressed', () => {
        fullscreenEl = document.documentElement;
        document.dispatchEvent(new Event('fullscreenchange'));
        expect(entry().textContent.trim()).toBe('Quitter le plein écran');
        expect(entry().querySelector('[data-lucide="minimize"]')).not.toBeNull();
        expect(entry().getAttribute('aria-pressed')).toBe('true');
    });

    it('en sortant (Échap, F11…) : retour à « Plein écran »', () => {
        fullscreenEl = document.documentElement;
        document.dispatchEvent(new Event('fullscreenchange'));
        fullscreenEl = null;
        document.dispatchEvent(new Event('fullscreenchange'));
        expect(entry().textContent.trim()).toBe('Plein écran');
        expect(entry().querySelector('[data-lucide="maximize"]')).not.toBeNull();
        expect(entry().getAttribute('aria-pressed')).toBe('false');
    });
});
