/**
 * zip-store.js — Encodeur ZIP minimaliste (méthode STORE, sans compression).
 *
 * Pourquoi STORE sans DEFLATE :
 *   — On ne zippe que des JPEG, déjà compressés par l'appareil photo.
 *     DEFLATE ne réduira pas leur taille (gain ~0%) et fait perdre du temps CPU.
 *   — STORE = simple concat des octets bruts + en-têtes, rapide et sans dépendance.
 *
 * Format ZIP (PKWARE APPNOTE.TXT, stable depuis 1989) :
 *   Pour chaque fichier :
 *     [Local File Header]  (30 octets fixes + nom UTF-8)
 *     [Raw file bytes]     (data, sans compression)
 *   Puis, en fin d'archive :
 *     [Central Directory Header]  (46 octets fixes + nom) × N fichiers
 *     [End Of Central Directory]  (22 octets fixes)
 *
 * Limites volontaires (ZIP classique, pas ZIP64) :
 *   — Max 65535 entrées
 *   — Max 4 Go par fichier / total
 *   (Largement suffisant pour un export photos de circuit touristique.)
 *
 * @module zip-store
 */

// --- CRC32 (table-driven, IEEE polynomial 0xEDB88320) ---

let crcTable = null;

function buildCrcTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
}

function crc32(bytes) {
    if (!crcTable) crcTable = buildCrcTable();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// --- DOS datetime (date stockée dans l'archive ZIP) ---

function dosDateTime(date = new Date()) {
    const dosTime =
        ((date.getHours() & 0x1F) << 11) |
        ((date.getMinutes() & 0x3F) << 5) |
        ((Math.floor(date.getSeconds() / 2)) & 0x1F);

    const dosDate =
        (((date.getFullYear() - 1980) & 0x7F) << 9) |
        (((date.getMonth() + 1) & 0x0F) << 5) |
        (date.getDate() & 0x1F);

    return { dosTime, dosDate };
}

// --- Utilitaires d'écriture little-endian sur DataView ---

function writeUint16(view, offset, value) { view.setUint16(offset, value, true); }
function writeUint32(view, offset, value) { view.setUint32(offset, value, true); }

// Encode une string en UTF-8 (pour les noms de fichiers dans l'archive)
const textEncoder = new TextEncoder();

// --- Lecture d'une entrée (Blob/ArrayBuffer/Uint8Array) en Uint8Array ---

async function toUint8Array(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data instanceof Blob) {
        const buf = await data.arrayBuffer();
        return new Uint8Array(buf);
    }
    throw new Error('zip-store: type de données non supporté (attendu Blob, ArrayBuffer ou Uint8Array)');
}

// --- API publique ---

/**
 * Assemble un ZIP STORE à partir d'une liste d'entrées.
 *
 * @param {Array<{name: string, data: Blob|ArrayBuffer|Uint8Array, date?: Date}>} entries
 * @returns {Promise<Blob>} Blob MIME "application/zip"
 *
 * Exemple :
 *   const zipBlob = await createZipBlob([
 *     { name: '01 - Mosquée Wadran - 01.jpg', data: fileBlob1 },
 *     { name: '01 - Mosquée Wadran - 02.jpg', data: fileBlob2 },
 *   ]);
 *   // → télécharger zipBlob via un <a download="…"> classique
 */
