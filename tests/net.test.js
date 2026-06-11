// @vitest-environment jsdom
//
// Audit R3 (11/06/2026) : fetchWithTimeout borne tout appel réseau externe pour
// qu'un serveur muet ne suspende pas l'app indéfiniment.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout, NET_TIMEOUT_MS } from '../src/net.js';

afterEach(() => {
    vi.useRealTimers();
    delete global.fetch;
});

describe('fetchWithTimeout', () => {
    it('expose un timeout par défaut raisonnable (12 s)', () => {
        expect(NET_TIMEOUT_MS).toBe(12000);
    });

    it('retourne la réponse si le fetch répond à temps', async () => {
        const fakeResp = { ok: true, status: 200 };
        global.fetch = vi.fn(() => Promise.resolve(fakeResp));
        const r = await fetchWithTimeout('https://api.exemple/x');
        expect(r).toBe(fakeResp);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('transmet les options et injecte un signal d\'abandon', async () => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
        await fetchWithTimeout('https://api.exemple/x', { method: 'POST', headers: { A: '1' } });
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.exemple/x');
        expect(opts.method).toBe('POST');
        expect(opts.headers).toEqual({ A: '1' });
        expect(opts.signal).toBeInstanceOf(AbortSignal);
    });

    it('rejette avec un message lisible si le serveur ne répond pas dans le délai', async () => {
        vi.useFakeTimers();
        // fetch qui ne résout jamais mais honore l'abort (comme un vrai fetch).
        global.fetch = vi.fn((url, opts) => new Promise((_, reject) => {
            opts.signal.addEventListener('abort', () => {
                const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
            });
        }));
        const p = fetchWithTimeout('https://api.lente/x', {}, 5000);
        p.catch(() => {}); // évite un unhandled rejection avant l'assertion
        await vi.advanceTimersByTimeAsync(5000);
        await expect(p).rejects.toThrow(/Délai réseau dépassé \(5 s\)/);
    });

    it('laisse passer une erreur réseau non liée au timeout', async () => {
        const netErr = new TypeError('Failed to fetch');
        global.fetch = vi.fn(() => Promise.reject(netErr));
        await expect(fetchWithTimeout('https://api.exemple/x')).rejects.toThrow('Failed to fetch');
    });

    it('relaie l\'abort d\'un signal fourni par l\'appelant', async () => {
        const caller = new AbortController();
        global.fetch = vi.fn((url, opts) => new Promise((_, reject) => {
            opts.signal.addEventListener('abort', () => {
                const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
            });
        }));
        const p = fetchWithTimeout('https://api.exemple/x', { signal: caller.signal });
        p.catch(() => {});
        caller.abort();
        await expect(p).rejects.toThrow(/Délai réseau dépassé/);
    });
});
