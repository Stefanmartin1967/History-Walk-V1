// Secours au démarrage (public/boot-guard.js) : une ancienne page dont les
// fichiers principaux ont disparu après un déploiement (11-12/11/2026) vide le
// précache, désinscrit le service worker et recharge UNE fois.
// Chaque test charge le script dans un JSDOM neuf (ses écouteurs ne s'empilent pas).
// Le rechargement se lit dans la console virtuelle : JSDOM signale
// « Not implemented: navigation » à l'appel de location.reload().
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const CODE = readFileSync(resolve(__dirname, '../public/boot-guard.js'), 'utf8');

function setup({ online = true, storage = {} } = {}) {
    const vc = new VirtualConsole();
    const events = { reloads: 0 };
    vc.on('jsdomError', (e) => { if (/navigation/i.test(String(e && e.message))) events.reloads++; });
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
        url: 'https://heripia.com/', runScripts: 'outside-only', virtualConsole: vc,
    });
    const w = dom.window;
    Object.entries(storage).forEach(([k, v]) => w.sessionStorage.setItem(k, v));
    Object.defineProperty(w.navigator, 'onLine', { value: online, configurable: true });
    events.unregistered = 0;
    Object.defineProperty(w.navigator, 'serviceWorker', {
        configurable: true,
        value: { getRegistrations: async () => [{ unregister: async () => { events.unregistered++; return true; } }] },
    });
    const store = new Set(['workbox-precache-v2-https://heripia.com/', 'map-tiles-v2', 'poi-photos', 'app-data']);
    w.caches = { keys: async () => [...store], delete: async (k) => store.delete(k) };
    w.eval(CODE);
    return { w, events, store };
}

// Simule l'échec de chargement d'un élément (l'événement ne remonte pas).
function failLoad(w, tag, url) {
    const el = w.document.createElement(tag);
    if (tag === 'script') el.src = url; else { el.rel = 'stylesheet'; el.href = url; }
    w.document.head.appendChild(el);
    el.dispatchEvent(new w.Event('error'));
}
const settle = () => new Promise(r => setTimeout(r, 20));

describe('boot-guard — fichiers principaux introuvables', () => {
    it('style principal en échec : vide le précache seul, désinscrit le SW, recharge', async () => {
        const { w, events, store } = setup();
        failLoad(w, 'link', 'https://heripia.com/assets/main-C7TCHnLZ.css');
        await settle();
        expect(events.reloads).toBe(1);
        expect(events.unregistered).toBe(1);
        expect([...store].sort()).toEqual(['app-data', 'map-tiles-v2', 'poi-photos']); // secours hors-ligne intact
        expect(w.sessionStorage.getItem('hw_boot_guard')).toBeTruthy();
    });

    it('code principal en échec : même secours', async () => {
        const { w, events } = setup();
        failLoad(w, 'script', 'https://heripia.com/assets/main-B_a1k_KN.js');
        await settle();
        expect(events.reloads).toBe(1);
    });

    it('le style et le code échouent ensemble : un seul rechargement', async () => {
        const { w, events } = setup();
        failLoad(w, 'link', 'https://heripia.com/assets/main-C7TCHnLZ.css');
        failLoad(w, 'script', 'https://heripia.com/assets/main-B_a1k_KN.js');
        await settle();
        expect(events.reloads).toBe(1);
    });

    it('déjà tenté dans cet onglet : ne recharge plus (pas de boucle)', async () => {
        const { w, events } = setup({ storage: { hw_boot_guard: '1' } });
        failLoad(w, 'link', 'https://heripia.com/assets/main-C7TCHnLZ.css');
        await settle();
        expect(events.reloads).toBe(0);
        expect(events.unregistered).toBe(0);
    });

    it('hors ligne : ne touche à rien', async () => {
        const { w, events, store } = setup({ online: false });
        failLoad(w, 'script', 'https://heripia.com/assets/main-B_a1k_KN.js');
        await settle();
        expect(events.reloads).toBe(0);
        expect(store.size).toBe(4);
    });

    it('un autre fichier en échec (morceau chargé à la demande, image) : rien', async () => {
        const { w, events } = setup();
        failLoad(w, 'script', 'https://heripia.com/assets/cropper-CMr-B4M_.js');
        failLoad(w, 'link', 'https://heripia.com/style/me-userspace.css?v=6');
        await settle();
        expect(events.reloads).toBe(0);
    });

    it('démarrage réussi : la tentative est rendue pour le prochain déploiement', async () => {
        const { w } = setup({ storage: { hw_boot_guard: '1' } });
        w.dispatchEvent(new w.Event('load'));
        expect(w.sessionStorage.getItem('hw_boot_guard')).toBeNull();
    });
});

describe('boot-guard — branchement', () => {
    it('index.html le charge avant tout autre script', () => {
        const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
        const guard = html.indexOf('<script src="boot-guard.js">');
        expect(guard).toBeGreaterThan(0);
        expect(guard).toBeLessThan(html.indexOf('<script src="theme-bootstrap.js">'));
        expect(guard).toBeLessThan(html.indexOf('<script type="module"'));
    });
});
