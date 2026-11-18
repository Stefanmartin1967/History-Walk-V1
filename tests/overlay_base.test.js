import { describe, it, expect } from 'vitest';
import { BASE_KEY, isTrackedKey, newStamps, pruneStamps, sameValue, kindOf, findConflicts } from '../src/overlay-base.js';

// Conflits à la publication (18/11/2026) : estampille de la version de départ
// et détection.
const S1 = 'a'.repeat(40), S2 = 'b'.repeat(40);

describe('isTrackedKey', () => {
    it('suit les champs publiés, pas les perso ni les internes', () => {
        expect(isTrackedKey('description')).toBe(true);
        expect(isTrackedKey('lat')).toBe(true);
        expect(isTrackedKey('notes')).toBe(false);
        expect(isTrackedKey('vu')).toBe(false);
        expect(isTrackedKey('photos')).toBe(false);
        expect(isTrackedKey('_deleted')).toBe(false);
        expect(isTrackedKey(BASE_KEY)).toBe(false);
    });
});

describe('newStamps', () => {
    it('estampille les champs qui entrent dans l’overlay', () => {
        expect(newStamps({}, { description: 'x', notes: 'n' }, S1)).toEqual({ description: S1 });
        expect(newStamps(null, { lat: 1, lng: 2 }, S1)).toEqual({ lat: S1, lng: S1 });
    });
    it('ne ré-estampille pas, ni un champ ancien sans estampille, ni sans version', () => {
        expect(newStamps({ description: 'x', [BASE_KEY]: { description: S1 } }, { description: 'y' }, S2)).toBeNull();
        expect(newStamps({ description: 'x' }, { description: 'y' }, S2)).toBeNull();
        expect(newStamps({}, { description: 'y' }, null)).toBeNull();
        expect(newStamps({}, { description: 'y', [BASE_KEY]: { description: S1 } }, S2)).toBeNull();
    });
});

describe('pruneStamps', () => {
    it('retire les estampilles des champs disparus', () => {
        const o = { description: 'x', [BASE_KEY]: { description: S1, lat: S1 } };
        expect(pruneStamps(o)[BASE_KEY]).toEqual({ description: S1 });
        const o2 = { notes: 'n', [BASE_KEY]: { lat: S1 } };
        expect(pruneStamps(o2)).toEqual({ notes: 'n' });
    });
});

describe('sameValue / kindOf', () => {
    it('vide = absent ; blancs de bord ignorés', () => {
        expect(sameValue(undefined, '')).toBe(true);
        expect(sameValue('a ', 'a')).toBe(true);
        expect(sameValue([1, 2], [1, 2])).toBe(true);
        expect(sameValue('a', 'b')).toBe(false);
    });
    it('texte pour la description ou un long texte', () => {
        expect(kindOf('description', 'x')).toBe('text');
        expect(kindOf('Accès', 'Extérieur seulement')).toBe('simple');
        expect(kindOf('Nom du site FR', 'x'.repeat(90))).toBe('text');
    });
});

describe('findConflicts', () => {
    const feat = (props, coords = [4.4592714, 50.3627415]) => ({ geometry: { coordinates: coords }, properties: props });
    const baseFeat = feat({ 'Accès': '', description: 'D.' });

    it('en ligne = départ : pas de conflit (modification normale)', () => {
        const ud = { 'Accès': 'Intérieur visitable', [BASE_KEY]: { 'Accès': S1 } };
        expect(findConflicts({ userData: ud, online: baseFeat, onlineSha: S2, baseOf: () => baseFeat })).toEqual([]);
    });

    it('en ligne a changé autrement : conflit', () => {
        const online = feat({ 'Accès': 'Extérieur seulement' });
        const ud = { 'Accès': 'Intérieur visitable', [BASE_KEY]: { 'Accès': S1 } };
        expect(findConflicts({ userData: ud, online, onlineSha: S2, baseOf: () => baseFeat })).toEqual([
            { key: 'Accès', kind: 'simple', base: '', online: 'Extérieur seulement', local: 'Intérieur visitable' },
        ]);
    });

    it('en ligne = ici : pas de conflit', () => {
        const online = feat({ 'Accès': 'Intérieur visitable' });
        const ud = { 'Accès': 'Intérieur visitable', [BASE_KEY]: { 'Accès': S1 } };
        expect(findConflicts({ userData: ud, online, onlineSha: S2, baseOf: () => baseFeat })).toEqual([]);
    });

    it('même version, version illisible ou sans estampille : rien', () => {
        const online = feat({ 'Accès': 'Extérieur seulement' });
        const ud = { 'Accès': 'Intérieur visitable', [BASE_KEY]: { 'Accès': S1 } };
        expect(findConflicts({ userData: ud, online, onlineSha: S1, baseOf: () => baseFeat })).toEqual([]);
        expect(findConflicts({ userData: ud, online, onlineSha: S2, baseOf: () => undefined })).toEqual([]);
        expect(findConflicts({ userData: { 'Accès': 'x' }, online, onlineSha: S2, baseOf: () => baseFeat })).toEqual([]);
    });

    it('position : la grotte publiée ailleurs entre-temps', () => {
        const online = feat({}, [4.4594862, 50.3630564]);
        const ud = { lat: 50.3627674, lng: 4.4595641, [BASE_KEY]: { lat: S1, lng: S1 } };
        const c = findConflicts({ userData: ud, online, onlineSha: S2, baseOf: () => baseFeat });
        expect(c).toHaveLength(1);
        expect(c[0]).toMatchObject({ key: 'position', kind: 'position', online: [50.3630564, 4.4594862], local: [50.3627674, 4.4595641] });
    });

    it('fiche absente de la version de départ : départ vide', () => {
        const online = feat({ description: 'En ligne.' });
        const ud = { description: 'Ici.', [BASE_KEY]: { description: S1 } };
        const c = findConflicts({ userData: ud, online, onlineSha: S2, baseOf: () => null });
        expect(c[0]).toMatchObject({ key: 'description', kind: 'text', base: undefined });
    });
});
