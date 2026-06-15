// @vitest-environment jsdom
//
// Tests du chantier i18n « noms patrimoniaux » :
//  - getPatrimonialName : nom AFFICHÉ selon la langue (FR ⇄ AR), repli FR, custom prime
//  - getSearchableNames : toutes les variantes de nom (pour la recherche agnostique)
//  - getSearchResults   : recherche AGNOSTIQUE (on trouve en FR OU en arabe quel
//                         que soit le réglage) + exclusion des POIs cachés

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks des dépendances lourdes de data.js (on garde la VRAIE logique de nom) ---
vi.mock('../src/state.js', () => {
    const state = { loadedFeatures: [], hiddenPoiIds: [] };
    return { state, setCurrentMap: vi.fn(), setLoadedFeatures: vi.fn(), setCustomFeatures: vi.fn(), setHiddenPoiIds: vi.fn(), setUserData: vi.fn() };
});
vi.mock('../src/events.js', () => ({ eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }));
vi.mock('../src/database.js', () => ({
    getAllPoiDataForMap: vi.fn(), getAllCircuitsForMap: vi.fn(), savePoiData: vi.fn(),
    getAppState: vi.fn(), saveAppState: vi.fn(), saveCircuit: vi.fn()
}));
vi.mock('../src/logger.js', () => ({ logModification: vi.fn() }));
vi.mock('../src/gist-sync.js', () => ({ schedulePush: vi.fn() }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/admin-control-center.js', () => ({
    addToDraft: vi.fn(), getMigrationId: vi.fn(), getAdminDraft: vi.fn(() => ({ pendingPois: {}, modifications: {} }))
}));
vi.mock('../src/url-utils.js', () => ({ getDomainFromUrl: vi.fn() }));

// utils.js mocké MAIS avec le VRAI cascade getPoiName (copié de utils.js:74) pour
// tester le repli FR réel sans tirer les imports de utils.
vi.mock('../src/utils.js', () => ({
    getPoiId: (f) => f?.properties?.HW_ID || f?.id,
    getPoiName: (feature) => {
        if (!feature || !feature.properties) return 'Lieu sans nom';
        const props = feature.properties;
        const ud = props.userData || {};
        return ud.custom_title || ud['Nom du site FR'] || props['Nom du site FR']
            || ud['Nom du site arabe'] || props['Nom du site AR'] || props.name || 'Lieu inconnu';
    },
    generateHWID: vi.fn(() => 'HW-' + '0'.repeat(26)),
    getZoneFromCoords: vi.fn(() => 'Zone'),
    isCandidate: vi.fn(() => false),
}));

// La langue courante des noms est mockée → pilotable par test.
const langMock = { lang: 'fr' };
vi.mock('../src/patrimonial-names.js', () => ({
    getCurrentPatrimonialLang: () => langMock.lang,
    setPatrimonialLang: vi.fn(),
    PATRIMONIAL_LANGS: ['fr', 'ar'],
}));

import { state } from '../src/state.js';
import { getPatrimonialName, getSearchableNames } from '../src/data.js';
import { getSearchResults } from '../src/search.js';

// Helper feature : champs de nom passés à plat dans properties.
function feat(id, props = {}) {
    return { type: 'Feature', properties: { HW_ID: id, ...props }, geometry: { type: 'Point', coordinates: [10, 35] } };
}

beforeEach(() => {
    state.loadedFeatures = [];
    state.hiddenPoiIds = [];
    langMock.lang = 'fr';
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getPatrimonialName', () => {
    const arPoi = feat('p1', { 'Nom du site FR': 'Mosquée Bazin', 'Nom du site arabe': 'جامع بازين' });

    it('AR : renvoie le nom arabe si présent', () => {
        expect(getPatrimonialName(arPoi, 'ar')).toBe('جامع بازين');
    });

    it('FR : renvoie le nom français même si un nom arabe existe', () => {
        expect(getPatrimonialName(arPoi, 'fr')).toBe('Mosquée Bazin');
    });

    it('AR : repli sur le FR si aucun nom arabe', () => {
        const f = feat('p2', { 'Nom du site FR': 'Café du Port' });
        expect(getPatrimonialName(f, 'ar')).toBe('Café du Port');
    });

    it('AR : un renommage explicite (custom_title) prime sur le nom arabe', () => {
        const f = feat('p3', { 'Nom du site arabe': 'جامع', userData: { custom_title: 'Ma mosquée' } });
        expect(getPatrimonialName(f, 'ar')).toBe('Ma mosquée');
    });

    it('lang absent : utilise la langue courante (mock = fr)', () => {
        langMock.lang = 'ar';
        expect(getPatrimonialName(arPoi)).toBe('جامع بازين');
        langMock.lang = 'fr';
        expect(getPatrimonialName(arPoi)).toBe('Mosquée Bazin');
    });

    it('lit aussi le nom arabe depuis userData', () => {
        const f = feat('p4', { 'Nom du site FR': 'X', userData: { 'Nom du site arabe': 'عربي' } });
        expect(getPatrimonialName(f, 'ar')).toBe('عربي');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getSearchableNames', () => {
    it('renvoie toutes les variantes non vides (custom + FR + arabe + brut)', () => {
        const f = feat('p1', {
            'Nom du site FR': 'Mosquée Bazin', 'Nom du site arabe': 'جامع بازين',
            name: 'bazin_raw', userData: { custom_title: 'Mon spot' }
        });
        const names = getSearchableNames(f);
        expect(names).toContain('Mon spot');
        expect(names).toContain('Mosquée Bazin');
        expect(names).toContain('جامع بازين');
        expect(names).toContain('bazin_raw');
    });

    it('exclut les valeurs vides ou blanches', () => {
        const f = feat('p2', { 'Nom du site FR': 'Seul', 'Nom du site arabe': '   ', name: '' });
        expect(getSearchableNames(f)).toEqual(['Seul']);
    });

    it('feature sans properties → []', () => {
        expect(getSearchableNames({})).toEqual([]);
        expect(getSearchableNames(null)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getSearchResults — recherche agnostique à la langue', () => {
    const f1 = feat('a', { 'Nom du site FR': 'Mosquée Bazin', 'Nom du site arabe': 'جامع بازين' });
    const f2 = feat('b', { 'Nom du site FR': 'Borj El Kébir' });

    it('mode FR : taper en ARABE trouve quand même le lieu', () => {
        langMock.lang = 'fr';
        const r = getSearchResults('جامع', [f1, f2]);
        expect(r.map(f => f.properties.HW_ID)).toEqual(['a']);
    });

    it('mode AR : taper en FRANÇAIS trouve quand même le lieu', () => {
        langMock.lang = 'ar';
        const r = getSearchResults('bazin', [f1, f2]);
        expect(r.map(f => f.properties.HW_ID)).toEqual(['a']);
    });

    it('matche un renommage perso (custom_title)', () => {
        const f3 = feat('c', { 'Nom du site FR': 'Officiel', userData: { custom_title: 'Mon coin secret' } });
        const r = getSearchResults('secret', [f1, f3]);
        expect(r.map(f => f.properties.HW_ID)).toEqual(['c']);
    });

    it('exclut les POIs cachés (hiddenPoiIds)', () => {
        state.hiddenPoiIds = ['a'];
        const r = getSearchResults('بازين', [f1]);
        expect(r).toHaveLength(0);
    });

    it('requête vide → []', () => {
        expect(getSearchResults('  ', [f1, f2])).toEqual([]);
    });
});
