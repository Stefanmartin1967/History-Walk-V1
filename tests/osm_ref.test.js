import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeOsmRef, osmObjectUrl, openPoiOnMap } from '../src/utils.js';

// ============================================================================
// osm_ref — identité de l'objet OpenStreetMap portée par un POI.
//   - normalizeOsmRef : accepte l'URL collée par l'admin → « type/id »
//   - osmObjectUrl    : « type/id » → page de l'objet
//   - openPoiOnMap('osm') : page de l'objet si osm_ref, sinon repli coordonnées
//     (le bouton ne doit JAMAIS être cassé) + lecture via l'overlay userData.
// ============================================================================

describe('normalizeOsmRef', () => {
    it('accepte la forme canonique « type/id »', () => {
        expect(normalizeOsmRef('way/386328373')).toBe('way/386328373');
        expect(normalizeOsmRef('node/1109117368')).toBe('node/1109117368');
        expect(normalizeOsmRef('relation/2682627')).toBe('relation/2682627');
    });

    it("extrait la référence d'une URL OSM collée telle quelle", () => {
        expect(normalizeOsmRef('https://www.openstreetmap.org/way/386328373'))
            .toBe('way/386328373');
    });

    it('tolère query string, hash de carte et espaces (copier-coller réel)', () => {
        expect(normalizeOsmRef('  https://www.openstreetmap.org/way/1364140400/history  '))
            .toBe('way/1364140400');
        expect(normalizeOsmRef('https://www.openstreetmap.org/node/123#map=19/33.8/10.9&layers=N'))
            .toBe('node/123');
    });

    it('normalise la casse du type', () => {
        expect(normalizeOsmRef('WAY/42')).toBe('way/42');
    });

    it('ne devine JAMAIS un id depuis un texte libre ou une autre source', () => {
        expect(normalizeOsmRef('')).toBe('');
        expect(normalizeOsmRef('Mosquée Kharroubi')).toBe('');
        expect(normalizeOsmRef('https://fr.wikipedia.org/wiki/Djerba')).toBe('');
        expect(normalizeOsmRef('386328373')).toBe('');
        expect(normalizeOsmRef(null)).toBe('');
        expect(normalizeOsmRef(undefined)).toBe('');
    });
});

describe('osmObjectUrl', () => {
    it("construit l'URL de la page de l'objet", () => {
        expect(osmObjectUrl('way/386328373'))
            .toBe('https://www.openstreetmap.org/way/386328373');
    });

    it('accepte une URL en entrée (idempotent)', () => {
        expect(osmObjectUrl('https://www.openstreetmap.org/node/123'))
            .toBe('https://www.openstreetmap.org/node/123');
    });

    it('retourne null si référence absente ou invalide', () => {
        expect(osmObjectUrl('')).toBeNull();
        expect(osmObjectUrl('pas une ref')).toBeNull();
        expect(osmObjectUrl(undefined)).toBeNull();
    });
});

describe('openPoiOnMap — bouton OSM', () => {
    let openSpy;
    beforeEach(() => {
        openSpy = vi.fn();
        vi.stubGlobal('window', { open: openSpy });
    });
    afterEach(() => vi.unstubAllGlobals());

    const feature = (props = {}) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [10.86333, 33.71001] },
        properties: props,
    });

    it("ouvre la page de l'objet quand osm_ref est présent", () => {
        expect(openPoiOnMap(feature({ osm_ref: 'way/386328366' }), 'osm')).toBe(true);
        expect(openSpy).toHaveBeenCalledWith(
            'https://www.openstreetmap.org/way/386328366', '_blank', 'noopener,noreferrer');
    });

    it('retombe sur les coordonnées quand osm_ref est absent (jamais cassé)', () => {
        expect(openPoiOnMap(feature(), 'osm')).toBe(true);
        expect(openSpy.mock.calls[0][0]).toContain('mlat=33.71001');
        expect(openSpy.mock.calls[0][0]).not.toContain('/way/');
    });

    it('retombe sur les coordonnées si osm_ref est invalide', () => {
        expect(openPoiOnMap(feature({ osm_ref: 'bricolage' }), 'osm')).toBe(true);
        expect(openSpy.mock.calls[0][0]).toContain('mlat=');
    });

    it("lit l'overlay userData en priorité (modif non encore publiée)", () => {
        const f = feature({ osm_ref: 'way/111', userData: { osm_ref: 'way/999' } });
        openPoiOnMap(f, 'osm');
        expect(openSpy.mock.calls[0][0]).toBe('https://www.openstreetmap.org/way/999');
    });

    it("n'affecte pas le bouton Maps, qui reste par coordonnées", () => {
        openPoiOnMap(feature({ osm_ref: 'way/386328366' }), 'gmaps');
        expect(openSpy.mock.calls[0][0]).toContain('google.com/maps');
        expect(openSpy.mock.calls[0][0]).toContain('33.71001');
    });

    it('retourne false si le POI n\'a pas de coordonnées exploitables', () => {
        expect(openPoiOnMap({ type: 'Feature', properties: {} }, 'osm')).toBe(false);
        expect(openSpy).not.toHaveBeenCalled();
    });
});
