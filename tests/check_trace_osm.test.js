// Tests du contrôle d'une trace GPX contre OSM (scripts/check-trace-osm.mjs).
// Seuls les calculs sont testés : Overpass et le Géoportail ne sont pas appelés.
import { describe, it, expect } from 'vitest';
import {
    lirePointsGpx, estFermeeAuMarcheur, associer, tronconsHorsOsm, tronconsFermes,
    voiesSuivies, modificationTexte,
} from '../scripts/check-trace-osm.mjs';

const way = (id, tags, lons, lat = 50.5) => ({ id, tags, geometry: lons.map(lon => ({ lat, lon })) });
const LIBRE = way(1, { highway: 'track', name: 'Chemin libre' }, [4.500, 4.505, 4.510]);
const PRIVE = way(2, { highway: 'track', access: 'private' }, [4.510, 4.515, 4.520]);

// Trace : sur la voie libre, un crochet de ~140 m à 66 m au nord (hors OSM), puis la voie privée.
const TRACE = [
    [50.5, 4.500], [50.5, 4.504], [50.5006, 4.5045], [50.5006, 4.5065], [50.5, 4.507], [50.5, 4.520],
].map(([lat, lon]) => ({ lat, lon }));

describe('check-trace-osm — lecture du GPX', () => {
    it('lit les trkpt dans l\'ordre', () => {
        const xml = '<gpx><trk><trkseg><trkpt lat="50.1" lon="4.2"><ele>1</ele></trkpt><trkpt lon="4.3" lat="50.2"/></trkseg></trk></gpx>';
        expect(lirePointsGpx(xml)).toEqual([{ lat: 50.1, lon: 4.2 }, { lat: 50.2, lon: 4.3 }]);
    });
    it('se rabat sur les rtept sans trkpt', () => {
        const xml = '<gpx><rte><rtept lat="50.1" lon="4.2"/><rtept lat="50.2" lon="4.3"/></rte></gpx>';
        expect(lirePointsGpx(xml)).toHaveLength(2);
    });
});

describe('check-trace-osm — voie fermée au marcheur', () => {
    it('access=private ou no, sauf foot=yes/designated/permissive', () => {
        expect(estFermeeAuMarcheur({ access: 'private' })).toBe(true);
        expect(estFermeeAuMarcheur({ access: 'no' })).toBe(true);
        expect(estFermeeAuMarcheur({ access: 'private', foot: 'yes' })).toBe(false);
        expect(estFermeeAuMarcheur({ access: 'private', foot: 'permissive' })).toBe(false);
        expect(estFermeeAuMarcheur({ foot: 'private' })).toBe(true);
        expect(estFermeeAuMarcheur({ access: 'destination' })).toBe(false);
        expect(estFermeeAuMarcheur({})).toBe(false);
    });
});

describe('check-trace-osm — comparaison trace / voies', () => {
    const ech = associer(TRACE, [LIBRE, PRIVE]);

    it('mesure la trace (~1,45 km)', () => {
        expect(ech.at(-1).km).toBeGreaterThan(1.40);
        expect(ech.at(-1).km).toBeLessThan(1.50);
    });
    it('trouve le crochet hors OSM, et lui seul', () => {
        const h = tronconsHorsOsm(ech);
        expect(h).toHaveLength(1);
        expect(Math.max(...h[0].ech.map(e => e.d))).toBeGreaterThan(60);
    });
    it('trouve la voie privée suivie sur ~700 m', () => {
        const f = tronconsFermes(ech);
        expect(f).toHaveLength(1);
        const long = (f[0].ech.at(-1).km - f[0].ech[0].km) * 1000;
        expect(long).toBeGreaterThan(650);
        expect(f[0].ech.every(e => e.way.id === 2)).toBe(true);
    });
    it('classe les voies suivies par longueur', () => {
        const v = voiesSuivies(ech);
        expect(v.map(s => s.way.id)).toEqual([2, 1]);
    });
    it('ne signale pas une voie privée qui longe une voie libre à moins de 15 m', () => {
        const route = way(3, { highway: 'unclassified' }, [4.510, 4.520], 50.50005);   // ~5,5 m au nord
        const e = associer([{ lat: 50.5, lon: 4.511 }, { lat: 50.5, lon: 4.519 }], [PRIVE, route]);
        expect(tronconsFermes(e)).toEqual([]);
    });
    it('rien à signaler quand tout est sur une voie libre', () => {
        const e = associer([{ lat: 50.5, lon: 4.501 }, { lat: 50.5, lon: 4.509 }], [LIBRE]);
        expect(tronconsHorsOsm(e)).toEqual([]);
        expect(tronconsFermes(e)).toEqual([]);
    });
});

describe('check-trace-osm — modification de l\'Atlas', () => {
    it('retire les champs vides, date en clair, lien cliquable', () => {
        const t = modificationTexte({
            OBJECTID: 4110, LIBELLE: null, DATE_OFFICIEL: -861148800000,
            LIEN_DOC2: 'https://carto.hainaut.be/plans_modifications/X_F009.jpg', REM: 'sentier',
        });
        expect(t).not.toContain('OBJECTID');
        expect(t).not.toContain('LIBELLE');
        expect(t).toContain('DATE_OFFICIEL : 1942-09-18');
        expect(t).toContain('<a href="https://carto.hainaut.be/plans_modifications/X_F009.jpg">X_F009.jpg</a>');
        expect(t).toContain('REM : sentier');
    });
});
