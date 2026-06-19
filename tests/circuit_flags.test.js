// @vitest-environment jsdom
// Tests pour src/circuit-flags.js — PR 4/5 chantier drapeaux v2.
// Tests minimalistes : on couvre l'API publique (markEditingStart, getDirtyCount,
// teardownAllFlags). syncFlags + ensureFlag dépendent de Leaflet (créer des
// markers réels) — testés visuellement en preview, mockables si besoin futur.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Leaflet : on CAPTURE les handlers (.on) pour pouvoir invoquer le dragend
// en test. Le bug eventBus de #872 vivait dans ce closure, jamais exécuté quand
// .on était un no-op — d'où l'angle mort de la CI (cf. revue 19/06).
vi.mock('leaflet', () => {
    const makeMarker = () => ({
        _handlers: {},
        on(ev, cb) { this._handlers[ev] = cb; return this; },
        setIcon() {},
        getElement() { return null; },
        getLatLng() { return { lat: 33.0005, lng: 10.0005 }; },
        remove() {},
        addTo() { return this; },
    });
    return {
        default: {
            marker: () => makeMarker(),
            polyline: () => ({ addTo() { return this; }, remove() {}, setLatLngs() {} }),
            divIcon: () => ({}),
        },
    };
});
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

describe('circuit-flags — dragend du drapeau en focus (régression import eventBus, PR #872)', () => {
    beforeEach(() => { vi.resetModules(); });

    const buildFeature = (id) => ({
        properties: { HW_ID: id, accessPoint: [10, 33] },
        geometry: { coordinates: [10.001, 33.001] },
    });

    it("le dragend en focus émet 'circuit-flag:moved' SANS ReferenceError (eventBus importé)", async () => {
        const mod = await import('../src/circuit-flags.js');
        const { state } = await import('../src/state.js');
        const { eventBus } = await import('../src/events.js');

        mod._internals.ensureFlag(buildFeature('POI-FOCUS'));
        const entry = mod._internals._flags.get('POI-FOCUS');
        expect(entry, 'le drapeau doit être créé (accessPoint présent, non verrouillé)').toBeTruthy();
        const dragend = entry.marker._handlers.dragend;
        expect(typeof dragend).toBe('function');

        const emitSpy = vi.spyOn(eventBus, 'emit');
        const prev = state.circuitFocusActive;
        state.circuitFocusActive = true;
        try {
            // AVANT #872 (eventBus non importé dans circuit-flags), ceci jetait
            // une ReferenceError au dragend → re-route live mort en silence.
            expect(() => dragend()).not.toThrow();
            expect(emitSpy).toHaveBeenCalledWith('circuit-flag:moved', { poiId: 'POI-FOCUS' });
        } finally {
            state.circuitFocusActive = prev;
            emitSpy.mockRestore();
        }
    });

    it("hors focus, le dragend ne ré-route pas (n'émet pas) et ne jette pas", async () => {
        const mod = await import('../src/circuit-flags.js');
        const { state } = await import('../src/state.js');
        const { eventBus } = await import('../src/events.js');

        mod._internals.ensureFlag(buildFeature('POI-NOFOCUS'));
        const dragend = mod._internals._flags.get('POI-NOFOCUS').marker._handlers.dragend;
        const emitSpy = vi.spyOn(eventBus, 'emit');
        const prev = state.circuitFocusActive;
        state.circuitFocusActive = false;
        try {
            expect(() => dragend()).not.toThrow();
            expect(emitSpy).not.toHaveBeenCalled();
        } finally {
            state.circuitFocusActive = prev;
            emitSpy.mockRestore();
        }
    });
});
