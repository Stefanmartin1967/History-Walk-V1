import { describe, it, expect, vi, beforeEach } from 'vitest';

// Notes privées entre appareils (18/11/2026, point 3) : enchaînement lecture →
// décision → action, avec le transport simulé.

const h = vi.hoisted(() => ({
    remote: {},            // poiId → { text, sha } (dépôt simulé)
    offline: false,
    shaN: 0,
    writeFail: null,       // erreur à lever à la prochaine écriture
    netBack: null,
}));

vi.mock('../src/state.js', () => ({ state: { isAdmin: true, currentMapId: 'charleroi', userData: {}, loadedFeatures: [] } }));
vi.mock('../src/database.js', () => ({ savePoiData: vi.fn(async () => {}) }));
vi.mock('../src/github-sync.js', () => ({ getStoredToken: vi.fn(() => 'tok') }));
vi.mock('../src/events.js', () => ({ eventBus: { emit: vi.fn(), on: vi.fn() } }));
vi.mock('../src/network-status.js', () => ({ isOffline: () => h.offline, onNetworkBack: (fn) => { h.netBack = fn; } }));
vi.mock('../src/private-notes.js', () => ({
    readNoteFile: vi.fn(async (_m, id) => (h.remote[id] ? { ...h.remote[id] } : null)),
    listNoteFiles: vi.fn(async () => new Map(Object.entries(h.remote).map(([id, r]) => [id, r.sha]))),
    writeNoteFile: vi.fn(async (_m, id, text, expectedSha) => {
        if (h.writeFail) { const e = h.writeFail; h.writeFail = null; throw e; }
        const cur = h.remote[id];
        if ((cur?.sha ?? null) !== (expectedSha ?? null)) { const e = new Error('conflit'); e.status = expectedSha ? 409 : 422; throw e; }
        const sha = `s${++h.shaN}`;
        h.remote[id] = { text, sha };
        return sha;
    }),
    removeNoteFile: vi.fn(async (_m, id) => { delete h.remote[id]; }),
}));

import { state } from '../src/state.js';
import { writeNoteFile, removeNoteFile } from '../src/private-notes.js';
import { syncNote, noteEdited, resolveNoteConflict, syncAllNotes, forgetNote, notesInConflict } from '../src/note-sync.js';

const ud = (id) => state.userData[id];

beforeEach(() => {
    vi.clearAllMocks();
    state.userData = {};
    h.remote = {};
    h.offline = false;
    h.shaN = 0;
    h.writeFail = null;
});

