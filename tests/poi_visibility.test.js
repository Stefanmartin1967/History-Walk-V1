import { describe, it, expect, vi, beforeEach } from 'vitest';

// Règle « lieu montré à l'utilisateur » (18/10/2026) : source unique pour la
// carte, la recherche, les catégories mobiles, le menu mobile et le Carnet.

vi.mock('../src/state.js', () => ({ state: { hiddenPoiIds: [], activeFilters: {} } }));

import { state } from '../src/state.js';
import { isDeletedPoi, isHiddenUnconfirmed, isShownToUser } from '../src/poi-visibility.js';

const place = (id, props = {}, userData) => ({
    type: 'Feature',
    properties: { HW_ID: id, ...props, ...(userData ? { userData } : {}) },
    geometry: { type: 'Point', coordinates: [10.9, 33.8] },
});

beforeEach(() => {
    state.hiddenPoiIds = [];
    state.activeFilters = { introuvableCarte: 'hide' };
});

describe('isDeletedPoi', () => {
    it('vrai pour un lieu inscrit dans hiddenPoiIds (supprimé), faux sinon', () => {
        state.hiddenPoiIds = ['HW-A'];
        expect(isDeletedPoi(place('HW-A'))).toBe(true);
        expect(isDeletedPoi(place('HW-B'))).toBe(false);
    });

    it('hiddenPoiIds absent : rien n\'est supprimé', () => {
        state.hiddenPoiIds = undefined;
        expect(isDeletedPoi(place('HW-A'))).toBe(false);
    });
});

describe('isHiddenUnconfirmed', () => {
    it('masqué quand le filtre est « Masquer » (défaut visiteur)', () => {
        expect(isHiddenUnconfirmed(place('HW-A', { introuvableCarte: true }))).toBe(true);
        expect(isHiddenUnconfirmed(place('HW-B'))).toBe(false);
    });

    it('lit l\'overlay : « Existence à confirmer » posé localement compte', () => {
        expect(isHiddenUnconfirmed(place('HW-A', {}, { introuvableCarte: true }))).toBe(true);
    });

    it('filtre « Tous » ou « Afficher seulement » (admin) : pas masqué', () => {
        state.activeFilters = { introuvableCarte: 'all' };
        expect(isHiddenUnconfirmed(place('HW-A', { introuvableCarte: true }))).toBe(false);
        state.activeFilters = { introuvableCarte: 'only' };
        expect(isHiddenUnconfirmed(place('HW-A', { introuvableCarte: true }))).toBe(false);
    });
});

describe('isShownToUser', () => {
    it('ni supprimé ni « Existence à confirmer » masqué → montré', () => {
        expect(isShownToUser(place('HW-A'))).toBe(true);
    });

    it('supprimé → pas montré', () => {
        state.hiddenPoiIds = ['HW-A'];
        expect(isShownToUser(place('HW-A'))).toBe(false);
    });

    it('« Existence à confirmer » masqué → pas montré', () => {
        expect(isShownToUser(place('HW-A', { introuvableCarte: true }))).toBe(false);
    });
});
