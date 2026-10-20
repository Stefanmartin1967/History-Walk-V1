// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================================
// network-status.js — retour du réseau VÉRIFIÉ
//
// Constaté par Stefan sur son S25 le 20/10/2026 (v3.7.444) : quand le réseau
// revient pendant que Heripia est en arrière-plan, le signal « online » du
// navigateur est perdu. De retour dans Heripia, le bandeau « Hors-ligne »
// restait, le tracé en vol d'oiseau, la carte grise. Le module vérifie donc
// vraiment la connexion tant qu'il se croit hors-ligne : au signal « online »,
// au retour au premier plan, et toutes les 15 s.
// ============================================================================

vi.mock('../src/net.js', () => ({ fetchWithTimeout: vi.fn() }));

let mod, fetchWithTimeout, onLine;
const registered = []; // écouteurs posés par le module, retirés après chaque test

// Module neuf à chaque test (son état est global), navigator.onLine piloté.
async function boot({ online }) {
    onLine = online;
    vi.resetModules();
    mod = await import('../src/network-status.js');
    ({ fetchWithTimeout } = await import('../src/net.js'));
    fetchWithTimeout.mockReset();
    fetchWithTimeout.mockRejectedValue(new TypeError('Failed to fetch'));
    mod.initNetworkStatus();
}
const reachable = () => fetchWithTimeout.mockResolvedValue({ ok: true, status: 200 });
const bannerShown = () => document.getElementById('offline-banner').classList.contains('visible');
const flush = () => new Promise((r) => setTimeout(r, 0));
const setVisible = () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
    document.body.innerHTML = '<div id="offline-banner"></div>';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => onLine });
    // Vérification des 15 s : minuterie simulée, avancée à la main.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    for (const target of [window, document]) {
        const original = target.addEventListener.bind(target);
        vi.spyOn(target, 'addEventListener').mockImplementation((type, fn, opts) => {
            registered.push([target, type, fn, opts]);
            original(type, fn, opts);
        });
    }
});
afterEach(() => {
    for (const [target, type, fn, opts] of registered) target.removeEventListener(type, fn, opts);
    registered.length = 0;
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('network-status.js — passage hors-ligne', () => {
    it('démarrage en ligne : pas de bandeau, aucune vérification', async () => {
        await boot({ online: true });

        expect(mod.isOffline()).toBe(false);
        expect(bannerShown()).toBe(false);
        expect(fetchWithTimeout).not.toHaveBeenCalled();
    });

    it('démarrage sans réseau : bandeau, et une vérification tout de suite', async () => {
        await boot({ online: false });
        await flush();

        expect(mod.isOffline()).toBe(true);
        expect(bannerShown()).toBe(true);
        expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
        const [url, options] = fetchWithTimeout.mock.calls[0];
        expect(url).toMatch(/robots\.txt\?verif=\d+$/);
        expect(options).toMatchObject({ method: 'HEAD', cache: 'no-store' });
    });

    it('signal « offline » du navigateur : bandeau affiché', async () => {
        await boot({ online: true });

        window.dispatchEvent(new Event('offline'));

        expect(mod.isOffline()).toBe(true);
        expect(bannerShown()).toBe(true);
    });
});

describe('network-status.js — retour du réseau', () => {
    it('signal « online » + vérification réussie : bandeau retiré, abonnés prévenus une fois', async () => {
        await boot({ online: true });
        const back = vi.fn();
        mod.onNetworkBack(back);
        window.dispatchEvent(new Event('offline'));

        reachable();
        window.dispatchEvent(new Event('online'));
        await flush();

        expect(mod.isOffline()).toBe(false);
        expect(bannerShown()).toBe(false);
        expect(back).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new Event('online')); // déjà en ligne : rien
        await flush();
        expect(back).toHaveBeenCalledTimes(1);
        expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    });

    it('signal « online » trop tôt (réseau pas encore utilisable) : on reste hors-ligne', async () => {
        await boot({ online: true });
        const back = vi.fn();
        mod.onNetworkBack(back);
        window.dispatchEvent(new Event('offline'));

        window.dispatchEvent(new Event('online')); // la vérification échoue
        await flush();

        expect(mod.isOffline()).toBe(true);
        expect(bannerShown()).toBe(true);
        expect(back).not.toHaveBeenCalled();
    });

    // Le cas du S25 : réseau revenu en arrière-plan, signal « online » perdu.
    it('signal « online » perdu : le retour au premier plan vérifie et rétablit', async () => {
        await boot({ online: false });
        const back = vi.fn();
        mod.onNetworkBack(back);
        await flush();

        reachable();
        setVisible();
        await flush();

        expect(mod.isOffline()).toBe(false);
        expect(bannerShown()).toBe(false);
        expect(back).toHaveBeenCalledTimes(1);
    });

    it('signal « online » perdu, Heripia resté à l\'écran : rétabli par la vérification des 15 s', async () => {
        await boot({ online: false });
        const back = vi.fn();
        mod.onNetworkBack(back);
        await flush();
        expect(fetchWithTimeout).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(15000); // toujours pas de réseau
        await flush();
        expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
        expect(mod.isOffline()).toBe(true);

        reachable();
        await vi.advanceTimersByTimeAsync(15000);
        await flush();
        expect(mod.isOffline()).toBe(false);
        expect(back).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(60000); // en ligne : plus aucune vérification
        expect(fetchWithTimeout).toHaveBeenCalledTimes(3);
    });

    it('une seule vérification à la fois', async () => {
        await boot({ online: true });
        window.dispatchEvent(new Event('offline'));
        let release;
        fetchWithTimeout.mockReturnValue(new Promise((r) => { release = r; }));

        window.dispatchEvent(new Event('online'));
        setVisible();
        window.dispatchEvent(new Event('online'));
        expect(fetchWithTimeout).toHaveBeenCalledTimes(1);

        release({ ok: true });
        await flush();
        expect(mod.isOffline()).toBe(false);
    });

    it("un abonné en échec n'empêche pas les autres", async () => {
        await boot({ online: false });
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const second = vi.fn();
        mod.onNetworkBack(() => { throw new Error('boum'); });
        mod.onNetworkBack(second);
        await flush();

        reachable();
        setVisible();
        await flush();

        expect(second).toHaveBeenCalledTimes(1);
        expect(errors).toHaveBeenCalled();
        errors.mockRestore();
    });
});

// Si le service worker servait ce fichier depuis son cache, la vérification
// réussirait hors-ligne : on se croirait en ligne.
describe('network-status.js — le fichier vérifié vient toujours du réseau', () => {
    const root = resolve(__dirname, '..');
    const config = readFileSync(resolve(root, 'vite.config.js'), 'utf8');
    const CHECK_URL = 'https://heripia.com/robots.txt?verif=1';

    it('existe dans public/', async () => {
        const { CHECK_PATH } = await import('../src/network-status.js');
        expect(existsSync(resolve(root, 'public', CHECK_PATH))).toBe(true);
    });

    it("n'est pas précaché", async () => {
        const { CHECK_PATH } = await import('../src/network-status.js');
        const ext = CHECK_PATH.split('.').pop();
        const patterns = config.match(/globPatterns:\s*\[([^\]]*)\]/)[1];
        expect(patterns).not.toContain(ext);
    });

    it("n'est pris par aucune route du service worker", () => {
        const routes = [...config.matchAll(/urlPattern:\s*(\/.+\/[a-z]*),\s*$/gm)].map((m) => m[1]);
        expect(routes.length).toBeGreaterThan(0);
        for (const literal of routes) {
            expect(new Function(`return ${literal}`)().test(CHECK_URL), literal).toBe(false);
        }
    });
});
