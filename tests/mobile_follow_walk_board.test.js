// @vitest-environment jsdom

// Tableau de marche du suivi mobile (17/11/2026, maquette « Tableau de marche »,
// variante A) : sous le titre, « faits / reste », une barre, le prochain lieu ;
// hors du tracé, l'avertissement et la direction. Les calculs sont testés dans
// walk_progress.test.js ; ici, l'affichage dans la vraie vue de suivi.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const LAT = 50.35, LON = 4.44;

const h = vi.hoisted(() => {
    const chain = new Proxy(function () {}, {
        get: (_t, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : chain),
        apply: () => chain,
    });
    return {
        chain,
        container: null,
        rafs: [],
        polylines: [],
        state: { activeCircuitId: 'C1', currentCircuit: [], loadedFeatures: [], userData: {} },
        circuit: null,
    };
});

vi.mock('leaflet', () => ({
    default: new Proxy({}, {
        get: (_t, prop) => {
            if (prop === 'polyline') return (latlngs, opts) => { h.polylines.push({ latlngs, opts }); return h.chain; };
            if (prop === 'then' || typeof prop === 'symbol') return undefined;
            return () => h.chain;
        },
    }),
}));
vi.mock('../src/map.js', () => ({
    map: new Proxy({}, {
        get: (_t, prop) => {
            if (prop === 'getContainer') return () => h.container;
            if (prop === 'getCenter') return () => ({ lat: LAT, lng: LON });
            if (prop === 'getZoom') return () => 16;
            if (prop === 'getBounds') return () => ({ pad: () => ({ contains: () => true }) });
            if (prop === 'then' || typeof prop === 'symbol') return undefined;
            return () => h.chain;
        },
    }),
    initMap: vi.fn(),
    createHistoryWalkIcon: vi.fn(() => h.chain),
    trackRenderer: vi.fn(() => h.chain),
}));
vi.mock('../src/state.js', () => ({ state: h.state, setActiveCircuitId: vi.fn() }));
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } }));
vi.mock('../src/circuit.js', () => ({ notifyCircuitChanged: vi.fn() }));
vi.mock('../src/data.js', () => ({ updatePoiData: vi.fn(), getPatrimonialName: (f) => f.properties.name }));
vi.mock('../src/database.js', () => ({ getPoiPhotos: vi.fn(async () => []) }));
vi.mock('../src/ui-details.js', () => ({ openDetailsPanel: vi.fn() }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/utils.js', async () => {
    const real = await vi.importActual('../src/utils.js');
    return {
        escapeHtml: (s) => String(s ?? ''),
        getZoneFromCoords: vi.fn(() => 'Nalinnes'),
        getPoiId: (f) => f?.properties?.HW_ID,
        getPoiProp: (f, k) => f?.properties?.[k],
        calculateDistance: real.calculateDistance,
        getAccessPoint: () => null,
    };
});
vi.mock('../src/poi-visibility.js', () => ({ isShownToUser: () => true }));
vi.mock('../src/mobile-state.js', () => ({ pushMobileLevel: vi.fn() }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/circuit-lookup.js', () => ({ getActiveCircuit: () => h.circuit }));
vi.mock('../src/mobile-new-place.js', () => ({ showNewPlaceModal: vi.fn(), createPlaceAt: vi.fn() }));

import { startFollow, stopFollow } from '../src/mobile-follow.js';

let watchSuccess = null;
const fix = (lat, lon) => watchSuccess({ coords: { latitude: lat, longitude: lon } });
const runRafs = () => { const q = h.rafs.splice(0); q.forEach((fn) => fn()); };
const poi = (id, lat, lon, name) => ({ geometry: { coordinates: [lon, lat] }, properties: { HW_ID: id, name } });
const $ = (id) => document.getElementById(id);

beforeAll(() => {
    globalThis.requestAnimationFrame = (fn) => { h.rafs.push(fn); return 0; };
    Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { watchPosition: (ok) => { watchSuccess = ok; return 1; }, clearWatch: vi.fn() },
    });
});

beforeEach(() => {
    document.body.innerHTML = '<div id="map"></div>';
    h.container = document.getElementById('map');
    h.polylines.length = 0;
    // Ligne droite vers l'est (~1,4 km), 3 lieux : départ, milieu, arrivée.
    const track = Array.from({ length: 21 }, (_, i) => [LAT, LON + i * 0.001]);
    h.state.currentCircuit = [
        poi('A', LAT, LON, 'Église Saint-Benoît'),
        poi('B', LAT, LON + 0.01, 'Grotte des Sarrasins'),
        poi('C', LAT, LON + 0.02, 'Église Saint-Nicolas'),
    ];
    h.circuit = { id: 'C1', name: 'Circuit de test', realTrack: track, file: 'x.gpx' };
    startFollow();
    runRafs();
});

afterEach(() => { stopFollow(); });

describe('Tableau de marche', () => {
    it('caché tant qu’aucune position n’est arrivée', () => {
        expect($('follow-walk').hidden).toBe(true);
    });

    it('sur le tracé : faits, reste, barre et prochain lieu numéroté', () => {
        fix(LAT, LON + 0.005); // ~360 m
        expect($('follow-walk').hidden).toBe(false);
        expect($('wb-done').textContent).toBe('360 m');
        expect($('wb-left').textContent).toBe('1,1 km');
        expect($('wb-bar').style.width).toBe('25%');
        expect($('wb-num').textContent).toBe('2');
        expect($('wb-name').textContent).toBe('Grotte des Sarrasins');
        expect($('wb-in').textContent).toBe('360 m');
        expect($('wb-off').hidden).toBe(true);
        expect(h.polylines.some(p => p.opts.className === 'follow-off-line')).toBe(false);
    });

    it('hors du tracé : avertissement, direction, progression figée et pointillé', () => {
        fix(LAT, LON + 0.005);
        fix(LAT - 0.0011, LON + 0.005); // ~120 m au sud
        const board = $('follow-walk');
        expect(board.classList.contains('is-off')).toBe(true);
        expect($('wb-off').hidden).toBe(false);
        expect($('wb-next').hidden).toBe(true);
        expect($('wb-off-m').textContent).toBe('120 m');
        expect($('wb-off-dir').textContent).toBe('le nord');
        expect($('wb-done').textContent).toBe('360 m');
        expect(h.polylines.some(p => p.opts.className === 'follow-off-line')).toBe(true);
    });

    it('au bout : tous les lieux sont passés', () => {
        fix(LAT, LON + 0.005);
        fix(LAT, LON + 0.012);
        fix(LAT, LON + 0.02);
        expect($('wb-next').hidden).toBe(true);
        expect($('wb-end').hidden).toBe(false);
        expect($('wb-left').textContent).toBe('0 m');
    });
});
