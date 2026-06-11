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

import {
    validatePhotoFile, MAX_PHOTO_SIZE_BYTES, compressImage, ADMIN_WATERMARK_TEXT, applyWatermark,
    PUBLISH_COMPRESSION, ADMIN_COMPRESSION, USER_COMPRESSION,
} from '../src/photo-service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Profils de compression — décision du 11/06/2026 (comparateur sur vraies photos).
// Ces tests verrouillent la décision : un changement de profil doit être un choix
// explicite (modifier le test), pas une dérive au détour d'un refactor.
// ─────────────────────────────────────────────────────────────────────────────
describe('Profils de compression', () => {
    it('PUBLISH_COMPRESSION = 1080 px (plus petit côté) · JPEG 75 % (décision 11/06/2026)', () => {
        expect(PUBLISH_COMPRESSION).toEqual({ targetMinSize: 1080, quality: 0.75 });
    });

    it('la grille admin (OPTIMIZED) suit le profil de publication — un seul profil publié', () => {
        expect(ADMIN_COMPRESSION.OPTIMIZED.targetMinSize).toBe(PUBLISH_COMPRESSION.targetMinSize);
        expect(ADMIN_COMPRESSION.OPTIMIZED.quality).toBe(PUBLISH_COMPRESSION.quality);
    });

    it('ORIGINAL reste un échappatoire pleine qualité (natif, JPEG 95 %)', () => {
        expect(ADMIN_COMPRESSION.ORIGINAL).toMatchObject({ targetMinSize: 0, quality: 0.95 });
    });

    it('USER_COMPRESSION (photos perso IndexedDB) inchangé : 1200 px · JPEG 80 %', () => {
        expect(USER_COMPRESSION).toEqual({ targetMinSize: 1200, quality: 0.8 });
    });
});

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
// par smoke test live. applyWatermark est la SOURCE UNIQUE du watermark, consommée
// par compressImage — l'UNIQUE encodeur depuis la fusion de compressFileToBlob
// (import GPS) du 11/06/2026 ; cf. fix v3.7.88 pour l'historique.
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
