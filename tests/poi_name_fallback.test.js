// P5 (Volet B) — repli d'affichage de getPoiName vers « Nom du site arabe ».
// Un POI arabe-seul (FR vide, fréquent depuis le routage du Scout) doit afficher
// son nom arabe en mode FR, et NON « Lieu inconnu ». On importe le VRAI getPoiName
// (utils.js) avec des mocks légers de ses seules dépendances d'import.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/zones.js', () => ({
    zonesData: { type: 'FeatureCollection', features: [] },
    zoneCacheGet: vi.fn(() => undefined),
    zoneCacheSet: vi.fn(),
}));
vi.mock('../src/taxonomy.js', () => ({ getSubtypes: vi.fn(() => []) }));

import { getPoiName } from '../src/utils.js';

const feat = (props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [10, 35] } });

describe('getPoiName — repli vers le nom arabe (P5 Volet B)', () => {
    it('FR vide + Nom du site arabe (props) → renvoie l’arabe (≠ « Lieu inconnu »)', () => {
        expect(getPoiName(feat({ 'Nom du site arabe': 'جامع الكونية' }))).toBe('جامع الكونية');
    });

    it('FR vide + Nom du site arabe (overlay userData) → renvoie l’arabe', () => {
        expect(getPoiName(feat({ userData: { 'Nom du site arabe': 'جامع الرحمة' } }))).toBe('جامع الرحمة');
    });

    it('le nom FR prime toujours sur l’arabe quand il existe', () => {
        expect(getPoiName(feat({ 'Nom du site FR': 'Grande Mosquée', 'Nom du site arabe': 'جامع' }))).toBe('Grande Mosquée');
    });

    it('aucun nom du tout → « Lieu inconnu »', () => {
        expect(getPoiName(feat({ 'Catégorie': 'Mosquée' }))).toBe('Lieu inconnu');
    });

    it('compat : la variante historique « Nom du site AR » reste lue en dernier recours', () => {
        expect(getPoiName(feat({ 'Nom du site AR': 'جامع قديم' }))).toBe('جامع قديم');
    });
});
