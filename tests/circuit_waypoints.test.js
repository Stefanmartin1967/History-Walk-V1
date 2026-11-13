// @vitest-environment jsdom
// Points de passage enregistrés avec le circuit (src/circuit-waypoints.js).
// Chantier points de passage permanents, PR 2 (13/11/2026).
import { describe, it, expect } from 'vitest';
import {
    passageKeys, savedToBySeg, draftToSaved, compactWaypoints, remapWaypoints,
} from '../src/circuit-waypoints.js';

const D = 0.001; // ~111 m de latitude

describe('passageKeys', () => {
    it('une clé par passage, rang si la paire revient', () => {
        expect(passageKeys(['A', 'B', 'A', 'B'])).toEqual(['A>B#0', 'B>A#0', 'A>B#1']);
        expect(passageKeys(['A'])).toEqual([]);
    });
});

describe('aller-retour session ↔ enregistrement', () => {
    const ids = ['A', 'B', 'C'];
    it('draftToSaved garde l’ordre et range par paire', () => {
        const draft = [
            { seg: 1, lat: 50.1, lng: 4.1 }, { seg: 0, lat: 50.2, lng: 4.2 }, { seg: 1, lat: 50.3, lng: 4.3 },
        ];
        expect(draftToSaved(draft, ids)).toEqual({ 'A>B#0': [[50.2, 4.2]], 'B>C#0': [[50.1, 4.1], [50.3, 4.3]] });
    });
    it('aucun point : null', () => {
        expect(draftToSaved([], ids)).toBeNull();
        expect(compactWaypoints({ 'A>B#0': [] })).toBeNull();
    });
    it('savedToBySeg : forme de routeCircuit', () => {
        expect(savedToBySeg({ 'B>C#0': [[50.1, 4.1]] }, ids)).toEqual({ 1: [{ lat: 50.1, lng: 4.1 }] });
    });
    it('arrondi à 6 décimales', () => {
        expect(draftToSaved([{ seg: 0, lat: 50.12345678, lng: 4.98765432 }], ids)).toEqual({ 'A>B#0': [[50.123457, 4.987654]] });
    });
});

describe('remapWaypoints — la liste des lieux change', () => {
    it('séquence inchangée ou autre passage touché : les points restent', () => {
        const saved = { 'A>B#0': [[1, 1]], 'B>C#0': [[2, 2]] };
        expect(remapWaypoints(saved, { ids: ['A', 'B', 'C'] }, { ids: ['A', 'B', 'C', 'D'] }))
            .toEqual({ 'A>B#0': [[1, 1]], 'B>C#0': [[2, 2]] });
    });

    it('lieu retiré : ses deux passages fusionnent, dans l’ordre (décision 1)', () => {
        const saved = { 'A>B#0': [[1, 1], [2, 2]], 'B>C#0': [[3, 3]], 'C>D#0': [[4, 4]] };
        expect(remapWaypoints(saved, { ids: ['A', 'B', 'C', 'D'] }, { ids: ['A', 'C', 'D'] }))
            .toEqual({ 'A>C#0': [[1, 1], [2, 2], [3, 3]], 'C>D#0': [[4, 4]] });
    });

    it('lieu ajouté au milieu : points répartis selon l’ancien tracé', () => {
        // Ancien passage A→C vers le nord, 1 km ; B ajouté à mi-chemin.
        const coords = Array.from({ length: 11 }, (_, i) => [50 + i * D, 4]);
        const saved = { 'A>C#0': [[50 + 2 * D, 4], [50 + 4 * D, 4], [50 + 7 * D, 4]] };
        const anchors = [[4, 50], [4, 50 + 5 * D], [4, 50 + 10 * D]]; // [lon, lat]
        const r = remapWaypoints(saved, { ids: ['A', 'C'], segments: [{ coords }] }, { ids: ['A', 'B', 'C'], anchors });
        expect(r).toEqual({ 'A>B#0': [[50 + 2 * D, 4], [50 + 4 * D, 4]], 'B>C#0': [[50 + 7 * D, 4]] });
    });

    it('boucle : l’ancien tracé décide, pas la distance au nouveau lieu', () => {
        // Ancien passage A→C : part vers le nord par l'ouest, revient par l'est.
        const up = Array.from({ length: 6 }, (_, i) => [50 + i * D, 4]);
        const down = Array.from({ length: 6 }, (_, i) => [50 + (5 - i) * D, 4.002]);
        const coords = [...up, ...down];
        // B ajouté en haut de la boucle ; un point à l'aller (bas ouest), un au retour (bas est).
        const saved = { 'A>C#0': [[50 + D, 4], [50 + D, 4.002]] };
        const anchors = [[4, 50], [4.001, 50 + 5 * D], [4.002, 50]];
        const r = remapWaypoints(saved, { ids: ['A', 'C'], segments: [{ coords }] }, { ids: ['A', 'B', 'C'], anchors });
        expect(r).toEqual({ 'A>B#0': [[50 + D, 4]], 'B>C#0': [[50 + D, 4.002]] });
    });

    it('sans ancien tracé : réparti le long des lignes droites entre lieux', () => {
        const saved = { 'A>C#0': [[50 + 2 * D, 4], [50 + 8 * D, 4]] };
        const anchors = [[4, 50], [4, 50 + 5 * D], [4, 50 + 10 * D]];
        expect(remapWaypoints(saved, { ids: ['A', 'C'] }, { ids: ['A', 'B', 'C'], anchors }))
            .toEqual({ 'A>B#0': [[50 + 2 * D, 4]], 'B>C#0': [[50 + 8 * D, 4]] });
    });

    it('lieux réordonnés sans lien : les points du passage disparu sont abandonnés', () => {
        const saved = { 'A>B#0': [[1, 1]], 'B>C#0': [[2, 2]] };
        expect(remapWaypoints(saved, { ids: ['A', 'B', 'C'] }, { ids: ['B', 'A', 'C'] })).toBeNull();
    });

    it('séquence d’origine inconnue : seules les paires identiques passent', () => {
        expect(remapWaypoints({ 'A>B#0': [[1, 1]], 'X>Y#0': [[2, 2]] }, null, { ids: ['A', 'B'] }))
            .toEqual({ 'A>B#0': [[1, 1]] });
        expect(remapWaypoints(null, { ids: ['A', 'B'] }, { ids: ['A', 'B'] })).toBeNull();
    });
});
