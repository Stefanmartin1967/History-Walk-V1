// @vitest-environment jsdom

// Bug du 05/11/2026 (Charleroi, suivi du circuit « Église Saint-Pierre à Maison
// Mattot ») : après l'enregistrement d'une fiche sur le téléphone, la carte du
// suivi portait en plus TOUS les lieux de la destination (refreshMapMarkers,
// peintre PC). Ces icônes n'étaient plus jamais mises à jour sur mobile : lieu en
// double après « Capturer position », et un clic dessus ouvrait la fiche complète
// cachée derrière la carte au lieu de l'aperçu du suivi.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
    // Leaflet factice : tout accès et tout appel renvoient le même objet chaînable.
    const chain = new Proxy(function () {}, {
        get: (_t, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : chain),
        apply: () => chain,
    });
    const state = { geojsonLayer: null, activeFilters: {}, destinations: null, currentCircuit: [] };
    return {
        chain,
        mobile: false,
        state,
        setGeojsonLayer: vi.fn((layer) => { state.geojsonLayer = layer; }),
    };
});

vi.mock('leaflet', () => ({ default: h.chain }));
vi.mock('leaflet.markercluster', () => ({}));
vi.mock('../src/state.js', () => ({
    state: h.state,
    setOrthodromicPolyline: vi.fn(),
    setRealTrackPolyline: vi.fn(),
    setGeojsonLayer: h.setGeojsonLayer,
    setDraggingMarkerId: vi.fn(),
}));
vi.mock('../src/circuit.js', () => ({ addPoiToCircuit: vi.fn(), isCircuitCompleted: vi.fn(() => false) }));
vi.mock('../src/ui-details.js', () => ({ openDetailsPanel: vi.fn() }));
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/data.js', () => ({ getPoiId: (f) => f?.properties?.HW_ID, getPatrimonialName: vi.fn() }));
vi.mock('../src/utils.js', () => ({ isCandidate: vi.fn(() => false) }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/database.js', () => ({ saveAppState: vi.fn(), getAppState: vi.fn(async () => null) }));
vi.mock('../src/poi-icons.js', () => ({ iconMap: {}, getIconHtml: vi.fn(), getIconForFeature: vi.fn() }));
vi.mock('../src/info-popover.js', () => ({ showInfoPopover: vi.fn() }));
vi.mock('../src/circuit-lookup.js', () => ({ getActiveCircuit: vi.fn(() => null), findCircuitById: vi.fn(() => null) }));
vi.mock('../src/network-status.js', () => ({ onNetworkBack: vi.fn() }));
vi.mock('../src/mobile-state.js', () => ({ isMobileView: () => h.mobile }));

import { initMap, refreshMapMarkers, map } from '../src/map.js';

const poi = { type: 'Feature', geometry: { type: 'Point', coordinates: [4.46, 50.41] }, properties: { HW_ID: 'A' } };

beforeAll(() => {
    document.body.innerHTML = '<div id="map"></div>';
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    // Sur mobile, la carte est créée à la demande par le suivi de circuit.
    initMap();
});

beforeEach(() => {
    h.setGeojsonLayer.mockClear();
    h.state.geojsonLayer = null;
});

describe('refreshMapMarkers — la destination ne se peint que sur PC', () => {
    it('la carte existe (créée par le suivi)', () => {
        expect(map).toBeTruthy();
    });

    it('mobile → aucune couche de lieux posée sur la carte du suivi', () => {
        h.mobile = true;
        refreshMapMarkers([poi]);
        expect(h.setGeojsonLayer).not.toHaveBeenCalled();
    });

    it('PC → la couche des lieux est posée comme avant', () => {
        h.mobile = false;
        refreshMapMarkers([poi]);
        expect(h.setGeojsonLayer).toHaveBeenCalledTimes(1);
    });
});
