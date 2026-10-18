import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOBILE_LAYOUT_QUERY, DESKTOP_LAYOUT_QUERY } from '../src/mobile-state.js';

// Garde (18/10/2026) : le CSS qui choisit entre interface bureau et interface
// mobile doit employer EXACTEMENT les requêtes de mobile-state.js. Une requête
// qui dérive (ex. un bloc resté à « max-width: 768px » seul) ferait de nouveau
// afficher, sur un téléphone en paysage, l'interface que le JS n'a pas construite.

const LAYOUT_FILES = ['style/base.css', 'style/mobile-follow.css'];
// Commentaires retirés : ils citent parfois « @media » en toutes lettres.
const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

describe('CSS de choix de l\'affichage', () => {
    it('chaque bloc @media à la frontière 768/769 px reprend une des deux requêtes partagées', () => {
        const found = [];
        for (const file of LAYOUT_FILES) {
            for (const m of read(file).matchAll(/@media\s+([^{]+)\{/g)) {
                const query = m[1].trim();
                if (/\b76[89]px\b/.test(query)) found.push({ file, query });
            }
        }
        for (const { file, query } of found) {
            expect([MOBILE_LAYOUT_QUERY, DESKTOP_LAYOUT_QUERY], `${file} : ${query}`).toContain(query);
        }
        // base.css : 2 blocs mobiles + 3 blocs bureau ; mobile-follow.css : 1 bloc mobile.
        expect(found.filter(f => f.query === MOBILE_LAYOUT_QUERY)).toHaveLength(3);
        expect(found.filter(f => f.query === DESKTOP_LAYOUT_QUERY)).toHaveLength(3);
    });
});

// Évaluation des deux requêtes sur une grille de fenêtres (largeur, hauteur,
// type de pointeur). Grammaire limitée à ce qu'elles emploient : « , » = OU,
// « and » = ET, caractéristiques min/max-width, min/max-height, pointer.
function evaluate(query, { width, height, pointer }) {
    return query.split(',').some(part => part.split(' and ').every(feature => {
        const [, name, value] = feature.trim().match(/^\(([a-z-]+):\s*([a-z0-9]+)\)$/);
        const px = parseInt(value, 10);
        switch (name) {
            case 'max-width': return width <= px;
            case 'min-width': return width >= px;
            case 'max-height': return height <= px;
            case 'min-height': return height >= px;
            case 'pointer': return pointer === value;
            default: throw new Error(`caractéristique non prévue : ${name}`);
        }
    }));
}
const isMobile = (env) => evaluate(MOBILE_LAYOUT_QUERY, env);
const isDesktop = (env) => evaluate(DESKTOP_LAYOUT_QUERY, env);

describe('requêtes mobile / bureau', () => {
    it('complémentaires : chaque fenêtre est soit mobile, soit bureau, jamais les deux', () => {
        for (const width of [320, 390, 683, 768, 769, 844, 932, 1024, 1366, 3440]) {
            for (const height of [340, 390, 430, 500, 501, 600, 768, 1024]) {
                for (const pointer of ['fine', 'coarse', 'none']) {
                    const env = { width, height, pointer };
                    expect(isMobile(env) !== isDesktop(env), JSON.stringify(env)).toBe(true);
                }
            }
        }
    });

    it.each([
        ['téléphone en portrait', true, { width: 390, height: 844, pointer: 'coarse' }],
        ['téléphone tourné en paysage', true, { width: 844, height: 390, pointer: 'coarse' }],
        ['grand téléphone en paysage', true, { width: 932, height: 430, pointer: 'coarse' }],
        ['tablette en portrait', true, { width: 768, height: 1024, pointer: 'coarse' }],
        ['tablette en paysage', false, { width: 1024, height: 768, pointer: 'coarse' }],
        ['portable 1366 px', false, { width: 1366, height: 768, pointer: 'fine' }],
        ['portable 1366 px en demi-écran', true, { width: 683, height: 768, pointer: 'fine' }],
        ['fenêtre de PC large mais basse', false, { width: 1366, height: 400, pointer: 'fine' }],
    ])('%s → mobile : %s', (_label, mobile, env) => {
        expect(isMobile(env)).toBe(mobile);
    });
});
