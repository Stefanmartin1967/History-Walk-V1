import { describe, it, expect } from 'vitest';
import { mergedFieldDates, datesAfterRemoval, stampCreatedPlaces, circuitUpdatedAt, FIELD_DATES_KEY } from '../src/field-dates.js';

// PR 1 du chantier « synchro users » (19/11/2026) : la date de changement de
// chaque donnée, fondation de la restauration qui fusionne et de la synchro.

describe('mergedFieldDates (fiches)', () => {
    it('champ modifié : daté maintenant ; champ inchangé : non', () => {
        const existing = { description: 'Ancienne', notes: 'Même' };
        expect(mergedFieldDates(existing, { description: 'Nouvelle', notes: 'Même' }, 100))
            .toEqual({ description: 100 });
    });

    it('les dates déjà posées sont gardées', () => {
        const existing = { description: 'A', [FIELD_DATES_KEY]: { notes: 50 } };
        expect(mergedFieldDates(existing, { description: 'B' }, 100)).toEqual({ notes: 50, description: 100 });
    });

    it('fiche réécrite entière sans changement : rien', () => {
        const existing = { description: 'A', [FIELD_DATES_KEY]: { description: 50 } };
        expect(mergedFieldDates(existing, { ...existing }, 100)).toBeNull();
    });

    it('un false écrit par défaut à la place d’un champ absent ne compte pas', () => {
        expect(mergedFieldDates({}, { verified: false, Prix: '' }, 100)).toBeNull();
    });

    it('date apportée par une fusion (autre appareil) : gardée telle quelle', () => {
        const existing = { description: 'A', [FIELD_DATES_KEY]: { description: 50 } };
        expect(mergedFieldDates(existing, { description: 'B', [FIELD_DATES_KEY]: { description: 80 } }, 100))
            .toEqual({ description: 80 });
    });

    it('les clés techniques ne sont jamais datées', () => {
        expect(mergedFieldDates({}, { _baseSha: { lat: 'x' }, noteSync: { sha: 's' }, vu: true, vuUpdatedAt: 5 }, 100)).toBeNull();
    });

    it('position déplacée : lat et lng datés', () => {
        expect(mergedFieldDates({ lat: 1, lng: 2 }, { lat: 1.5, lng: 2.5 }, 100)).toEqual({ lat: 100, lng: 100 });
    });
});

describe('datesAfterRemoval', () => {
    it('retirer un champ (retour à l’officiel) est daté', () => {
        expect(datesAfterRemoval({ notes: 5 }, ['description'], 100)).toEqual({ notes: 5, description: 100 });
    });
    it('rien à retirer : null', () => {
        expect(datesAfterRemoval({ notes: 5 }, [], 100)).toBeNull();
    });
});

describe('stampCreatedPlaces (lieux créés)', () => {
    const place = (id, props = {}, coords = [4.4, 50.3]) => ({ type: 'Feature', properties: { HW_ID: id, ...props }, geometry: { type: 'Point', coordinates: coords } });

    it('lieu nouveau : tous ses champs datés à la création', () => {
        const next = [place('A', { 'Nom du site FR': 'Chapelle' })];
        stampCreatedPlaces([], next, 100);
        expect(next[0].properties[FIELD_DATES_KEY]).toEqual({ 'Nom du site FR': 100, _position: 100 });
    });

    it('seul le champ modifié est daté ; déplacer le lieu date sa position', () => {
        const prev = [place('A', { 'Nom du site FR': 'Chapelle', description: 'x', [FIELD_DATES_KEY]: { 'Nom du site FR': 10, description: 10, _position: 10 } })];
        const next = [place('A', { 'Nom du site FR': 'Chapelle Saint-Fiacre', description: 'x', [FIELD_DATES_KEY]: { 'Nom du site FR': 10, description: 10, _position: 10 } }, [4.41, 50.3])];
        stampCreatedPlaces(prev, next, 100);
        expect(next[0].properties[FIELD_DATES_KEY]).toEqual({ 'Nom du site FR': 100, description: 10, _position: 100 });
    });

    it('liste réenregistrée sans changement : aucune date ne bouge', () => {
        const prev = [place('A', { 'Nom du site FR': 'Chapelle', [FIELD_DATES_KEY]: { 'Nom du site FR': 10, _position: 10 } })];
        const next = JSON.parse(JSON.stringify(prev));
        expect(stampCreatedPlaces(prev, next, 100)).toBe(0);
        expect(next[0].properties[FIELD_DATES_KEY]).toEqual({ 'Nom du site FR': 10, _position: 10 });
    });
});

describe('circuitUpdatedAt (circuits perso)', () => {
    const c = (o = {}) => ({ id: 'c1', name: 'Boucle', poiIds: ['a', 'b'], ...o });

    it('nouveau circuit : daté', () => {
        expect(circuitUpdatedAt(null, c(), 100)).toBe(100);
    });
    it('étapes changées : daté', () => {
        expect(circuitUpdatedAt(c({ updatedAt: 10 }), c({ poiIds: ['a', 'c'], updatedAt: 10 }), 100)).toBe(100);
    });
    it('rien de changé (ou seulement fait / Corbeille) : date d’avant', () => {
        expect(circuitUpdatedAt(c({ updatedAt: 10 }), c({ updatedAt: 10, isCompleted: true, isDeleted: true }), 100)).toBe(10);
    });
    it('date apportée par une fusion : gardée', () => {
        expect(circuitUpdatedAt(c({ updatedAt: 10 }), c({ poiIds: ['z'], updatedAt: 70 }), 100)).toBe(70);
    });
});
