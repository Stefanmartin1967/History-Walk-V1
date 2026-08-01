import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapsPlaceUrl, openPoiOnMap } from '../src/utils.js';

// ============================================================================
// maps_ref — lien Google Maps précis porté par un POI, même geste que osm_ref
// (cf. tests/osm_ref.test.js) mais sans normalisation : les formats d'URL
// Maps varient trop (lien court, CID hexadécimal, coordonnées) pour être
// réduits à une forme canonique sans risquer de casser silencieusement.
//   - mapsPlaceUrl        : garde http(s) uniquement, stocke tel que collé
//   - openPoiOnMap('gmaps') : fiche Maps si maps_ref, sinon repli coordonnées
//     (le bouton ne doit JAMAIS être cassé) + lecture via l'overlay userData
// ============================================================================

describe('mapsPlaceUrl', () => {
    it('accepte un lien http(s) tel quel', () => {
        expect(mapsPlaceUrl('https://www.google.com/maps/place/Mosqu%C3%A9e+Aboumessouer/@33.86,10.82'))
            .toBe('https://www.google.com/maps/place/Mosqu%C3%A9e+Aboumessouer/@33.86,10.82');
        expect(mapsPlaceUrl('http://maps.app.goo.gl/xyz')).toBe('http://maps.app.goo.gl/xyz');
    });

    it('retire les espaces de bord (copier-coller réel)', () => {
        expect(mapsPlaceUrl('  https://goo.gl/maps/abc  ')).toBe('https://goo.gl/maps/abc');
    });

    it('ne devine ni ne normalise rien : le format Maps est trop variable', () => {
        // Contrairement à osm_ref, aucune extraction — la garde est SEULEMENT le schéma.
        expect(mapsPlaceUrl('www.google.com/maps/place/x')).toBeNull(); // pas de schéma
    });

    it("rejette tout ce qui n'est pas http(s)", () => {
        expect(mapsPlaceUrl('javascript:alert(1)')).toBeNull();
        expect(mapsPlaceUrl('data:text/html,<script>x</script>')).toBeNull();
        expect(mapsPlaceUrl('ftp://exemple.org')).toBeNull();
    });

    it.each([[''], ['   '], [null], [undefined], [42]])('rejette %s', (v) => {
        expect(mapsPlaceUrl(v)).toBeNull();
    });
});

describe('openPoiOnMap — bouton Maps', () => {
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

    it('ouvre le lien Maps quand maps_ref est présent', () => {
        const url = 'https://www.google.com/maps/place/Mosqu%C3%A9e+Aboumessouer/@33.86,10.82';
        expect(openPoiOnMap(feature({ maps_ref: url }), 'gmaps')).toBe(true);
        expect(openSpy).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
    });

    it('retombe sur les coordonnées quand maps_ref est absent (jamais cassé)', () => {
        expect(openPoiOnMap(feature(), 'gmaps')).toBe(true);
        expect(openSpy.mock.calls[0][0]).toContain('google.com/maps');
        expect(openSpy.mock.calls[0][0]).toContain('basemap=satellite');
    });

    it('retombe sur les coordonnées si maps_ref est invalide', () => {
        expect(openPoiOnMap(feature({ maps_ref: 'pas une url' }), 'gmaps')).toBe(true);
        expect(openSpy.mock.calls[0][0]).toContain('basemap=satellite');
    });

    it("lit l'overlay userData en priorité (modif non encore publiée)", () => {
        const f = feature({
            maps_ref: 'https://maps.google.com/ancien',
            userData: { maps_ref: 'https://maps.google.com/nouveau' },
        });
        openPoiOnMap(f, 'gmaps');
        expect(openSpy.mock.calls[0][0]).toBe('https://maps.google.com/nouveau');
    });

    it("n'affecte pas le bouton OSM, qui garde sa propre logique", () => {
        openPoiOnMap(feature({ maps_ref: 'https://maps.google.com/x' }), 'osm');
        expect(openSpy.mock.calls[0][0]).toContain('openstreetmap.org');
        expect(openSpy.mock.calls[0][0]).not.toContain('google.com');
    });

    it('retourne false si le POI n\'a ni maps_ref ni coordonnées exploitables', () => {
        expect(openPoiOnMap({ type: 'Feature', properties: {} }, 'gmaps')).toBe(false);
        expect(openSpy).not.toHaveBeenCalled();
    });
});
