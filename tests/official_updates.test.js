import { describe, it, expect } from 'vitest';
import { newOfficialBases, findOfficialUpdates, pruneOfficialBases, OFFICIAL_BASE_KEY } from '../src/overlay-base.js';

// Fiche officielle mise à jour depuis la modification d'un user (20/11/2026,
// PR 4 « synchro users ») : valeur officielle notée à la première modification.

describe('newOfficialBases', () => {
    const official = { description: 'Texte officiel.', 'Nom du site FR': 'Fadhloun' };
    it('note la valeur officielle du champ qui entre dans l’overlay', () => {
        expect(newOfficialBases(null, { description: 'Ma version.' }, official)).toEqual({ description: 'Texte officiel.' });
    });
    it('champ officiel absent : null', () => {
        expect(newOfficialBases(null, { Horaires: '8h-12h' }, official)).toEqual({ Horaires: null });
    });
    it('ne renote pas un champ déjà modifié, ni les champs perso, techniques ou la position', () => {
        const existing = { description: 'Ma version.', [OFFICIAL_BASE_KEY]: { description: 'Ancien officiel.' } };
        expect(newOfficialBases(existing, { description: 'Ma version 2.', notes: 'x', vu: true, lat: 1, lng: 2, _fieldDates: {} }, official)).toBeNull();
    });
    it('champ déjà présent sans valeur notée (avant le 20/11/2026) : rien', () => {
        expect(newOfficialBases({ description: 'Ancienne modif' }, { description: 'Encore' }, official)).toBeNull();
    });
});

describe('findOfficialUpdates', () => {
    const ud = (local, base) => ({ description: local, [OFFICIAL_BASE_KEY]: { description: base } });
    it('officiel inchangé : rien', () => {
        expect(findOfficialUpdates(ud('Ma version.', 'Officiel.'), { description: 'Officiel.' })).toEqual({ updates: [], obsolete: [] });
    });
    it('officiel changé depuis : mise à jour', () => {
        const r = findOfficialUpdates(ud('Ma version.', 'Officiel.'), { description: 'Officiel corrigé.' });
        expect(r.updates).toEqual([{ key: 'description', kind: 'text', base: 'Officiel.', official: 'Officiel corrigé.', local: 'Ma version.' }]);
    });
    it('officiel devenu identique à la version du user : modification inutile', () => {
        expect(findOfficialUpdates(ud('Ma version.', 'Officiel.'), { description: ' Ma version. ' }).obsolete).toEqual(['description']);
    });
    it('sans valeur notée : rien (ancienne modification)', () => {
        expect(findOfficialUpdates({ description: 'x' }, { description: 'y' })).toEqual({ updates: [], obsolete: [] });
    });
});

describe('pruneOfficialBases', () => {
    it('retire la valeur notée d’un champ qui a quitté l’overlay', () => {
        const o = { notes: 'n', [OFFICIAL_BASE_KEY]: { description: 'Officiel.' } };
        pruneOfficialBases(o);
        expect(o[OFFICIAL_BASE_KEY]).toBeUndefined();
    });
});
