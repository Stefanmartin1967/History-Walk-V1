// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// repo-read.js — lecture fraîche des fichiers du dépôt (10/11/2026).
// RAW garde 5 minutes et ignore `?t=` : avec un jeton, on lit par l'API.
// ============================================================================

const h = vi.hoisted(() => ({ token: 'jeton', fetch: null }));

vi.mock('../src/github-sync.js', () => ({ getStoredToken: () => h.token }));
vi.mock('../src/net.js', () => ({ fetchWithTimeout: (...a) => h.fetch(...a) }));

import {
    fetchRepoFile, fetchRepoFileFresh, repoFileSha, getRepoFileSha,
    setLoadedGeojsonSha, getLoadedGeojsonSha,
} from '../src/repo-read.js';

const SHA = '2ad2ec164571e4c578393df494b29edf9e7b00aa';
const API = 'https://api.github.com/repos/Stefanmartin1967/History-Walk-V1/contents/public/charleroi.geojson?ref=main';

function resp(status, etag) {
    return { ok: status >= 200 && status < 300, status, headers: new Headers(etag ? { etag } : {}), json: async () => ({}) };
}

beforeEach(() => {
    h.token = 'jeton';
    h.fetch = vi.fn(async () => resp(200, `"${SHA}"`));
});

describe('fetchRepoFile', () => {
    it("avec un jeton : lit par l'API, sans cache navigateur, et retient la version (ETag)", async () => {
        const r = await fetchRepoFile('public/charleroi.geojson');
        const [url, opts] = h.fetch.mock.calls[0];
        expect(url).toBe(API);
        expect(opts.cache).toBe('no-store');
        expect(opts.headers.Accept).toBe('application/vnd.github.raw');
        expect(opts.headers.Authorization).toBe('token jeton');
        expect(repoFileSha(r)).toBe(SHA);
    });

    it('sans jeton : RAW, comme avant, et version inconnue', async () => {
        h.token = null;
        const r = await fetchRepoFile('public/charleroi.geojson');
        expect(h.fetch.mock.calls[0][0]).toMatch(/^https:\/\/raw\.githubusercontent\.com\/.+\/public\/charleroi\.geojson\?t=\d+$/);
        expect(repoFileSha(r)).toBeNull();
    });

    it("API en panne (500) : repli sur RAW", async () => {
        h.fetch = vi.fn(async (url) => url.startsWith('https://api.github.com') ? resp(500) : resp(200));
        const r = await fetchRepoFile('public/charleroi.geojson');
        expect(h.fetch).toHaveBeenCalledTimes(2);
        expect(h.fetch.mock.calls[1][0]).toMatch(/raw\.githubusercontent\.com/);
        expect(repoFileSha(r)).toBeNull();
    });

    it("404 de l'API : rendu tel quel (fichier absent), sans repli", async () => {
        h.fetch = vi.fn(async () => resp(404));
        const r = await fetchRepoFile('public/circuits/tested_hammamet.json');
        expect(r.status).toBe(404);
        expect(h.fetch).toHaveBeenCalledTimes(1);
    });
});

describe('fetchRepoFileFresh', () => {
    it('null sans jeton, ou si le réseau échoue', async () => {
        h.token = null;
        expect(await fetchRepoFileFresh('public/x.geojson')).toBeNull();
        h.token = 'jeton';
        h.fetch = vi.fn(async () => { throw new Error('hors ligne'); });
        expect(await fetchRepoFileFresh('public/x.geojson')).toBeNull();
    });
});

describe('getRepoFileSha', () => {
    it('HEAD sur l\'API, version lue dans l\'ETag', async () => {
        expect(await getRepoFileSha('public/charleroi.geojson')).toBe(SHA);
        expect(h.fetch.mock.calls[0][1].method).toBe('HEAD');
    });

    it('null si le fichier est absent ; erreur si GitHub ne répond pas bien', async () => {
        h.fetch = vi.fn(async () => resp(404));
        expect(await getRepoFileSha('public/x.geojson')).toBeNull();
        h.fetch = vi.fn(async () => resp(502));
        await expect(getRepoFileSha('public/x.geojson')).rejects.toThrow(/502/);
        h.fetch = vi.fn(async () => resp(200));
        await expect(getRepoFileSha('public/x.geojson')).rejects.toThrow(/ETag/);
    });
});

describe('version chargée', () => {
    it('retenue par destination, null par défaut', () => {
        expect(getLoadedGeojsonSha('nulle-part')).toBeNull();
        setLoadedGeojsonSha('charleroi', SHA);
        expect(getLoadedGeojsonSha('charleroi')).toBe(SHA);
        setLoadedGeojsonSha('charleroi', null);
        expect(getLoadedGeojsonSha('charleroi')).toBeNull();
    });
});
