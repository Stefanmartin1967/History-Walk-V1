// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sauvegarde « Photos » (20/11/2026, PR 3 « synchro users »). Avant, restaurer
// passait les seules photos du fichier à savePoiPhotos, qui REMPLACE : les
// photos ajoutées depuis sur l'appareil disparaissaient.

const db = vi.hoisted(() => ({ photos: {} })); // poiId → [{ id, blob }]
vi.mock('../src/state.js', () => ({ state: { currentMapId: 'djerba', appVersion: '3.7' } }));
vi.mock('../src/database.js', () => ({
    getAllPoiPhotosForMap: vi.fn(async () => Object.entries(db.photos).map(([poiId, photos]) => ({ poiId, photos }))),
    getPoiPhotos: vi.fn(async (_m, poiId) => [...(db.photos[poiId] || [])]),
    savePoiPhotos: vi.fn(async (_m, poiId, photos) => { db.photos[poiId] = photos; }),
    blobToBase64: vi.fn(async (blob) => `data:image/jpeg;base64,${blob.__content}`),
    base64ToBlob: vi.fn((b64) => { const b = new Blob([b64]); b.__content = b64.split(',')[1]; return b; }),
}));
vi.mock('../src/utils.js', () => ({
    sha256OfFile: vi.fn(async (blob) => `h:${blob.__content}`),
    downloadFile: vi.fn(),
}));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));

import { buildPhotosBackup, photosOfBackup, addPhotos, removeAddedPhotos, countPhotos } from '../src/photo-backup.js';

const photo = (id, content) => { const blob = new Blob([content]); blob.__content = content; return { id, blob }; };

beforeEach(() => { db.photos = {}; vi.clearAllMocks(); });

describe('addPhotos', () => {
    it('ajoute sans effacer les photos déjà sur l’appareil', async () => {
        db.photos.P = [photo('mine', 'AAA')];
        const r = await addPhotos('djerba', { P: [{ id: 'f1', data: 'data:image/jpeg;base64,BBB' }] });
        expect(db.photos.P.map(p => p.id)).toEqual(['mine', 'f1']);
        expect(r).toEqual({ added: { P: ['f1'] }, count: 1 });
    });
    it('même photo restaurée deux fois (même id, ou même contenu) : pas de doublon', async () => {
        db.photos.P = [photo('mine', 'AAA')];
        const r = await addPhotos('djerba', { P: [
            { id: 'mine', data: 'data:image/jpeg;base64,ZZZ' },
            { data: 'data:image/jpeg;base64,AAA' },
        ] });
        expect(r.count).toBe(0);
        expect(db.photos.P).toHaveLength(1);
    });
});

describe('removeAddedPhotos', () => {
    it('retire seulement les photos ajoutées par la restauration', async () => {
        db.photos.P = [photo('mine', 'AAA'), photo('f1', 'BBB')];
        await removeAddedPhotos('djerba', { P: ['f1'] });
        expect(db.photos.P.map(p => p.id)).toEqual(['mine']);
    });
});

describe('fichiers', () => {
    it('le fichier « Photos » garde l’id de chaque photo', async () => {
        db.photos.P = [photo('mine', 'AAA')];
        const f = await buildPhotosBackup('djerba');
        expect(f).toMatchObject({ kind: 'photos', mapId: 'djerba', count: 1, photos: { P: [{ id: 'mine', data: 'data:image/jpeg;base64,AAA' }] } });
    });
    it('une ancienne sauvegarde complète reste lisible (photos en base64 dans userData)', () => {
        const byPoi = photosOfBackup({ userData: { P: { vu: true, photos: ['photos/admin.jpg', 'data:image/jpeg;base64,AAA'] } } });
        expect(byPoi).toEqual({ P: [{ data: 'data:image/jpeg;base64,AAA' }] });
        expect(countPhotos(byPoi)).toBe(1);
    });
});
