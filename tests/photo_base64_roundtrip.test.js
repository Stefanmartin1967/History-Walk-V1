// @vitest-environment jsdom
//
// Vérifie les briques de conversion utilisées par la sauvegarde des photos :
// les photos perso vivent en Blob (runtime) mais doivent transiter en base64
// dans le fichier JSON (un JSON ne porte pas de binaire). On teste le vrai
// aller-retour blobToBase64 -> base64ToBlob (pas de mock de ces fonctions).

import { describe, it, expect, vi } from 'vitest';

// database.js importe modal.js (showAlert) — on le neutralise. Aucune autre
// dépendance n'est exécutée au chargement du module (IndexedDB est lazy).
vi.mock('../src/modal.js', () => ({ showAlert: vi.fn() }));

import { blobToBase64, base64ToBlob } from '../src/database.js';

describe('round-trip Blob <-> base64 (photos)', () => {
    it('blobToBase64 produit une data-URL base64', async () => {
        const blob = new Blob(['hello'], { type: 'text/plain' });
        const dataUrl = await blobToBase64(blob);
        expect(typeof dataUrl).toBe('string');
        expect(dataUrl.startsWith('data:')).toBe(true);
        expect(dataUrl).toContain('base64,');
    });

    it('base64ToBlob ∘ blobToBase64 préserve le contenu et le type MIME', async () => {
        const original = new Blob(['HistoryWalk-1234'], { type: 'image/jpeg' });
        const dataUrl = await blobToBase64(original);
        const restored = base64ToBlob(dataUrl);

        expect(restored).toBeInstanceOf(Blob);
        expect(restored.type).toBe('image/jpeg');
        const text = await restored.text();
        expect(text).toBe('HistoryWalk-1234');
    });

    it('base64ToBlob retombe sur image/jpeg si le mime est absent', () => {
        const blob = base64ToBlob('data:;base64,QUJD'); // "ABC"
        expect(blob.type).toBe('image/jpeg');
    });
});
