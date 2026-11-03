import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Rejets de candidats regroupés (plan validé par Stefan le 02/11/2026).
//
// Un rejet n'est plus poussé sur-le-champ (un commit et un déploiement par rejet,
// intenable avec les ~3000 candidats de la Wallonie) : il est EN ATTENTE, gardé
// sur l'appareil, et part en un commit à « Tout publier » ou avec la corbeille.
// ============================================================================

const h = vi.hoisted(() => ({ store: {}, push: vi.fn() }));
vi.mock('../src/database.js', () => ({
    getAppState: vi.fn(async (k) => h.store[k] ?? null),
    saveAppState: vi.fn(async (k, v) => { h.store[k] = structuredClone(v); }),
}));
vi.mock('../src/publish-destination.js', () => ({ pushDestinationRejected: h.push }));

import {
    rejectedData, pendingRejected, setRejectedData, addRejected, removeRejected,
    clearRejected, isRejected, pendingRejectedCount,
} from '../src/rejected.js';
import { loadPendingRejected, savePendingRejected, pushRejected } from '../src/rejected-store.js';

const rec = (ref) => ({ osm_ref: ref, name: ref, category: 'Église', lat: 50.4, lng: 4.4, rejectedAt: 0 });

beforeEach(() => {
    clearRejected();
    h.store = {};
    h.push.mockReset();
    h.push.mockResolvedValue({});
});

describe('rejets en attente (rejected.js)', () => {
    it('un rejet est rejeté ET en attente', () => {
        addRejected(rec('node/1'));
        expect(isRejected('node/1')).toBe(true);
        expect(pendingRejectedCount()).toBe(1);
    });

    it('le fichier publié chargé au démarrage garde les rejets en attente', () => {
        addRejected(rec('node/1'));
        setRejectedData({ 'node/9': rec('node/9') });
        expect(Object.keys(rejectedData).sort()).toEqual(['node/1', 'node/9']);
        expect(pendingRejectedCount()).toBe(1);
    });

    it('restaurer retire aussi de l\'attente ; tout vider vide les deux', () => {
        addRejected(rec('node/1'));
        addRejected(rec('node/2'));
        removeRejected('node/1');
        expect(Object.keys(pendingRejected)).toEqual(['node/2']);
        clearRejected();
        expect(Object.keys(rejectedData)).toEqual([]);
        expect(pendingRejectedCount()).toBe(0);
    });
});

describe('garde sur l\'appareil et envoi (rejected-store.js)', () => {
    it('un rejet enregistré survit au rechargement', async () => {
        addRejected(rec('node/1'));
        await savePendingRejected('charleroi');

        clearRejected(); // « rechargement » : mémoire vide
        await loadPendingRejected('charleroi');
        setRejectedData({ 'node/9': rec('node/9') }); // fichier publié
        expect(isRejected('node/1')).toBe(true);
        expect(isRejected('node/9')).toBe(true);
        expect(pendingRejectedCount()).toBe(1);
    });

    it('chaque destination a ses propres rejets en attente', async () => {
        addRejected(rec('node/1'));
        await savePendingRejected('charleroi');
        clearRejected();
        await loadPendingRejected('djerba');
        expect(pendingRejectedCount()).toBe(0);
    });

    it('envoi : le fichier entier en un appel, puis plus rien en attente (aussi sur l\'appareil)', async () => {
        setRejectedData({ 'node/9': rec('node/9') });
        addRejected(rec('node/1'));
        addRejected(rec('node/2'));

        await pushRejected('charleroi');

        expect(h.push).toHaveBeenCalledTimes(1);
        expect(h.push.mock.calls[0][0]).toBe('charleroi');
        expect(Object.keys(h.push.mock.calls[0][1]).sort()).toEqual(['node/1', 'node/2', 'node/9']);
        expect(pendingRejectedCount()).toBe(0);
        expect(h.store.pendingRejected_charleroi).toEqual({});
    });

    it('envoi échoué : les rejets restent en attente, l\'erreur remonte', async () => {
        addRejected(rec('node/1'));
        h.push.mockRejectedValue(new Error('Aucun token GitHub connecté'));
        await expect(pushRejected('charleroi')).rejects.toThrow(/token/);
        expect(pendingRejectedCount()).toBe(1);
    });

    it('un rejet ajouté pendant l\'envoi reste en attente', async () => {
        addRejected(rec('node/1'));
        h.push.mockImplementation(async () => { addRejected(rec('node/2')); });
        await pushRejected('charleroi');
        expect(Object.keys(pendingRejected)).toEqual(['node/2']);
        expect(Object.keys(h.store.pendingRejected_charleroi)).toEqual(['node/2']);
    });
});
