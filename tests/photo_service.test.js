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

import { validatePhotoFile, MAX_PHOTO_SIZE_BYTES, compressImage, ADMIN_WATERMARK_TEXT } from '../src/photo-service.js';

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
// Watermark admin — la branche canvas ne peut pas tourner sous jsdom
// (canvas.toBlob non implémenté). Validation visuelle réelle via smoke test
// live sur l'app. Ici on vérifie juste l'export du texte attendu.
// ─────────────────────────────────────────────────────────────────────────────
describe('ADMIN_WATERMARK_TEXT', () => {
    it('exporte le texte exact "© Stefan Martin — History Walk"', () => {
        expect(ADMIN_WATERMARK_TEXT).toBe('© Stefan Martin — History Walk');
    });
});