describe('syncNote', () => {
    it('note écrite sur le terrain sans réseau : partie au retour', async () => {
        state.userData.G = { notes: 'Panneau n° 5.' };
        h.offline = true;
        expect(await noteEdited('G')).toBe('pending');
        expect(writeNoteFile).not.toHaveBeenCalled();
        expect(ud('G').noteSync.dirty).toBe(true);
        h.offline = false;
        await syncAllNotes();
        expect(h.remote.G.text).toBe('Panneau n° 5.');
        expect(ud('G').noteSync).toEqual({ sha: h.remote.G.sha, base: 'Panneau n° 5.', dirty: false });
    });

    it('changée seulement sur l’autre appareil : prise ici', async () => {
        h.remote.G = { text: 'Départ. Ailleurs.', sha: 's9' };
        state.userData.G = { notes: 'Départ.', noteSync: { sha: 's8', base: 'Départ.', dirty: false } };
        expect(await syncNote('G')).toBe('take');
        expect(ud('G').notes).toBe('Départ. Ailleurs.');
    });

    it('changée des deux côtés : conflit, rien d’écrasé', async () => {
        h.remote.G = { text: 'Départ. Ailleurs.', sha: 's9' };
        state.userData.G = { notes: 'Départ. Ici.', noteSync: { sha: 's8', base: 'Départ.', dirty: true } };
        expect(await syncNote('G')).toBe('conflict');
        expect(writeNoteFile).not.toHaveBeenCalled();
        expect(ud('G').notes).toBe('Départ. Ici.');
        expect(ud('G').noteSync).toMatchObject({ remote: 'Départ. Ailleurs.', remoteSha: 's9', base: 'Départ.' });
        expect(notesInConflict().map(n => n.poiId)).toEqual(['G']);
    });

    it('fichier changé entre la lecture et l’écriture : refus GitHub → conflit', async () => {
        h.remote.G = { text: 'Départ.', sha: 's8' };
        state.userData.G = { notes: 'Départ. Ici.', noteSync: { sha: 's8', base: 'Départ.', dirty: true } };
        const e = new Error('changé'); e.status = 409;
        h.writeFail = e;
        h.remote.G = { text: 'Départ.', sha: 's8' };
        // la 2e lecture voit la version de l'autre appareil
        const { readNoteFile } = await import('../src/private-notes.js');
        vi.mocked(readNoteFile).mockImplementationOnce(async () => ({ text: 'Départ.', sha: 's8' }))
            .mockImplementationOnce(async () => ({ text: 'Départ. Ailleurs.', sha: 's9' }));
        expect(await syncNote('G')).toBe('conflict');
    });

    it('résolution : la version finale part depuis la version en conflit', async () => {
        h.remote.G = { text: 'Départ. Ailleurs.', sha: 's9' };
        state.userData.G = { notes: 'Départ. Ici.', noteSync: { sha: 's8', base: 'Départ.', dirty: true, remote: 'Départ. Ailleurs.', remoteSha: 's9' } };
        expect(await resolveNoteConflict('G', 'Départ. Ici. Ailleurs.')).toBe('push');
        expect(h.remote.G.text).toBe('Départ. Ici. Ailleurs.');
        expect(ud('G').noteSync.remote).toBeUndefined();
        expect(notesInConflict()).toEqual([]);
    });

    it('note vidée ici, dépôt inchangé : supprimée du dépôt', async () => {
        h.remote.G = { text: 'Départ.', sha: 's8' };
        state.userData.G = { notes: '', noteSync: { sha: 's8', base: 'Départ.', dirty: true } };
        expect(await syncNote('G')).toBe('push');
        expect(removeNoteFile).toHaveBeenCalledWith('charleroi', 'G', 's8');
    });
});

describe('syncAllNotes', () => {
    it('une lecture du dossier ; seules les notes concernées sont relues', async () => {
        h.remote = { A: { text: 'a', sha: 'sa' }, B: { text: 'b2', sha: 'sb2' } };
        state.userData = {
            A: { notes: 'a', noteSync: { sha: 'sa', base: 'a', dirty: false } },   // à jour
            B: { notes: 'b', noteSync: { sha: 'sb', base: 'b', dirty: false } },   // changée ailleurs
        };
        const { readNoteFile } = await import('../src/private-notes.js');
        const r = await syncAllNotes();
        expect(readNoteFile).toHaveBeenCalledTimes(1);
        expect(ud('B').notes).toBe('b2');
        expect(r).toMatchObject({ changed: 1, conflicts: 0, errors: 0, failed: false });
    });
});

describe('forgetNote', () => {
    it('candidat rejeté : sa note quitte le dépôt', async () => {
        state.userData.K = { notes: 'Note du candidat', noteSync: { sha: 'sk', base: 'Note du candidat', dirty: false } };
        await forgetNote('K');
        expect(removeNoteFile).toHaveBeenCalledWith('charleroi', 'K', 'sk');
    });
    it('candidat sans note : rien', async () => {
        state.userData.K = {};
        await forgetNote('K');
        expect(removeNoteFile).not.toHaveBeenCalled();
    });
});

describe('gitBlobSha', () => {
    it('même empreinte que Git pour un texte (« hello » → b6fc4c62…)', async () => {
        const { gitBlobSha } = await import('../src/note-sync.js');
        // git hash-object sur « hello » (sans retour à la ligne)
        expect(await gitBlobSha('hello')).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
    });
    it('note d’avant le chantier identique au dépôt : retenue sans relecture', async () => {
        const { gitBlobSha } = await import('../src/note-sync.js');
        const { readNoteFile } = await import('../src/private-notes.js');
        h.remote = { A: { text: 'hello', sha: await gitBlobSha('hello') } };
        state.userData = { A: { notes: 'hello' } };
        await syncAllNotes();
        expect(readNoteFile).not.toHaveBeenCalled();
        expect(ud('A').noteSync).toMatchObject({ sha: h.remote.A.sha, dirty: false });
    });
});
