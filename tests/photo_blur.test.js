import { describe, it, expect } from 'vitest';
import { blockSizeFor, toPixelRect, pixelateBuffer, MIN_BLOCK } from '../src/photo-blur.js';

describe('blockSizeFor', () => {
    it('vise environ 8 blocs sur le plus grand côté', () => {
        expect(blockSizeFor(400, 100)).toBe(50); // plaque : 8 × 2 blocs
        expect(blockSizeFor(160, 200)).toBe(25);
    });
    it('ne descend pas sous le bloc minimal', () => {
        expect(blockSizeFor(20, 20)).toBe(MIN_BLOCK);
    });
});

describe('toPixelRect', () => {
    it('convertit et borne une zone normalisée', () => {
        expect(toPixelRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, 1000, 500))
            .toEqual({ x: 100, y: 100, w: 500, h: 150 });
        expect(toPixelRect({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 100, 100))
            .toEqual({ x: 90, y: 90, w: 10, h: 10 });
    });
    it('renvoie null pour une zone vide', () => {
        expect(toPixelRect({ x: 1, y: 0, w: 0.2, h: 0.2 }, 100, 100)).toBeNull();
    });
});

describe('pixelateBuffer', () => {
    // Tampon RGBA w × h dont chaque pixel vaut une valeur distincte.
    function gradient(w, h) {
        const d = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) {
            d[i * 4] = i; d[i * 4 + 1] = 255 - i; d[i * 4 + 2] = (i * 7) % 256; d[i * 4 + 3] = 255;
        }
        return d;
    }
    const px = (d, w, x, y) => Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

    it('remplit chaque bloc de la moyenne de ses pixels', () => {
        const w = 4, h = 2;
        const d = gradient(w, h);
        pixelateBuffer(d, w, h, 2);
        // Bloc gauche : pixels 0,1,4,5 → R moyen 2.5 → 3 (arrondi)
        expect(px(d, w, 0, 0)).toEqual(px(d, w, 1, 1));
        expect(px(d, w, 0, 0)[0]).toBe(3);
        // Bloc droit : pixels 2,3,6,7 → R moyen 4.5 → 5
        expect(px(d, w, 2, 0)).toEqual(px(d, w, 3, 1));
        expect(px(d, w, 2, 0)[0]).toBe(5);
    });

    it('rogne les derniers blocs sans déborder', () => {
        const w = 5, h = 3;
        const d = gradient(w, h);
        pixelateBuffer(d, w, h, 2);
        // Dernière colonne (x = 4) : bloc 1 px de large, rangées 0-1 → pixels 4 et 9
        expect(px(d, w, 4, 0)[0]).toBe(Math.round((4 + 9) / 2));
        // Coin bas-droit : bloc 1 × 1 inchangé (pixel 14)
        expect(px(d, w, 4, 2)[0]).toBe(14);
    });

    it("ne laisse aucun pixel d'origine distinct dans un bloc", () => {
        const w = 16, h = 16;
        const d = gradient(w, h);
        pixelateBuffer(d, w, h, 8);
        const colors = new Set();
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) colors.add(px(d, w, x, y).join(','));
        expect(colors.size).toBe(4);
    });
});
