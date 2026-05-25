import { describe, it, expect, vi, beforeEach } from 'vitest';

// Dépendances DOM / IndexedDB / icônes mockées : on ne teste ici que la
// logique pure (extraction des coordonnées + libellé), pas la modale.
vi.mock('../src/database.js', () => ({ saveAppState: vi.fn() }));
vi.mock('../src/modal.js', () => ({ openHwModal: vi.fn(), closeHwModal: vi.fn() }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/data.js', () => ({
    getPoiName: (f) => f?.properties?.Nom || 'Sans nom',
    getPoiId: (f) => f?.properties?.HW_ID,
}));

import { buildHomeFromFeature, getStartPointLabel } from '../src/start-point.js';
import { state } from '../src/state.js';

const poi = (nom, lng, lat) => ({
    type: 'Feature',
    properties: { Nom: nom, HW_ID: 'x' },
    geometry: { type: 'Point', coordinates: [lng, lat] },
});

describe('start-point — buildHomeFromFeature', () => {
    it('remet les coordonnées GeoJSON [lng,lat] dans l\'ordre {lat,lng}', () => {
        const home = buildHomeFromFeature(poi('Borj El Kébir', 10.8413, 33.8762));
        expect(home).toMatchObject({ lat: 33.8762, lng: 10.8413, label: 'Borj El Kébir' });
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
    beforeEach(() => { state.homeLocation = null; });

    it('renvoie le libellé du point défini', () => {
        state.homeLocation = { lat: 1, lng: 2, label: 'Ma position' };
        expect(getStartPointLabel()).toBe('Ma position');
    });

    it('renvoie null sans point défini', () => {
        state.homeLocation = null;
        expect(getStartPointLabel()).toBeNull();
    });

    it('renvoie null si le point n\'a pas de libellé', () => {
        state.homeLocation = { lat: 1, lng: 2 };
        expect(getStartPointLabel()).toBeNull();
    });
});
