import { describe, it, expect } from 'vitest';
import { mergeCircuitPair, mergeCircuitLists, takePart, lastTouched } from '../src/circuit-merge.js';
import { circuitPartStamps, circuitPart } from '../src/field-dates.js';

// Circuits perso réunis morceau par morceau (synchro Google, PR 7, maquette
// écrans 43-46 validée par Stefan le 20/11/2026).

const c = (over = {}) => ({
    id: 'c1', name: 'Boucle', description: 'Texte', poiIds: ['A', 'B'], realTrack: [[1, 1], [2, 2]], transport: { bus: 1 },
    updatedAt: 1000, _partDates: { name: 1000, description: 1000, steps: 1000, trace: 1000 }, ...over,
});

describe('circuitPartStamps', () => {
    it('ne date que le morceau qui change, et retient la date dont il part', () => {
        const before = c();
        const st = circuitPartStamps(before, { ...before, poiIds: ['A', 'B', 'C'] }, 5000);
        expect(st._partDates).toEqual({ name: 1000, description: 1000, steps: 5000, trace: 1000 });
        expect(st._partFrom).toEqual({ steps: 1000 });
    });
    it('le tracé comprend le reste du contenu (transport…), pas le nom ni les étapes', () => {
        const a = c();
        expect(circuitPart(a, 'trace')).toBe(circuitPart({ ...a, name: 'Autre', poiIds: ['Z'] }, 'trace'));
        expect(circuitPart(a, 'trace')).not.toBe(circuitPart({ ...a, transport: { bus: 2 } }, 'trace'));
    });
    it('une date apportée (fusion) est gardée', () => {
        const st = circuitPartStamps(c(), { ...c(), name: 'X', _partDates: { ...c()._partDates, name: 3000 } }, 9000);
        expect(st._partDates.name).toBe(3000);
    });
    it('circuit d’avant la PR 7 (sans dates par morceau) : départ = sa date d’ensemble', () => {
        const old = { id: 'c1', name: 'Boucle', poiIds: ['A'], updatedAt: 700 };
        const st = circuitPartStamps(old, { ...old, name: 'Neuf' }, 9000);
        expect(st._partFrom.name).toBe(700);
    });
});

describe('mergeCircuitPair', () => {
    it('un morceau changé d’un seul côté passe ; les autres restent', () => {
        const here = c({ name: 'Boucle du nord', _partDates: { name: 2000, description: 1000, steps: 1000, trace: 1000 }, _partFrom: { name: 1000 } });
        const file = c({ poiIds: ['A', 'B', 'C'], _partDates: { name: 1000, description: 1000, steps: 3000, trace: 1000 }, _partFrom: { steps: 1000 } });
        const r = mergeCircuitPair(here, file);
        expect(r.conflicts).toEqual([]);
        expect(r.next.name).toBe('Boucle du nord');
        expect(r.next.poiIds).toEqual(['A', 'B', 'C']);
        expect(r.next._partDates.steps).toBe(3000);
    });
    it('nom écrit des deux côtés : à choisir, comme un texte', () => {
        const here = c({ name: 'Nord', _partDates: { name: 2000 } });
        const file = c({ name: 'Sud', _partDates: { name: 3000 } });
        const r = mergeCircuitPair(here, file);
        expect(r.conflicts).toEqual([{ key: 'name', here: 'Nord', file: 'Sud', fileDate: 3000 }]);
    });
    it('Corbeille : le geste le plus récent gagne', () => {
        const r = mergeCircuitPair(c({ isDeleted: false, trashUpdatedAt: 2000 }), c({ isDeleted: true, trashUpdatedAt: 3000 }));
        expect(r.next.isDeleted).toBe(true);
    });
    it('fait : le plus récent ; sans date, « fait » gagne', () => {
        expect(mergeCircuitPair(c({ isCompleted: true, completedUpdatedAt: 4000 }), c({ isCompleted: false, completedUpdatedAt: 3000 })).next).toBeNull();
        expect(mergeCircuitPair(c(), c({ isCompleted: true })).next.isCompleted).toBe(true);
    });
});

describe('takePart', () => {
    it('le tracé remplace aussi les clés que l’autre version n’a plus', () => {
        const target = c({ routing: { variant: 'paths' } });
        takePart(target, c({ realTrack: [[5, 5], [6, 6]] }), 'trace', 9000, 1000);
        expect(target.realTrack).toEqual([[5, 5], [6, 6]]);
        expect(target.routing).toBeUndefined();
        expect(target.name).toBe('Boucle');
        expect(target._partDates.trace).toBe(9000);
        expect(target._partFrom.trace).toBe(1000);
    });
});

describe('mergeCircuitLists et suppressions', () => {
    it('un circuit supprimé ailleurs n’est pas repris depuis le compte', () => {
        const r = mergeCircuitLists([], [c()], { c1: 5000 });
        expect(r.toSave).toEqual([]);
    });
    it('restauré ici après la suppression : il vit (le geste le plus récent)', () => {
        const here = c({ isDeleted: false, trashUpdatedAt: 8000 });
        const r = mergeCircuitLists([here], [], { c1: 5000 });
        expect(r.toDelete).toEqual([]);
        expect(r.survivors).toEqual([]);
    });
    it('les circuits officiels ne sont jamais réunis ici', () => {
        expect(mergeCircuitLists([], [{ ...c(), isOfficial: true }], {}).toSave).toEqual([]);
    });
    it('lastTouched prend la date la plus récente du circuit', () => {
        expect(lastTouched(c({ trashUpdatedAt: 7000 }))).toBe(7000);
    });
});
