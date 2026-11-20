// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    ACCOUNT_KEY,
    getLinkedAccount,
    linkGoogleAccount,
    disconnectGoogleAccount,
    eraseGoogleData,
    _resetGoogleAccountForTests,
} from '../src/google-account.js';

// Relier Heripia au compte Google (synchro users, PR 5, 20/11/2026).
// Fausse bibliothèque Google : `next` dit comment la fenêtre répond.

let next;           // { token } | { error } | { popup: 'popup_closed' | 'popup_failed_to_open' }
let lastRequest;    // options passées à requestAccessToken
let revoked;
let fetchCalls;

function installGoogle() {
    globalThis.google = {
        accounts: {
            oauth2: {
                initTokenClient(cfg) {
                    return {
                        requestAccessToken(opts) {
                            lastRequest = opts;
                            queueMicrotask(() => {
                                if (next.popup) cfg.error_callback({ type: next.popup });
                                else if (next.error) cfg.callback({ error: next.error });
                                else cfg.callback({ access_token: next.token, expires_in: 3599 });
                            });
                        },
                    };
                },
                hasGrantedAllScopes: () => true,
                revoke(tok, done) { revoked = tok; done(); },
            },
        },
    };
}

function installFetch(files = []) {
    fetchCalls = [];
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
        fetchCalls.push({ url, method: opts.method || 'GET', auth: opts.headers?.Authorization });
        if (url.includes('/about')) return new Response(JSON.stringify({ user: { emailAddress: 'prenom.nom@gmail.com' } }));
        if (url.includes('/files?')) return new Response(JSON.stringify({ files: files.map(id => ({ id })) }));
        if (opts.method === 'DELETE') return new Response(null, { status: 204 });
        return new Response('{}', { status: 404 });
    });
}

beforeEach(() => {
    _resetGoogleAccountForTests();
    localStorage.clear();
    next = { token: 'jeton-1' };
    lastRequest = undefined;
    revoked = undefined;
    installGoogle();
    installFetch();
});
afterEach(() => {
    delete globalThis.google;
});

describe('relier', () => {
    it('retient l’adresse du compte, lue avec l’accès drive.appdata', async () => {
        const acc = await linkGoogleAccount();
        expect(acc.email).toBe('prenom.nom@gmail.com');
        expect(getLinkedAccount().email).toBe('prenom.nom@gmail.com');
        expect(fetchCalls[0].url).toContain('/about?fields=user(emailAddress)');
        expect(fetchCalls[0].auth).toBe('Bearer jeton-1');
    });

    it('ne garde jamais l’accès lui-même sur l’appareil', async () => {
        await linkGoogleAccount();
        const stored = Object.keys(localStorage).map(k => localStorage.getItem(k)).join(' ');
        expect(stored).not.toContain('jeton-1');
    });

    it.each([
        ['popup_closed', 'closed'],
        ['popup_failed_to_open', 'blocked'],
    ])('fenêtre Google %s → %s, rien de retenu', async (popup, kind) => {
        next = { popup };
        await expect(linkGoogleAccount()).rejects.toMatchObject({ kind });
        expect(getLinkedAccount()).toBeNull();
    });

    it('accord refusé → denied', async () => {
        next = { error: 'access_denied' };
        await expect(linkGoogleAccount()).rejects.toMatchObject({ kind: 'denied' });
    });

    it('hors ligne → offline, sans ouvrir la fenêtre', async () => {
        const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        await expect(linkGoogleAccount()).rejects.toMatchObject({ kind: 'offline' });
        expect(lastRequest).toBeUndefined();
        spy.mockRestore();
    });

    it('bibliothèque Google absente → offline', async () => {
        delete globalThis.google;
        await expect(linkGoogleAccount()).rejects.toMatchObject({ kind: 'offline' });
    });
});

describe('déconnecter', () => {
    it('oublie l’adresse sans révoquer l’accord (les autres appareils restent reliés)', async () => {
        await linkGoogleAccount();
        disconnectGoogleAccount();
        expect(getLinkedAccount()).toBeNull();
        expect(revoked).toBeUndefined();
    });
});

describe('effacer', () => {
    it('supprime tous les fichiers de l’espace Heripia, révoque l’accès et oublie l’adresse', async () => {
        await linkGoogleAccount();
        installFetch(['a', 'b']);
        const n = await eraseGoogleData();
        expect(n).toBe(2);
        expect(fetchCalls.filter(c => c.method === 'DELETE').map(c => c.url)).toEqual([
            expect.stringContaining('/files/a'),
            expect.stringContaining('/files/b'),
        ]);
        expect(fetchCalls[0].url).toContain('spaces=appDataFolder');
        expect(revoked).toBe('jeton-1');
        expect(getLinkedAccount()).toBeNull();
    });

    it('accès expiré : redemande avec l’adresse en indice (pas de « Sélectionnez un compte »)', async () => {
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ email: 'prenom.nom@gmail.com', linkedAt: 'x' }));
        await eraseGoogleData();
        expect(lastRequest).toEqual({ login_hint: 'prenom.nom@gmail.com' });
    });

    it('fenêtre fermée : rien n’est effacé, le compte reste relié', async () => {
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ email: 'prenom.nom@gmail.com', linkedAt: 'x' }));
        next = { popup: 'popup_closed' };
        await expect(eraseGoogleData()).rejects.toMatchObject({ kind: 'closed' });
        expect(fetchCalls).toHaveLength(0);
        expect(getLinkedAccount()).not.toBeNull();
    });
});

describe('politique de sécurité de la page', () => {
    it('laisse passer la bibliothèque Google, sa fenêtre et l’espace Drive', async () => {
        const { readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');
        const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
        const directive = (name) => csp.split(';').map(d => d.trim()).find(d => d.startsWith(`${name} `)).split(/\s+/);
        expect(directive('script-src')).toContain('https://accounts.google.com/gsi/');
        expect(directive('frame-src')).toContain('https://accounts.google.com');
        expect(directive('connect-src')).toEqual(expect.arrayContaining([
            'https://www.googleapis.com', 'https://accounts.google.com', 'https://oauth2.googleapis.com',
        ]));
    });
});
