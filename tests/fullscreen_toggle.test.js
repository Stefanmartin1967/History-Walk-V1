// @vitest-environment jsdom
//
// Bouton « Plein écran » de la pile de contrôles de la carte (map.js), depuis
// le 12/11/2026 (handoff Claude Design « écran bas » ; avant : menu Outils).
// Bouton carré, icône seule : l'info-bulle et le nom accessible suivent l'état
// réel, y compris quand on sort par Échap ou F11.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));

import { bindFullscreenButton, isFullscreenSupported } from '../src/fullscreen-toggle.js';

let fullscreenEl = null;
beforeEach(() => {
    fullscreenEl = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenEl });
    document.documentElement.requestFullscreen = vi.fn(() => Promise.resolve());
    document.exitFullscreen = vi.fn(() => Promise.resolve());
    document.body.innerHTML = `<a href="#" id="leaflet-btn-fullscreen" role="button"></a>`;
    bindFullscreenButton(btn());
});

const btn = () => document.getElementById('leaflet-btn-fullscreen');

describe('bouton « Plein écran » de la pile de la carte', () => {
    it('au repos : « Plein écran », icône maximize, aria-pressed false', () => {
        expect(btn().getAttribute('aria-label')).toBe('Plein écran');
        expect(btn().title).toBe('Plein écran');
        expect(btn().querySelector('[data-lucide="maximize"]')).not.toBeNull();
        expect(btn().getAttribute('aria-pressed')).toBe('false');
    });

    it('en plein écran : « Quitter le plein écran », icône minimize, aria-pressed', () => {
        fullscreenEl = document.documentElement;
        document.dispatchEvent(new Event('fullscreenchange'));
        expect(btn().getAttribute('aria-label')).toBe('Quitter le plein écran');
        expect(btn().querySelector('[data-lucide="minimize"]')).not.toBeNull();
        expect(btn().getAttribute('aria-pressed')).toBe('true');
    });

    it('en sortant (Échap, F11…) : retour à « Plein écran »', () => {
        fullscreenEl = document.documentElement;
        document.dispatchEvent(new Event('fullscreenchange'));
        fullscreenEl = null;
        document.dispatchEvent(new Event('fullscreenchange'));
        expect(btn().getAttribute('aria-label')).toBe('Plein écran');
        expect(btn().getAttribute('aria-pressed')).toBe('false');
    });

    it('un clic demande le plein écran, sans suivre le lien', () => {
        const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
        btn().dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
    });

    it('navigateur sans Fullscreen API : non pris en charge', () => {
        delete document.documentElement.requestFullscreen;
        expect(isFullscreenSupported()).toBe(false);
    });
});
