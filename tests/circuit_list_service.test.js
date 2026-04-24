import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks — circuit-list-service est une fonction de transformation lourde
// (fusion, enrichment, filter, sort). On isole des dépendances externes.
// ============================================================================

vi.mock('../src/state.js', () => ({
    state: {
        officialCircuits: [],
        myCircuits: [],
        loadedFeatures: [],
        selectedOfficialCircuitIds: null, // null = tous les officiels
        homeLocation: null
    }
}));

vi.mock('../src/data.js', () => ({
    getPoiId: (f) => f?.properties?.HW_ID || f?.id || null
}));

vi.mock('../src/circuit.js', () => ({
    isCircuitCompleted: vi.fn(() => false)
}));

vi.mock('../src/utils.js', () => ({
    getZoneFromCoords: vi.fn(() => null),
    getRealDistance: vi.fn(() => 0),
    getOrthodromicDistance: vi.fn(() => 0)
}));

// Leaflet : seul `L.latLng(lat, lng).distanceTo(...)` est utilisé.
// Stub déterministe (pseudo-distance basée sur écart lat/lng) pour tester
// l'ordre du tri proximity_asc sans dépendre du calcul géodésique réel.
vi.mock('leaflet', () => ({
    default: {
        latLng: (lat, lng) => ({
            lat, lng,
            distanceTo: (other) => {
                const dLat = lat - other.lat;
                const dLng = lng - other.lng;
                return Math.sqrt(dLat * dLat + dLng * dLng) * 111000;
            }
        })
    }
}));

import { state } from '../src/state.js';
import { isCircuitCompleted } from '../src/circuit.js';
import { getZoneFromCoords, getRealDistance, getOrthodromicDistance } from '../src/utils.js';
import { getProcessedCircuits, getAvailableZonesFromCircuits } from '../src/circuit-list-service.js';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function makePoi(id, coords = [10, 33.5], extra = {}) {
    return {
        properties: { HW_ID: id, ...extra },
        geometry: { type: 'Point', coordinates: coords }
    };
}

