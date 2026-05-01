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

describe('welcome-actions — choix "discover"', () => {
    it('replie la sidebar (ajoute classe sidebar-collapsed)', () => {
        setupWelcomeActions();
        eventBus.emit('welcome:choice', { choice: 'discover' });
        expect(document.body.classList.contains('sidebar-collapsed')).toBe(true);
    });

    it('persiste l\'état "replié" dans localStorage', () => {
        setupWelcomeActions();
        eventBus.emit('welcome:choice', { choice: 'discover' });
        expect(localStorage.getItem('sidebar-collapsed')).toBe('1');
    });
});

describe('welcome-actions — choix "create"', () => {
    it('déplie la sidebar (retire classe sidebar-collapsed)', () => {
        document.body.classList.add('sidebar-collapsed');
        setupWelcomeActions();
        eventBus.emit('welcome:choice', { choice: 'create' });
        expect(document.body.classList.contains('sidebar-collapsed')).toBe(false);
    });

    it('persiste l\'état "déplié" dans localStorage', () => {
        setupWelcomeActions();
        eventBus.emit('welcome:choice', { choice: 'create' });
        expect(localStorage.getItem('sidebar-collapsed')).toBe('0');
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

describe('welcome-actions — choix "import"', () => {
    it('déplie la sidebar', () => {
        document.body.classList.add('sidebar-collapsed');
        setupWelcomeActions();
        eventBus.emit('welcome:choice', { choice: 'import' });
        expect(document.body.classList.contains('sidebar-collapsed')).toBe(false);
    });

    it('clique sur #btn-open-my-circuits s\'il est présent (active l\'onglet Mes Circuits)', () => {
        const btn = document.createElement('button');
        btn.id = 'btn-open-my-circuits';
        const clickSpy = vi.fn();
        btn.addEventListener('click', clickSpy);
        document.body.appendChild(btn);

        setupWelcomeActions();
        eventBus.emit('welcome:choice', { choice: 'import' });
        expect(clickSpy).toHaveBeenCalled();
    });

    it('ne plante pas si #btn-open-my-circuits est absent', () => {
        setupWelcomeActions();
        expect(() => {
            eventBus.emit('welcome:choice', { choice: 'import' });
        }).not.toThrow();
    });
});

describe('welcome-actions — choix inconnu', () => {
    it('ne fait rien (no-op gracieux)', () => {
        setupWelcomeActions();
        expect(() => {
            eventBus.emit('welcome:choice', { choice: 'unknown-thing' });
        }).not.toThrow();
        expect(document.body.classList.contains('sidebar-collapsed')).toBe(false);
    });
});
