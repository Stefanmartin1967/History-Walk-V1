// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================================
// vite.config.js — cache des tuiles de carte (`map-tiles-cors`)
//
// Jusqu'à v3.7.440, la route était en CacheFirst : une tuile vue au moins une
// fois tous les 30 jours n'était jamais redemandée. L'expiration de Workbox
// remet l'horodatage à zéro à chaque affichage, et tient pour fraîche une
// réponse sans en-tête `Date`, illisible en CORS. Constaté le 19/10/2026 :
// Plan et Plan (FR) ont changé d'aspect quand l'ancien cache a été vidé.
//
// StaleWhileRevalidate garde le « pack terrain » (tuile servie depuis le cache,
// réseau ou pas) et la rafraîchit en arrière-plan, à travers le cache HTTP.
// ============================================================================

const config = readFileSync(resolve(__dirname, '..', 'vite.config.js'), 'utf8');

// Texte de la route des tuiles : de son `urlPattern` à celui de la route suivante.
function tileRoute() {
    const at = config.indexOf("cacheName: 'map-tiles-cors'");
    expect(at, 'cache map-tiles-cors absent de vite.config.js').toBeGreaterThan(-1);
    const start = config.lastIndexOf('urlPattern:', at);
    const next = config.indexOf('urlPattern:', at);
    return config.slice(start, next === -1 ? undefined : next);
}

describe('vite.config.js — cache des tuiles de carte', () => {
    it('rafraîchit les tuiles en arrière-plan (StaleWhileRevalidate)', () => {
        expect(tileRoute()).toMatch(/handler:\s*'StaleWhileRevalidate'/);
    });

    // Sans filtre explicite, StaleWhileRevalidate garde aussi les réponses
    // opaques (status 0), que Chrome compte ~7,8 Mo chacune. Pas d'âge maximal
    // depuis v3.7.443 : il effaçait une tuile restée 30 jours sans être affichée
    // (cf. cache_retention.test.js).
    it('ne garde que les réponses 200, avec une limite de nombre', () => {
        const route = tileRoute();
        expect(route).toMatch(/statuses:\s*\[200\]/);
        expect(route).toMatch(/maxEntries:\s*\d+/);
    });
});
