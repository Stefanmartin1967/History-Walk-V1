import { describe, it, expect } from 'vitest';
import { syncStampsFor, newer, mergeHiddenCircuits } from '../src/sync-stamps.js';

// Point 4 des conflits (18/11/2026) : le changement le plus récent gagne.

describe('syncStampsFor (posé à l’écriture d’une fiche)', () => {
    it('Incontournable changé : daté', () => {
        expect(syncStampsFor({ incontournable: true }, { incontournable: false }, 100)).toEqual({ incontournableUpdatedAt: 100 });
    });
    it('valeur inchangée (fiche réécrite entière) : rien', () => {
        expect(syncStampsFor({ incontournable: true, incontournableUpdatedAt: 5 }, { incontournable: true, incontournableUpdatedAt: 5 }, 100)).toBeNull();
        expect(syncStampsFor({}, { incontournable: false }, 100)).toBeNull(); // absent = non
    });
    it('date apportée par la fusion Gist : gardée', () => {
        expect(syncStampsFor({ incontournable: true, incontournableUpdatedAt: 5 }, { incontournable: false, incontournableUpdatedAt: 50 }, 100)).toBeNull();
    });
    it('fiche réécrite entière avec l’ancienne date et une nouvelle valeur : datée maintenant', () => {
        expect(syncStampsFor({ incontournable: true, incontournableUpdatedAt: 5 }, { incontournable: false, incontournableUpdatedAt: 5 }, 100)).toEqual({ incontournableUpdatedAt: 100 });
    });
    it('photos de travail et photos gardées : une date commune', () => {
        expect(syncStampsFor({ workPhotos: ['a'] }, { workPhotos: ['a', 'b'] }, 7)).toEqual({ workPhotosUpdatedAt: 7 });
        expect(syncStampsFor({ keptWorkPhotos: [] }, { keptWorkPhotos: ['a'] }, 8)).toEqual({ workPhotosUpdatedAt: 8 });
    });
    it('champ non synchronisé : rien', () => {
        expect(syncStampsFor({}, { description: 'x' }, 1)).toBeNull();
    });
});

describe('newer', () => {
    it('plus récent gagne ; sans date des deux côtés : null (ancienne règle)', () => {
        expect(newer(10, 20)).toBe('remote');
        expect(newer(20, 10)).toBe('local');
        expect(newer(10, 10)).toBe('local');
        expect(newer(undefined, 3)).toBe('remote');
        expect(newer(3, undefined)).toBe('local');
        expect(newer(undefined, undefined)).toBeNull();
    });
});

describe('mergeHiddenCircuits', () => {
    it('circuit réaffiché sur l’autre appareil, plus tard : réaffiché ici', () => {
        const r = mergeHiddenCircuits({ ids: ['c1', 'c2'], stamps: { c1: 10 } }, { ids: ['c2'], stamps: { c1: 20 } });
        expect(r.ids).toEqual(['c2']);
        expect(r.stamps.c1).toBe(20);
        expect(r.changed).toBe(true);
    });
    it('caché ici plus récemment : reste caché', () => {
        const r = mergeHiddenCircuits({ ids: ['c1'], stamps: { c1: 30 } }, { ids: [], stamps: { c1: 20 } });
        expect(r.ids).toEqual(['c1']);
        expect(r.changed).toBe(false);
    });
    it('sans date des deux côtés : réunion, comme avant', () => {
        const r = mergeHiddenCircuits({ ids: ['c1'], stamps: {} }, { ids: ['c2'], stamps: {} });
        expect(r.ids).toEqual(['c1', 'c2']);
    });
});
