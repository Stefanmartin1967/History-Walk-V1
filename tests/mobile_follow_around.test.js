// @vitest-environment jsdom

// « Autour de moi » (08/11/2026) : la carte du suivi, ouverte sans circuit par le
// bouton « Carte » du dock. Pas de tracé ni de flèches ; seuls les lieux de la
// zone visible sont posés (plafond AROUND_MAX_MARKERS, au-delà invite à zoomer) ;
// l'aperçu donne la distance au lieu de l'étape ; le Back depuis une fiche ouverte
// sur cette carte la rouvre.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
    // Leaflet factice : tout accès et tout appel renvoient le même objet chaînable.
    const chain = new Proxy(function () {}, {
        get: (_t, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : chain),
        apply: () => chain,
    });
    return {
        chain,
        container: null,
        rafs: [],
        markers: [],
        mapHandlers: {},
        // Zone visible factice : un carré autour de Mellet.
        bounds: { minLat: 50.50, maxLat: 50.51, minLng: 4.47, maxLng: 4.49 },
        state: { activeCircuitId: null, currentCircuit: [], loadedFeatures: [], userData: {} },
        showNewPlaceModal: vi.fn(),
        createPlaceAt: vi.fn(() => 7),
        openDetailsPanel: vi.fn(),
        pushMobileLevel: vi.fn(),
        listeners: {},
        shown: vi.fn(() => true),
    };
});

function fakeMarker(latlng, opts) {
    const handlers = {};
    const m = {
        latlng, opts, removed: false,
        on: (evt, fn) => { handlers[evt] = fn; return m; },
        addTo: () => { h.markers.push(m); return m; },
        remove: () => { m.removed = true; },
        getElement: () => null,
        click: () => handlers.click?.(),
    };
    return m;
}

vi.mock('leaflet', () => ({
    default: new Proxy({}, {
        get: (_t, prop) => {
            if (prop === 'marker') return fakeMarker;
            if (prop === 'then' || typeof prop === 'symbol') return undefined;
            return () => h.chain;
        },
    }),
}));
vi.mock('../src/map.js', () => ({
    map: new Proxy({}, {
        get: (_t, prop) => {
            if (prop === 'getContainer') return () => h.container;
            if (prop === 'getCenter') return () => ({ lat: 50.505, lng: 4.48 });
            if (prop === 'getZoom') return () => 16;
            if (prop === 'on') return (evt, fn) => { h.mapHandlers[evt] = fn; };
            if (prop === 'off') return (evt) => { delete h.mapHandlers[evt]; };
            if (prop === 'getBounds') return () => ({
                pad: () => ({
                    contains: ([lat, lng]) => lat >= h.bounds.minLat && lat <= h.bounds.maxLat
                        && lng >= h.bounds.minLng && lng <= h.bounds.maxLng,
                }),
            });
            if (prop === 'then' || typeof prop === 'symbol') return undefined;
            return () => h.chain;
        },
    }),
    initMap: vi.fn(),
    createHistoryWalkIcon: vi.fn(() => h.chain),
}));
vi.mock('../src/state.js', () => ({ state: h.state, setActiveCircuitId: vi.fn() }));
vi.mock('../src/events.js', () => ({
    eventBus: { on: (evt, fn) => { h.listeners[evt] = fn; }, emit: vi.fn(), off: vi.fn() },
}));
vi.mock('../src/circuit.js', () => ({ notifyCircuitChanged: vi.fn() }));
vi.mock('../src/data.js', () => ({ updatePoiData: vi.fn(), getPatrimonialName: vi.fn((f) => f.properties.name) }));
vi.mock('../src/database.js', () => ({ getPoiPhotos: vi.fn(async () => []) }));
vi.mock('../src/ui-details.js', () => ({ openDetailsPanel: h.openDetailsPanel }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/utils.js', async () => {
    const real = await vi.importActual('../src/utils.js');
    return {
        escapeHtml: (s) => String(s ?? ''),
        getZoneFromCoords: vi.fn(() => 'Mellet'),
        getPoiId: (f) => f?.properties?.HW_ID,
        getPoiProp: (f, k) => f?.properties?.[k],
        calculateDistance: real.calculateDistance,
    };
});
vi.mock('../src/poi-visibility.js', () => ({ isShownToUser: h.shown }));
vi.mock('../src/mobile-state.js', () => ({ pushMobileLevel: h.pushMobileLevel }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/circuit-lookup.js', () => ({ getActiveCircuit: () => null }));
vi.mock('../src/mobile-new-place.js', () => ({
    showNewPlaceModal: h.showNewPlaceModal,
    createPlaceAt: h.createPlaceAt,
}));

import {
    startAroundMe, stopFollow, isFollowActive, getResumeFollow, followBack,
} from '../src/mobile-follow.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const runRafs = () => { const q = h.rafs.splice(0); q.forEach((fn) => fn()); };
const poi = (id, lat, lng, extra = {}) => ({
    geometry: { coordinates: [lng, lat] },
    properties: { HW_ID: id, name: `Lieu ${id}`, 'Catégorie': 'Chapelle', ...extra },
});
const liveMarkers = () => h.markers.filter((m) => !m.removed);

let watchSuccess = null;

beforeAll(() => {
    globalThis.requestAnimationFrame = (fn) => { h.rafs.push(fn); return 0; };
    Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
            watchPosition: (ok) => { watchSuccess = ok; return 1; },
            clearWatch: vi.fn(),
        },
    });
});

