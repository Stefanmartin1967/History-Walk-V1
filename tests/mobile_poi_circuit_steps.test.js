// @vitest-environment jsdom

// Bug du 05/11/2026 (Charleroi, suivi du circuit « Église Saint-Pierre à Maison
// Mattot ») : après avoir coché « Visité » dans la fiche d'une étape, l'écran du
// circuit affichait « MARCINELLE · 2468 LIEUX » et toute la destination comme
// étapes. applyFilters → data:filtered passait la liste filtrée de la destination
// à renderMobilePoiList, qui la prenait pour les étapes du circuit actif, et
// remplaçait au passage la fiche ouverte.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    state: {
        activeCircuitId: null,
        currentFeatureId: null,
        currentCircuit: [],
        loadedFeatures: [],
        officialCircuits: [],
        hiddenCircuitIds: [],
        currentMapId: 'charleroi',
        isAdmin: false,
    },
    view: 'circuit-details',
    circuit: null,
}));

const poi = (id, name, lng = 4.44, lat = 50.41) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { HW_ID: id, 'Nom du site FR': name, 'Catégorie': 'Église' },
});

vi.mock('../src/state.js', () => ({ state: h.state }));
vi.mock('../src/data.js', () => ({
    getPoiId: (f) => f.properties.HW_ID,
    getPatrimonialName: (f) => f.properties['Nom du site FR'],
    updatePoiCoordinates: vi.fn(),
    applyFilters: vi.fn(),
    isCategoryInName: () => true,
}));
vi.mock('../src/poi-icons.js', () => ({ getStepCategoryDisplay: () => ({ label: '' }) }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/utils.js', () => ({
    escapeHtml: (s) => String(s ?? ''),
    getZoneFromCoords: (lat) => (lat > 50.40 ? 'Montignies-sur-Sambre' : 'Marcinelle'),
    getOrthodromicDistance: () => 6400,
    getRealDistance: () => 6400,
    getPoiProp: () => false,
}));
vi.mock('../src/ui-details.js', () => ({ openDetailsPanel: vi.fn() }));
vi.mock('../src/ui-circuit-editor.js', () => ({ generateCircuitQR: vi.fn() }));
vi.mock('../src/circuit.js', () => ({
    clearCircuit: vi.fn(),
    isCircuitCompleted: () => false,
    isCircuitTested: () => false,
    loadCircuitById: vi.fn(),
    openCircuitGallery: vi.fn(),
}));
vi.mock('../src/circuit-actions.js', () => ({ handleCircuitVisitedToggle: vi.fn(), setCircuitHidden: vi.fn() }));
vi.mock('../src/mobile-follow.js', () => ({ startFollow: vi.fn(), circuitHasTrace: () => true }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/mobile-state.js', () => ({
    animateContainer: vi.fn(),
    getCurrentView: () => h.view,
    getAllCircuitsOrdered: () => [],
    setMobileHeaderSlot: vi.fn(),
    setMobileViewFooter: vi.fn(),
}));
vi.mock('../src/mobile-nav.js', () => ({ switchMobileView: vi.fn() }));
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn() } }));
vi.mock('../src/database.js', () => ({ getPoiPhotos: vi.fn(async () => []), getPendingAdminPhotos: vi.fn(async () => []) }));
vi.mock('../src/circuit-lookup.js', () => ({ getActiveCircuit: () => h.circuit }));
vi.mock('../src/circuit-description.js', () => ({ stripCircuitSignature: (s) => s || '' }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn() }));
vi.mock('../src/access-point.js', () => ({ setAccessPointAt: vi.fn() }));

import { renderMobilePoiList, refreshMobileCircuitDetails } from '../src/mobile-poi.js';

// 3 étapes à Montignies-sur-Sambre, et une « destination » de 5 lieux qui
// commence ailleurs (Marcinelle), comme la liste filtrée de Charleroi.
const steps = [poi('A', 'Église Saint-Pierre'), poi('B', 'Musée des Beaux-Arts'), poi('C', 'Maison Mattot')];
const destination = [poi('X', 'Le Bois du Cazier', 4.45, 50.39), poi('Y', 'Monument aux martyrs', 4.45, 50.39), ...steps];

const container = () => document.getElementById('mobile-main-container');
const stepNames = () => [...container().querySelectorAll('.cartel-step-name')].map(e => e.textContent);
const eyebrow = () => container().querySelector('.cc-eyebrow')?.textContent.replace(/\s+/g, ' ').trim();

beforeEach(() => {
    document.body.innerHTML = '<div id="mobile-header-slot"></div><div id="mobile-main-container"></div><div id="mobile-view-footer"></div>';
    h.view = 'circuit-details';
    h.circuit = { id: 'circ-1', name: 'Circuit de Église Saint-Pierre à Maison Mattot', isOfficial: true, realTrack: [[0, 0]] };
    Object.assign(h.state, {
        activeCircuitId: 'circ-1',
        currentFeatureId: null,
        currentCircuit: steps,
        loadedFeatures: destination,
    });
});

describe('détail du circuit mobile — les étapes viennent du circuit', () => {
    it('reçoit la liste de toute la destination → affiche quand même les étapes du circuit', () => {
        renderMobilePoiList(destination);
        expect(stepNames()).toEqual(['Église Saint-Pierre', 'Musée des Beaux-Arts', 'Maison Mattot']);
        expect(eyebrow()).toContain('MONTIGNIES-SUR-SAMBRE');
        expect(eyebrow()).toContain('3 LIEUX');
        expect(eyebrow()).not.toContain('MARCINELLE');
    });

    it('sans circuit actif → la liste reçue est affichée telle quelle (mode simple)', () => {
        h.state.activeCircuitId = null;
        renderMobilePoiList(destination);
        expect(stepNames()).toHaveLength(destination.length);
    });
});

describe('refreshMobileCircuitDetails — ne repeint que le détail du circuit affiché', () => {
    it('détail du circuit affiché → re-rendu avec ses étapes', () => {
        refreshMobileCircuitDetails();
        expect(stepNames()).toEqual(['Église Saint-Pierre', 'Musée des Beaux-Arts', 'Maison Mattot']);
    });

    it('fiche d\'une étape ouverte (« Visité » coché) → la fiche n\'est pas remplacée', () => {
        h.state.currentFeatureId = 2;
        container().innerHTML = '<div id="fiche">fiche ouverte</div>';
        refreshMobileCircuitDetails();
        expect(container().querySelector('#fiche')).not.toBeNull();
    });

    it.each(['add-poi', 'search', 'actions', 'circuits'])('écran « %s » → rien n\'est remplacé', (view) => {
        h.view = view;
        container().innerHTML = '<div id="ecran">écran courant</div>';
        refreshMobileCircuitDetails();
        expect(container().querySelector('#ecran')).not.toBeNull();
    });

    it('aucun circuit actif → rien n\'est remplacé', () => {
        h.state.activeCircuitId = null;
        container().innerHTML = '<div id="ecran">écran courant</div>';
        refreshMobileCircuitDetails();
        expect(container().querySelector('#ecran')).not.toBeNull();
    });
});
