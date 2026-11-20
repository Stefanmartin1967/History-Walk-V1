import { describe, it, expect } from 'vitest';
import { decideField, mergePoiData, mergePlaces, mergeCircuits, mergeBackup } from '../src/restore-merge.js';

// PR 2 du chantier « synchro users » (19/11/2026) : la restauration réunit au
// lieu de remplacer. Maquette écrans 17-19 validée.

const D = '_fieldDates', F = '_fieldFrom';

describe('decideField', () => {
    it('même valeur : rien à décider', () => {
        expect(decideField({ value: 'A', date: 1 }, { value: 'A', date: 9 })).toBe('same');
    });
    it('aucune date des deux côtés (appli pas publiée) : le fichier gagne, comme avant', () => {
        expect(decideField({ value: 'A' }, { value: 'B' })).toBe('file');
    });
    it('le PC a corrigé le texte reçu du téléphone : il en descend, il gagne sans question', () => {
        expect(decideField({ value: 'Corrigé', date: 20, from: 10 }, { value: 'Reçu', date: 10 })).toBe('here');
    });
    it('le fichier descend de la version d’ici : le fichier gagne', () => {
        expect(decideField({ value: 'Ici', date: 10 }, { value: 'Suite', date: 20, from: 10 })).toBe('file');
    });
    it('chacun de son côté depuis la même version : les deux', () => {
        expect(decideField({ value: 'Ici', date: 20, from: 5 }, { value: 'Là-bas', date: 15, from: 5 })).toBe('both');
    });
    it('fichier plus ancien que la version dont ici est parti : ici gagne (chaîne de corrections)', () => {
        expect(decideField({ value: 'C', date: 30, from: 20 }, { value: 'A', date: 10 })).toBe('here');
    });
});

describe('mergePoiData (une fiche)', () => {
    it('champ repris du fichier : sa valeur officielle notée le suit (20/11/2026)', () => {
        const r = mergePoiData(
            { description: 'Ici', [D]: { description: 10 }, _officialBase: { description: 'Officiel ancien' } },
            { description: 'Là-bas', [D]: { description: 20 }, [F]: { description: 10 }, _officialBase: { description: 'Officiel' } });
        expect(r.data.description).toBe('Là-bas');
        expect(r.data._officialBase).toEqual({ description: 'Officiel' });
    });
    it('note ajoutée sur le téléphone, absente du PC : ajoutée', () => {
        const r = mergePoiData({}, { notes: 'Panneau n° 5', [D]: { notes: 10 } });
        expect(r.data.notes).toBe('Panneau n° 5');
        expect(r.addedNote).toBe(true);
    });
    it('description absente du fichier, sans date : gardée ici (un vieux fichier n’efface rien)', () => {
        const r = mergePoiData({ description: 'Écrite depuis', [D]: { description: 30 } }, { notes: 'x', [D]: { notes: 10 } });
        expect(r.data.description).toBe('Écrite depuis');
    });
    it('texte écrit des deux côtés : conflit, la version d’ici reste en attendant', () => {
        const r = mergePoiData(
            { description: 'Version PC', [D]: { description: 20 }, [F]: { description: 5 } },
            { description: 'Version téléphone', [D]: { description: 15 }, [F]: { description: 5 } },
        );
        expect(r.data).toBeNull();
        expect(r.conflicts).toEqual([{ key: 'description', here: 'Version PC', file: 'Version téléphone', fileDate: 15, fileFrom: 5 }]);
    });
    it('position déplacée des deux côtés : pas de question, la plus récente gagne', () => {
        const r = mergePoiData(
            { lat: 1, lng: 2, [D]: { lat: 20, lng: 20 }, [F]: { lat: 5, lng: 5 } },
            { lat: 3, lng: 4, [D]: { lat: 25, lng: 25 }, [F]: { lat: 5, lng: 5 } },
        );
        expect(r.data).toMatchObject({ lat: 3, lng: 4 });
        expect(r.data[D]).toMatchObject({ lat: 25, lng: 25 });
        expect(r.conflicts).toEqual([]);
    });
    it('visite cochée sur le téléphone : ajoutée', () => {
        const r = mergePoiData({}, { vuManual: true, vuUpdatedAt: 50 });
        expect(r.data.vuManual).toBe(true);
        expect(r.addedVisit).toBe(true);
    });
    it('Incontournable retiré ici plus tard : gardé retiré', () => {
        const r = mergePoiData({ incontournable: false, incontournableUpdatedAt: 30 }, { incontournable: true, incontournableUpdatedAt: 20 });
        expect(r.data).toBeNull();
    });
});

