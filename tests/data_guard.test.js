import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    invalidFeatureReason, keepValidFeatures,
    invalidCircuitEntryReason, keepValidCircuitEntries,
    takeInvalidDataReport, invalidDataMessage,
} from '../src/data-guard.js';

// 18/10/2026 — une seule donnée mal formée faisait tomber tout un pan de l'app
// (0 marqueur sur 437, ou aucun circuit officiel). On trie à l'entrée, entrée
// par entrée.

const place = (id, coordinates = [10.85, 33.87], extra = {}) => ({
    type: 'Feature',
    properties: { HW_ID: id, 'Nom du site FR': id },
    geometry: { type: 'Point', coordinates },
    ...extra,
});

let warn;
beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    takeInvalidDataReport(); // repart d'un rapport vide
});
afterEach(() => warn.mockRestore());

describe('invalidFeatureReason', () => {
    it('lieu valide → null', () => {
        expect(invalidFeatureReason(place('HW-A'))).toBeNull();
    });

    it.each([
        ['null', null, "ce n'est pas un objet"],
        ['sans properties', { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] } }, 'pas de properties'],
        ['coordonnées en texte', place('HW-B', ['abc', 'def']), 'position invalide'],
        ['Point sans coordonnées', { ...place('HW-C'), geometry: { type: 'Point' } }, 'position invalide'],
        ['géométrie nulle', { ...place('HW-D'), geometry: null }, 'position invalide'],
        ['une seule coordonnée', place('HW-E', [10.85]), 'position invalide'],
        ['pas un Point', { ...place('HW-F'), geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] } }, 'position invalide'],
    ])('%s → %s', (_label, feature, reason) => {
        expect(invalidFeatureReason(feature)).toBe(reason);
    });
});

describe('keepValidFeatures', () => {
    it('garde les valides dans l\'ordre, écarte les autres, signale chacun', () => {
        const list = [place('HW-1'), place('HW-2', ['x', 'y']), place('HW-3'), null];
        const kept = keepValidFeatures(list, 'djerba.geojson');

        expect(kept.map(f => f.properties.HW_ID)).toEqual(['HW-1', 'HW-3']);
        expect(warn).toHaveBeenCalledTimes(2);
        expect(warn.mock.calls[0][0]).toBe('[Données] Lieu ignoré (djerba.geojson) : HW-2 — position invalide.');
        expect(list).toHaveLength(4); // la liste reçue n'est pas modifiée
    });

    it('tout est valide → même contenu, aucun signalement', () => {
        const list = [place('HW-1'), place('HW-2')];
        expect(keepValidFeatures(list, 'x')).toEqual(list);
        expect(warn).not.toHaveBeenCalled();
        expect(takeInvalidDataReport()).toEqual({ lieux: 0, circuits: 0 });
    });

    it('pas un tableau → []', () => {
        expect(keepValidFeatures(undefined, 'x')).toEqual([]);
        expect(keepValidFeatures({ a: 1 }, 'x')).toEqual([]);
    });
});

describe('invalidCircuitEntryReason', () => {
    it.each([
        ['valide avec id', { id: 'c1', name: 'Circuit', poiIds: ['a'] }, null],
        ['valide sans id mais avec nom', { name: 'Circuit', poiIds: [] }, null],
        ['valide sans poiIds (liste vide, comme avant)', { id: 'c1' }, null],
        ['null', null, "ce n'est pas un objet"],
        ['ni id ni nom', { poiIds: ['x'] }, 'ni identifiant ni nom'],
        ['nom vide', { name: '  ' }, 'ni identifiant ni nom'],
        ['poiIds en texte', { id: 'c1', poiIds: 'abc' }, "poiIds n'est pas une liste"],
    ])('%s', (_label, entry, reason) => {
        expect(invalidCircuitEntryReason(entry)).toBe(reason);
    });
});

describe('keepValidCircuitEntries', () => {
    it('garde les valides, écarte les autres, compte pour le rapport', () => {
        const kept = keepValidCircuitEntries(
            [{ id: 'c1' }, { poiIds: ['x'] }, null, { id: 'c2', poiIds: 'abc' }, { id: 'c3' }],
            'circuits/djerba.json'
        );
        expect(kept.map(e => e.id)).toEqual(['c1', 'c3']);
        expect(takeInvalidDataReport()).toEqual({ lieux: 0, circuits: 3 });
    });
});

describe('rapport et message admin', () => {
    it('takeInvalidDataReport cumule puis remet à zéro', () => {
        keepValidFeatures([place('HW-1', ['x', 'y'])], 'a');
        keepValidCircuitEntries([null], 'b');
        expect(takeInvalidDataReport()).toEqual({ lieux: 1, circuits: 1 });
        expect(takeInvalidDataReport()).toEqual({ lieux: 0, circuits: 0 });
    });

    it.each([
        [{ lieux: 0, circuits: 0 }, null],
        [{ lieux: 1, circuits: 0 }, '1 lieu ignoré : données invalides, à corriger avant de publier (détail dans la console).'],
        [{ lieux: 2, circuits: 0 }, '2 lieux ignorés : données invalides, à corriger avant de publier (détail dans la console).'],
        [{ lieux: 0, circuits: 1 }, '1 circuit ignoré : données invalides, à corriger avant de publier (détail dans la console).'],
        [{ lieux: 1, circuits: 2 }, '1 lieu et 2 circuits ignorés : données invalides, à corriger avant de publier (détail dans la console).'],
    ])('%o → %s', (r, msg) => {
        expect(invalidDataMessage(r)).toBe(msg);
    });
});
