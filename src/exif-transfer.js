/**
 * exif-transfer.js — Réinjection du bloc EXIF d'un JPEG d'origine dans un JPEG
 * ré-encodé par `canvas.toBlob`.
 *
 * Pourquoi ce module existe :
 *   Apposer un watermark oblige à repasser par un canvas, et `canvas.toBlob`
 *   n'émet AUCUNE métadonnée. Sans réinjection, l'export ZIP de l'import GPS
 *   perdrait GPS, date de prise de vue et modèle d'appareil — or ces photos
 *   ZIPées sont l'archive organisée, et un futur ré-import GPS les classerait
 *   toutes en « Sans GPS ». On recopie donc le segment APP1 (Exif) original.
 *
 * Deux corrections indispensables sur le segment recopié :
 *   1. `Orientation` (tag 0x0112) forcée à 1. Le navigateur a DÉJÀ redressé
 *      l'image en la dessinant sur le canvas (`image-orientation: from-image`
 *      est le défaut). Recopier une orientation « rotation 90° » ferait
 *      pivoter l'image une seconde fois chez les visionneuses.
 *   2. Vignette EXIF (IFD1) détruite : c'est une copie miniature de l'image
 *      SANS watermark, extractible en deux clics — elle viderait le filigrane
 *      de son sens. On efface ses octets puis on délie IFD1 d'IFD0.
 *
 * Le module travaille sur des octets bruts (aucun DOM) → testable en Node.
 * `exifr`, déjà en dépendance, ne sait que LIRE : il ne peut pas servir ici.
 *
 * @module exif-transfer
 */

const SOI = 0xD8;
const SOS = 0xDA;
const EOI = 0xD9;
const APP1 = 0xE1;

// « Exif\0\0 » — en-tête qui distingue un APP1 EXIF d'un APP1 XMP.
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

const TAG_ORIENTATION = 0x0112;
const TAG_THUMB_OFFSET = 0x0201; // JPEGInterchangeFormat
const TAG_THUMB_LENGTH = 0x0202; // JPEGInterchangeFormatLength
const TYPE_SHORT = 3;

// Décalage du header TIFF dans un segment APP1 : FF E1 + longueur(2) + « Exif\0\0 »(6).
const TIFF_START = 10;

function isJpeg(bytes) {
    return !!bytes && bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === SOI;
}

function hasExifHeader(bytes, at) {
    if (at + EXIF_HEADER.length > bytes.length) return false;
    return EXIF_HEADER.every((b, i) => bytes[at + i] === b);
}

/**
 * Localise le segment APP1 EXIF d'un JPEG.
 * @param {Uint8Array} bytes
 * @returns {{ start: number, end: number }|null} bornes du segment (marqueur inclus)
 */
export function findExifSegment(bytes) {
    if (!isJpeg(bytes)) return null;
    let off = 2;
    while (off + 4 <= bytes.length) {
        if (bytes[off] !== 0xFF) return null; // flux désynchronisé → on abandonne
        const marker = bytes[off + 1];
        // Marqueurs isolés (sans champ longueur)
        if (marker === 0x01 || marker === SOI || (marker >= 0xD0 && marker <= 0xD7)) {
            off += 2;
            continue;
        }
        // Début des données image : plus aucune métadonnée au-delà
        if (marker === SOS || marker === EOI) return null;
        const len = (bytes[off + 2] << 8) | bytes[off + 3];
        if (len < 2) return null;
        const end = off + 2 + len;
        if (end > bytes.length) return null;
        if (marker === APP1 && hasExifHeader(bytes, off + 4)) {
            return { start: off, end };
        }
        off = end;
    }
    return null;
}

// --- Lecture/écriture TIFF (l'endianness est portée par le header du segment) ---

function read16(bytes, at, little) {
    return little
        ? bytes[at] | (bytes[at + 1] << 8)
        : (bytes[at] << 8) | bytes[at + 1];
}

function read32(bytes, at, little) {
    return (little
        ? bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)
        : (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]
    ) >>> 0;
}

function write16(bytes, at, value, little) {
    if (little) {
        bytes[at] = value & 0xFF;
        bytes[at + 1] = (value >> 8) & 0xFF;
    } else {
        bytes[at] = (value >> 8) & 0xFF;
        bytes[at + 1] = value & 0xFF;
    }
}

function write32(bytes, at, value, little) {
    for (let i = 0; i < 4; i++) {
        const shift = little ? i * 8 : (3 - i) * 8;
        bytes[at + i] = (value >>> shift) & 0xFF;
    }
}

// Parcourt les entrées d'un IFD et appelle visit(tag, type, count, valueOffset).
// Retourne l'offset (dans le segment) du pointeur « IFD suivant », ou -1 si l'IFD
// déborde du segment.
function walkIfd(seg, ifdAt, little, visit) {
    if (ifdAt + 2 > seg.length) return -1;
    const count = read16(seg, ifdAt, little);
    const nextAt = ifdAt + 2 + count * 12;
    if (nextAt + 4 > seg.length) return -1;
    for (let i = 0; i < count; i++) {
        const entry = ifdAt + 2 + i * 12;
        visit(
            read16(seg, entry, little),
            read16(seg, entry + 2, little),
            read32(seg, entry + 4, little),
            entry + 8
        );
    }
    return nextAt;
}

/**
 * Copie le segment APP1 en neutralisant l'orientation et la vignette.
 * @param {Uint8Array} segment segment APP1 EXIF complet (marqueur inclus)
 * @returns {Uint8Array|null} copie assainie, ou null si le segment est illisible
 */
