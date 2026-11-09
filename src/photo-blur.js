/**
 * photo-blur.js
 * Pixelisation de zones d'une photo (outil « Flouter » de la modale d'import).
 *
 * Choix (proposition validée par Stefan le 09/11/2026) :
 * - une PIXELISATION franche plutôt qu'un flou gaussien léger, qui peut laisser
 *   une plaque lisible ;
 * - des blocs dimensionnés sur la ZONE (environ 8 blocs sur son plus grand
 *   côté), pour qu'un visage de 50 px comme une plaque de 400 px deviennent
 *   illisibles, et que ça le reste après la réduction à 1080 px de la publication ;
 * - chaque bloc prend la MOYENNE exacte de ses pixels (calcul sur les octets,
 *   pas un sous-échantillonnage du navigateur qui garde des pixels d'origine).
 *
 * Les fonctions de calcul sont pures (testables sous jsdom, qui n'a pas de
 * canvas) ; `applyPixelation` est le seul point qui touche un contexte 2D.
 */

/** Nombre de blocs visé sur le plus grand côté de la zone. */
const BLOCKS_ACROSS = 8;

/** Taille minimale d'un bloc, en pixels de l'image traitée. */
export const MIN_BLOCK = 6;

/**
 * Taille des blocs pour une zone de w × h pixels.
 * @param {number} w
 * @param {number} h
 * @param {number} [minBlock]
 * @returns {number}
 */
export function blockSizeFor(w, h, minBlock = MIN_BLOCK) {
    const longest = Math.max(w, h);
    return Math.max(minBlock, Math.ceil(longest / BLOCKS_ACROSS));
}

/**
 * Convertit un rectangle normalisé (0..1, relatif à l'image) en pixels entiers,
 * borné à l'image. Renvoie null si la zone est vide une fois bornée.
 * @param {{x:number,y:number,w:number,h:number}} r
 * @param {number} width
 * @param {number} height
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
export function toPixelRect(r, width, height) {
    const x0 = Math.max(0, Math.floor(r.x * width));
    const y0 = Math.max(0, Math.floor(r.y * height));
    const x1 = Math.min(width, Math.ceil((r.x + r.w) * width));
    const y1 = Math.min(height, Math.ceil((r.y + r.h) * height));
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Pixelise EN PLACE un tampon RGBA de w × h pixels : chaque bloc de `block`
 * pixels de côté (aligné sur le coin haut-gauche, les derniers rognés) est
 * rempli de la moyenne de ses pixels.
 * @param {Uint8ClampedArray|Uint8Array} data
 * @param {number} w
 * @param {number} h
 * @param {number} block
 */
export function pixelateBuffer(data, w, h, block) {
    for (let by = 0; by < h; by += block) {
        const yEnd = Math.min(by + block, h);
        for (let bx = 0; bx < w; bx += block) {
            const xEnd = Math.min(bx + block, w);
            let r = 0, g = 0, b = 0, a = 0;
            for (let y = by; y < yEnd; y++) {
                let i = (y * w + bx) * 4;
                for (let x = bx; x < xEnd; x++, i += 4) {
                    r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
                }
            }
            const n = (yEnd - by) * (xEnd - bx);
            r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n); a = Math.round(a / n);
            for (let y = by; y < yEnd; y++) {
                let i = (y * w + bx) * 4;
                for (let x = bx; x < xEnd; x++, i += 4) {
                    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
                }
            }
        }
    }
}

/**
 * Pixelise les zones `rects` (normalisées) dans un contexte 2D de
 * width × height pixels.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {Array<{x:number,y:number,w:number,h:number}>} rects
 */
export function applyPixelation(ctx, width, height, rects) {
    for (const r of rects) {
        const px = toPixelRect(r, width, height);
        if (!px) continue;
        const img = ctx.getImageData(px.x, px.y, px.w, px.h);
        pixelateBuffer(img.data, px.w, px.h, blockSizeFor(px.w, px.h));
        ctx.putImageData(img, px.x, px.y);
    }
}