describe('mergePlaces (lieux créés)', () => {
    const place = (id, props = {}, coords = [4.4, 50.3]) => ({ type: 'Feature', properties: { HW_ID: id, ...props }, geometry: { type: 'Point', coordinates: coords } });
    it('lieu créé sur le téléphone : ajouté au PC', () => {
        const r = mergePlaces([place('A')], [place('B', { 'Nom du site FR': 'Chapelle Saint-Fiacre' })]);
        expect(r.places.map(f => f.properties.HW_ID)).toEqual(['A', 'B']);
        expect(r.added).toHaveLength(1);
    });
    it('même lieu, renommé dans le fichier après : renommé ici', () => {
        const here = place('A', { 'Nom du site FR': 'Chapelle', [D]: { 'Nom du site FR': 10 } });
        const file = place('A', { 'Nom du site FR': 'Chapelle Saint-Fiacre', [D]: { 'Nom du site FR': 20 }, [F]: { 'Nom du site FR': 10 } });
        const r = mergePlaces([here], [file]);
        expect(r.places[0].properties['Nom du site FR']).toBe('Chapelle Saint-Fiacre');
    });
});

describe('mergeCircuits (circuits perso)', () => {
    const c = (o) => ({ id: 'c1', name: 'Boucle', poiIds: ['a'], ...o });
    it('circuit préparé sur le PC après la sauvegarde : gardé (n’est plus effacé)', () => {
        const r = mergeCircuits([c({ id: 'pc', name: 'Préparé sur le PC' })], [c()]);
        expect(r.toSave.map(x => x.id)).toEqual(['c1']); // ajouté
        expect(r.added).toHaveLength(1);
    });
    it('modifié ici plus tard : gardé ici', () => {
        const r = mergeCircuits([c({ poiIds: ['a', 'b'], updatedAt: 30 })], [c({ updatedAt: 20 })]);
        expect(r.toSave).toEqual([]);
        expect(r.kept).toHaveLength(1);
    });
    it('mis à la Corbeille dans le fichier plus tard : à la Corbeille ici aussi', () => {
        const r = mergeCircuits([c({ updatedAt: 10, trashUpdatedAt: 5 })], [c({ updatedAt: 10, isDeleted: true, trashUpdatedAt: 40 })]);
        expect(r.toSave[0].isDeleted).toBe(true);
    });
    it('copie d’un circuit officiel dans le fichier : écartée', () => {
        expect(mergeCircuits([], [c({ isOfficial: true })]).toSave).toEqual([]);
    });
});

describe('mergeBackup (résumé)', () => {
    it('compte ce qui est ajouté, mis à jour, gardé, et liste les textes à choisir', () => {
        const here = {
            userData: {
                G: { description: 'PC', [D]: { description: 20 }, [F]: { description: 5 } },
                M: { description: 'Ancienne', [D]: { description: 10 } },
                K: { notes: 'Gardée', [D]: { notes: 40 }, [F]: { notes: 10 } },
            },
            places: [], circuits: [], hiddenPoiIds: ['h1'],
        };
        const file = {
            userData: {
                G: { description: 'Téléphone', [D]: { description: 15 }, [F]: { description: 5 } },
                M: { description: 'Nouvelle', [D]: { description: 30 }, [F]: { description: 10 } },
                K: { notes: 'Vieille', [D]: { notes: 10 } },
                V: { vuManual: true, vuUpdatedAt: 5 },
            },
            places: [], circuits: [{ id: 'c9', name: 'Boucle', poiIds: [] }], hiddenPoiIds: ['h2'],
        };
        const r = mergeBackup(here, file);
        expect(r.summary.visits).toBe(1);
        expect(r.summary.updated).toEqual(['M']);
        expect(r.summary.kept).toEqual(['K']);
        expect(r.summary.circuits).toEqual(['Boucle']);
        expect(r.conflicts.map(c => c.id)).toEqual(['G']);
        expect(r.hiddenPoiIds.sort()).toEqual(['h1', 'h2']);
    });
});