describe('circuit-list-service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.officialCircuits = [];
        state.myCircuits = [];
        state.loadedFeatures = [];
        state.selectedOfficialCircuitIds = null;
        state.homeLocation = null;
        // Valeurs par défaut des mocks après clearAllMocks
        getRealDistance.mockReturnValue(0);
        getOrthodromicDistance.mockReturnValue(0);
        isCircuitCompleted.mockReturnValue(false);
        getZoneFromCoords.mockReturnValue(null);
    });

    // ========================================================================
    // 1. Fusion officiels + locaux (avec filtres de sécurité)
    // ========================================================================
    describe('Fusion officiels + locaux', () => {
        it('selectedOfficialCircuitIds=null renvoie tous les officiels', () => {
            state.officialCircuits = [
                { id: 'o1', name: 'Off1' },
                { id: 'o2', name: 'Off2' }
            ];
            state.selectedOfficialCircuitIds = null;

            const r = getProcessedCircuits();

            expect(r.map(c => c.id).sort()).toEqual(['o1', 'o2']);
        });

        it('selectedOfficialCircuitIds=["o1"] ne garde que les officiels sélectionnés', () => {
            state.officialCircuits = [
                { id: 'o1', name: 'Off1' },
                { id: 'o2', name: 'Off2' }
            ];
            state.selectedOfficialCircuitIds = ['o1'];
            state.myCircuits = [{ id: 'm1', name: 'Mon' }];

            const r = getProcessedCircuits();

            expect(r.map(c => c.id).sort()).toEqual(['m1', 'o1']);
        });

        it('exclut les circuits locaux isDeleted et isOfficial (fantômes)', () => {
            state.myCircuits = [
                { id: 'm1', name: 'Actif' },
                { id: 'm2', name: 'Corbeille', isDeleted: true },
                { id: 'm3', name: 'Fantôme officiel', isOfficial: true }
            ];

            const r = getProcessedCircuits();

            expect(r.map(c => c.id)).toEqual(['m1']);
        });

        it('exclut les locaux fantômes (id ou nom trimé identique à un officiel)', () => {
            state.officialCircuits = [{ id: 'o1', name: 'Circuit X' }];
            state.myCircuits = [
                { id: 'o1', name: 'Autre nom' },       // id collision
                { id: 'm2', name: 'Circuit X' },       // name collision
                { id: 'm3', name: '  Circuit X  ' },   // collision après trim
                { id: 'm4', name: 'Propre' }           // distinct
            ];

            const r = getProcessedCircuits();

            expect(r.map(c => c.id).sort()).toEqual(['m4', 'o1']);
        });
    });

    // ========================================================================
    // 2. Distance — 3 priorités cascadées
    // ========================================================================
    describe('Distance (3 priorités)', () => {
        it('priorité 1 : parse une chaîne "3.8 km" (point décimal)', () => {
            state.myCircuits = [{ id: 'm1', name: 'C', distance: '3.8 km' }];

            const r = getProcessedCircuits();

            expect(r[0]._dist).toBe(3800);
            expect(r[0]._distDisplay).toBe('3.8 km');
        });

        it('priorité 1 : parse "1,5 km" avec virgule française', () => {
            state.myCircuits = [{ id: 'm1', name: 'C', distance: '1,5 km' }];

            const r = getProcessedCircuits();

            expect(r[0]._dist).toBe(1500);
        });

        it('priorité 2 : pas de string, appelle getRealDistance sur realTrack', () => {
            getRealDistance.mockReturnValue(5000);
            state.myCircuits = [{
                id: 'm1', name: 'C',
                realTrack: [[33.5, 10], [33.6, 10.1]]
            }];

            const r = getProcessedCircuits();

            expect(getRealDistance).toHaveBeenCalledWith(state.myCircuits[0]);
            expect(r[0]._dist).toBe(5000);
        });
    });

    // ========================================================================
    // 3. Enrichment (restaurant, visitedCount)
    // ========================================================================
    describe('Enrichissement metadata', () => {
        it('hasRestaurant=true si un POI a properties.Catégorie="Restaurant"', () => {
            state.myCircuits = [{ id: 'm1', name: 'C', poiIds: ['p1', 'p2'] }];
            state.loadedFeatures = [
                makePoi('p1', [10, 33.5], { 'Catégorie': 'Monument' }),
                makePoi('p2', [10, 33.5], { 'Catégorie': 'Restaurant' })
            ];

            const r = getProcessedCircuits();

            expect(r[0]._hasRestaurant).toBe(true);
        });

        it('hasRestaurant=true via userData.Catégorie (override admin)', () => {
            state.myCircuits = [{ id: 'm1', name: 'C', poiIds: ['p1'] }];
            state.loadedFeatures = [
                makePoi('p1', [10, 33.5], { userData: { 'Catégorie': 'Restaurant' } })
            ];

            const r = getProcessedCircuits();

            expect(r[0]._hasRestaurant).toBe(true);
        });

        it('visitedCount compte les POIs avec userData.vu=true', () => {
            state.myCircuits = [{ id: 'm1', name: 'C', poiIds: ['p1', 'p2', 'p3'] }];
            state.loadedFeatures = [
                makePoi('p1', [10, 33.5], { userData: { vu: true } }),
                makePoi('p2', [10, 33.5], { userData: { vu: false } }),
                makePoi('p3', [10, 33.5], { userData: { vu: true } })
            ];

            const r = getProcessedCircuits();

            expect(r[0]._poiCount).toBe(3);
            expect(r[0]._visitedCount).toBe(2);
        });
    });

    // ========================================================================
    // 4. Zone — priorités (c.zone → POI[0] → realTrack[0])
    // ========================================================================
    describe('Zone', () => {
        it('utilise c.zone stocké par défaut (pas de POI ni realTrack)', () => {
            state.myCircuits = [{ id: 'm1', name: 'C', zone: 'Nord', poiIds: [] }];

            const r = getProcessedCircuits();

            expect(r[0]._zoneName).toBe('Nord');
        });

        it('fallback sur realTrack[0] via getZoneFromCoords si pas de POIs', () => {
            getZoneFromCoords.mockReturnValueOnce('Zone-Track');
            state.myCircuits = [{
                id: 'm1', name: 'C',
                realTrack: [[37.5, 10.5]]
            }];

            const r = getProcessedCircuits();

            // realTrack[0] = [lat, lng] → getZoneFromCoords(lat, lng)
            expect(getZoneFromCoords).toHaveBeenCalledWith(37.5, 10.5);
            expect(r[0]._zoneName).toBe('Zone-Track');
        });
    });

    // ========================================================================
    // 5. Filtres
    // ========================================================================
    describe('Filtres', () => {
        it('filterTodo=true exclut les circuits complétés', () => {
            isCircuitCompleted.mockImplementation(c => c.id === 'm1');
            state.myCircuits = [
                { id: 'm1', name: 'Fait' },
                { id: 'm2', name: 'À faire' }
            ];

            const r = getProcessedCircuits('date_desc', true);

            expect(r.map(c => c.id)).toEqual(['m2']);
        });

        it('filterZone ne garde que les circuits de la zone demandée', () => {
            getZoneFromCoords.mockImplementation((lat) => (lat > 33 ? 'Nord' : 'Sud'));
            state.myCircuits = [
                { id: 'm1', name: 'A', realTrack: [[35, 10]] },
                { id: 'm2', name: 'B', realTrack: [[30, 10]] }
            ];

            const r = getProcessedCircuits('date_desc', false, 'Nord');

            expect(r.map(c => c.id)).toEqual(['m1']);
        });

        it('filterPoiId garde les circuits contenant le POI', () => {
            state.myCircuits = [
                { id: 'm1', name: 'A', poiIds: ['p1', 'p2'] },
                { id: 'm2', name: 'B', poiIds: ['p3'] },
                { id: 'm3', name: 'C' } // poiIds absent
            ];

            const r = getProcessedCircuits('date_desc', false, null, 'p2');

            expect(r.map(c => c.id)).toEqual(['m1']);
        });
    });

    // ========================================================================
    // 6. Tri
    // ========================================================================
    describe('Tri', () => {
        it('proximity_asc : circuit dont le premier POI est le plus proche de home en tête', () => {
            state.homeLocation = { lat: 33.8, lng: 10.8 };
            state.loadedFeatures = [
                // [lng, lat] dans GeoJSON
                makePoi('p_far',  [12.0, 34.5]),   // loin
                makePoi('p_near', [10.85, 33.82])  // proche
            ];
            state.myCircuits = [
                { id: 'm_far',  name: 'Far',  poiIds: ['p_far'] },
                { id: 'm_near', name: 'Near', poiIds: ['p_near'] }
            ];

            const r = getProcessedCircuits('proximity_asc');

            expect(r.map(c => c.id)).toEqual(['m_near', 'm_far']);
        });

        it('proximity_asc : Infinity partout quand homeLocation absent (ordre d\'entrée)', () => {
            state.homeLocation = null;
            state.myCircuits = [
                { id: 'm1', name: 'A', poiIds: [] },
                { id: 'm2', name: 'B', poiIds: [] }
            ];

            const r = getProcessedCircuits('proximity_asc');

            expect(r.every(c => c._proximityFromHome === Infinity)).toBe(true);
        });

        it('dist_asc / dist_desc trient par distance', () => {
            state.myCircuits = [
                { id: 'a', name: 'A', distance: '5.0 km' },
                { id: 'b', name: 'B', distance: '2.0 km' },
                { id: 'c', name: 'C', distance: '8.0 km' }
            ];

            const asc  = getProcessedCircuits('dist_asc');
            const desc = getProcessedCircuits('dist_desc');

            expect(asc.map(c => c.id)).toEqual(['b', 'a', 'c']);
            expect(desc.map(c => c.id)).toEqual(['c', 'a', 'b']);
        });

        it('date_desc applique un reverse sur l\'ordre d\'entrée', () => {
            state.myCircuits = [
                { id: 'm1', name: 'A' },
                { id: 'm2', name: 'B' },
                { id: 'm3', name: 'C' }
            ];

            const r = getProcessedCircuits('date_desc');

            expect(r.map(c => c.id)).toEqual(['m3', 'm2', 'm1']);
        });
    });

    // ========================================================================
    // 7. getAvailableZonesFromCircuits
    // ========================================================================
    describe('getAvailableZonesFromCircuits', () => {
        it('comptabilise les zones et retourne sortedZones triées alphabétiquement', () => {
            getZoneFromCoords.mockImplementation((lat) => {
                if (lat > 35) return 'Zuid';
                if (lat > 33) return 'Nord';
                return 'Est';
            });
            state.myCircuits = [
                { id: 'a', realTrack: [[36, 10]] },  // Zuid
                { id: 'b', realTrack: [[34, 10]] },  // Nord
                { id: 'c', realTrack: [[34, 10]] },  // Nord
                { id: 'd', realTrack: [[32, 10]] }   // Est
            ];

            const r = getAvailableZonesFromCircuits();

            expect(r.zoneCounts).toEqual({ Zuid: 1, Nord: 2, Est: 1 });
            expect(r.sortedZones).toEqual(['Est', 'Nord', 'Zuid']);
        });

        it('utilise c.zone stocké en priorité (n\'appelle pas getZoneFromCoords)', () => {
            state.myCircuits = [{ id: 'a', zone: 'Centre' }];

            const r = getAvailableZonesFromCircuits();

            expect(r.zoneCounts).toEqual({ Centre: 1 });
            expect(getZoneFromCoords).not.toHaveBeenCalled();
        });

        it('ignore les circuits dont la zone ne peut pas être déterminée', () => {
            // b : ni zone stockée, ni POIs, ni realTrack → pas de zone
            state.myCircuits = [
                { id: 'a', zone: 'Nord' },
                { id: 'b', poiIds: [], realTrack: [] }
            ];

            const r = getAvailableZonesFromCircuits();

            expect(r.zoneCounts).toEqual({ Nord: 1 });
            expect(r.sortedZones).toEqual(['Nord']);
        });
    });
});
