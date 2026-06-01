// Tests du helper isPoiMalCategorized (ui-photo-batch.js) — chantier
// enrichissement photo point 4 : signal visuel du bouton « Catégoriser ».
//
// Règle (cf. saveTaxonomyBatch / categorizeTooltip) : POI mal catégorisé si
//   - pas de Catégorie, OU
//   - Catégorie === 'A définir', OU
//   - Catégorie a des sous-types disponibles ET Sous-type est vide.
// État/Accès NON considérés (secondaires).

import { describe, it, expect, beforeAll } from 'vitest';
import { isPoiMalCategorized } from '../src/utils.js';
import { setTaxonomy } from '../src/taxonomy.js';

// Le FALLBACK de taxonomy.js (utilisé tant que poi-categories.json n'est pas
// chargé) n'embarque pas la structure fine (sousTypes / etats / acces). On
// configure un référentiel minimal pour les tests qui dépendent des sous-types.
beforeAll(() => {
    setTaxonomy({
        groups: ['Lieux de culte', 'Manger & boire'],
        categories: [
            { label: 'A définir', groupe: null },
            {
                label: 'Mosquée', groupe: 'Lieux de culte',
                sousTypes: [
                    { label: 'À minaret', portee: 'générique' },
                    { label: 'Générique', portee: 'générique' },
                ],
            },
            {
                label: 'Église', groupe: 'Lieux de culte',
                sousTypes: [
                    { label: 'Catholique', portee: 'générique' },
                ],
            },
            { label: 'Marabout', groupe: 'Lieux de culte', sousTypes: [] },
            { label: 'Restaurant', groupe: 'Manger & boire' }, // pas de sousTypes
        ],
    });
});

function poi(props = {}) {
    return {
        properties: { HW_ID: 'HW-TEST', ...props },
        geometry: { type: 'Point', coordinates: [10.85, 33.88] },
    };
}

describe('isPoiMalCategorized — badge orange du bouton « Catégoriser »', () => {
    it('aucune catégorie → mal catégorisé', () => {
        expect(isPoiMalCategorized(poi())).toBe(true);
    });

    it('« A définir » → mal catégorisé (même si autres champs remplis)', () => {
        expect(isPoiMalCategorized(poi({
            'Catégorie': 'A définir',
            'État': 'En activité',
        }))).toBe(true);
    });

    it('Mosquée sans Sous-type → mal catégorisé (sous-types disponibles)', () => {
        expect(isPoiMalCategorized(poi({ 'Catégorie': 'Mosquée' }))).toBe(true);
    });

    it('Mosquée avec Sous-type → BIEN catégorisé', () => {
        expect(isPoiMalCategorized(poi({
            'Catégorie': 'Mosquée',
            'Sous-type': 'À minaret',
        }))).toBe(false);
    });

    it('Restaurant (aucun sous-type dans la taxonomie) → BIEN catégorisé', () => {
        // Restaurant n'a pas de sousTypes dans le FALLBACK ni la taxo v2 → pas
        // de signal manquant. État/Accès n'entrent pas dans le test.
        expect(isPoiMalCategorized(poi({ 'Catégorie': 'Restaurant' }))).toBe(false);
    });

    it('Marabout (sous-types vides dans taxonomie) → BIEN catégorisé', () => {
        expect(isPoiMalCategorized(poi({ 'Catégorie': 'Marabout' }))).toBe(false);
    });

    it('userData prime sur properties (overlay) — cat dans userData seul', () => {
        // getPoiProp lit userData en overlay → l'utilisateur peut catégoriser un
        // POI dont properties.Catégorie est vide, ça doit compter comme bon.
        expect(isPoiMalCategorized(poi({
            userData: { 'Catégorie': 'Marabout' },
        }))).toBe(false);
    });

    it('Église avec Sous-type Catholique → BIEN catégorisé', () => {
        expect(isPoiMalCategorized(poi({
            'Catégorie': 'Église',
            'Sous-type': 'Catholique',
        }))).toBe(false);
    });
});
