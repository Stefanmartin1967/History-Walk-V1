// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// ============================================================================
// map.js — écouteur window 'circuit:updated'
//
// Régression constatée par Stefan le 13/09/2026 (console) :
//   « Cannot destructure property 'points' of 'e.detail' as it is null ».
// L'ancienne entrée en « Éditer l'itinéraire » (circuit-focus.js, retiré le
// 14/11/2026) émettait 'circuit:updated' SANS detail pour rafraîchir le panneau ;
// l'écouteur de map.js déstructurait `e.detail` et levait une TypeError (depuis
// #785, 07/06/2026). Plus personne ne l'émet ainsi, le garde reste : un signal
// sans données doit être IGNORÉ, sans redessiner la ligne globale.
// ============================================================================

const h = vi.hoisted(() => ({
    state: {
        currentCircuit: [],
        orthodromicPolyline: null,
        realTrackPolyline: null,
        routeBasisKey: null,
    },
    findCircuitById: vi.fn(() => null),
}));

vi.mock('leaflet', () => ({ default: {} }));
vi.mock('leaflet.markercluster', () => ({}));
vi.mock('../src/state.js', () => ({
    state: h.state,
    setOrthodromicPolyline: vi.fn(),
    setRealTrackPolyline: vi.fn(),
    setGeojsonLayer: vi.fn(),
    setDraggingMarkerId: vi.fn(),
}));
vi.mock('../src/circuit.js', () => ({ addPoiToCircuit: vi.fn(), isCircuitCompleted: vi.fn(() => false) }));
vi.mock('../src/ui-details.js', () => ({ openDetailsPanel: vi.fn() }));
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/data.js', () => ({ getPoiId: (f) => f?.properties?.HW_ID, getPatrimonialName: vi.fn() }));
vi.mock('../src/utils.js', () => ({ isCandidate: vi.fn(() => false) }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/database.js', () => ({ saveAppState: vi.fn() }));
vi.mock('../src/poi-icons.js', () => ({ iconMap: {}, getIconHtml: vi.fn(), getIconForFeature: vi.fn() }));
vi.mock('../src/info-popover.js', () => ({ showInfoPopover: vi.fn() }));
vi.mock('../src/circuit-lookup.js', () => ({ getActiveCircuit: vi.fn(() => null), findCircuitById: h.findCircuitById }));

import { initMapListeners } from '../src/map.js';

// jsdom ne propage pas une exception levée dans un écouteur jusqu'à
// dispatchEvent : il la signale par un événement 'error' sur window.
let errors = [];
const onError = (ev) => { errors.push(ev.error || ev.message); ev.preventDefault(); };

beforeAll(() => {
    initMapListeners();
});

beforeEach(() => {
    errors = [];
    h.findCircuitById.mockClear();
    window.addEventListener('error', onError);
});

afterEach(() => {
    window.removeEventListener('error', onError);
});

describe("map.js — 'circuit:updated'", () => {
    it("ignore un signal SANS detail sans lever d'erreur", () => {
        window.dispatchEvent(new CustomEvent('circuit:updated'));

        expect(errors).toEqual([]);
        // Ignoré : aucune résolution de circuit, donc aucun redessin.
        expect(h.findCircuitById).not.toHaveBeenCalled();
    });

    it('traite toujours un signal normal (avec detail)', () => {
        window.dispatchEvent(new CustomEvent('circuit:updated', {
            detail: { points: [], activeId: null },
        }));

        expect(errors).toEqual([]);
    });
});
