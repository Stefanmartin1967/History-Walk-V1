// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================================
// Hauteur de l'écran mobile (#mobile-container) : en pourcentage, jamais en
// unité de fenêtre.
//
// Mesuré le 20/10/2026 sur le S25 de Stefan, au démarrage qui suit une mise à
// jour : fenêtre de 750 px, un élément neuf en 100dvh mesurait 750, mais
// #mobile-container, en 100dvh, était resté à 805 px. Chrome ne l'avait pas
// recalculé quand la fenêtre avait rapetissé : dock poussé 55 px sous l'écran
// jusqu'à une rotation. Un pourcentage, lui, est recalculé à chaque mise en page.
// ============================================================================

const root = resolve(__dirname, '..');
const files = ['style.css', ...readdirSync(resolve(root, 'style')).filter(f => f.endsWith('.css')).map(f => `style/${f}`)];

// Règles « sélecteurs { déclarations } » de tous les CSS, commentaires retirés
// (ils citent 100dvh pour expliquer son absence). Les blocs @media imbriqués
// donnent leurs règles internes.
const rules = files.flatMap(file => {
    const css = readFileSync(resolve(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
        file,
        selectors: m[1].split(',').map(s => s.trim()),
        decls: m[2],
    }));
});
const heightOf = (decls) => decls.match(/(?:^|;)\s*height\s*:\s*([^;]+)/)?.[1].trim();

describe('#mobile-container — hauteur', () => {
    const own = rules.filter(r => r.selectors.includes('#mobile-container'));

    it('une seule règle fixe sa hauteur, à 100 %', () => {
        const withHeight = own.filter(r => heightOf(r.decls));
        expect(withHeight.map(r => `${r.file} : ${heightOf(r.decls)}`)).toEqual(['style/base.css : 100%']);
    });

    it("aucune de ses règles n'emploie une unité de fenêtre", () => {
        for (const r of own) expect(r.decls, r.file).not.toMatch(/\d(?:d|s|l)?v[hw]\b/);
    });

    it('html et body font 100 % : le pourcentage remonte à la fenêtre', () => {
        const base = rules.find(r => r.selectors.includes('html') && r.selectors.includes('body'));
        expect(heightOf(base.decls)).toBe('100%');
    });
});
