// @vitest-environment jsdom
//
// Détection HEIC/HEIF à l'import photo. Le MIME est peu fiable (Chrome renvoie
// souvent une chaîne vide pour un .heic) → isHeicFile doit aussi reconnaître
// l'extension. On ne teste pas convertHeicToJpeg ici (heic2any = wasm, hors
// portée jsdom) — seule la détection est testée.

import { describe, it, expect } from 'vitest';
import { isHeicFile } from '../src/heic.js';

const fileWith = (name, type) => new File([new Uint8Array([1, 2, 3])], name, { type });

describe('isHeicFile', () => {
    it('reconnaît un HEIC par son MIME image/heic', () => {
        expect(isHeicFile(fileWith('photo.bin', 'image/heic'))).toBe(true);
    });

    it('reconnaît un HEIF par son MIME image/heif', () => {
        expect(isHeicFile(fileWith('photo.bin', 'image/heif'))).toBe(true);
    });

    it('reconnaît un .heic même sans MIME (cas Chrome)', () => {
        expect(isHeicFile(fileWith('IMG_1234.HEIC', ''))).toBe(true);
        expect(isHeicFile(fileWith('img.heic', ''))).toBe(true);
    });

    it('reconnaît un .heif par extension', () => {
        expect(isHeicFile(fileWith('img.heif', ''))).toBe(true);
    });

    it('rejette un JPEG', () => {
        expect(isHeicFile(fileWith('photo.jpg', 'image/jpeg'))).toBe(false);
        expect(isHeicFile(fileWith('photo.jpeg', 'image/jpeg'))).toBe(false);
    });

    it('rejette un PNG', () => {
        expect(isHeicFile(fileWith('photo.png', 'image/png'))).toBe(false);
    });

    it('ne confond pas un nom contenant "heic" sans être l\'extension', () => {
        expect(isHeicFile(fileWith('heic-vacances.jpg', 'image/jpeg'))).toBe(false);
    });

    it('tolère null / undefined', () => {
        expect(isHeicFile(null)).toBe(false);
        expect(isHeicFile(undefined)).toBe(false);
    });
});
