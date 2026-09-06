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
import { GUIDE_CIRCUIT, GUIDE_IMPORT, HELP_PREPARER } from '../src/help-content.js';

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
    it('enchaîne « Préparer » → « Importer », puis lance #btn-import-photos à la FERMETURE du 2e', () => {
        const btn = document.createElement('button');
        btn.id = 'btn-import-photos';
        const clickSpy = vi.fn();
        btn.addEventListener('click', clickSpy);
        document.body.appendChild(btn);

        setupWelcomeActions();
        eventBus.emit('welcome:choice', { choice: 'photos' });
        expect(clickSpy).not.toHaveBeenCalled(); // pas avant le guide

        // 1er maillon : « Préparer ses photos » (parcours découverte).
        vi.advanceTimersByTime(400);
        expect(openHelpPanel).toHaveBeenCalledTimes(1);
        const [prepOpts, prepTrigger] = openHelpPanel.mock.calls[0];
        expect(prepOpts.title).toBe(HELP_PREPARER.title);
        expect(prepTrigger).toBeNull();
        expect(typeof prepOpts.onClose).toBe('function');
        expect(clickSpy).not.toHaveBeenCalled();

        // 2e maillon : sa fermeture ouvre le guide d'import — et SURTOUT ne
        // lance pas encore le sélecteur (garantie d'origine de ce test).
        prepOpts.onClose();
        expect(openHelpPanel).toHaveBeenCalledTimes(2);
        const [importOpts, importTrigger] = openHelpPanel.mock.calls[1];
        expect(importOpts.title).toBe(GUIDE_IMPORT.title);
        expect(importTrigger).toBeNull();
        expect(typeof importOpts.onClose).toBe('function');
        expect(clickSpy).not.toHaveBeenCalled();

        // 3e maillon : la fermeture du guide d'import lance le sélecteur.
        importOpts.onClose();
        expect(clickSpy).toHaveBeenCalled();
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
