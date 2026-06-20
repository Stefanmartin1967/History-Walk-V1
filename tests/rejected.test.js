import { describe, it, expect, beforeEach } from 'vitest';
import { rejectedData, setRejectedData, isRejected, addRejected, rejectedCount } from '../src/rejected.js';

const rec = (ref, extra = {}) => ({ osm_ref: ref, name: 'X', category: 'Y', lat: 1, lng: 2, rejectedAt: 0, ...extra });

describe('rejected — store des tombstones de curation Scout', () => {
    beforeEach(() => setRejectedData({}));

    describe('setRejectedData', () => {
        it('accepte un objet indexé par osm_ref', () => {
            setRejectedData({ 'node/1': rec('node/1') });
            expect(rejectedCount()).toBe(1);
            expect(rejectedData['node/1'].name).toBe('X');
        });
        it('rejette tableau / null / non-objet → vide (sûr : rien masqué)', () => {
            setRejectedData(['node/1']);
            expect(rejectedCount()).toBe(0);
            setRejectedData(null);
            expect(rejectedCount()).toBe(0);
            setRejectedData('node/1');
            expect(rejectedCount()).toBe(0);
        });
    });

    describe('isRejected', () => {
        it('true pour un osm_ref présent, false sinon', () => {
            setRejectedData({ 'way/42': rec('way/42') });
            expect(isRejected('way/42')).toBe(true);
            expect(isRejected('way/99')).toBe(false);
        });
        it('false pour une référence vide/nulle', () => {
            expect(isRejected('')).toBe(false);
            expect(isRejected(undefined)).toBe(false);
            expect(isRejected(null)).toBe(false);
        });
    });

    describe('addRejected', () => {
        it('ajoute un rejet avec osm_ref', () => {
            addRejected(rec('node/7'));
            expect(isRejected('node/7')).toBe(true);
            expect(rejectedCount()).toBe(1);
        });
        it('ignore un enregistrement SANS osm_ref (POI créé à la main, pas d\'identité OSM)', () => {
            addRejected({ name: 'Sans ref', lat: 1, lng: 2 });
            addRejected(null);
            addRejected(undefined);
            expect(rejectedCount()).toBe(0);
        });
        it('écrase un rejet existant (même osm_ref)', () => {
            addRejected(rec('node/7', { name: 'A' }));
            addRejected(rec('node/7', { name: 'B' }));
            expect(rejectedCount()).toBe(1);
            expect(rejectedData['node/7'].name).toBe('B');
        });
    });
});
