// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================================
// vite.config.js — durée de conservation des caches du service worker
//
// Jusqu'à v3.7.442, les données (index des circuits, catégories, destinations,
// fichier des lieux) avaient un âge maximal de 7 jours, les photos et les
// tuiles de 30 jours. Mesuré hors-ligne le 20/10/2026 avec des copies vieillies
// de 31 jours : plus aucun circuit officiel listé, photo de fiche absente, et
// les tuiles pas affichées depuis 30 jours effacées au premier affichage de la
// carte. Ces caches sont le secours hors-ligne du « pack terrain », préparé
// parfois des mois avant le terrain : aucun ne doit avoir d'âge maximal, et
// chacun reste borné par un nombre d'entrées.
// ============================================================================

const config = readFileSync(resolve(__dirname, '..', 'vite.config.js'), 'utf8');
// Code seul : les commentaires citent l'option pour expliquer son absence.
const code = config.replace(/^\s*\/\/.*$/gm, '');

// Chaque route : de son `urlPattern` à celui de la suivante, nommée par son cache.
const routes = code.split(/urlPattern:/).slice(1).map((text) => ({
    name: text.match(/cacheName:\s*'([^']+)'/)?.[1] ?? '(sans nom)',
    text,
}));

describe('vite.config.js — durée de conservation des caches', () => {
    it('lit bien toutes les routes du service worker', () => {
        expect(routes.map((r) => r.name)).toEqual(
            expect.arrayContaining(['geojson-data', 'app-data', 'circuit-traces', 'map-tiles-cors', 'poi-photos']),
        );
    });

    it("aucune route n'a d'âge maximal (maxAgeSeconds)", () => {
        for (const route of routes) expect(route.text, route.name).not.toMatch(/maxAgeSeconds/);
    });

    it("chaque route borne son cache par un nombre d'entrées", () => {
        for (const route of routes) expect(route.text, route.name).toMatch(/maxEntries:\s*\d+/);
    });
});
