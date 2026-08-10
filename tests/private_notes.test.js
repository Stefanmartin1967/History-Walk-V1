// @vitest-environment jsdom
//
// Note privée (chantier 10/08/2026) — remplace la sync Gist de `notes` par
// heripia-travail. Les tests portent sur les GARANTIES : bon dépôt, jamais
// perte silencieuse, jamais confondu avec le dépôt public.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/state.js', () => ({
    state: { userData: {} }
}));
vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn(() => 'fake-token'),
    uploadFileToGitHub: vi.fn(() => Promise.resolve()),
    deleteFileFromGitHub: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/net.js', () => ({ fetchWithTimeout: vi.fn() }));

import { state } from '../src/state.js';
import { getStoredToken, uploadFileToGitHub, deleteFileFromGitHub } from '../src/github-sync.js';
import { fetchWithTimeout } from '../src/net.js';
import { GITHUB_REPO, GITHUB_WORK_REPO } from '../src/config.js';
import { loadPrivateNote, savePrivateNote, migrateExistingNotes } from '../src/private-notes.js';

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStoredToken).mockReturnValue('fake-token');
    state.userData = {};
});

describe('garanties de transport', () => {
    it('le dépôt de travail est distinct du dépôt public', () => {
        expect(GITHUB_WORK_REPO).not.toBe(GITHUB_REPO);
    });

    it("l'envoi vise le dépôt de travail, jamais le dépôt public", async () => {
        await savePrivateNote('djerba', 'HW-1', 'une note');
        const repoArg = vi.mocked(uploadFileToGitHub).mock.calls[0][3];
        expect(repoArg).toBe(GITHUB_WORK_REPO);
        expect(repoArg).not.toBe(GITHUB_REPO);
    });

    it('le chemin est déterministe (mapId + poiId), pas d\'ID opaque à découvrir', async () => {
        await savePrivateNote('djerba', 'HW-42', 'une note');
        const pathArg = vi.mocked(uploadFileToGitHub).mock.calls[0][4];
        expect(pathArg).toBe('djerba/note_HW-42.txt');
    });
});