export function sanitizeExifSegment(segment) {
    if (!segment || segment.length < TIFF_START + 8) return null;
    const seg = segment.slice();

    const order = read16(seg, TIFF_START, false);
    if (order !== 0x4949 && order !== 0x4D4D) return null; // ni « II » ni « MM »
    const little = order === 0x4949;
    if (read16(seg, TIFF_START + 2, little) !== 42) return null;

    const ifd0 = TIFF_START + read32(seg, TIFF_START + 4, little);
    if (ifd0 < TIFF_START || ifd0 + 2 > seg.length) return null;

    // 1. Orientation → 1 (le canvas a déjà redressé les pixels)
    const nextAt = walkIfd(seg, ifd0, little, (tag, type, count, valueAt) => {
        if (tag === TAG_ORIENTATION && type === TYPE_SHORT && count === 1) {
            write16(seg, valueAt, 1, little);
        }
    });
    if (nextAt < 0) return null;

    // 2. Vignette (IFD1) : supprimée, puis IFD1 délié d'IFD0
    const ifd1Offset = read32(seg, nextAt, little);
    if (ifd1Offset === 0) return seg;

    const ifd1 = TIFF_START + ifd1Offset;
    let thumbAt = 0;
    let thumbLen = 0;
    if (ifd1 > TIFF_START && ifd1 + 2 <= seg.length) {
        walkIfd(seg, ifd1, little, (tag, type, count, valueAt) => {
            if (tag === TAG_THUMB_OFFSET) thumbAt = read32(seg, valueAt, little);
            else if (tag === TAG_THUMB_LENGTH) thumbLen = read32(seg, valueAt, little);
        });
    }
    write32(seg, nextAt, 0, little); // plus aucun lecteur n'atteindra IFD1

    const from = TIFF_START + thumbAt;
    if (thumbAt <= 0 || thumbLen <= 0 || from + thumbLen > seg.length) return seg;

    if (from + thumbLen === seg.length) {
        // Cas courant (Samsung, iPhone…) : la vignette occupe la fin du segment
        // → on la TRONQUE. La mettre à zéro suffirait à la détruire, mais le ZIP
        // est en méthode STORE : ce serait ~48 Ko de zéros écrits par photo.
        // Rien ne peut pointer au-delà, la vignette étant le dernier bloc.
        const cut = seg.slice(0, from);
        const newLen = cut.length - 2; // le champ longueur s'entend hors marqueur
        cut[2] = (newLen >> 8) & 0xFF;
        cut[3] = newLen & 0xFF;
        return cut;
    }

    // Vignette au milieu du segment (agencement exotique) : on l'écrase sur place,
    // tronquer couperait des données encore référencées par IFD0.
    seg.fill(0, from, from + thumbLen);
    return seg;
}

/**
 * Insère un segment APP1 EXIF juste après le SOI d'un JPEG, en remplaçant
 * l'éventuel APP1 EXIF déjà présent.
 * @param {Uint8Array} jpeg
 * @param {Uint8Array} segment
 * @returns {Uint8Array|null} nouveau JPEG, ou null si `jpeg` n'en est pas un
 */
export function injectExifSegment(jpeg, segment) {
    if (!isJpeg(jpeg) || !segment || segment.length === 0) return null;

    // Défensif : un ré-encodage canvas n'en produit pas, mais deux APP1 EXIF
    // dans le même fichier donneraient un résultat dépendant du lecteur.
    let body = jpeg.subarray(2);
    const existing = findExifSegment(jpeg);
    if (existing) {
        const stripped = new Uint8Array(jpeg.length - (existing.end - existing.start) - 2);
        stripped.set(jpeg.subarray(2, existing.start), 0);
        stripped.set(jpeg.subarray(existing.end), existing.start - 2);
        body = stripped;
    }

    const out = new Uint8Array(2 + segment.length + body.length);
    out[0] = 0xFF;
    out[1] = SOI;
    out.set(segment, 2);
    out.set(body, 2 + segment.length);
    return out;
}

/**
 * Recopie l'EXIF de `originalBytes` dans `encodedBytes` (assaini au passage).
 * @param {Uint8Array} originalBytes JPEG d'origine (sortie de l'appareil photo)
 * @param {Uint8Array} encodedBytes  JPEG ré-encodé (sortie canvas, watermarké)
 * @returns {Uint8Array} le JPEG enrichi, ou `encodedBytes` tel quel si l'original
 *                       n'a pas d'EXIF exploitable (HEIC converti, PNG, capture…)
 */
export function transferExif(originalBytes, encodedBytes) {
    const found = findExifSegment(originalBytes);
    if (!found) return encodedBytes;
    const sanitized = sanitizeExifSegment(originalBytes.subarray(found.start, found.end));
    if (!sanitized) return encodedBytes;
    return injectExifSegment(encodedBytes, sanitized) || encodedBytes;
}

/**
 * Variante Blob de `transferExif`. Ne jette jamais : en cas de souci, on rend le
 * blob ré-encodé inchangé — perdre l'EXIF est un moindre mal face à un export
 * ZIP qui échoue.
 * @param {File|Blob} originalFile
 * @param {Blob} encodedBlob
 * @returns {Promise<Blob>}
 */
export async function copyExifToBlob(originalFile, encodedBlob) {
    try {
        const [origBuf, encBuf] = await Promise.all([
            originalFile.arrayBuffer(),
            encodedBlob.arrayBuffer(),
        ]);
        const encoded = new Uint8Array(encBuf);
        const out = transferExif(new Uint8Array(origBuf), encoded);
        if (out === encoded) return encodedBlob;
        return new Blob([out], { type: 'image/jpeg' });
    } catch (e) {
        console.warn('[exif-transfer] copie EXIF impossible, blob laissé tel quel', e);
        return encodedBlob;
    }
}
