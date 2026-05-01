// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupWelcomeActions } from '../src/welcome-actions.js';
import { eventBus } from '../src/events.js';

beforeEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
    localStorage.clear();
    eventBus.listeners = {};
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
    it('clique sur l\'onglet [data-tab="circuit"]', () => {
        const tab = document.createElement('button');
        tab.dataset.tab = 'circuit';
        const clickSpy = vi.fn();
        tab.addEventListener('click', clickSpy);
        document.body.appendChild(tab);

        setupWelcomeActions();
        eventBus.emit('welcome:choice', { choice: 'create' });
        expect(clickSpy).toHaveBeenCalled();
    });
});

describe('welcome-actions — choix "photos"', () => {
    it('clique sur #btn-import-photos s\'il est présent', () => {
        const btn = document.createElement('button');
        btn.id = 'btn-import-photos';
        const clickSpy = vi.fn();
        btn.addEventListener('click', clickSpy);
        document.body.appendChild(btn);

        setupWelcomeActions();
        eventBus.emit('welcome:choice', { choice: 'photos' });
        expect(clickSpy).toHaveBeenCalled();
    });

    it('ne plante pas si #btn-import-photos est absent', () => {
        setupWelcomeActions();
        expect(() => {
            eventBus.emit('welcome:choice', { choice: 'photos' });
        }).not.toThrow();
    });
});

describe('welcome-actions — choix inconnu', () => {
    it('ne fait rien (no-op gracieux)', () => {
        setupWelcomeActions();
        expect(() => {
            eventBus.emit('welcome:choice', { choice: 'unknown-thing' });
        }).not.toThrow();
    });
});
