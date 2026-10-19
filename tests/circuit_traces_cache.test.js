// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================================
// vite.config.js — cache des tracés de circuits officiels (`circuit-traces`)
//
// Le tracé d'un circuit officiel (circuits/<map>/<nom>.gpx) est chargé à
// l'ouverture du circuit et gardé en mémoire seulement. Jusqu'à v3.7.441, aucune
// route du service worker ne le gardait : hors-ligne, un circuit ouvert en wifi
// s'affichait en vol d'oiseau (pointillés rouges). Constaté en suivi mobile le
// 19/10/2026.
//
// NetworkFirst (un tracé republié arrive en ligne), sans maxAgeSeconds : Workbox
// refuserait hors-ligne une copie dont l'en-tête `Date` dépasse cet âge.
// ============================================================================

const root = resolve(__dirname, '..');
const config = readFileSync(resolve(root, 'vite.config.js'), 'utf8');
const ORIGIN = 'https://heripia.com/';
const PATTERN = /urlPattern:\s*(\/.+\/[a-z]*),\s*$/gm;

// Texte de la route des tracés : de son `urlPattern` à celui de la route suivante.
function traceRoute() {
    const at = config.indexOf("cacheName: 'circuit-traces'");
    expect(at, 'cache circuit-traces absent de vite.config.js').toBeGreaterThan(-1);
    const start = config.lastIndexOf('urlPattern:', at);
    const next = config.indexOf('urlPattern:', at);
    return config.slice(start, next === -1 ? undefined : next);
}

// Littéral d'expression régulière écrit dans la config → RegExp.
const toRegExp = (literal) => new Function(`return ${literal}`)();
const patternsIn = (text) => [...text.matchAll(PATTERN)].map((m) => m[1]);

// Les GPX publiés, plus deux noms difficiles écrits ici (’ suivi d'un caractère
// invisible, apostrophe droite), avec les deux formes d'adresse de l'app :
// - chargement du tracé (circuit.js) : chaque segment passé à encodeURIComponent ;
// - QR de partage : nom brut, encodé par le navigateur.
const circuitsDir = resolve(root, 'public', 'circuits');
const gpxFiles = [
    ...readdirSync(circuitsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .flatMap((d) => readdirSync(resolve(circuitsDir, d.name))
            .filter((f) => f.endsWith('.gpx'))
            .map((f) => `${d.name}/${f}`)),
    'djerba/Circuit de Mosquée Sidi Youssef (Guechaine) à Mosquée d’‏Elyounsiine.gpx',
    "hammamet/Circuit de Vieux tank à Point de vue d'El Monchar.gpx",
];
const gpxUrls = gpxFiles.flatMap((file) => [
    new URL(`./circuits/${file.split('/').map(encodeURIComponent).join('/')}`, ORIGIN),
    new URL(`circuits/${file}`, ORIGIN),
]);

describe('vite.config.js — cache des tracés de circuits officiels', () => {
    it('garde le tracé, en le redemandant au serveur en ligne (NetworkFirst)', () => {
        expect(traceRoute()).toMatch(/handler:\s*'NetworkFirst'/);
    });

    it('ne garde que les réponses 200, avec une limite de nombre et SANS âge maximal', () => {
        const route = traceRoute();
        expect(route).toMatch(/statuses:\s*\[200\]/);
        expect(route).toMatch(/maxEntries:\s*\d+/);
        expect(route).not.toMatch(/maxAgeSeconds:/);
    });

    it('prend les GPX publiés, et pas les autres données des circuits', () => {
        const pattern = toRegExp(patternsIn(traceRoute())[0]);
        for (const url of gpxUrls) expect(pattern.test(url.href), url.href).toBe(true);
        expect(pattern.test(`${ORIGIN}circuits/djerba.json`)).toBe(false);
        expect(pattern.test(`${ORIGIN}djerba.geojson`)).toBe(false);
    });

    it('aucune autre route ne prend un GPX à sa place', () => {
        const trace = patternsIn(traceRoute())[0];
        const others = patternsIn(config).filter((literal) => literal !== trace);
        expect(others.length).toBeGreaterThan(0);
        for (const literal of others) {
            for (const url of gpxUrls) expect(toRegExp(literal).test(url.href), `${literal} ← ${url.href}`).toBe(false);
        }
    });

    // QR de partage : sans le denylist, la navigation vers le .gpx recevrait
    // index.html (l'app sur « Mes Circuits » vide) au lieu du fichier.
    it("l'ouverture directe d'un GPX n'est pas remplacée par l'app (navigateFallbackDenylist)", () => {
        const denylist = config.match(/navigateFallbackDenylist:\s*(\[.+\]),\s*$/m);
        expect(denylist, 'navigateFallbackDenylist absent de vite.config.js').not.toBeNull();
        const patterns = toRegExp(denylist[1]);
        for (const url of gpxUrls) {
            expect(patterns.some((p) => p.test(url.pathname + url.search)), url.pathname).toBe(true);
        }
    });
});
