// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/database.js', () => ({
    getPoiPhotos: vi.fn(),
    savePoiPhotos: vi.fn(),
    deletePoiPhotos: vi.fn()
}));
vi.mock('../src/github-sync.js', () => ({
    uploadFileToGitHub: vi.fn(),
    getStoredToken: vi.fn(() => null)
}));
vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));
vi.mock('../src/ui-dom.js', () => ({
    DOM: {}
}));

import { validatePhotoFile, MAX_PHOTO_SIZE_BYTES, compressImage, ADMIN_WATERMARK_TEXT, applyWatermark } from '../src/photo-service.js';

describe('validatePhotoFile', () => {
    it('accepte un File JPEG sous le cap', () => {
        const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
        const result = validatePhotoFile(file);
        expect(result.valid).toBe(true);
        expect(result.reason).toBeNull();
    });

    it('accepte un Blob image/png', () => {
        const blob = new Blob(['x'], { type: 'image/png' });
        const result = validatePhotoFile(blob);
        expect(result.valid).toBe(true);
    });

    it('rejette null/undefined', () => {
        expect(validatePhotoFile(null).valid).toBe(false);
        expect(validatePhotoFile(undefined).valid).toBe(false);
    });

    it('rejette un fichier sans type MIME', () => {
        const file = new File(['x'], 'mystere.bin', { type: '' });
        const result = validatePhotoFile(file);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Format non supporté');
    });

    it('rejette un PDF (MIME non image/*)', () => {
        const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
        const result = validatePhotoFile(file);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('application/pdf');
    });

    it('rejette une vidéo (MIME video/*)', () => {
        const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
        expect(validatePhotoFile(file).valid).toBe(false);
    });

    it('rejette un fichier > MAX_PHOTO_SIZE_BYTES', () => {
        // Construit un objet pseudo-File avec size simulée
        const huge = { type: 'image/jpeg', size: MAX_PHOTO_SIZE_BYTES + 1 };
        const result = validatePhotoFile(huge);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Trop volumineux');
    });

    it('accepte un fichier exactement à la limite', () => {
        const limite = { type: 'image/jpeg', size: MAX_PHOTO_SIZE_BYTES };
        expect(validatePhotoFile(limite).valid).toBe(true);
    });

    it('MAX_PHOTO_SIZE_BYTES vaut 50 Mo', () => {
        expect(MAX_PHOTO_SIZE_BYTES).toBe(50 * 1024 * 1024);
    });
});

describe('compressImage — validation en entrée', () => {
    it('reject avec raison claire si fichier non-image', async () => {
        const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
        await expect(compressImage(file)).rejects.toThrow(/Format non supporté/);
    });

    it('reject avec raison claire si fichier trop volumineux', async () => {
        const huge = { type: 'image/jpeg', size: MAX_PHOTO_SIZE_BYTES + 1 };
        await expect(compressImage(huge)).rejects.toThrow(/Trop volumineux/);
    });

    it('reject sur null', async () => {
        await expect(compressImage(null)).rejects.toThrow(/Fichier manquant/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Watermark admin — la chaîne complète compressImage→canvas.toBlob ne tourne pas
// sous jsdom (toBlob non implémenté). Mais applyWatermark, elle, opère sur un ctx :
// on la teste en isolation avec un ctx mocké. Le rendu visuel réel reste validé
// par smoke test live. applyWatermark est la SOURCE UNIQUE du watermark, partagée
// par compressImage (grille) et compressFileToBlob (import GPS) — cf. fix v3.7.88.
// ─────────────────────────────────────────────────────────────────────────────
describe('ADMIN_WATERMARK_TEXT', () => {
    it('exporte le texte exact "© Stefan Martin — Heripia"', () => {
        expect(ADMIN_WATERMARK_TEXT).toBe('© Stefan Martin — Heripia');
    });
});

describe('applyWatermark', () => {
    it('est exportée (source unique réutilisée par la grille et le chemin GPS)', () => {
        expect(typeof applyWatermark).toBe('function');
    });

    it('dessine le texte deux fois (ombre + texte principal) puis save/restore le ctx', () => {
        const ctx = {
            save: vi.fn(),
            restore: vi.fn(),
            fillText: vi.fn(),
            font: '',
            textAlign: '',
            textBaseline: '',
            fillStyle: '',
        };
        applyWatermark(ctx, 650, 400, ADMIN_WATERMARK_TEXT);
        expect(ctx.save).toHaveBeenCalledTimes(1);
        expect(ctx.restore).toHaveBeenCalledTimes(1);
        expect(ctx.fillText).toHaveBeenCalledTimes(2);
        expect(ctx.fillText).toHaveBeenCalledWith(ADMIN_WATERMARK_TEXT, expect.any(Number), expect.any(Number));
    });
});
