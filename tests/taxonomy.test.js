import { describe, it, expect, beforeEach } from 'vitest';
import {
    setTaxonomy, getCategoryLabels, getGroups, getGroupForCategory,
    getCategoriesInGroup, getSubtypes, getStates, getAccessValues,
    getAccessDefault, usesDerivedLabel, getDisplayName
} from '../src/taxonomy.js';
import refJson from '../public/poi-categories.json';

// Référentiel de test contrôlé — teste la logique des résolveurs indépendamment
// du contenu réel de poi-categories.json.
const TEST_REF = {
    groups: ['Culte', 'Patrimoine'],
    categories: [
        {
            label: 'Mosquée', groupe: 'Culte', libelleDerive: false,
            sousTypes: [
                { label: 'À minaret', portee: 'générique' },
                { label: 'Menzel-test', portee: ['djerba'] }
            ],
            etats: ['En activité', 'Ruine'],
            acces: { valeurs: ['Intérieur visitable', 'Extérieur seulement'], defaut: 'Extérieur seulement' }
        },
        {
            label: 'Puits', groupe: 'Patrimoine', libelleDerive: true,
            sousTypes: [], etats: [], acces: null
        }
    ]
};

describe('taxonomy — résolveurs', () => {
    beforeEach(() => setTaxonomy(TEST_REF));

    it('getCategoryLabels retourne les libellés triés', () => {
        expect(getCategoryLabels()).toEqual(['Mosquée', 'Puits']);
    });

    it('getGroups retourne les groupes', () => {
        expect(getGroups()).toEqual(['Culte', 'Patrimoine']);
    });

    it('getGroupForCategory : catégorie connue / inconnue', () => {
        expect(getGroupForCategory('Mosquée')).toBe('Culte');
        expect(getGroupForCategory('Inexistante')).toBeNull();
    });

    it('getCategoriesInGroup filtre par groupe', () => {
        expect(getCategoriesInGroup('Culte')).toEqual(['Mosquée']);
        expect(getCategoriesInGroup('Patrimoine')).toEqual(['Puits']);
    });

    it('getSubtypes : sans destId, exclut les sous-types à portée destination', () => {
        expect(getSubtypes('Mosquée')).toEqual(['À minaret']);
    });

    it('getSubtypes : avec la bonne destId, inclut le sous-type à portée', () => {
        expect(getSubtypes('Mosquée', 'djerba')).toEqual(['À minaret', 'Menzel-test']);
    });

    it('getSubtypes : avec une autre destId, exclut le sous-type à portée', () => {
        expect(getSubtypes('Mosquée', 'hammamet')).toEqual(['À minaret']);
    });

    it('getStates : catégorie avec / sans états', () => {
        expect(getStates('Mosquée')).toEqual(['En activité', 'Ruine']);
        expect(getStates('Puits')).toEqual([]);
    });

    it('getAccessValues / getAccessDefault', () => {
        expect(getAccessValues('Mosquée')).toContain('Extérieur seulement');
        expect(getAccessDefault('Mosquée')).toBe('Extérieur seulement');
        expect(getAccessValues('Puits')).toEqual([]);
        expect(getAccessDefault('Puits')).toBeNull();
    });

    it('usesDerivedLabel distingue les catégories à libellé dérivé', () => {
        expect(usesDerivedLabel('Puits')).toBe(true);
        expect(usesDerivedLabel('Mosquée')).toBe(false);
    });

    it('getDisplayName : nom propre prioritaire', () => {
        const f = { properties: { 'Nom du site FR': 'Mosquée Fadhloun', 'Catégorie': 'Mosquée' } };
        expect(getDisplayName(f)).toBe('Mosquée Fadhloun');
    });

    it('getDisplayName : libellé dérivé "Type — Zone" si nom vide et catégorie dérivée', () => {
        const f = { properties: { 'Nom du site FR': '', 'Catégorie': 'Puits', 'Zone': 'Houmt Souk' } };
        expect(getDisplayName(f)).toBe('Puits — Houmt Souk');
    });

    it('getDisplayName : catégorie seule si nom vide et catégorie non dérivée', () => {
        const f = { properties: { 'Nom du site FR': '', 'Catégorie': 'Mosquée', 'Zone': 'Midoun' } };
        expect(getDisplayName(f)).toBe('Mosquée');
    });

    it('setTaxonomy ignore une donnée malformée et garde le référentiel courant', () => {
        setTaxonomy(null);
        expect(getCategoryLabels()).toEqual(['Mosquée', 'Puits']);
        setTaxonomy({ categories: [] });
        expect(getCategoryLabels()).toEqual(['Mosquée', 'Puits']);
    });
});

describe('taxonomy — cohérence du référentiel réel (poi-categories.json)', () => {
    it('chaque catégorie a un label non vide', () => {
        for (const c of refJson.categories) {
            expect(typeof c.label).toBe('string');
            expect(c.label.length).toBeGreaterThan(0);
        }
    });

    it('chaque groupe référencé par une catégorie existe dans groups', () => {
        for (const c of refJson.categories) {
            if (c.groupe !== null && c.groupe !== undefined) {
                expect(refJson.groups).toContain(c.groupe);
            }
        }
    });

    it('le référentiel réel alimente bien les résolveurs', () => {
        setTaxonomy(refJson);
        expect(getCategoryLabels()).toContain('Mosquée');
        expect(getGroups()).toContain('Lieux de culte');
        expect(getSubtypes('Mosquée')).toContain('À coupoles');
        expect(usesDerivedLabel('Puits')).toBe(true);
    });

    it('structure v2 : 6 groupes, ex-catégories promues en groupes, catégories retirées', () => {
        setTaxonomy(refJson);
        const groups = getGroups();
        expect(groups).toHaveLength(6);
        expect(groups).toContain('Site historique');
        expect(groups).toContain('Architecture traditionnelle');
        expect(groups).toContain('Manger & boire');
        // ex-sous-types fonctionnels promus en catégories
        expect(getCategoriesInGroup('Site historique')).toContain('Fort');
        expect(getCategoriesInGroup('Architecture traditionnelle')).toContain('Menzel');
        // catégories retirées / dissoutes
        const labels = getCategoryLabels();
        expect(labels).not.toContain('Photo');
        expect(labels).not.toContain('Site historique');
        expect(labels).not.toContain('Culture et tradition');
        // un atelier d'artisanat vivant ou en ruine reste « Artisanat » → l'état porte la nuance
        expect(getStates('Artisanat')).toContain('Ruine');
    });
});