export async function createZipBlob(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('zip-store: aucune entrée à zipper');
    }
    if (entries.length > 65535) {
        throw new Error('zip-store: plus de 65535 entrées (ZIP classique ne supporte pas, utilisez ZIP64)');
    }

    // 1) Précalcul : bytes + CRC + nom UTF-8 pour chaque entrée
    const prepared = await Promise.all(entries.map(async (e) => {
        const bytes = await toUint8Array(e.data);
        const nameBytes = textEncoder.encode(e.name);
        const { dosTime, dosDate } = dosDateTime(e.date || new Date());
        return {
            nameBytes,
            bytes,
            crc: crc32(bytes),
            size: bytes.length,
            dosTime,
            dosDate,
            localHeaderOffset: 0 // rempli plus bas
        };
    }));

    // 2) Calcul de la taille totale de l'archive (pour pré-allouer un seul Uint8Array)
    let localPartSize = 0;
    for (const p of prepared) {
        localPartSize += 30 + p.nameBytes.length + p.size;
    }
    let centralDirSize = 0;
    for (const p of prepared) {
        centralDirSize += 46 + p.nameBytes.length;
    }
    const eocdSize = 22;
    const totalSize = localPartSize + centralDirSize + eocdSize;

    const buffer = new ArrayBuffer(totalSize);
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    // 3) Écriture des Local File Headers + data
    let offset = 0;
    for (const p of prepared) {
        p.localHeaderOffset = offset;

        // Signature Local File Header : 0x04034b50
        writeUint32(view, offset, 0x04034b50); offset += 4;
        writeUint16(view, offset, 20);         offset += 2; // version needed (2.0)
        writeUint16(view, offset, 0x0800);     offset += 2; // flags : bit 11 = UTF-8 filename
        writeUint16(view, offset, 0);          offset += 2; // méthode = STORE
        writeUint16(view, offset, p.dosTime);  offset += 2;
        writeUint16(view, offset, p.dosDate);  offset += 2;
        writeUint32(view, offset, p.crc);      offset += 4;
        writeUint32(view, offset, p.size);     offset += 4; // compressed size
        writeUint32(view, offset, p.size);     offset += 4; // uncompressed size
        writeUint16(view, offset, p.nameBytes.length); offset += 2;
        writeUint16(view, offset, 0);          offset += 2; // extra field length
        bytes.set(p.nameBytes, offset); offset += p.nameBytes.length;
        bytes.set(p.bytes, offset);     offset += p.size;
    }

    // 4) Écriture du Central Directory
    const centralDirOffset = offset;
    for (const p of prepared) {
        // Signature Central Directory File Header : 0x02014b50
        writeUint32(view, offset, 0x02014b50); offset += 4;
        writeUint16(view, offset, 20);         offset += 2; // version made by
        writeUint16(view, offset, 20);         offset += 2; // version needed (2.0)
        writeUint16(view, offset, 0x0800);     offset += 2; // flags
        writeUint16(view, offset, 0);          offset += 2; // méthode = STORE
        writeUint16(view, offset, p.dosTime);  offset += 2;
        writeUint16(view, offset, p.dosDate);  offset += 2;
        writeUint32(view, offset, p.crc);      offset += 4;
        writeUint32(view, offset, p.size);     offset += 4; // compressed size
        writeUint32(view, offset, p.size);     offset += 4; // uncompressed size
        writeUint16(view, offset, p.nameBytes.length); offset += 2;
        writeUint16(view, offset, 0);          offset += 2; // extra field length
        writeUint16(view, offset, 0);          offset += 2; // file comment length
        writeUint16(view, offset, 0);          offset += 2; // disk number
        writeUint16(view, offset, 0);          offset += 2; // internal file attrs
        writeUint32(view, offset, 0);          offset += 4; // external file attrs
        writeUint32(view, offset, p.localHeaderOffset); offset += 4;
        bytes.set(p.nameBytes, offset); offset += p.nameBytes.length;
    }

    // 5) End Of Central Directory Record
    writeUint32(view, offset, 0x06054b50); offset += 4; // signature EOCD
    writeUint16(view, offset, 0);          offset += 2; // disk number
    writeUint16(view, offset, 0);          offset += 2; // disk with central dir
    writeUint16(view, offset, prepared.length); offset += 2; // entries on this disk
    writeUint16(view, offset, prepared.length); offset += 2; // total entries
    writeUint32(view, offset, centralDirSize);  offset += 4;
    writeUint32(view, offset, centralDirOffset); offset += 4;
    writeUint16(view, offset, 0);          offset += 2; // comment length

    return new Blob([buffer], { type: 'application/zip' });
}

// --- Export internes pour tests éventuels ---
export const __internals = { crc32, dosDateTime };
