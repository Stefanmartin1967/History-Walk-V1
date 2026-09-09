// Recherche insensible aux accents, à la casse et aux séparateurs (v3.7.384).
//
// Deux niveaux : la clé de comparaison elle-même (foldForSearch, sans mock), puis
// le VRAI getSearchResults exercé sur des noms réellement présents dans les
// données Djerba — c'est là que le bug se voyait : « tenafsa » ne rendait rien.
import { describe, it, expect, vi } from 'vitest';
import { foldForSearch } from '../src/text-search.js';

vi.mock('../src/state.js', () => ({ state: { loadedFeatures: [], hiddenPoiIds: [] } }));
vi.mock('../src/patrimonial-names.js', () => ({ getCurrentPatrimonialLang: () => 'fr' }));
vi.mock('../src/data.js', () => ({
    getPoiId: (f) => f.properties.HW_ID,
    getPatrimonialName: (f) => f.properties['Nom du site FR'] || '',
    getSearchableNames: (f) => [
        f.properties['Nom du site FR'],
        f.properties['Nom du site arabe'],
    ].filter(Boolean),
}));

import { getSearchResults } from '../src/search.js';
import { state } from '../src/state.js';

let seq = 0;
const poi = (fr, ar) => ({
    type: 'Feature',
    properties: { HW_ID: `HW-TEST-${++seq}`, 'Nom du site FR': fr, 'Nom du site arabe': ar },
    geometry: { type: 'Point', coordinates: [10.9, 33.8] },
});

// Noms réels (public/djerba.geojson + OSM), pas des cas d'école.
const FEATURES = [
    poi('Mosquée Ténafsa', 'جامع بن تنفوس'),
    poi('Mausolée Sidi Saïd'),
    poi('Mosquée Hadherbach'),
    poi('Musée du Patrimoine de Guellala'),
    poi('Mosquée El-Guechaï'),
    poi('Mosquée Ennour', 'جامع النّور'),
    poi('Mosquée de Midoun', 'سيدي يأتي'),
];
const found = (q) => getSearchResults(q, FEATURES).map(f => f.properties['Nom du site FR']);

describe('foldForSearch — la clé de comparaison', () => {
    it('retire les accents et met en minuscules', () => {
        expect(foldForSearch('Mosquée Ténafsa')).toBe(foldForSearch('mosquee tenafsa'));
    });

    it('ignore espaces, tirets et apostrophes (Hadherbach ↔ Hadher Bach)', () => {
        expect(foldForSearch('Hadher Bach')).toBe(foldForSearch('Hadherbach'));
        expect(foldForSearch('El-Guechaï')).toBe(foldForSearch('El Guechai'));
        expect(foldForSearch("Mosquée d’Elyounsiine")).toBe(foldForSearch('Mosquee dElyounsiine'));
    });

    it('retire les harakat arabes et ramène أ/إ/آ à ا', () => {
        expect(foldForSearch('جامع النّور')).toBe(foldForSearch('جامع النور'));
        expect(foldForSearch('سيدي يأتي')).toBe(foldForSearch('سيدي ياتي'));
    });

    it('retire le tatweel, qui est une lettre et survivrait au filtre', () => {
        expect(foldForSearch('جامــع')).toBe(foldForSearch('جامع'));
    });

    it('tolère null / undefined / nombre sans lever', () => {
        expect(foldForSearch(null)).toBe('');
        expect(foldForSearch(undefined)).toBe('');
        expect(foldForSearch(42)).toBe('42');
    });

    it('une saisie faite QUE de séparateurs se replie sur la chaîne vide', () => {
        expect(foldForSearch(" -'· ")).toBe('');
    });
});

describe('getSearchResults — ce que le user tape retrouve ce que la fiche stocke', () => {
    it('« tenafsa » (sans accent) retrouve « Mosquée Ténafsa »', () => {
        expect(found('tenafsa')).toEqual(['Mosquée Ténafsa']);
    });

    it('« ténafsa » (avec accent) marche toujours', () => {
        expect(found('ténafsa')).toEqual(['Mosquée Ténafsa']);
    });

    it('« sidi said » retrouve « Mausolée Sidi Saïd »', () => {
        expect(found('sidi said')).toEqual(['Mausolée Sidi Saïd']);
    });

    it('« musee du patrimoine » retrouve le Musée du Patrimoine', () => {
        expect(found('musee du patrimoine')).toEqual(['Musée du Patrimoine de Guellala']);
    });

    it('« Hadher Bach » (graphie OSM) retrouve « Mosquée Hadherbach »', () => {
        expect(found('Hadher Bach')).toEqual(['Mosquée Hadherbach']);
    });

    it('« el guechai » retrouve « Mosquée El-Guechaï »', () => {
        expect(found('el guechai')).toEqual(['Mosquée El-Guechaï']);
    });

    it('la recherche en arabe reste possible, harakat ou non', () => {
        expect(found('جامع النور')).toEqual(['Mosquée Ennour']);
        expect(found('سيدي ياتي')).toEqual(['Mosquée de Midoun']);
    });

    it('une requête sans correspondance ne rend rien', () => {
        expect(found('houmt souk')).toEqual([]);
    });

    it('une requête faite QUE de séparateurs ne rend RIEN (et surtout pas tout)', () => {
        expect(found(' - ')).toEqual([]);
        expect(getSearchResults('', FEATURES)).toEqual([]);
    });

    it('le repli ne fait pas resurgir un POI masqué', () => {
        state.hiddenPoiIds = [FEATURES[0].properties.HW_ID];
        try {
            expect(found('tenafsa')).toEqual([]);
        } finally {
            state.hiddenPoiIds = [];
        }
    });
});
