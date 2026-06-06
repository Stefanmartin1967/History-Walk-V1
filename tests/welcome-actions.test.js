// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Le patron d'aide est mocké : on teste la LOGIQUE de welcome-actions (quel
// guide, quel onClose), pas le rendu du drawer. lucide mocké pour ne pas charger
// la lib en test.
vi.mock('../src/help-popover.js', () => ({
    openHelpPanel: vi.fn(),
    configureHelp: vi.fn(),
}));
vi.mock('../src/lucide-icons.js', () => ({
    createIcons: vi.fn(),
    appIcons: {},
}));

import { setupWelcomeActions } from '../src/welcome-actions.js';
import { eventBus } from '../src/events.js';
import { openHelpPanel } from '../src/help-popover.js';
import { GUIDE_CIRCUIT, GUIDE_IMPORT } from '../src/help-content.js';

beforeEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
    localStorage.clear();
    eventBus.listeners = {};
    vi.clearAllMocks();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('welcome-actions — choix "discover" / "import"', () => {
    it('clique sur l\'onglet [data-tab="explorer"] (Mes Circuits)', () => {
        const tab = document.createElement('button');
        tab.dataset.tab = 'explorer';
        const clickSpy = vi.fn();
        tab.addEventListener('click', clickSpy);
        document.body.appendChild(tab);

        setupWelcomeActions();
        eventBus.emit('welcome:choice', { choice: 'discover' });
        expect(clickSpy).toHaveBeenCalled();
        vi.advanceTimersByTime(400);
        expect(openHelpPanel).not.toHaveBeenCalled(); // pas de guide pour "discover"
    });

    it('"import" cible aussi l\'onglet Mes Circuits', () => {
        const tab = document.createElement('button');
        tab.dataset.tab = 'explorer';
        const clickSpy = vi.fn();
        tab.addEventListener('click', clickSpy);
        document.body.appendChild(tab);

        setupWelcomeActions();
        eventBus.emit('welcome:choice', { choice: 'import' });
        expect(clickSpy).toHaveBeenCalled();
    });

    it('ne plante pas si l\'onglet est absent', () => {
        setupWelcomeActions();
        expect(() => {
            eventBus.emit('welcome:choice', { choice: 'discover' });
        }).not.toThrow();
    });
});

describe('welcome-actions — choix "create"', () => {
    it('clique l\'onglet circuit ET ouvre le guide « Créer un circuit » (après le fondu)', () => {
        const tab = document.createElement('button');
        tab.dataset.tab = 'circuit';
        const clickSpy = vi.fn();
        tab.addEventListener('click', clickSpy);
        document.body.appendChild(tab);

        setupWelcomeActions();
        eventBus.emit('welcome:choice', { choice: 'create' });
        expect(clickSpy).toHaveBeenCalled();          // onglet activé tout de suite
        expect(openHelpPanel).not.toHaveBeenCalled(); // guide différé

        vi.advanceTimersByTime(400);
        expect(openHelpPanel).toHaveBeenCalledWith(GUIDE_CIRCUIT, null);
    });
});

describe('welcome-actions — choix "photos"', () => {
    it('ouvre le guide d\'import, puis lance #btn-import-photos à la FERMETURE', () => {
        const btn = document.createElement('button');
        btn.id = 'btn-import-photos';
        const clickSpy = vi.fn();
        btn.addEventListener('click', clickSpy);
        document.body.appendChild(btn);

        setupWelcomeActions();
        eventBus.emit('welcome:choice', { choice: 'photos' });
        expect(clickSpy).not.toHaveBeenCalled(); // pas avant le guide

        vi.advanceTimersByTime(400);
        expect(openHelpPanel).toHaveBeenCalledTimes(1);
        const [opts, trigger] = openHelpPanel.mock.calls[0];
        expect(opts.title).toBe(GUIDE_IMPORT.title); // le guide d'import
        expect(trigger).toBeNull();
        expect(typeof opts.onClose).toBe('function');
        expect(clickSpy).not.toHaveBeenCalled(); // toujours pas (guide ouvert)

        opts.onClose();                  // l'utilisateur ferme le guide
        expect(clickSpy).toHaveBeenCalled(); // → le sélecteur de photos se lance
    });

    it('ne plante pas si #btn-import-photos est absent', () => {
        setupWelcomeActions();
        expect(() => {
            eventBus.emit('welcome:choice', { choice: 'photos' });
            vi.advanceTimersByTime(400);
            const opts = openHelpPanel.mock.calls[0]?.[0];
            opts?.onClose?.();
        }).not.toThrow();
    });
});

describe('welcome-actions — choix inconnu', () => {
    it('ne fait rien (no-op gracieux)', () => {
        setupWelcomeActions();
        expect(() => {
            eventBus.emit('welcome:choice', { choice: 'unknown-thing' });
            vi.advanceTimersByTime(400);
        }).not.toThrow();
        expect(openHelpPanel).not.toHaveBeenCalled();
    });
});
