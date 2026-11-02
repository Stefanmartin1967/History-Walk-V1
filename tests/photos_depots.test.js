// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { photoStorage } from '../src/config.js';

// ============================================================================
// Photos servies par un dépôt de photos par destination (heripia-photos-<id>,
// chantier du 02/11/2026) : une autre origine que le site.
//
//  - service worker : une route dédiée, ancrée au début de l'adresse (sinon
//    Workbox ne l'applique pas à une autre origine), qui redemande la photo en
//    CORS et ne garde que les réponses 200 — une réponse opaque compterait
//    ~7,8 Mo dans le stockage du site (piège des tuiles, 18/10/2026) ;
//  - politique de sécurité de la page : `connect-src` doit laisser passer
//    l'adresse (ZIP, photos des étapes gardées hors-ligne), `img-src` aussi.
// ============================================================================

const root = resolve(__dirname, '..');
const config = readFileSync(resolve(root, 'vite.config.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
const route = config.split(/urlPattern:/).slice(1).find((text) => /cacheName:\s*'poi-photos-depots'/.test(text));
const [, source, flags] = route.match(/^\s*\/(.+)\/([a-z]*),/);
const pattern = new RegExp(source, flags);

describe('service worker — route des dépôts de photos', () => {
    it('reconnaît une photo de dépôt, et rien d\'autre', () => {
        expect(pattern.test('https://stefanmartin1967.github.io/heripia-photos-charleroi/photos/poi_HW-1_2.jpg')).toBe(true);
        expect(pattern.test('https://stefanmartin1967.github.io/heripia-photos-djerba/photos/poi_HW-1_2.JPG?v=1')).toBe(true);
        expect(pattern.test('https://stefanmartin1967.github.io/Photo-Manager/photos/a.jpg')).toBe(false);
        expect(pattern.test('https://stefanmartin1967.github.io/heripia-photos-charleroi/a.jpg')).toBe(false);
        expect(pattern.test('https://heripia.com/photos/poi_HW-1_2.jpg')).toBe(false);
    });

    it("est ancrée au début de l'adresse (Workbox, autre origine)", () => {
        expect(pattern.source.startsWith('^https:')).toBe(true);
    });

    it('redemande en CORS et ne garde que les réponses 200', () => {
        expect(route).toMatch(/fetchOptions:\s*\{\s*mode:\s*'cors',\s*credentials:\s*'omit'\s*\}/);
        expect(route).toMatch(/statuses:\s*\[200\]/);
        expect(route).toMatch(/handler:\s*'CacheFirst'/);
    });

    it("reconnaît l'adresse qu'enregistre l'envoi d'une photo (photoStorage)", () => {
        expect(pattern.test(photoStorage('poi_HW-1_2.jpg', 'heripia-photos-charleroi').url)).toBe(true);
    });

    it('même motif que circuit-photos-offline.js', () => {
        const offline = readFileSync(resolve(root, 'src/circuit-photos-offline.js'), 'utf8');
        expect(offline).toContain(pattern.toString());
    });
});

describe('destinations.json', () => {
    it('chaque photosRepo suit le motif heripia-photos-… (sinon envoi refusé)', () => {
        const { maps } = JSON.parse(readFileSync(resolve(root, 'public/destinations.json'), 'utf8'));
        for (const [id, dest] of Object.entries(maps)) {
            if (dest.photosRepo) expect(() => photoStorage('x.jpg', dest.photosRepo), id).not.toThrow();
        }
    });
});

describe('politique de sécurité de la page', () => {
    const csp = readFileSync(resolve(root, 'index.html'), 'utf8').match(/Content-Security-Policy" content="([^"]+)"/)[1];
    const directive = (name) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)).split(/\s+/);

    it('laisse passer les dépôts de photos en affichage et en téléchargement', () => {
        expect(directive('img-src')).toContain('https://stefanmartin1967.github.io');
        expect(directive('connect-src')).toContain('https://stefanmartin1967.github.io');
    });
});
