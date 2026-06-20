import { describe, it, expect, beforeEach } from 'vitest';
import { setTaxonomy, getCategoryLabels } from '../src/taxonomy.js';
import refJson from '../public/poi-categories.json';
import { getHwCategory, HW_MAPPING, isArabicText, resolveOsmNames } from '../src/scout-categories.js';

// PR-1 (modèle C) : garde-fou de la classe de bug #2 de l'audit — le mapping de
// catégories du Scout était figé sur la taxonomie PRÉ-v2 ('Site historique',
// 'Site religieux', 'Culture et tradition') → des catégories-feuilles INEXISTANTES
// → icône « ? », valeur perdue au <select>. On croise les sorties de getHwCategory
// avec la taxonomie v2 RÉELLE (public/poi-categories.json).

// Échantillon représentatif d'objets OSM moissonnables (tags réels Overpass).
const OSM_SAMPLES = [
    { building: 'mosque' },
    { building: 'synagogue' },
    { building: 'church' },
    { building: 'chapel' },
    { building: 'cathedral' },
    { amenity: 'place_of_worship', religion: 'muslim' },
    { amenity: 'place_of_worship', religion: 'christian' },
    { amenity: 'place_of_worship', religion: 'jewish' },
    { amenity: 'place_of_worship' },              // religion inconnue → null
    { amenity: 'place_of_worship', religion: 'buddhist' },
    { historic: 'fort' },
    { historic: 'castle' },
    { historic: 'archaeological_site' },
    { historic: 'ruins' },
    { historic: 'monument' },                     // ambigu → null
    { historic: 'memorial' },                     // ambigu → null
    { tourism: 'museum' },
    { tourism: 'theme_park' },
    { tourism: 'zoo' },
    { tourism: 'viewpoint' },
    { tourism: 'artwork' },
    { tourism: 'attraction' },
    { amenity: 'restaurant' },
    { amenity: 'cafe' },
    { tourism: 'hotel' },
    { tourism: 'guest_house' },
    { amenity: 'parking' },                       // non mappé → null
    {},                                           // aucun tag → null
    // P1 Niveau 1 — patrimoine élargi
    { historic: 'fortress' }, { historic: 'citadel' }, { historic: 'city_gate' },
    { historic: 'citywalls' }, { historic: 'bastion' },
    { historic: 'tomb' }, { historic: 'mausoleum' }, { historic: 'tumulus' },
    { historic: 'tower' },                        // ambigu (défensif ou non) → null
    { historic: 'palace' }, { historic: 'monastery' }, { historic: 'aqueduct' }, // → null (triage)
    { man_made: 'water_well' }, { man_made: 'lighthouse' },
    { man_made: 'windmill' }, { man_made: 'watermill' },
    { craft: 'pottery' }, { craft: 'weaving' }, { shop: 'pottery' },
];

describe('scout-categories — getHwCategory aligné sur la taxonomie v2', () => {
    beforeEach(() => setTaxonomy(refJson));

    it('INVARIANT : toute sortie non-nulle est une catégorie-feuille valide', () => {
        const valid = new Set(getCategoryLabels());
        for (const tags of OSM_SAMPLES) {
            const cat = getHwCategory(tags);
            if (cat !== null) {
                expect(valid.has(cat), `getHwCategory(${JSON.stringify(tags)}) = "${cat}" hors taxonomie`).toBe(true);
            }
        }
    });

    it('toutes les valeurs de HW_MAPPING sont des catégories-feuilles valides', () => {
        const valid = new Set(getCategoryLabels());
        for (const v of Object.values(HW_MAPPING)) {
            expect(valid.has(v), `HW_MAPPING → "${v}" hors taxonomie`).toBe(true);
        }
    });

    it('mappings confiants corrects', () => {
        expect(getHwCategory({ building: 'mosque' })).toBe('Mosquée');
        expect(getHwCategory({ building: 'synagogue' })).toBe('Synagogue');
        expect(getHwCategory({ building: 'church' })).toBe('Église');
        expect(getHwCategory({ amenity: 'place_of_worship', religion: 'muslim' })).toBe('Mosquée');
        expect(getHwCategory({ amenity: 'place_of_worship', religion: 'christian' })).toBe('Église');
        expect(getHwCategory({ amenity: 'place_of_worship', religion: 'jewish' })).toBe('Synagogue');
        expect(getHwCategory({ historic: 'fort' })).toBe('Fortification');
        expect(getHwCategory({ historic: 'castle' })).toBe('Fortification');
        expect(getHwCategory({ historic: 'archaeological_site' })).toBe('Site archéologique');
        expect(getHwCategory({ historic: 'ruins' })).toBe('Site archéologique');
        expect(getHwCategory({ tourism: 'museum' })).toBe('Musée');
        expect(getHwCategory({ amenity: 'cafe' })).toBe('Café');
        expect(getHwCategory({ amenity: 'restaurant' })).toBe('Restaurant');
        expect(getHwCategory({ tourism: 'hotel' })).toBe('Hôtel');
        expect(getHwCategory({ tourism: 'attraction' })).toBe('Curiosité');
    });

    it('tags ambigus / non mappés → null (triage manuel, pas de catégorie devinée à tort)', () => {
        expect(getHwCategory({ amenity: 'place_of_worship' })).toBeNull();
        expect(getHwCategory({ amenity: 'place_of_worship', religion: 'buddhist' })).toBeNull();
        expect(getHwCategory({ historic: 'monument' })).toBeNull();
        expect(getHwCategory({ historic: 'memorial' })).toBeNull();
        expect(getHwCategory({ amenity: 'parking' })).toBeNull();
        expect(getHwCategory({})).toBeNull();
    });

    it('régression : ne retourne JAMAIS un libellé pré-v2 cassé', () => {
        const broken = new Set(['Site historique', 'Site religieux', 'Culture et tradition']);
        for (const tags of OSM_SAMPLES) {
            const cat = getHwCategory(tags);
            expect(broken.has(cat)).toBe(false);
        }
    });

    // P1 Niveau 1 — couverture patrimoniale élargie.
    it('ouvrages défensifs élargis → Fortification', () => {
        for (const v of ['fortress', 'citadel', 'city_gate', 'citywalls', 'bastion']) {
            expect(getHwCategory({ historic: v }), v).toBe('Fortification');
        }
    });
    it('sépultures → Site funéraire (catégorie jusque-là jamais moissonnée)', () => {
        for (const v of ['tomb', 'mausoleum', 'tumulus']) {
            expect(getHwCategory({ historic: v }), v).toBe('Site funéraire');
        }
    });
    it('patrimoine technique man_made → Puits / Curiosité', () => {
        expect(getHwCategory({ man_made: 'water_well' })).toBe('Puits');
        expect(getHwCategory({ man_made: 'lighthouse' })).toBe('Curiosité');
        expect(getHwCategory({ man_made: 'windmill' })).toBe('Curiosité');
        expect(getHwCategory({ man_made: 'watermill' })).toBe('Curiosité');
    });
    it('artisanat traditionnel → Artisanat', () => {
        expect(getHwCategory({ craft: 'pottery' })).toBe('Artisanat');
        expect(getHwCategory({ craft: 'weaving' })).toBe('Artisanat');
        expect(getHwCategory({ shop: 'pottery' })).toBe('Artisanat');
    });
    it('valeurs historic ambiguës moissonnées → null (triage « A définir »)', () => {
        for (const v of ['tower', 'palace', 'monastery', 'aqueduct', 'manor', 'wayside_shrine', 'heritage']) {
            expect(getHwCategory({ historic: v }), v).toBeNull();
        }
    });
    it('un lieu de culte prime sur un man_made co-tagué', () => {
        // ex. minaret tagué man_made=tower + amenity=place_of_worship → reste Mosquée
        expect(getHwCategory({ amenity: 'place_of_worship', religion: 'muslim', man_made: 'tower' })).toBe('Mosquée');
    });
});

