// Règle unique du tri de « Mes Circuits » (PC et mobile).
// Constat du 10/11/2026 (parcours visiteur, PC) : sans point de départ, le tri
// « Proximité » ne triait rien — le circuit créé par le visiteur restait 25e sur
// 25, sous tous les officiels, alors que le mobile le classait déjà par longueur.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/state.js', () => ({ state: { homeLocation: null } }));

import { state } from '../src/state.js';
import { getEffectiveCircuitSort, getBaseCircuitSort } from '../src/circuit-sort.js';

const HOME = { lat: 33.8, lng: 10.9 };

beforeEach(() => { state.homeLocation = null; });

describe('getEffectiveCircuitSort', () => {
    it('sans point de départ : Proximité se lit Court', () => {
        expect(getEffectiveCircuitSort('proximity_asc')).toBe('dist_asc');
    });

    it('avec un point de départ : Proximité reste Proximité', () => {
        state.homeLocation = { ...HOME };
        expect(getEffectiveCircuitSort('proximity_asc')).toBe('proximity_asc');
    });

    it('les autres tris ne dépendent pas du point de départ', () => {
        for (const sort of ['dist_asc', 'dist_desc', 'verified_first']) {
            expect(getEffectiveCircuitSort(sort)).toBe(sort);
            state.homeLocation = { ...HOME };
            expect(getEffectiveCircuitSort(sort)).toBe(sort);
            state.homeLocation = null;
        }
    });
});

describe('getBaseCircuitSort', () => {
    it('Vérifiés d\'abord part de Court sans point de départ', () => {
        expect(getBaseCircuitSort('verified_first')).toBe('dist_asc');
    });

    it('Vérifiés d\'abord part de Proximité avec un point de départ', () => {
        state.homeLocation = { ...HOME };
        expect(getBaseCircuitSort('verified_first')).toBe('proximity_asc');
    });

    it('un tri simple est demandé tel qu\'il s\'applique', () => {
        expect(getBaseCircuitSort('proximity_asc')).toBe('dist_asc');
        expect(getBaseCircuitSort('dist_desc')).toBe('dist_desc');
    });
});
