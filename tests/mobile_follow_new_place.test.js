// @vitest-environment jsdom

// Retour terrain Charleroi (05/11/2026) : pendant le suivi, le dock et son (+)
// sont masqués → impossible de créer un lieu sans quitter la carte. Bouton
// « Nouveau lieu » sur la carte du suivi : même fenêtre que le (+) du dock ;
// « Annuler » laisse le suivi intact, « Capturer » ouvre la fiche du nouveau
// lieu et le Back depuis cette fiche relance le suivi (comme « Fiche → »).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
    // Leaflet factice : tout accès et tout appel renvoient le même objet chaînable.
    const chain = new Proxy(function () {}, {
        get: (_t, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : chain),
        apply: () => chain,
    });
    const circuit = { id: 'CIRC-1', name: 'Circuit test', realTrack: [[50.41, 4.44], [50.42, 4.45]] };
    return {
        chain,
        circuit,
        container: null,
        state: { activeCircuitId: 'CIRC-1', currentCircuit: [], loadedFeatures: [], userData: {} },
        showNewPlaceModal: vi.fn(),
        createPlaceAt: vi.fn(() => 7),
        openDetailsPanel: vi.fn(),
        pushMobileLevel: vi.fn(),
        listeners: {},
    };
});

vi.mock('leaflet', () => ({ default: h.chain }));
vi.mock('../src/map.js', () => ({
    map: new Proxy({}, {
        get: (_t, prop) => {
            if (prop === 'getContainer') return () => h.container;
            if (prop === 'getCenter') return () => ({ lat: 50.41, lng: 4.44 });
            if (prop === 'getZoom') return () => 16;
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
vi.mock('../src/data.js', () => ({ updatePoiData: vi.fn(), getPatrimonialName: vi.fn(() => '') }));
vi.mock('../src/database.js', () => ({ getPoiPhotos: vi.fn(async () => []) }));
vi.mock('../src/ui-details.js', () => ({ openDetailsPanel: h.openDetailsPanel }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/utils.js', () => ({
    escapeHtml: (s) => String(s ?? ''),
    getZoneFromCoords: vi.fn(() => ''),
    getPoiId: (f) => f?.properties?.HW_ID,
    getPoiProp: vi.fn(),
}));
vi.mock('../src/mobile-state.js', () => ({ pushMobileLevel: h.pushMobileLevel }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/circuit-lookup.js', () => ({ getActiveCircuit: () => h.circuit }));
vi.mock('../src/mobile-new-place.js', () => ({
    showNewPlaceModal: h.showNewPlaceModal,
    createPlaceAt: h.createPlaceAt,
}));

import { startFollow, stopFollow, isFollowActive, getResumeFollowCircuitId } from '../src/mobile-follow.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
    globalThis.requestAnimationFrame = () => 0;
});

beforeEach(() => {
    document.body.innerHTML = '<div id="map"></div>';
    h.container = document.getElementById('map');
    h.showNewPlaceModal.mockReset();
    h.createPlaceAt.mockClear();
    h.openDetailsPanel.mockClear();
    // Fermeture normale de la fiche du test précédent → efface une reprise en attente.
    h.listeners['details-panel:closed']?.();
    startFollow();
});

afterEach(() => {
    stopFollow();
});

describe('suivi mobile — bouton « Nouveau lieu »', () => {
    it('est présent sur la carte du suivi', () => {
        expect(isFollowActive()).toBe(true);
        expect(document.getElementById('follow-add-place')).not.toBeNull();
    });

    it('« Annuler » : le suivi continue, aucun lieu créé', async () => {
        h.showNewPlaceModal.mockResolvedValue(null);
        document.getElementById('follow-add-place').click();
        await flush();
        expect(h.showNewPlaceModal).toHaveBeenCalledTimes(1);
        expect(h.createPlaceAt).not.toHaveBeenCalled();
        expect(h.openDetailsPanel).not.toHaveBeenCalled();
        expect(isFollowActive()).toBe(true);
        expect(getResumeFollowCircuitId()).toBeNull();
    });

    it('« Capturer » : crée le lieu, ouvre sa fiche et mémorise la reprise du suivi', async () => {
        const position = { latitude: 50.41, longitude: 4.44 };
        h.showNewPlaceModal.mockResolvedValue(position);
        document.getElementById('follow-add-place').click();
        await flush();
        expect(h.createPlaceAt).toHaveBeenCalledWith(position);
        expect(isFollowActive()).toBe(false);
        expect(h.openDetailsPanel).toHaveBeenCalledWith(7);
        expect(getResumeFollowCircuitId()).toBe('CIRC-1');
        expect(document.getElementById('follow-add-place')).toBeNull();
    });

    it('suivi quitté pendant la fenêtre (Back) : fiche ouverte sans reprise', async () => {
        let resolveModal;
        h.showNewPlaceModal.mockReturnValue(new Promise((r) => { resolveModal = r; }));
        document.getElementById('follow-add-place').click();
        stopFollow();
        resolveModal({ latitude: 50.41, longitude: 4.44 });
        await flush();
        expect(h.openDetailsPanel).toHaveBeenCalledWith(7);
        expect(getResumeFollowCircuitId()).toBeNull();
    });
});
