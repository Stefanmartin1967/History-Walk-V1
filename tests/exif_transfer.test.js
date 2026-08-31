// Transfert du bloc EXIF vers un JPEG ré-encodé (export ZIP filigrané de
// l'import GPS). Aucun DOM : le module ne manipule que des octets, on peut donc
// construire des JPEG synthétiques et vérifier le résultat octet par octet.
//
// JPEG de test : SOI + APP1(Exif) + SOS + EOI. Le bloc TIFF contient une
// Orientation = 6 (rotation 90°) et une vignette IFD1, les deux cas que
// sanitizeExifSegment doit neutraliser.

import { describe, it, expect } from 'vitest';
import {
    findExifSegment,
    sanitizeExifSegment,
    injectExifSegment,
    transferExif,
    copyExifToBlob,
} from '../src/exif-transfer.js';

const THUMB_BYTES = [0xFF, 0xD8, 0x11, 0x22, 0x33, 0x44, 0xFF, 0xD9];

// Offsets, relatifs au début du TIFF, de la structure construite ci-dessous.
const OFF_IFD0 = 8;
const OFF_ORIENTATION_VALUE = 8 + 2 + 8; // entrée 0 d'IFD0, champ valeur
const OFF_NEXT_IFD = 8 + 2 + 12;         // pointeur « IFD suivant » d'IFD0
const OFF_IFD1 = 26;
const OFF_THUMB = 56;

// Entrée IFD sur 12 octets, petit-boutiste, valeur tenant dans le champ inline.
function entry(tag, type, count, value) {
    const b = new Uint8Array(12);
    const dv = new DataView(b.buffer);
    dv.setUint16(0, tag, true);
    dv.setUint16(2, type, true);
    dv.setUint32(4, count, true);
    dv.setUint32(8, value, true);
    return b;
}

// Bloc TIFF « II » : IFD0 (Orientation) → IFD1 (vignette) → octets de vignette.
function buildTiff(orientation = 6) {
    const tiff = new Uint8Array(OFF_THUMB + THUMB_BYTES.length);
    const dv = new DataView(tiff.buffer);
    tiff[0] = 0x49; tiff[1] = 0x49;          // « II » (little-endian)
    dv.setUint16(2, 42, true);
    dv.setUint32(4, OFF_IFD0, true);

    dv.setUint16(OFF_IFD0, 1, true);          // IFD0 : 1 entrée
    tiff.set(entry(0x0112, 3, 1, orientation), OFF_IFD0 + 2);
    dv.setUint32(OFF_NEXT_IFD, OFF_IFD1, true);

    dv.setUint16(OFF_IFD1, 2, true);          // IFD1 : 2 entrées
    tiff.set(entry(0x0201, 4, 1, OFF_THUMB), OFF_IFD1 + 2);
    tiff.set(entry(0x0202, 4, 1, THUMB_BYTES.length), OFF_IFD1 + 14);
    dv.setUint32(OFF_IFD1 + 2 + 24, 0, true); // pas d'IFD2

    tiff.set(THUMB_BYTES, OFF_THUMB);
    return tiff;
}

function buildExifSegment(tiff = buildTiff()) {
    const len = 2 + 6 + tiff.length; // longueur + « Exif\0\0 » + TIFF
    const seg = new Uint8Array(2 + len);
    seg[0] = 0xFF; seg[1] = 0xE1;
    seg[2] = (len >> 8) & 0xFF; seg[3] = len & 0xFF;
    seg.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);
    seg.set(tiff, 10);
    return seg;
}

const TAIL = [0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9]; // SOS (vide) + EOI

function concat(...chunks) {
    const flat = chunks.flatMap(c => Array.from(c));
    return new Uint8Array(flat);
}

const originalJpeg = (tiff) => concat([0xFF, 0xD8], buildExifSegment(tiff), TAIL);
// Sortie canvas : ni APP1 ni métadonnée, juste un APP0 JFIF vide.
const encodedJpeg = () => concat([0xFF, 0xD8], [0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00], TAIL);

describe('findExifSegment', () => {
    it('localise le segment APP1 Exif', () => {
        const jpeg = originalJpeg();
        const found = findExifSegment(jpeg);
        expect(found).not.toBeNull();
        expect(found.start).toBe(2);
        expect(found.end).toBe(jpeg.length - TAIL.length);
    });

    it('rend null sur un JPEG sans EXIF', () => {
        expect(findExifSegment(encodedJpeg())).toBeNull();
    });

    it('rend null sur un fichier qui n’est pas un JPEG', () => {
        expect(findExifSegment(new Uint8Array([0x89, 0x50, 0x4E, 0x47]))).toBeNull();
        expect(findExifSegment(null)).toBeNull();
    });

    it('ignore un APP1 XMP (pas d’en-tête « Exif\\0\\0 »)', () => {
        const xmp = concat([0xFF, 0xE1, 0x00, 0x08], [0x68, 0x74, 0x74, 0x70, 0x00, 0x00]);
        expect(findExifSegment(concat([0xFF, 0xD8], xmp, TAIL))).toBeNull();
    });
});

