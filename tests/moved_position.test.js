import { describe, it, expect } from 'vitest';
import { movedPosition, applyMovedPosition } from '../src/utils.js';

// Lieu déplacé (userData.lat/lng) rejoué au démarrage, PC et téléphone
// (17/11/2026 : le démarrage mobile ne le faisait pas).
describe('movedPosition / applyMovedPosition', () => {
    it('lit une position en nombres ou en texte', () => {
        expect(movedPosition({ lat: 50.36, lng: 4.45 })).toEqual([4.45, 50.36]);
        expect(movedPosition({ lat: '50.36', lng: '4.45' })).toEqual([4.45, 50.36]);
    });

    it('ignore une position absente ou illisible', () => {
        expect(movedPosition(null)).toBeNull();
        expect(movedPosition({ notes: 'x' })).toBeNull();
        expect(movedPosition({ lat: 'abc', lng: 4 })).toBeNull();
        expect(movedPosition({ lat: '', lng: '' })).toBeNull();
        expect(movedPosition({ lat: 0, lng: 0 })).toBeNull();
    });

    it('pose la nouvelle place sur la géométrie', () => {
        const f = { geometry: { type: 'Point', coordinates: [4.4592714, 50.3627415] } };
        expect(applyMovedPosition(f, { lat: 50.3630564, lng: 4.4594862 })).toBe(true);
        expect(f.geometry.coordinates).toEqual([4.4594862, 50.3630564]);
        expect(applyMovedPosition(f, {})).toBe(false);
        expect(f.geometry.coordinates).toEqual([4.4594862, 50.3630564]);
    });
});
