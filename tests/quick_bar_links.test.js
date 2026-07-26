import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openCoordsOnMap } from '../src/utils.js';
import { state, getActiveDestinationName } from '../src/state.js';

// ============================================================================
// Mini-barre de la fiche POI — liens sortants.
//   - Maps  : Google Maps en vue SATELLITE (voir s'il y a un bâtiment)
//   - Google: recherche contextualisée par la DESTINATION ACTIVE (multi-dest)
// ============================================================================

describe('openCoordsOnMap — Maps en vue satellite', () => {
    let openSpy;
    beforeEach(() => {
        openSpy = vi.fn();
        vi.stubGlobal('window', { open: openSpy });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('ouvre Google Maps en satellite, zoom 19, centré sur le POI', () => {
        expect(openCoordsOnMap(33.71001, 10.86333, 'gmaps')).toBe(true);
        const url = openSpy.mock.calls[0][0];
        expect(url).toContain('basemap=satellite');
        expect(url).toContain('zoom=19');
        expect(url).toContain('center=33.71001,10.86333');
    });

    it("laisse OSM sur son épingle par coordonnées (repli quand pas d'osm_ref)", () => {
        openCoordsOnMap(33.71001, 10.86333, 'osm');
        const url = openSpy.mock.calls[0][0];
        expect(url).toContain('openstreetmap.org');
        expect(url).toContain('mlat=33.71001');
        expect(url).not.toContain('basemap');
    });

    it('refuse des coordonnées invalides sans rien ouvrir', () => {
        expect(openCoordsOnMap(NaN, 10, 'gmaps')).toBe(false);
        expect(openCoordsOnMap(undefined, undefined, 'gmaps')).toBe(false);
        expect(openSpy).not.toHaveBeenCalled();
    });
});

describe('getActiveDestinationName — contexte de la recherche web', () => {
    const snapshot = { currentMapId: state.currentMapId, destinations: state.destinations };
    afterEach(() => {
        state.currentMapId = snapshot.currentMapId;
        state.destinations = snapshot.destinations;
    });

    it('retourne le nom de la destination courante', () => {
        state.destinations = { activeMapId: 'djerba', maps: { djerba: { name: 'Djerba' }, hammamet: { name: 'Hammamet' } } };
        state.currentMapId = 'djerba';
        expect(getActiveDestinationName()).toBe('Djerba');
    });

    it("SUIT la destination active (pas de nom en dur) — garde multi-destination", () => {
        state.destinations = { activeMapId: 'djerba', maps: { djerba: { name: 'Djerba' }, hammamet: { name: 'Hammamet' } } };
        state.currentMapId = 'hammamet';
        expect(getActiveDestinationName()).toBe('Hammamet');
    });

    it('retombe sur activeMapId si currentMapId pas encore résolu (boot)', () => {
        state.destinations = { activeMapId: 'hammamet', maps: { hammamet: { name: 'Hammamet' } } };
        state.currentMapId = null;
        expect(getActiveDestinationName()).toBe('Hammamet');
    });

    it("retourne '' si destination inconnue (l'appelant choisit son repli)", () => {
        state.destinations = { activeMapId: 'inconnue', maps: {} };
        state.currentMapId = 'inconnue';
        expect(getActiveDestinationName()).toBe('');
        state.destinations = undefined;
        expect(getActiveDestinationName()).toBe('');
    });
});