describe('sanitizeExifSegment', () => {
    it('force l’orientation à 1 (le canvas a déjà redressé les pixels)', () => {
        const seg = sanitizeExifSegment(buildExifSegment(buildTiff(6)));
        expect(seg[10 + OFF_ORIENTATION_VALUE]).toBe(1);
        expect(seg[10 + OFF_ORIENTATION_VALUE + 1]).toBe(0);
    });

    it('délie IFD1 du chaînage', () => {
        const seg = sanitizeExifSegment(buildExifSegment());
        const nextIfd = new DataView(seg.buffer).getUint32(seg.byteOffset + 10 + OFF_NEXT_IFD, true);
        expect(nextIfd).toBe(0);
    });

    it('tronque la vignette quand elle occupe la fin du segment', () => {
        const src = buildExifSegment();
        const seg = sanitizeExifSegment(src);
        expect(seg.length).toBe(src.length - THUMB_BYTES.length);
        // Le champ longueur de l'APP1 doit suivre la troncature, sinon le
        // segment déborderait sur le reste du JPEG.
        expect((seg[2] << 8) | seg[3]).toBe(seg.length - 2);
    });

    it('écrase la vignette sur place quand des octets la suivent', () => {
        // Agencement exotique : du rembourrage après la vignette → tronquer
        // couperait potentiellement des données référencées par IFD0.
        const src = buildExifSegment(concat(buildTiff(), [0xAA, 0xBB, 0xCC, 0xDD]));
        const seg = sanitizeExifSegment(src);
        expect(seg.length).toBe(src.length);
        const thumb = seg.subarray(10 + OFF_THUMB, 10 + OFF_THUMB + THUMB_BYTES.length);
        expect(Array.from(thumb)).toEqual(THUMB_BYTES.map(() => 0));
        expect(Array.from(seg.subarray(seg.length - 4))).toEqual([0xAA, 0xBB, 0xCC, 0xDD]);
    });

    it('ne modifie pas le segment source', () => {
        const src = buildExifSegment();
        const before = Array.from(src);
        sanitizeExifSegment(src);
        expect(Array.from(src)).toEqual(before);
    });

    it('rend null sur un segment illisible', () => {
        const broken = buildExifSegment();
        broken[10] = 0x00; broken[11] = 0x00; // ni « II » ni « MM »
        expect(sanitizeExifSegment(broken)).toBeNull();
        expect(sanitizeExifSegment(new Uint8Array(4))).toBeNull();
    });
});

describe('injectExifSegment', () => {
    it('insère le segment juste après le SOI, corps préservé', () => {
        const seg = buildExifSegment();
        const out = injectExifSegment(encodedJpeg(), seg);
        expect(Array.from(out.subarray(0, 2))).toEqual([0xFF, 0xD8]);
        expect(Array.from(out.subarray(2, 2 + seg.length))).toEqual(Array.from(seg));
        // L'APP0 JFIF du canvas suit, intact
        expect(Array.from(out.subarray(2 + seg.length, 2 + seg.length + 4)))
            .toEqual([0xFF, 0xE0, 0x00, 0x04]);
        expect(out.length).toBe(encodedJpeg().length + seg.length);
    });

    it('remplace un APP1 Exif déjà présent au lieu de le doubler', () => {
        const seg = buildExifSegment();
        const once = injectExifSegment(encodedJpeg(), seg);
        const twice = injectExifSegment(once, seg);
        expect(twice.length).toBe(once.length);
        expect(Array.from(twice)).toEqual(Array.from(once));
    });

    it('rend null si la cible n’est pas un JPEG', () => {
        expect(injectExifSegment(new Uint8Array([1, 2, 3]), buildExifSegment())).toBeNull();
    });
});

describe('transferExif', () => {
    it('recopie l’EXIF assaini dans le JPEG ré-encodé', () => {
        const out = transferExif(originalJpeg(), encodedJpeg());
        const found = findExifSegment(out);
        expect(found).not.toBeNull();
        expect(out[found.start + 10 + OFF_ORIENTATION_VALUE]).toBe(1);
        // Vignette partie : le segment a maigri d'exactement sa taille.
        expect(found.end - found.start).toBe(buildExifSegment().length - THUMB_BYTES.length);
        expect(out.subarray(found.start + 10 + OFF_THUMB, found.end).length).toBe(0);
    });

    it('rend le JPEG ré-encodé tel quel si l’original n’a pas d’EXIF', () => {
        const encoded = encodedJpeg();
        // Cas réel : HEIC converti, capture d'écran, PNG.
        expect(transferExif(encodedJpeg(), encoded)).toBe(encoded);
    });

    it('rend le JPEG ré-encodé tel quel si l’EXIF est corrompu', () => {
        const broken = originalJpeg();
        broken[2 + 10] = 0x00; broken[2 + 11] = 0x00; // ordre d'octets invalide
        const encoded = encodedJpeg();
        expect(transferExif(broken, encoded)).toBe(encoded);
    });
});

describe('copyExifToBlob', () => {
    it('rend un Blob JPEG porteur de l’EXIF d’origine', async () => {
        const out = await copyExifToBlob(
            new Blob([originalJpeg()], { type: 'image/jpeg' }),
            new Blob([encodedJpeg()], { type: 'image/jpeg' })
        );
        expect(out.type).toBe('image/jpeg');
        const bytes = new Uint8Array(await out.arrayBuffer());
        expect(findExifSegment(bytes)).not.toBeNull();
    });

    it('rend le blob ré-encodé inchangé si la lecture échoue', async () => {
        const encoded = new Blob([encodedJpeg()], { type: 'image/jpeg' });
        const unreadable = { arrayBuffer: () => Promise.reject(new Error('boom')) };
        expect(await copyExifToBlob(unreadable, encoded)).toBe(encoded);
    });
});