describe('savePrivateNote', () => {
    it('sans token → échec explicite (pas une perte silencieuse)', async () => {
        vi.mocked(getStoredToken).mockReturnValue(null);
        await expect(savePrivateNote('djerba', 'HW-1', 'texte')).rejects.toThrow(/Token/);
    });

    it('texte vide → SUPPRIME le fichier distant plutôt que d\'écrire un fichier vide', async () => {
        await savePrivateNote('djerba', 'HW-1', '');
        expect(deleteFileFromGitHub).toHaveBeenCalledWith(
            'fake-token', expect.any(String), GITHUB_WORK_REPO, 'djerba/note_HW-1.txt', expect.any(String)
        );
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('texte composé uniquement d\'espaces → traité comme vide (suppression)', async () => {
        await savePrivateNote('djerba', 'HW-1', '   \n  ');
        expect(deleteFileFromGitHub).toHaveBeenCalled();
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('suppression d\'une note qui n\'a jamais existé sur le dépôt → pas une erreur', async () => {
        vi.mocked(deleteFileFromGitHub).mockRejectedValue(new Error('Fichier introuvable sur le serveur: x'));
        await expect(savePrivateNote('djerba', 'HW-1', '')).resolves.toBeUndefined();
    });

    it('une vraie erreur de suppression remonte quand même', async () => {
        vi.mocked(deleteFileFromGitHub).mockRejectedValue(new Error('500'));
        await expect(savePrivateNote('djerba', 'HW-1', '')).rejects.toThrow('500');
    });
});

describe('loadPrivateNote', () => {
    it('sans token → null, silencieux', async () => {
        vi.mocked(getStoredToken).mockReturnValue(null);
        await expect(loadPrivateNote('djerba', 'HW-1')).resolves.toBeNull();
        expect(fetchWithTimeout).not.toHaveBeenCalled();
    });

    it('404 (cas normal : pas de note) → null', async () => {
        vi.mocked(fetchWithTimeout).mockResolvedValue({ status: 404, ok: false });
        await expect(loadPrivateNote('djerba', 'HW-1')).resolves.toBeNull();
    });

    it('200 → texte décodé', async () => {
        vi.mocked(fetchWithTimeout).mockResolvedValue({
            status: 200, ok: true,
            json: () => Promise.resolve({ content: btoa('Chercher l\'oratoire') }),
        });
        await expect(loadPrivateNote('djerba', 'HW-1')).resolves.toBe('Chercher l\'oratoire');
    });

    it('base64 avec retours à la ligne (formatage API GitHub) → décodé quand même', async () => {
        const wrapped = btoa('texte de la note').replace(/(.{4})/g, '$1\n');
        vi.mocked(fetchWithTimeout).mockResolvedValue({
            status: 200, ok: true,
            json: () => Promise.resolve({ content: wrapped }),
        });
        await expect(loadPrivateNote('djerba', 'HW-1')).resolves.toBe('texte de la note');
    });

    it('accents préservés (décodage UTF-8 explicite, pas atob seul)', async () => {
        const text = 'Vérifier la présence d\'un mausolée à Ouchachna';
        const bytes = new TextEncoder().encode(text);
        const b64 = btoa(String.fromCharCode(...bytes));
        vi.mocked(fetchWithTimeout).mockResolvedValue({
            status: 200, ok: true,
            json: () => Promise.resolve({ content: b64 }),
        });
        await expect(loadPrivateNote('djerba', 'HW-1')).resolves.toBe(text);
    });

    it('erreur réseau → null, ne jette pas', async () => {
        vi.mocked(fetchWithTimeout).mockRejectedValue(new Error('offline'));
        await expect(loadPrivateNote('djerba', 'HW-1')).resolves.toBeNull();
    });

    it('5xx → null (l\'appelant décide de la suite, ce module reste silencieux)', async () => {
        vi.mocked(fetchWithTimeout).mockResolvedValue({ status: 500, ok: false });
        await expect(loadPrivateNote('djerba', 'HW-1')).resolves.toBeNull();
    });
});

describe('migrateExistingNotes — one-shot, additif seulement', () => {
    it('pousse chaque note locale non vide vers heripia-travail', async () => {
        state.userData = {
            'HW-1': { notes: 'note un' },
            'HW-2': { notes: '' },
            'HW-3': { vu: true }, // pas de notes du tout
            'HW-4': { notes: 'note quatre' },
        };
        const result = await migrateExistingNotes('djerba');
        expect(result.total).toBe(2);
        expect(result.success).toBe(2);
        expect(result.failed).toEqual([]);
        expect(uploadFileToGitHub).toHaveBeenCalledTimes(2);
    });

    it('rien à migrer → aucun appel réseau', async () => {
        state.userData = { 'HW-1': { vu: true } };
        const result = await migrateExistingNotes('djerba');
        expect(result.total).toBe(0);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('un échec sur un POI n\'interrompt pas les suivants', async () => {
        state.userData = {
            'HW-1': { notes: 'ok' },
            'HW-2': { notes: 'va échouer' },
            'HW-3': { notes: 'ok aussi' },
        };
        vi.mocked(uploadFileToGitHub)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('rate limit'))
            .mockResolvedValueOnce(undefined);

        const result = await migrateExistingNotes('djerba');
        expect(result.total).toBe(3);
        expect(result.success).toBe(2);
        expect(result.failed).toEqual([{ poiId: 'HW-2', error: 'rate limit' }]);
    });

    it('rapporte la progression au fil de l\'envoi', async () => {
        state.userData = { 'HW-1': { notes: 'a' }, 'HW-2': { notes: 'b' } };
        const progress = [];
        await migrateExistingNotes('djerba', (done, total) => progress.push([done, total]));
        expect(progress).toEqual([[1, 2], [2, 2]]);
    });

    it('ne touche JAMAIS à state.userData (additif seulement, cf. no-direct-data-edits)', async () => {
        state.userData = { 'HW-1': { notes: 'a', vu: true } };
        const before = JSON.stringify(state.userData);
        await migrateExistingNotes('djerba');
        expect(JSON.stringify(state.userData)).toBe(before);
    });
});
