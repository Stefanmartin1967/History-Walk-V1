// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// ============================================================================
// photos-move.js — déménager les photos publiées d'une destination vers son
// dépôt de photos (3ᵉ PR du chantier, 02/11/2026).
//
// Copie TELLE QUELLE (mêmes octets), jamais de remplacement d'un fichier
// différent, adresse écrite dans le data seulement une fois en ligne, ordre
// conservé. La publication reste celle de « Tout publier ».
// ============================================================================

const h = vi.hoisted(() => ({ repoFiles: {}, online: new Set(), siteFiles: {} }));

vi.mock('../src/state.js', () => ({ state: {} }));
vi.mock('../src/utils.js', () => ({
    getPoiId: (f) => f.properties.HW_ID,
    getPoiProp: (f, key) => f.properties.userData?.[key] ?? f.properties[key],
}));
vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn(() => 'jeton'),
    uploadFileToGitHub: vi.fn(async () => ({})),
    githubHttpError: vi.fn(async (r, action) => new Error(`${action} : HTTP ${r.status}`)),
}));
vi.mock('../src/database.js', () => ({ savePoiData: vi.fn(async () => {}) }));
vi.mock('../src/events.js', () => ({ eventBus: { emit: vi.fn() } }));
vi.mock('../src/net.js', () => ({
    fetchWithTimeout: vi.fn(async (url, options = {}) => {
        if (url.startsWith('https://api.github.com/')) {
            const path = url.split('/contents/')[1];
            const sha = h.repoFiles[path];
            return sha ? { ok: true, status: 200, json: async () => ({ sha }) } : { ok: false, status: 404 };
        }
        if (options.method === 'HEAD') return { ok: h.online.has(url), status: h.online.has(url) ? 200 : 404 };
        const name = new URL(url).pathname.split('/').pop();
        return h.siteFiles[name] !== undefined
            ? { ok: true, status: 200, blob: async () => new Blob([h.siteFiles[name]]) }
            : { ok: false, status: 404 };
    }),
}));

import { state } from '../src/state.js';
import { uploadFileToGitHub } from '../src/github-sync.js';
import { savePoiData } from '../src/database.js';
import { eventBus } from '../src/events.js';
import { listPhotosToMove, movePhotosToRepo } from '../src/photos-move.js';

const BASE = 'https://stefanmartin1967.github.io/heripia-photos-charleroi/photos/';
const place = (id, photos, userData) => ({ properties: { HW_ID: id, photos, ...(userData ? { userData } : {}) } });
const blobSha = (text) => createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex');
const run = (timing = { pollMs: 0, deadlineMs: 0 }) => movePhotosToRepo('charleroi', () => {}, timing);

beforeEach(() => {
    vi.clearAllMocks();
    h.repoFiles = {};
    h.siteFiles = { 'a.jpg': 'AAA', 'b.jpg': 'BBB', 'c.jpg': 'CCC' };
    h.online = new Set([`${BASE}a.jpg`, `${BASE}b.jpg`, `${BASE}c.jpg`]);
    state.currentMapId = 'charleroi';
    state.destinations = { maps: { charleroi: { photosRepo: 'heripia-photos-charleroi' }, djerba: {} } };
    state.userData = {};
    state.loadedFeatures = [
        place('p1', ['photos/a.jpg', `${BASE}x.jpg`, 'photos/b.jpg']),
        place('p2', ['photos/c.jpg']),
        place('p3', []),
    ];
});

describe('listPhotosToMove', () => {
    it('ne liste que les chemins courts du dépôt principal, lieux supprimés exclus', () => {
        state.loadedFeatures.push(place('p4', ['photos/d.jpg']));
        state.userData.p4 = { _deleted: true };
        expect(listPhotosToMove()).toEqual([
            { poiId: 'p1', paths: ['photos/a.jpg', 'photos/b.jpg'] },
            { poiId: 'p2', paths: ['photos/c.jpg'] },
        ]);
    });

    it('lit les données locales en premier (overlay)', () => {
        state.loadedFeatures = [place('p1', ['photos/a.jpg'], { photos: [`${BASE}a.jpg`] })];
        expect(listPhotosToMove()).toEqual([]);
    });
});

