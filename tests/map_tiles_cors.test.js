// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll } from 'vitest';

// ============================================================================
// map.js — fonds de carte chargés en CORS
//
// Sans `crossOrigin`, Leaflet crée des <img> sans attribut crossorigin : les
// tuiles arrivent en réponses opaques, que Chrome compte ~7,8 Mo chacune dans
// le stockage du site (2,2 Go constatés le 18/10/2026 pour heripia.com). Le
// cache du service worker (`map-tiles-cors`) n'accepte plus que les réponses
// 200 : une couche sans CORS ne serait plus gardée hors-ligne.
// ============================================================================

const h = vi.hoisted(() => ({ tileLayers: [] }));

// Faux Leaflet « tout-terrain » : tout accès, appel ou `new` renvoie le même
// objet chaînable, ce qui suffit à dérouler initMap. Seul tileLayer est noté.
vi.mock('leaflet', () => {
    const chain = new Proxy(function () {}, {
        get: (_target, key) => (key === 'tileLayer'
            ? (url, options) => { h.tileLayers.push({ url, options }); return chain; }
            : chain),
        apply: () => chain,
        construct: () => chain,
    });
    return { default: chain };
});
vi.mock('leaflet.markercluster', () => ({}));
vi.mock('../src/state.js', () => ({
    state: {},
    setOrthodromicPolyline: vi.fn(),
    setRealTrackPolyline: vi.fn(),
    setGeojsonLayer: vi.fn(),
    setDraggingMarkerId: vi.fn(),
}));
vi.mock('../src/circuit.js', () => ({ addPoiToCircuit: vi.fn(), isCircuitCompleted: vi.fn(() => false) }));
vi.mock('../src/ui-details.js', () => ({ openDetailsPanel: vi.fn() }));
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/data.js', () => ({ getPoiId: vi.fn(), getPatrimonialName: vi.fn() }));
vi.mock('../src/utils.js', () => ({ isCandidate: vi.fn(() => false) }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/database.js', () => ({ saveAppState: vi.fn() }));
vi.mock('../src/poi-icons.js', () => ({ iconMap: {}, getIconHtml: vi.fn(), getIconForFeature: vi.fn() }));
vi.mock('../src/info-popover.js', () => ({ showInfoPopover: vi.fn() }));
vi.mock('../src/circuit-lookup.js', () => ({ getActiveCircuit: vi.fn(() => null), findCircuitById: vi.fn(() => null) }));

import { initMap } from '../src/map.js';

beforeAll(() => {
    // Absents de jsdom, appelés en fin d'initMap.
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = () => 0;
    initMap();
});

describe('map.js — fonds de carte', () => {
    it('crée les quatre fonds de carte (Plan, Satellite, Voyager, Plan FR)', () => {
        expect(h.tileLayers).toHaveLength(4);
    });

    it('les charge tous en CORS', () => {
        for (const { url, options } of h.tileLayers) {
            expect(options.crossOrigin, url).toBe(true);
        }
    });
});
