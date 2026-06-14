// @vitest-environment jsdom
// (jsdom requis : start-point.js importe search.js → patrimonial-names.js, qui
// touche document.documentElement au chargement du module.)
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Dépendances DOM / IndexedDB / icônes mockées : on ne teste ici que la
// logique pure (extraction des coordonnées + libellé), pas la modale.
vi.mock('../src/database.js', () => ({ saveAppState: vi.fn() }));
vi.mock('../src/modal.js', () => ({ openHwModal: vi.fn(), closeHwModal: vi.fn() }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/data.js', () => ({
    getPoiName: (f) => f?.properties?.Nom || 'Sans nom',
    getPoiId: (f) => f?.properties?.HW_ID,
    // Nom « affiché » mocké : préfixe distinctif pour vérifier que le libellé est
    // bien résolu à la volée (et non figé depuis label).
    getPatrimonialName: (f) => 'AFF:' + (f?.properties?.Nom || ''),
}));

import { buildHomeFromFeature, getStartPointLabel } from '../src/start-point.js';
import { state } from '../src/state.js';

const poi = (nom, lng, lat) => ({
    type: 'Feature',
    properties: { Nom: nom, HW_ID: 'x' },
    geometry: { type: 'Point', coordinates: [lng, lat] },
});

describe('start-point — buildHomeFromFeature', () => {
    it('remet les coordonnées GeoJSON [lng,lat] dans l\'ordre {lat,lng} + stocke poiId', () => {
        const home = buildHomeFromFeature(poi('Borj El Kébir', 10.8413, 33.8762));
        expect(home).toMatchObject({ lat: 33.8762, lng: 10.8413, label: 'Borj El Kébir', poiId: 'x' });
        expect(typeof home.savedAt).toBe('number');
    });

    it('renvoie null si la géométrie est absente', () => {
        expect(buildHomeFromFeature({ properties: { Nom: 'X' } })).toBeNull();
    });

    it('renvoie null si les coordonnées sont incomplètes', () => {
        expect(buildHomeFromFeature({ geometry: { coordinates: [10.8] } })).toBeNull();
    });

    it('renvoie null si les coordonnées ne sont pas numériques', () => {
        expect(buildHomeFromFeature({ geometry: { coordinates: ['a', 'b'] } })).toBeNull();
    });
});

describe('start-point — getStartPointLabel', () => {
    beforeEach(() => { state.homeLocation = null; state.loadedFeatures = []; });

    it('point GPS (sans poiId) : renvoie le libellé figé', () => {
        state.homeLocation = { lat: 1, lng: 2, label: 'Ma position' };
        expect(getStartPointLabel()).toBe('Ma position');
    });

    it('point POI : résout le nom à la volée (suit la langue affichée)', () => {
        const f = poi('Borj El Kébir', 10.8, 33.8); // HW_ID 'x'
        state.loadedFeatures = [f];
        state.homeLocation = { lat: 33.8, lng: 10.8, poiId: 'x', label: 'Borj El Kébir' };
        // getPatrimonialName mocké → préfixe 'AFF:' : prouve qu'on ne lit PAS label.
        expect(getStartPointLabel()).toBe('AFF:Borj El Kébir');
    });

    it('point POI absent de loadedFeatures : repli sur le libellé figé', () => {
        state.loadedFeatures = [];
        state.homeLocation = { lat: 1, lng: 2, poiId: 'disparu', label: 'Ancien lieu' };
        expect(getStartPointLabel()).toBe('Ancien lieu');
    });

    it('renvoie null sans point défini', () => {
        state.homeLocation = null;
        expect(getStartPointLabel()).toBeNull();
    });

    it('renvoie null si le point n\'a ni poiId ni libellé', () => {
        state.homeLocation = { lat: 1, lng: 2 };
        expect(getStartPointLabel()).toBeNull();
    });
});
