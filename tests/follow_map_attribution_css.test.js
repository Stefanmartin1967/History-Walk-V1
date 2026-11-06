import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Garde (06/11/2026) : sur le téléphone, la carte ne s'affiche QUE pendant le
// suivi. Le suivi masquait tout le conteneur des contrôles Leaflet, mention de
// la carte comprise : « © OpenStreetMap contributors © CARTO » n'apparaissait
// nulle part sur mobile, alors qu'elle conditionne l'usage gratuit du fond
// Voyager (cf. map.js). Seuls les contrôles du haut sont remplacés par l'UI du
// suivi ; la mention reste visible.

const css = readFileSync(fileURLToPath(new URL('../style/mobile-follow.css', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

// Règles « sélecteurs { déclarations } » (les blocs @media sont aplatis).
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(m => ({ selectors: m[1].split(',').map(s => s.trim()), body: m[2] }));
const hides = (r) => /display:\s*none/.test(r.body);

describe('suivi mobile — mention de la carte', () => {
    it('ne masque pas tout le conteneur des contrôles Leaflet', () => {
        const bad = rules.filter(r => hides(r) && r.selectors.some(s => /\.leaflet-control-container\s*$/.test(s)));
        expect(bad).toEqual([]);
    });

    it('ne masque ni le coin bas-gauche ni la mention elle-même', () => {
        const bad = rules.filter(r => hides(r) && r.selectors.some(s =>
            /\.leaflet-bottom(\.leaflet-left)?\s*$/.test(s) || /\.leaflet-control-attribution\s*$/.test(s)));
        expect(bad).toEqual([]);
    });

    it('masque les contrôles du haut (zoom, calques), remplacés par ceux du suivi', () => {
        expect(rules.some(r => hides(r) && r.selectors.some(s => /follow-active \.leaflet-top$/.test(s)))).toBe(true);
    });
});
