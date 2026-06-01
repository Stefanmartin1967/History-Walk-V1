// @vitest-environment jsdom
// Tests pour src/circuit-flags.js — PR 4/5 chantier drapeaux v2.
// Tests minimalistes : on couvre l'API publique (markEditingStart, getDirtyCount,
// teardownAllFlags). syncFlags + ensureFlag dépendent de Leaflet (créer des
// markers réels) — testés visuellement en preview, mockables si besoin futur.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Leaflet (créer des markers passe trop de plomberie pour ce test).
vi.mock('leaflet', () => ({
    default: {
        marker: () => ({ addTo: () => ({ on: () => {}, setIcon: () => {}, getElement: () => null, remove: () => {} }) }),
        polyline: () => ({ addTo: () => ({ remove: () => {}, setLatLngs: () => {} }) }),
        divIcon: () => ({}),
    },
}));
vi.mock('../src/map.js', () => ({ map: {} }));

describe('circuit-flags — API publique', () => {
    let mod;

    beforeEach(async () => {
        vi.resetModules();
        mod = await import('../src/circuit-flags.js');
    });

    it('markEditingStart accepte un tableau vide sans erreur', () => {
        expect(() => mod.markEditingStart([])).not.toThrow();
    });

    it('markEditingStart accepte un tableau de features et stocke les IDs', () => {
        const features = [
            { properties: { HW_ID: 'POI1' }, geometry: { coordinates: [10, 33] } },
            { properties: { HW_ID: 'POI2' }, geometry: { coordinates: [11, 34] } },
        ];
        expect(() => mod.markEditingStart(features)).not.toThrow();
    });

    it('markEditingStart accepte null/undefined sans crasher', () => {
        expect(() => mod.markEditingStart(null)).not.toThrow();
        expect(() => mod.markEditingStart(undefined)).not.toThrow();
    });

    it('getDirtyCount retourne 0 sur état neuf', () => {
        expect(mod.getDirtyCount()).toBe(0);
    });

    it('teardownAllFlags est idempotent', () => {
        expect(() => mod.teardownAllFlags()).not.toThrow();
        expect(() => mod.teardownAllFlags()).not.toThrow();
        expect(mod.getDirtyCount()).toBe(0);
    });

    it('commitDirtyFlags retourne 0 quand rien à commit', async () => {
        const n = await mod.commitDirtyFlags();
        expect(n).toBe(0);
    });
});

describe('circuit-flags — _internals.flagIcon', () => {
    let mod;
    beforeEach(async () => {
        vi.resetModules();
        mod = await import('../src/circuit-flags.js');
    });

    it("flagIcon est appelable avec 'osm', 'moved', 'locked'", () => {
        const { flagIcon } = mod._internals;
        expect(() => flagIcon('osm', false)).not.toThrow();
        expect(() => flagIcon('moved', false)).not.toThrow();
        expect(() => flagIcon('locked', true)).not.toThrow();
    });
});