beforeEach(() => {
    document.body.innerHTML = '<div id="map"></div>';
    h.container = document.getElementById('map');
    h.rafs.length = 0;
    h.markers.length = 0;
    h.shown.mockImplementation(() => true);
    h.openDetailsPanel.mockClear();
    h.pushMobileLevel.mockClear();
    h.state.loadedFeatures = [
        poi('A', 50.505, 4.480),            // dans la zone visible
        poi('B', 50.506, 4.485),            // dans la zone visible
        poi('FAR', 50.60, 4.60),            // hors zone
    ];
    h.listeners['details-panel:closed']?.();
    startAroundMe();
    runRafs();
});

afterEach(() => {
    stopFollow();
});

describe('Autour de moi — ouverture', () => {
    it('ouvre la carte plein écran avec le titre « Autour de moi »', () => {
        expect(isFollowActive()).toBe(true);
        expect(document.body.classList.contains('follow-active')).toBe(true);
        expect(document.body.classList.contains('follow-around')).toBe(true);
        expect(document.querySelector('.follow-title').textContent).toBe('Autour de moi');
        expect(h.pushMobileLevel).toHaveBeenCalledWith('follow');
    });

    it('ne pose que les lieux de la zone visible', () => {
        const ids = liveMarkers().map((m) => m.opts.title);
        expect(ids).toEqual(['Lieu A', 'Lieu B']);
    });

    it('écarte les lieux que l\'utilisateur ne voit pas (supprimés, à confirmer)', () => {
        stopFollow();
        h.markers.length = 0;
        h.shown.mockImplementation((f) => f.properties.HW_ID !== 'B');
        startAroundMe();
        runRafs();
        expect(liveMarkers().map((m) => m.opts.title)).toEqual(['Lieu A']);
    });

    it('la fermeture retire la classe et remet le mode suivi par défaut', () => {
        followBack();
        expect(isFollowActive()).toBe(false);
        expect(document.body.classList.contains('follow-around')).toBe(false);
    });
});

describe('Autour de moi — déplacements', () => {
    it('retire les lieux sortis de la zone et ajoute les nouveaux', () => {
        h.bounds = { minLat: 50.59, maxLat: 50.61, minLng: 4.59, maxLng: 4.61 };
        h.mapHandlers.moveend();
        expect(liveMarkers().map((m) => m.opts.title)).toEqual(['Lieu FAR']);
        h.bounds = { minLat: 50.50, maxLat: 50.51, minLng: 4.47, maxLng: 4.49 };
    });

    it('trop de lieux à l\'écran : aucun marqueur, invite à zoomer', () => {
        h.state.loadedFeatures = Array.from({ length: 301 }, (_, i) => poi(`P${i}`, 50.505, 4.48));
        h.mapHandlers.moveend();
        expect(liveMarkers()).toHaveLength(0);
        expect(document.getElementById('follow-zoom-hint').hidden).toBe(false);
    });
});

describe('Autour de moi — aperçu et fiche', () => {
    it('l\'aperçu affiche la distance depuis la position GPS', () => {
        watchSuccess({ coords: { latitude: 50.505, longitude: 4.480 } });
        liveMarkers().find((m) => m.opts.title === 'Lieu B').click();
        const eyebrow = document.querySelector('.pv-eyebrow').textContent;
        expect(eyebrow).toMatch(/^À \d+ M · CHAPELLE$/);
    });

    it('sans position : la catégorie seule, sans « ÉTAPE »', () => {
        liveMarkers().find((m) => m.opts.title === 'Lieu A').click();
        expect(document.querySelector('.pv-eyebrow').textContent).toBe('CHAPELLE');
    });

    it('la zone de la position s\'inscrit dans l\'en-tête au 1er fix', () => {
        watchSuccess({ coords: { latitude: 50.505, longitude: 4.480 } });
        expect(document.getElementById('follow-eyebrow').textContent).toContain('CARTE · MELLET');
    });

    it('« Fiche → » mémorise la reprise de la carte Autour de moi', () => {
        h.state.loadedFeatures = [poi('A', 50.505, 4.480)];
        liveMarkers().find((m) => m.opts.title === 'Lieu A').click();
        document.getElementById('pv-fiche').click();
        expect(isFollowActive()).toBe(false);
        expect(h.openDetailsPanel).toHaveBeenCalled();
        expect(getResumeFollow()).toEqual({ mode: 'around', circuitId: null });
    });

    it('« Nouveau lieu » → fiche, avec reprise de la carte Autour de moi', async () => {
        h.showNewPlaceModal.mockResolvedValue({ latitude: 50.505, longitude: 4.48 });
        document.getElementById('follow-add-place').click();
        await flush();
        expect(h.openDetailsPanel).toHaveBeenCalledWith(7);
        expect(getResumeFollow()).toEqual({ mode: 'around', circuitId: null });
    });
});
