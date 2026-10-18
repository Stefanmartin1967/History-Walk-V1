// @vitest-environment node

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================================
// public/sw-cleanup.js — suppression des caches obsolètes par le service worker
//
// Les tuiles de carte passent en CORS (18/10/2026) : leur cache est renommé
// `map-tiles` → `map-tiles-cors`, parce qu'une tuile opaque déjà en cache,
// resservie à une <img crossorigin>, ne s'affiche pas. L'ancien cache (jusqu'à
// ~2 Go au compteur de Chrome) doit disparaître à l'activation du nouveau SW.
//
// Deux gardes en plus du comportement :
// - le script est bien chargé par le SW et existe dans public/ (sinon le SW
//   échouerait à s'installer et plus aucune mise à jour n'arriverait) ;
// - il ne supprime aucun cache encore utilisé par une route Workbox.
// ============================================================================

const root = resolve(__dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

// Exécute le script comme le ferait le service worker, avec un `self` et un
// `caches` factices, puis déclenche 'activate'. Renvoie la promesse confiée à
// waitUntil.
function runActivate(deleteImpl = async () => true) {
    const listeners = {};
    const self = { addEventListener: (type, fn) => { listeners[type] = fn; } };
    const caches = { delete: vi.fn(deleteImpl) };
    new Function('self', 'caches', read('public/sw-cleanup.js'))(self, caches);
    let pending;
    listeners.activate({ waitUntil: (promise) => { pending = promise; } });
    return { caches, pending };
}

describe('sw-cleanup.js — activation du service worker', () => {
    it("supprime l'ancien cache de tuiles opaques `map-tiles`", async () => {
        const { caches, pending } = runActivate();
        await pending;
        expect(caches.delete).toHaveBeenCalledWith('map-tiles');
    });

    it("un échec de suppression ne fait pas échouer l'activation", async () => {
        const { pending } = runActivate(async () => { throw new Error('quota'); });
        await expect(pending).resolves.toBeUndefined();
    });
});

describe('sw-cleanup.js — gardes de configuration (vite.config.js)', () => {
    const config = read('vite.config.js');

    it('est chargé par le service worker et existe dans public/', () => {
        const declared = config.match(/importScripts:\s*\[([^\]]*)\]/);
        expect(declared, 'importScripts absent de vite.config.js').not.toBeNull();
        const scripts = [...declared[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
        expect(scripts).toContain('sw-cleanup.js');
        for (const script of scripts) {
            expect(existsSync(resolve(root, 'public', script)), `public/${script} manquant`).toBe(true);
        }
    });

    it("ne supprime aucun cache encore utilisé par une route", async () => {
        const { caches, pending } = runActivate();
        await pending;
        const deleted = caches.delete.mock.calls.map(([name]) => name);
        const live = [...config.matchAll(/cacheName:\s*'([^']+)'/g)].map((m) => m[1]);
        expect(live).toContain('map-tiles-cors');
        expect(deleted.filter((name) => live.includes(name))).toEqual([]);
    });
});