// P5 — routage du nom OSM vers le bon champ FR/AR (un nom en arabe ne doit PAS
// finir dans « Nom du site FR »).
describe('scout-categories — isArabicText', () => {
    it('détecte l’écriture arabe (bloc + formes de présentation)', () => {
        expect(isArabicText('جامع الرحمة')).toBe(true);
        expect(isArabicText('الموقع الاثري نيابوليس')).toBe(true);
        expect(isArabicText('ﻷ')).toBe(true);            // forme de présentation (lam-alef)
    });
    it('est false pour le latin, les chiffres, le vide et le non-string', () => {
        expect(isArabicText('Mosquée Bazin')).toBe(false);
        expect(isArabicText('Borj El Kébir')).toBe(false);
        expect(isArabicText('12345')).toBe(false);
        expect(isArabicText('')).toBe(false);
        expect(isArabicText(null)).toBe(false);
        expect(isArabicText(undefined)).toBe(false);
    });
    it('est true dès qu’un caractère arabe est présent (mixte)', () => {
        expect(isArabicText('Mosquée جامع')).toBe(true);
    });
});

describe('scout-categories — resolveOsmNames (routage FR/AR)', () => {
    it('name:fr + name:ar → chacun dans son champ', () => {
        expect(resolveOsmNames({ 'name:fr': 'Mosquée Bazin', 'name:ar': 'جامع بازين' }))
            .toEqual({ nameFr: 'Mosquée Bazin', nameAr: 'جامع بازين' });
    });
    it('name:fr seul + name brut arabe → FR explicite, AR depuis le brut', () => {
        expect(resolveOsmNames({ 'name:fr': 'Grande Mosquée', name: 'جامع الرحمة' }))
            .toEqual({ nameFr: 'Grande Mosquée', nameAr: 'جامع الرحمة' });
    });
    it('name brut latin seul → FR (le bug ne se produit pas pour le latin)', () => {
        expect(resolveOsmNames({ name: 'Borj El Kébir' }))
            .toEqual({ nameFr: 'Borj El Kébir', nameAr: '' });
    });
    it('BUG P5 : name brut arabe seul → AR, FR vide (jamais d’arabe en FR)', () => {
        expect(resolveOsmNames({ name: 'جامع الكونية' }))
            .toEqual({ nameFr: '', nameAr: 'جامع الكونية' });
    });
    it('name:ar seul → AR, FR vide', () => {
        expect(resolveOsmNames({ 'name:ar': 'جامع سيدي محرصي' }))
            .toEqual({ nameFr: '', nameAr: 'جامع سيدي محرصي' });
    });
    it('aucun tag de nom → deux champs vides (candidat sans nom, à compléter)', () => {
        expect(resolveOsmNames({})).toEqual({ nameFr: '', nameAr: '' });
        expect(resolveOsmNames({ amenity: 'place_of_worship' })).toEqual({ nameFr: '', nameAr: '' });
    });
    it('trim les valeurs', () => {
        expect(resolveOsmNames({ 'name:fr': '  Fort  ', 'name:ar': '  جامع  ' }))
            .toEqual({ nameFr: 'Fort', nameAr: 'جامع' });
    });
});
