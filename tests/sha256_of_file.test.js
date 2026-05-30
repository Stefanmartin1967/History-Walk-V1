import { describe, it, expect } from 'vitest';
import { sha256OfFile } from '../src/utils.js';

// Blob.arrayBuffer() existe en jsdom/Node récent. crypto.subtle = Web Crypto
// (dispo dans Node 18+ via globalThis.crypto).
describe('sha256OfFile', () => {
    it('hashe le contenu (hex 64 chars) — déterministe', async () => {
        const a = new Blob(['hello world'], { type: 'text/plain' });
        const h1 = await sha256OfFile(a);
        const h2 = await sha256OfFile(new Blob(['hello world'], { type: 'text/plain' }));
        expect(h1).toMatch(/^[0-9a-f]{64}$/);
        expect(h1).toBe(h2); // même contenu → même hash
    });

    it('SHA-256 de "hello world" = la valeur connue', async () => {
        const h = await sha256OfFile(new Blob(['hello world']));
        expect(h).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    });

    it('contenus différents → hashes différents', async () => {
        const h1 = await sha256OfFile(new Blob(['photo-A']));
        const h2 = await sha256OfFile(new Blob(['photo-B']));
        expect(h1).not.toBe(h2);
    });

    it('le TYPE mime n’influence pas le hash (seul le contenu compte)', async () => {
        const h1 = await sha256OfFile(new Blob(['same'], { type: 'image/jpeg' }));
        const h2 = await sha256OfFile(new Blob(['same'], { type: 'image/png' }));
        expect(h1).toBe(h2);
    });

    it('retourne null pour une entrée invalide (pas de crash)', async () => {
        expect(await sha256OfFile(null)).toBeNull();
        expect(await sha256OfFile(undefined)).toBeNull();
        expect(await sha256OfFile({})).toBeNull();
    });
});
