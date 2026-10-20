// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ============================================================================
// map.js — tuiles grises redemandées au retour du réseau
//
// Une tuile demandée hors-ligne (zone jamais vue) reste grise : Leaflet 1.9 ne
// redemande une tuile en erreur qu'au changement de zoom. Mesuré le 19/10/2026 :
// 16 tuiles grises, toujours là au retour du réseau, revenues après un zoom.
// À l'événement 'online', le fond affiché est retiré puis remis (tuiles recréées)
// s'il a des tuiles en erreur ; une carte complète n'est pas touchée. Jamais
// layer.redraw() : Leaflet 1.9.4 y garde le zoom fractionnaire de la carte
// (zoomSnap 0,1) → adresses de tuiles invalides (mesuré le 20/10/2026).
// ============================================================================

const h = vi.hoisted(() => ({ layers: [], onMap: new Set(), removed: [] }));

// Faux Leaflet : tout accès renvoie un objet chaînable, sauf les fonds de carte
// (objets distincts, avec un vrai conteneur DOM), `map.hasLayer` et
// `map.removeLayer`.
vi.mock('leaflet', () => {
    const chain = new Proxy(function () {}, {
        get: (_target, key) => {
            if (key === 'tileLayer') {
                return (url) => {
                    const layer = {
                        url,
                        container: document.createElement('div'),
                        redraw: vi.fn(),
                        addTo() { h.onMap.add(layer); return layer; },
                        getContainer() { return layer.container; },
                    };
                    h.layers.push(layer);
                    return layer;
                };
            }
            if (key === 'hasLayer') return (layer) => h.onMap.has(layer);
            if (key === 'removeLayer') return (layer) => { h.removed.push(layer); h.onMap.delete(layer); };
            return chain;
        },
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

// Tuile Leaflet : <img class="leaflet-tile">, chargée (largeur > 0) ou en erreur.
function addTile(layer, { loaded }) {
    const img = document.createElement('img');
    img.className = 'leaflet-tile';
    Object.defineProperty(img, 'complete', { value: true });
    Object.defineProperty(img, 'naturalWidth', { value: loaded ? 256 : 0 });
    layer.container.appendChild(img);
}

const voyager = () => h.layers.find((l) => l.url.includes('cartocdn'));
const plan = () => h.layers.find((l) => l.url.includes('tile.openstreetmap.org'));

beforeAll(() => {
    // Absents de jsdom, appelés en fin d'initMap.
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = () => 0;
    initMap();
});

beforeEach(() => {
    for (const layer of h.layers) {
        layer.container.replaceChildren();
        layer.redraw.mockClear();
    }
    h.removed.length = 0;
});

describe('map.js — tuiles grises au retour du réseau', () => {
    it('Voyager est le fond affiché au départ', () => {
        expect(h.onMap.has(voyager())).toBe(true);
        expect(h.onMap.has(plan())).toBe(false);
    });

    it('recrée les tuiles du fond affiché qui en a en erreur (retiré puis remis)', () => {
        addTile(voyager(), { loaded: true });
        addTile(voyager(), { loaded: false });

        window.dispatchEvent(new Event('online'));

        expect(h.removed).toEqual([voyager()]);
        expect(h.onMap.has(voyager())).toBe(true);
        expect(voyager().redraw).not.toHaveBeenCalled();
    });

    it("ne touche pas une carte complète (pas de clignotement)", () => {
        addTile(voyager(), { loaded: true });
        addTile(voyager(), { loaded: true });

        window.dispatchEvent(new Event('online'));

        expect(h.removed).toEqual([]);
    });

    it("ignore un fond qui n'est pas affiché", () => {
        addTile(voyager(), { loaded: true });
        addTile(plan(), { loaded: false });

        window.dispatchEvent(new Event('online'));

        expect(h.removed).toEqual([]);
        expect(h.onMap.has(voyager())).toBe(true);
    });
});
