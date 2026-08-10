// @vitest-environment jsdom
//
// Photos de travail (chantier 10/08/2026) — images dont Stefan n'est PAS
// l'auteur, jamais publiables. Les tests portent sur les GARANTIES, pas sur le
// rendu : ce qui doit être vrai pour qu'une photo de tiers ne fuie jamais.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/state.js', () => ({
    state: { isAdmin: true, currentMapId: 'djerba', userData: {}, loadedFeatures: [] }
}));
vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn(() => 'fake-token'),
    uploadFileToGitHub: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/photo-service.js', () => ({
    compressImage: vi.fn(() => Promise.resolve(new Blob(['img'], { type: 'image/jpeg' }))),
    validatePhotoFile: vi.fn(() => ({ valid: true, reason: null })),
    PUBLISH_COMPRESSION: { targetMinSize: 1080, quality: 0.75 },
}));
vi.mock('../src/database.js', () => ({
    getCachedWorkPhoto: vi.fn(() => Promise.resolve(null)),
    setCachedWorkPhoto: vi.fn(() => Promise.resolve()),
    deleteCachedWorkPhoto: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/data.js', () => ({ updatePoiData: vi.fn(() => Promise.resolve()) }));
vi.mock('../src/net.js', () => ({ fetchWithTimeout: vi.fn() }));

import { state } from '../src/state.js';
import { uploadFileToGitHub } from '../src/github-sync.js';
import { compressImage } from '../src/photo-service.js';
import { getCachedWorkPhoto, setCachedWorkPhoto, deleteCachedWorkPhoto } from '../src/database.js';
import { updatePoiData } from '../src/data.js';
import { fetchWithTimeout } from '../src/net.js';
import { PERSONAL_KEYS, GITHUB_REPO, GITHUB_WORK_REPO } from '../src/config.js';
import {
    getWorkPhotosById, uploadWorkPhoto, loadWorkPhotoBlob, clearWorkPhotos,
} from '../src/work-photos.js';

beforeEach(() => {
    vi.clearAllMocks();
    state.isAdmin = true;
    state.currentMapId = 'djerba';
    state.userData = {};
    vi.mocked(getCachedWorkPhoto).mockResolvedValue(null);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('garanties de non-publication', () => {
    it('workPhotos est déclarée personnelle → purgée du geojson public', () => {
        // C'est LA garantie structurelle : admin-geojson / admin-diff-engine /
        // data.js partagent cette liste. Retirer la clé d'ici ferait fuiter des
        // photos de tiers dans la source publique.
        expect(PERSONAL_KEYS).toContain('workPhotos');
    });

    it('le dépôt de travail est distinct du dépôt public', () => {
        // Le pipeline de publication ne lit que GITHUB_REPO : la séparation
        // physique est ce qui rend l'oubli d'un filtre impossible.
        expect(GITHUB_WORK_REPO).not.toBe(GITHUB_REPO);
    });

    it("l'envoi vise le dépôt de travail, jamais le dépôt public", async () => {
        await uploadWorkPhoto(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 'HW-1');
        const repoArg = vi.mocked(uploadFileToGitHub).mock.calls[0][3];
        expect(repoArg).toBe(GITHUB_WORK_REPO);
        expect(repoArg).not.toBe(GITHUB_REPO);
    });

    it('AUCUN watermark : la photo est celle de quelqu\'un d\'autre', async () => {
        await uploadWorkPhoto(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 'HW-1');
        const opts = vi.mocked(compressImage).mock.calls[0][3];
        expect(opts).toEqual(expect.objectContaining({ skipWatermark: true }));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('uploadWorkPhoto', () => {
    it('range la photo sous la destination active et retourne son chemin', async () => {
        const path = await uploadWorkPhoto(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 'HW-42');
        expect(path).toMatch(/^djerba\/work_HW-42_\d+\.jpg$/);
    });

    it('met en cache immédiatement — pas de re-téléchargement sur cet appareil', async () => {
        const path = await uploadWorkPhoto(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 'HW-1');
        expect(setCachedWorkPhoto).toHaveBeenCalledWith(path, expect.any(Blob));
    });

    it('sans token → échec explicite plutôt qu\'un envoi silencieusement perdu', async () => {
        const { getStoredToken } = await import('../src/github-sync.js');
        vi.mocked(getStoredToken).mockReturnValueOnce(null);
        await expect(
            uploadWorkPhoto(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 'HW-1')
        ).rejects.toThrow(/Token/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('loadWorkPhotoBlob — cache puis réseau', () => {
    it('sert le cache sans toucher au réseau (consultation hors-ligne terrain)', async () => {
        vi.mocked(getCachedWorkPhoto).mockResolvedValue(new Blob(['cached']));
        const blob = await loadWorkPhotoBlob('djerba/a.jpg');
        expect(blob).toBeInstanceOf(Blob);
        expect(fetchWithTimeout).not.toHaveBeenCalled();
    });

    it('absent du cache → API Contents authentifiée (dépôt privé), puis mise en cache', async () => {
        vi.mocked(fetchWithTimeout).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ content: btoa('img-bytes') }),
        });
        const blob = await loadWorkPhotoBlob('djerba/a.jpg');
        expect(blob).toBeInstanceOf(Blob);
        const url = vi.mocked(fetchWithTimeout).mock.calls[0][0];
        expect(url).toContain(GITHUB_WORK_REPO);
        expect(url).toContain('/contents/djerba/a.jpg');
        expect(setCachedWorkPhoto).toHaveBeenCalled();
    });

    it('base64 renvoyé avec des retours à la ligne → décodé quand même', async () => {
        // L'API GitHub formate le base64 sur 60 colonnes ; atob les refuse.
        const wrapped = btoa('img-bytes').replace(/(.{4})/g, '$1\n');
        vi.mocked(fetchWithTimeout).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ content: wrapped }),
        });
        await expect(loadWorkPhotoBlob('djerba/a.jpg')).resolves.toBeInstanceOf(Blob);
    });

    it('hors-ligne et jamais mise en cache → null, sans jeter', async () => {
        vi.mocked(fetchWithTimeout).mockRejectedValue(new Error('offline'));
        await expect(loadWorkPhotoBlob('djerba/a.jpg')).resolves.toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('clearWorkPhotos — le provisoire s\'efface devant le définitif', () => {
    it('retire les références du POI', async () => {
        state.userData['HW-1'] = { workPhotos: ['djerba/a.jpg', 'djerba/b.jpg'] };
        const n = await clearWorkPhotos('HW-1');
        expect(n).toBe(2);
        expect(updatePoiData).toHaveBeenCalledWith('HW-1', 'workPhotos', []);
    });

    it('vide le cache local des photos concernées', async () => {
        state.userData['HW-1'] = { workPhotos: ['djerba/a.jpg'] };
        await clearWorkPhotos('HW-1');
        expect(deleteCachedWorkPhoto).toHaveBeenCalledWith('djerba/a.jpg');
    });

    it('ne touche JAMAIS aux octets du dépôt privé (un import par erreur ne détruit rien)', async () => {
        state.userData['HW-1'] = { workPhotos: ['djerba/a.jpg'] };
        await clearWorkPhotos('HW-1');
        // Aucune suppression distante : seule la référence disparaît.
        expect(fetchWithTimeout).not.toHaveBeenCalled();
    });

    it('rien à faire → aucune écriture parasite', async () => {
        state.userData['HW-1'] = {};
        expect(await clearWorkPhotos('HW-1')).toBe(0);
        expect(updatePoiData).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getWorkPhotosById', () => {
    it('toujours un tableau, même sans données', () => {
        expect(getWorkPhotosById('inconnu')).toEqual([]);
    });

    it('écarte les entrées non exploitables', () => {
        state.userData['HW-1'] = { workPhotos: ['ok.jpg', '', null, 42] };
        expect(getWorkPhotosById('HW-1')).toEqual(['ok.jpg']);
    });
});
