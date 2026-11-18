// @vitest-environment jsdom
//
// Note privée — transport vers heripia-travail. Depuis le 18/11/2026 (point 3
// des conflits), par VERSION : lecture avec la version du fichier, liste du
// dossier en une requête, écriture et suppression seulement depuis une version
// connue (sinon GitHub refuse au lieu d'écraser). Garanties gardées : bon
// dépôt, chemin déterministe, jamais confondu avec le dépôt public.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn(() => 'fake-token'),
    uploadFileToGitHub: vi.fn(() => Promise.resolve({ content: { sha: 'new-sha' } })),
    deleteFileFromGitHub: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/net.js', () => ({ fetchWithTimeout: vi.fn() }));

import { getStoredToken, uploadFileToGitHub, deleteFileFromGitHub } from '../src/github-sync.js';
import { fetchWithTimeout } from '../src/net.js';
import { GITHUB_REPO, GITHUB_WORK_REPO } from '../src/config.js';
import { readNoteFile, listNoteFiles, writeNoteFile, removeNoteFile } from '../src/private-notes.js';

const b64 = (t) => btoa(String.fromCharCode(...new TextEncoder().encode(t)));
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStoredToken).mockReturnValue('fake-token');
});

describe('garanties de transport', () => {
    it('le dépôt de travail est distinct du dépôt public', () => {
        expect(GITHUB_WORK_REPO).not.toBe(GITHUB_REPO);
    });

    it("l'écriture vise le dépôt de travail, au chemin déterministe", async () => {
        await writeNoteFile('djerba', 'HW-42', 'une note', 'sha1');
        const [, , owner, repo, path] = vi.mocked(uploadFileToGitHub).mock.calls[0];
        expect(owner).toBeTruthy();
        expect(repo).toBe(GITHUB_WORK_REPO);
        expect(path).toBe('djerba/note_HW-42.txt');
    });
});

describe('writeNoteFile', () => {
    it('depuis une version connue : la donne à GitHub (refus si changée ailleurs)', async () => {
        const sha = await writeNoteFile('djerba', 'HW-1', ' texte ', 'sha1');
        expect(sha).toBe('new-sha');
        expect(vi.mocked(uploadFileToGitHub).mock.calls[0][6]).toEqual({ expectedSha: 'sha1' });
    });
    it('sans version : création seulement (jamais d’écrasement d’un fichier créé ailleurs)', async () => {
        await writeNoteFile('djerba', 'HW-1', 'texte', null);
        expect(vi.mocked(uploadFileToGitHub).mock.calls[0][6]).toEqual({ create: true });
    });
    it('sans jeton : échec explicite', async () => {
        vi.mocked(getStoredToken).mockReturnValue(null);
        await expect(writeNoteFile('djerba', 'HW-1', 'x', 'sha1')).rejects.toThrow(/Jeton/);
    });
});

describe('removeNoteFile', () => {
    it('supprime CETTE version seulement', async () => {
        await removeNoteFile('djerba', 'HW-1', 'sha1');
        const call = vi.mocked(deleteFileFromGitHub).mock.calls[0];
        expect(call[2]).toBe(GITHUB_WORK_REPO);
        expect(call[3]).toBe('djerba/note_HW-1.txt');
        expect(call[5]).toEqual({ expectedSha: 'sha1' });
    });
});

describe('readNoteFile', () => {
    it('200 → texte décodé (accents, base64 avec retours à la ligne) et version', async () => {
        const content = b64('Grotte visitable\nSombre à l’intérieur').replace(/(.{20})/g, '$1\n');
        vi.mocked(fetchWithTimeout).mockResolvedValue(resp(200, { content, sha: 'abc' }));
        expect(await readNoteFile('charleroi', 'HW-1')).toEqual({ text: 'Grotte visitable\nSombre à l’intérieur', sha: 'abc' });
    });
    it('404 → null (pas de note)', async () => {
        vi.mocked(fetchWithTimeout).mockResolvedValue(resp(404, {}));
        expect(await readNoteFile('charleroi', 'HW-1')).toBeNull();
    });
    it('5xx ou réseau → LÈVE (« absente » ≠ « inconnue »)', async () => {
        vi.mocked(fetchWithTimeout).mockResolvedValue(resp(500, {}));
        await expect(readNoteFile('charleroi', 'HW-1')).rejects.toThrow();
        vi.mocked(fetchWithTimeout).mockRejectedValue(new Error('réseau'));
        await expect(readNoteFile('charleroi', 'HW-1')).rejects.toThrow();
    });
});

describe('listNoteFiles', () => {
    it('une requête : versions de toutes les notes du dossier', async () => {
        vi.mocked(fetchWithTimeout).mockResolvedValue(resp(200, [
            { type: 'file', name: 'note_HW-A.txt', sha: 's1' },
            { type: 'file', name: 'work_HW-A_1.jpg', sha: 'x' },
            { type: 'file', name: 'note_HW-B.txt', sha: 's2' },
        ]));
        const m = await listNoteFiles('charleroi');
        expect([...m.entries()]).toEqual([['HW-A', 's1'], ['HW-B', 's2']]);
        expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    });
    it('dossier absent → aucune note ; échec → LÈVE', async () => {
        vi.mocked(fetchWithTimeout).mockResolvedValue(resp(404, {}));
        expect((await listNoteFiles('charleroi')).size).toBe(0);
        vi.mocked(fetchWithTimeout).mockResolvedValue(resp(503, {}));
        await expect(listNoteFiles('charleroi')).rejects.toThrow();
    });
});
