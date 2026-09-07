// @vitest-environment jsdom
// Tests pour src/osm-pass.js — chantier point d'accès v2 PR 3/5.
// On teste les helpers purs : shouldIncludeInPass + filterItems. La logique
// d'orchestration (startOsmPass / actions) reste manuelle en preview.
import { describe, it, expect } from 'vitest';
import { shouldIncludeInPass, filterItems } from '../src/osm-pass.js';
import { getAccessPointStatus } from '../src/access-point.js';

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

describe('osm-pass — POI legacy (drapeau publié, aucun statut) — 07/09/2026', () => {
    // Le vrai enjeu : ces POI ne doivent PAS retomber dans le lot réévalué au
    // lancement de la passe (`toEvaluate` = status undefined OU failed). La
    // dérivation les fait remonter en 'moved', donc ils en sortent d'eux-mêmes.
    function legacyFeat(id, name = 'Legacy') {
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [10, 33] },
            properties: { HW_ID: id, 'Nom du site FR': name, accessPoint: [10.95, 33.81] },
        };
    }

    it('est vu comme "moved", donc HORS du lot réévalué par Overpass', () => {
        const status = getAccessPointStatus(legacyFeat('L1'));
        expect(status).toBe('moved');
        // Reproduit le filtre exact de runInitialBatch (non exporté).
        const seraitReevalue = status === undefined || status === 'failed';
        expect(seraitReevalue).toBe(false);
    });

    it('reste LISTÉ dans la passe (révisable), comme un osm/moved explicite', () => {
        expect(shouldIncludeInPass(legacyFeat('L2'))).toBe(true);
    });

    it('apparaît sous « Avec drapeau », plus sous « Sans drapeau »', () => {
        const items = [{ feature: legacyFeat('L3'), status: getAccessPointStatus(legacyFeat('L3')), distance: null }];
        expect(filterItems(items, 'drapeau', '')).toHaveLength(1);
        expect(filterItems(items, 'nodrapeau', '')).toHaveLength(0);
    });

    it('un POI SANS drapeau ni statut reste, lui, à réévaluer', () => {
        const nu = feat('L4', undefined);
        const status = getAccessPointStatus(nu);
        expect(status).toBeUndefined();
        expect(status === undefined || status === 'failed').toBe(true);
        expect(shouldIncludeInPass(nu)).toBe(true);
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
