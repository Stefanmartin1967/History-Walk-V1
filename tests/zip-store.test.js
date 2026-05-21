import { describe, it, expect } from 'vitest';
import { createZipBlob, __internals } from '../src/zip-store.js';

const { crc32, dosDateTime } = __internals;

// Lit un Blob en Uint8Array (jsdom/node : Blob.arrayBuffer dispo).
async function blobBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
}
// Lecture little-endian.
function u16(bytes, off) { return bytes[off] | (bytes[off + 1] << 8); }
function u32(bytes, off) { return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0; }

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

describe('zip-store — crc32', () => {
    it('CRC32 de la chaîne vide = 0', () => {
        expect(crc32(new Uint8Array([]))).toBe(0);
    });

    it('CRC32 du vecteur de test standard "123456789" = 0xCBF43926', () => {
        const bytes = new TextEncoder().encode('123456789');
        expect(crc32(bytes)).toBe(0xCBF43926);
    });

    it('CRC32 est déterministe et non signé (>>> 0)', () => {
        const bytes = new Uint8Array([255, 254, 253, 0, 1, 2]);
        const a = crc32(bytes);
        const b = crc32(bytes);
        expect(a).toBe(b);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(0xFFFFFFFF);
    });
});

describe('zip-store — dosDateTime', () => {
    it('encode une date connue (1er janvier 2021, 00:00:00)', () => {
        const { dosTime, dosDate } = dosDateTime(new Date(2021, 0, 1, 0, 0, 0));
        // dosDate = ((2021-1980)<<9) | ((0+1)<<5) | 1 = 41*512 + 32 + 1
        expect(dosDate).toBe(41 * 512 + 32 + 1);
        expect(dosTime).toBe(0);
    });

    it('encode l\'heure (13:24:30 → secondes /2)', () => {
        const { dosTime } = dosDateTime(new Date(2021, 5, 15, 13, 24, 30));
        // (13<<11) | (24<<5) | (15)  — 30s/2 = 15
        expect(dosTime).toBe((13 << 11) | (24 << 5) | 15);
    });
});

describe('zip-store — createZipBlob', () => {
    it('rejette une liste vide', async () => {
        await expect(createZipBlob([])).rejects.toThrow(/aucune entrée/);
    });

    it('rejette un argument non-tableau', async () => {
        await expect(createZipBlob(null)).rejects.toThrow();
        await expect(createZipBlob('nope')).rejects.toThrow();
    });

    it('rejette un type de données non supporté', async () => {
        await expect(createZipBlob([{ name: 'x.txt', data: 42 }])).rejects.toThrow(/non supporté/);
    });

    it('produit un Blob application/zip non vide', async () => {
        const zip = await createZipBlob([{ name: 'a.txt', data: new Uint8Array([1, 2, 3]) }]);
        expect(zip).toBeInstanceOf(Blob);
        expect(zip.type).toBe('application/zip');
        expect(zip.size).toBeGreaterThan(0);
    });

    it('commence par la signature Local File Header (PK\\x03\\x04)', async () => {
        const zip = await createZipBlob([{ name: 'a.txt', data: new Uint8Array([1, 2, 3]) }]);
        const bytes = await blobBytes(zip);
        expect(u32(bytes, 0)).toBe(LOCAL_SIG);
    });

    it('se termine par un End Of Central Directory valide avec le bon nombre d\'entrées', async () => {
        const zip = await createZipBlob([
            { name: 'a.txt', data: new Uint8Array([1]) },
            { name: 'b.txt', data: new Uint8Array([2, 3]) },
            { name: 'c.txt', data: new Uint8Array([4, 5, 6]) },
        ]);
        const bytes = await blobBytes(zip);
        // EOCD = 22 derniers octets (pas de commentaire d'archive).
        const eocdOff = bytes.length - 22;
        expect(u32(bytes, eocdOff)).toBe(EOCD_SIG);
        expect(u16(bytes, eocdOff + 8)).toBe(3);  // entries on this disk
        expect(u16(bytes, eocdOff + 10)).toBe(3); // total entries
    });

    it('écrit le CRC32 correct dans le Local File Header', async () => {
        const data = new TextEncoder().encode('123456789');
        const zip = await createZipBlob([{ name: 'n.txt', data }]);
        const bytes = await blobBytes(zip);
        // CRC32 dans le Local File Header à l'offset 14 (uint32 LE).
        expect(u32(bytes, 14)).toBe(0xCBF43926);
        // Tailles compressée + non compressée = longueur des données (méthode STORE).
        expect(u32(bytes, 18)).toBe(data.length); // compressed size
        expect(u32(bytes, 22)).toBe(data.length); // uncompressed size
    });

    it('contient le nom de fichier et les octets bruts (STORE, pas de compression)', async () => {
        const data = new Uint8Array([0xAA, 0xBB, 0xCC]);
        const zip = await createZipBlob([{ name: 'photo.jpg', data }]);
        const bytes = await blobBytes(zip);
        const nameBytes = new TextEncoder().encode('photo.jpg');
        // Le nom commence après l'en-tête fixe de 30 octets.
        const nameInHeader = bytes.slice(30, 30 + nameBytes.length);
        expect(Array.from(nameInHeader)).toEqual(Array.from(nameBytes));
        // Les données brutes suivent immédiatement le nom.
        const dataStart = 30 + nameBytes.length;
        const dataInZip = bytes.slice(dataStart, dataStart + data.length);
        expect(Array.from(dataInZip)).toEqual(Array.from(data));
    });

    it('contient un Central Directory Header par entrée', async () => {
        const zip = await createZipBlob([
            { name: 'a', data: new Uint8Array([1]) },
            { name: 'b', data: new Uint8Array([2]) },
        ]);
        const bytes = await blobBytes(zip);
        // Compte les signatures Central Directory dans tout le buffer.
        let count = 0;
        for (let i = 0; i + 4 <= bytes.length; i++) {
            if (u32(bytes, i) === CENTRAL_SIG) count++;
        }
        expect(count).toBe(2);
    });

    it('accepte des données ArrayBuffer comme des Uint8Array', async () => {
        const ab = new Uint8Array([9, 8, 7]).buffer;
        const zip = await createZipBlob([{ name: 'buf.bin', data: ab }]);
        const bytes = await blobBytes(zip);
        expect(u32(bytes, 0)).toBe(LOCAL_SIG);
        expect(u32(bytes, 18)).toBe(3); // taille = 3 octets
    });
});