describe('movePhotosToRepo', () => {
    it('copie tel quel, puis remplace les adresses dans le même ordre', async () => {
        const res = await run();

        expect(uploadFileToGitHub).toHaveBeenCalledTimes(3);
        const [file, token, owner, repo, path] = uploadFileToGitHub.mock.calls[0];
        expect([token, owner, repo, path, file.name]).toEqual(['jeton', 'Stefanmartin1967', 'heripia-photos-charleroi', 'photos/a.jpg', 'a.jpg']);
        expect(await file.text()).toBe('AAA');

        expect(state.userData.p1.photos).toEqual([`${BASE}a.jpg`, `${BASE}x.jpg`, `${BASE}b.jpg`]);
        expect(state.userData.p2.photos).toEqual([`${BASE}c.jpg`]);
        expect(state.loadedFeatures[0].properties.userData).toBe(state.userData.p1);
        expect(savePoiData).toHaveBeenCalledWith('charleroi', 'p1', state.userData.p1);
        expect(eventBus.emit).toHaveBeenCalledWith('admin:poi-edited', { id: 'p1', type: 'update' });
        expect(res).toEqual({ places: 2, copied: 3, alreadyThere: 0, notOnline: [], failed: [] });
    });

    it('fichier déjà dans le dépôt avec le même contenu : sauté, adresse remplacée', async () => {
        h.repoFiles['photos/a.jpg'] = blobSha('AAA');
        const res = await run();
        expect(uploadFileToGitHub.mock.calls.map((c) => c[4])).toEqual(['photos/b.jpg', 'photos/c.jpg']);
        expect(res.alreadyThere).toBe(1);
        expect(state.userData.p1.photos[0]).toBe(`${BASE}a.jpg`);
    });

    it('fichier DIFFÉRENT sous le même nom : jamais remplacé, adresse inchangée', async () => {
        h.repoFiles['photos/a.jpg'] = blobSha('autre chose');
        const res = await run();
        expect(uploadFileToGitHub.mock.calls.map((c) => c[4])).not.toContain('photos/a.jpg');
        expect(res.failed).toEqual([{ path: 'photos/a.jpg', error: expect.stringMatching(/fichier différent/) }]);
        expect(state.userData.p1.photos).toEqual(['photos/a.jpg', `${BASE}x.jpg`, `${BASE}b.jpg`]);
    });

    it('photo pas encore en ligne : adresse inchangée, signalée', async () => {
        h.online.delete(`${BASE}c.jpg`);
        const res = await run();
        expect(res.notOnline).toEqual([`${BASE}c.jpg`]);
        expect(state.userData.p2).toBeUndefined();
        expect(res.places).toBe(1);
    });

    it('attend la mise en ligne tant que le délai le permet', async () => {
        h.online.delete(`${BASE}c.jpg`);
        setTimeout(() => h.online.add(`${BASE}c.jpg`), 20);
        const res = await run({ pollMs: 10, deadlineMs: 2000 });
        expect(res.notOnline).toEqual([]);
        expect(state.userData.p2.photos).toEqual([`${BASE}c.jpg`]);
    });

    it('photo absente du site : signalée, rien envoyé pour elle', async () => {
        delete h.siteFiles['c.jpg'];
        const res = await run();
        expect(res.failed).toEqual([{ path: 'photos/c.jpg', error: expect.stringMatching(/introuvable/) }]);
        expect(state.userData.p2).toBeUndefined();
    });

    it('refuse sans dépôt de photos, hors destination active', async () => {
        state.currentMapId = 'djerba';
        await expect(movePhotosToRepo('djerba')).rejects.toThrow(/pas de dépôt de photos/);
        await expect(movePhotosToRepo('charleroi')).rejects.toThrow(/pas active/);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('relancé après coup : rien à refaire', async () => {
        await run();
        vi.clearAllMocks();
        const res = await run();
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
        expect(res).toEqual({ places: 0, copied: 0, alreadyThere: 0, notOnline: [], failed: [] });
    });
});
