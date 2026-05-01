// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { ensureSidebarOpen, ensureSidebarCollapsed, isSidebarVisible } from '../src/sidebar-utils.js';

beforeEach(() => {
    document.body.className = '';
    localStorage.clear();
});

describe('ensureSidebarOpen', () => {
    it('retire sidebar-collapsed', () => {
        document.body.classList.add('sidebar-collapsed');
        ensureSidebarOpen();
        expect(document.body.classList.contains('sidebar-collapsed')).toBe(false);
    });

    it('ajoute sidebar-open (compat CSS)', () => {
        ensureSidebarOpen();
        expect(document.body.classList.contains('sidebar-open')).toBe(true);
    });

    it('persiste l\'état "déplié" dans localStorage', () => {
        ensureSidebarOpen();
        expect(localStorage.getItem('sidebar-collapsed')).toBe('0');
    });

    it('idempotent si déjà ouverte', () => {
        ensureSidebarOpen();
        ensureSidebarOpen();
        expect(document.body.classList.contains('sidebar-open')).toBe(true);
        expect(document.body.classList.contains('sidebar-collapsed')).toBe(false);
    });
});

describe('ensureSidebarCollapsed', () => {
    it('ajoute sidebar-collapsed', () => {
        ensureSidebarCollapsed();
        expect(document.body.classList.contains('sidebar-collapsed')).toBe(true);
    });

    it('persiste l\'état "replié" dans localStorage', () => {
        ensureSidebarCollapsed();
        expect(localStorage.getItem('sidebar-collapsed')).toBe('1');
    });
});

describe('isSidebarVisible', () => {
    it('renvoie true si sidebar-collapsed absente', () => {
        expect(isSidebarVisible()).toBe(true);
    });

    it('renvoie false si sidebar-collapsed présente', () => {
        document.body.classList.add('sidebar-collapsed');
        expect(isSidebarVisible()).toBe(false);
    });
});

describe('intégration ensureSidebarOpen / ensureSidebarCollapsed', () => {
    it('toggle ouvert → fermé → ouvert se comporte correctement', () => {
        ensureSidebarOpen();
        expect(isSidebarVisible()).toBe(true);

        ensureSidebarCollapsed();
        expect(isSidebarVisible()).toBe(false);

        ensureSidebarOpen();
        expect(isSidebarVisible()).toBe(true);
        expect(document.body.classList.contains('sidebar-open')).toBe(true);
    });
});
