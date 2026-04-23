// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// mobile-state.js : module "couche zéro" sans dépendance, uniquement
// getters/setters + 3 utilitaires (isMobileView, animateContainer,
// pushMobileLevel). Tests directs, pas de mock de module.

import {
    getCurrentView, setCurrentView,
    getMobileSort, setMobileSort,
    getMobileCurrentPage, setMobileCurrentPage,
    getAllCircuitsOrdered, setAllCircuitsOrdered,
    isMobileView,
    animateContainer,
    pushMobileLevel
} from '../src/mobile-state.js';

function setInnerWidth(w) {
    // jsdom expose innerWidth comme propriété settable — assignation directe
    window.innerWidth = w;
}

describe('mobile-state', () => {
    describe('Getters/Setters', () => {
        it('currentView : roundtrip set/get', () => {
            setCurrentView('circuits');
            expect(getCurrentView()).toBe('circuits');
            setCurrentView('poi');
            expect(getCurrentView()).toBe('poi');
        });

        it('mobileSort : roundtrip', () => {
            setMobileSort('proximity_asc');
            expect(getMobileSort()).toBe('proximity_asc');
            setMobileSort('dist_desc');
            expect(getMobileSort()).toBe('dist_desc');
        });

        it('mobileCurrentPage : roundtrip', () => {
            setMobileCurrentPage(1);
            expect(getMobileCurrentPage()).toBe(1);
            setMobileCurrentPage(5);
            expect(getMobileCurrentPage()).toBe(5);
        });

        it('allCircuitsOrdered : set/get retourne la même référence', () => {
            const arr = [{ id: 'c1' }, { id: 'c2' }];
            setAllCircuitsOrdered(arr);
            expect(getAllCircuitsOrdered()).toBe(arr);
            setAllCircuitsOrdered([]);
            expect(getAllCircuitsOrdered()).toEqual([]);
        });
    });

    describe('isMobileView', () => {
        it('innerWidth = 500 → true', () => {
            setInnerWidth(500);
            expect(isMobileView()).toBe(true);
        });

        it('innerWidth = 768 → true (borne incluse)', () => {
            setInnerWidth(768);
            expect(isMobileView()).toBe(true);
        });

        it('innerWidth = 1024 → false (desktop)', () => {
            setInnerWidth(1024);
            expect(isMobileView()).toBe(false);
        });
    });

    describe('animateContainer', () => {
        it('retire puis ajoute la classe view-enter (ordre correct)', () => {
            const el = document.createElement('div');
            el.classList.add('view-enter');
            const removeSpy = vi.spyOn(el.classList, 'remove');
            const addSpy = vi.spyOn(el.classList, 'add');

            animateContainer(el);

            expect(removeSpy).toHaveBeenCalledWith('view-enter');
            expect(addSpy).toHaveBeenCalledWith('view-enter');
            // État final : la classe est présente
            expect(el.classList.contains('view-enter')).toBe(true);
            // remove appelé AVANT add (offsetWidth entre les deux force le reflow)
            expect(removeSpy.mock.invocationCallOrder[0])
                .toBeLessThan(addSpy.mock.invocationCallOrder[0]);
        });

        it('ne crash pas si la classe n\'est pas présente au départ', () => {
            const el = document.createElement('div');
            expect(() => animateContainer(el)).not.toThrow();
            expect(el.classList.contains('view-enter')).toBe(true);
        });
    });

    describe('pushMobileLevel', () => {
        let pushStateSpy;

        beforeEach(() => {
            setInnerWidth(500); // mobile par défaut
            pushStateSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
            // Reset l'URL à la racine (sans hash)
            window.history.replaceState(null, '', window.location.pathname);
        });

        afterEach(() => {
            pushStateSpy.mockRestore();
        });

        it('ne fait rien si non-mobile (innerWidth > 768)', () => {
            setInnerWidth(1024);
            pushMobileLevel('c');
            expect(pushStateSpy).not.toHaveBeenCalled();
        });

        it('ne repush pas si le hash courant est déjà la cible', () => {
            window.history.replaceState(null, '', '#c');
            pushMobileLevel('c');
            expect(pushStateSpy).not.toHaveBeenCalled();
        });

        it('push avec hash et state { hwLevel: <level> }', () => {
            pushMobileLevel('p');
            expect(pushStateSpy).toHaveBeenCalledTimes(1);
            const [state, , url] = pushStateSpy.mock.calls[0];
            expect(state).toEqual({ hwLevel: 'p' });
            expect(url).toBe('#p');
        });

        it('catch et warn si pushState throw (aucun crash)', () => {
            pushStateSpy.mockImplementation(() => { throw new Error('quota'); });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            expect(() => pushMobileLevel('c')).not.toThrow();
            expect(warnSpy).toHaveBeenCalled();

            warnSpy.mockRestore();
        });
    });
});
