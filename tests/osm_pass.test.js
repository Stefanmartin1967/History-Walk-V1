// @vitest-environment jsdom
// Tests pour src/osm-pass.js — chantier point d'accès v2 PR 3/5.
// On teste les helpers purs : shouldIncludeInPass + filterItems. La logique
// d'orchestration (startOsmPass / actions) reste manuelle en preview.
import { describe, it, expect } from 'vitest';
import { shouldIncludeInPass, filterItems } from '../src/osm-pass.js';

function feat(id, status, name = 'Test') {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [10, 33] },
        properties: {
            HW_ID: id,
            'Nom du site FR': name,
            ...(status !== undefined ? { userData: { accessPointStatus: status } } : {}),
        },
    };
}

describe('osm-pass — shouldIncludeInPass', () => {
    it("inclut les status 'osm', 'moved', 'failed' et undefined", () => {
        expect(shouldIncludeInPass(feat('A', 'osm'))).toBe(true);
        expect(shouldIncludeInPass(feat('B', 'moved'))).toBe(true);
        expect(shouldIncludeInPass(feat('C', 'failed'))).toBe(true);
        expect(shouldIncludeInPass(feat('D', undefined))).toBe(true);
    });
    it("EXCLUT les status 'on-track' (déjà confirmés sur voie)", () => {
        expect(shouldIncludeInPass(feat('E', 'on-track'))).toBe(false);
    });
});

describe('osm-pass — filterItems', () => {
    const items = [
        { feature: feat('1', 'osm',    'Mosquée Alpha'),     status: 'osm',       distance: 18 },
        { feature: feat('2', 'moved',  'Café Beta'),         status: 'moved',     distance: 9 },
        { feature: feat('3', 'failed', 'Marabout Gamma'),    status: 'failed',    distance: null },
        { feature: feat('4', undefined,'Synagogue Delta'),   status: undefined,   distance: null },
    ];

    it("filter='all' retourne tout", () => {
        expect(filterItems(items, 'all', '')).toHaveLength(4);
    });
    it("filter='nodrapeau' retourne undefined + failed", () => {
        const r = filterItems(items, 'nodrapeau', '');
        expect(r).toHaveLength(2);
        expect(r.map(x => x.status).sort()).toEqual(['failed', undefined].sort());
    });
    it("filter='drapeau' retourne osm + moved", () => {
        const r = filterItems(items, 'drapeau', '');
        expect(r).toHaveLength(2);
        expect(r.map(x => x.status).sort()).toEqual(['moved', 'osm']);
    });
    it("filter='failed' retourne uniquement les failed", () => {
        const r = filterItems(items, 'failed', '');
        expect(r).toHaveLength(1);
        expect(r[0].status).toBe('failed');
    });
    it('recherche insensible à la casse sur le nom', () => {
        expect(filterItems(items, 'all', 'beta')).toHaveLength(1);
        expect(filterItems(items, 'all', 'BETA')).toHaveLength(1);
        expect(filterItems(items, 'all', 'mosquée')).toHaveLength(1);
        expect(filterItems(items, 'all', 'inexistant')).toHaveLength(0);
    });
    it('combine filtre + recherche', () => {
        const r = filterItems(items, 'drapeau', 'mos');
        expect(r).toHaveLength(1);
        expect(r[0].status).toBe('osm');
    });
});
