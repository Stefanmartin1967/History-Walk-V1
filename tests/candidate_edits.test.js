import { describe, it, expect } from 'vitest';
import { ORIG_KEY, noteCandidateOriginals, noteCandidatePosition, candidateChanges } from '../src/candidate-edits.js';

// Candidats Scout gardés sur l'appareil (18/11/2026, point 2) : valeur capturée
// notée au premier changement, comparée par le Centre de contrôle.
const cand = (props = {}, coords = [10.9, 33.8]) => ({ geometry: { coordinates: coords }, properties: { candidate: true, 'Nom du site FR': '', 'Catégorie': 'A définir', ...props } });

describe('noteCandidateOriginals', () => {
    it('note la valeur capturée, une seule fois par champ', () => {
        const f = cand();
        noteCandidateOriginals(f.properties, { 'Nom du site FR': 'Marabout X' });
        f.properties['Nom du site FR'] = 'Marabout X';
        noteCandidateOriginals(f.properties, { 'Nom du site FR': 'Marabout Y' });
        expect(f.properties[ORIG_KEY]).toEqual({ 'Nom du site FR': '' });
    });
    it('ignore un lieu qui n’est pas candidat, et la validation', () => {
        const f = { properties: { 'Catégorie': 'Mosquée' } };
        noteCandidateOriginals(f.properties, { 'Catégorie': 'Mausolée' });
        expect(f.properties[ORIG_KEY]).toBeUndefined();
        const c = cand();
        noteCandidateOriginals(c.properties, { candidate: false });
        expect(c.properties[ORIG_KEY]).toBeUndefined();
    });
});

describe('candidateChanges', () => {
    it('liste nom et position changés depuis la capture', () => {
        const f = cand();
        noteCandidateOriginals(f.properties, { 'Nom du site FR': 'Marabout X' });
        f.properties['Nom du site FR'] = 'Marabout X';
        noteCandidatePosition(f.properties, f.geometry.coordinates);
        f.geometry.coordinates = [10.9001, 33.8002];
        expect(candidateChanges(f)).toEqual([
            { key: 'Nom du site FR', rawKey: 'Nom du site FR', old: '—', new: 'Marabout X' },
            { key: 'Position', rawKey: 'position', old: '33.80000, 10.90000', new: '33.80020, 10.90010' },
        ]);
    });
    it('revenu à la valeur capturée : plus rien à montrer', () => {
        const f = cand({ 'Catégorie': 'A définir' });
        noteCandidateOriginals(f.properties, { 'Catégorie': 'Chapelle' });
        expect(candidateChanges(f)).toEqual([]);
    });
});
