// Support HEIC/HEIF à l'import photo (format par défaut des iPhones).
//
// Pourquoi : Chrome / Firefox / Edge ne décodent PAS le HEIC via
// `<img>`/`<canvas>` (seul Safari le fait). Le pipeline d'import (resize,
// compression, aperçu) passe par canvas → un HEIC échouait silencieusement
// hors Safari. On convertit donc le HEIC en JPEG À L'IMPORT, avant tout
// traitement pixel.
//
// ⚠️ Ordre crucial côté appelant : lire l'EXIF (GPS) sur le fichier ORIGINAL
// AVANT la conversion — `exifr` sait lire le GPS d'un HEIC, mais heic2any ne
// préserve PAS l'EXIF dans le JPEG produit. Le hash de dédup se prend aussi
// sur l'original (HEIC = octets stables → dédup fiable d'un ré-import).
//
// La bibliothèque (libheif WebAssembly via heic-to, ~lourde) est importée
// DYNAMIQUEMENT, uniquement quand un HEIC est réellement rencontré → aucun
// surpoids de bundle pour les imports JPEG classiques.
//
// Choix de la lib : `heic-to/csp` (et non heic2any). heic2any repose sur asm.js
// + `new Function`, ce qui imposerait `'unsafe-eval'` dans la CSP (ouverture de
// TOUT le script-src). Le build `heic-to/csp` est compilé pour la CSP : libheif
// en WebAssembly, SANS `new Function`/`eval`. Il ne requiert donc que
// `'wasm-unsafe-eval'` (directive étroite : autorise seulement la compilation
// wasm) + `worker-src 'self' blob:` (le décodage tourne dans un Web Worker).

/**
 * Vrai si le fichier est un HEIC/HEIF. Le MIME est peu fiable (Chrome renvoie
 * souvent une chaîne vide pour un .heic) → on teste aussi l'extension.
 * @param {File|Blob} file
 * @returns {boolean}
 */
export function isHeicFile(file) {
    if (!file) return false;
    const type = (file.type || '').toLowerCase();
    if (type === 'image/heic' || type === 'image/heif') return true;
    return /\.(heic|heif)$/i.test(file.name || '');
}

/**
 * Convertit un HEIC/HEIF en JPEG. Retourne un File `.jpg` (type image/jpeg)
 * directement consommable par le reste du pipeline (resize/compress/save).
 * @param {File} file — fichier HEIC original
 * @param {number} [quality=0.92] — qualité JPEG (0..1)
 * @returns {Promise<File>}
 */
export async function convertHeicToJpeg(file, quality = 0.92) {
    const { heicTo } = await import('heic-to/csp');
    const result = await heicTo({ blob: file, type: 'image/jpeg', quality });
    // heicTo renvoie un Blob (canvas.toBlob) ; on tolère un tableau par sûreté.
    const blob = Array.isArray(result) ? result[0] : result;
    const name = (file.name || 'photo').replace(/\.(heic|heif)$/i, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
}
