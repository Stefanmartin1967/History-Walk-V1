// Les deux sources de la taxonomie restent alignées : chaque sous-type de
// poi-categories.json a sa propre icône dans poi-icons.js (sinon la fiche
// affiche l'icône générique de la catégorie sans que rien ne le signale).
// Ajouté avec « À voûtes en berceau » (24/10/2026).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLegendGroups, getIconHtml } from '../src/poi-icons.js';

const taxonomy = JSON.parse(readFileSync(resolve(import.meta.dirname, '../public/poi-categories.json'), 'utf8'));

describe('taxonomie ↔ icônes', () => {
    it('chaque sous-type a son entrée dans la légende de sa catégorie', () => {
        const legend = new Map(getLegendGroups().map(g => [g.category, g.variants.map(v => v.label)]));
        for (const cat of taxonomy.categories) {
            for (const st of cat.sousTypes || []) {
                expect(legend.get(cat.label), `${cat.label} › ${st.label}`).toContain(st.label);
            }
        }
    });

    it('« À voûtes en berceau » a une icône distincte des autres mosquées', () => {
        const mosquee = getLegendGroups().find(g => g.category === 'Mosquée');
        const svgs = mosquee.variants.map(v => v.svg);
        expect(new Set(svgs).size).toBe(svgs.length);
    });

    it('Chapelle : « À porte » et « À grille » ont deux icônes, distinctes de l\'Église', () => {
        const chapelle = getLegendGroups().find(g => g.category === 'Chapelle');
        expect(chapelle.variants.map(v => v.label)).toEqual(['À porte', 'À grille']);
        const svgs = chapelle.variants.map(v => v.svg);
        expect(new Set(svgs).size).toBe(2);
        const eglise = getLegendGroups().find(g => g.category === 'Église').variants.map(v => v.svg);
        for (const svg of svgs) expect(eglise).not.toContain(svg);
        // Sans sous-type : l'icône « À porte » (comme l'Église prend « Catholique »).
        expect(getIconHtml('Chapelle', '')).toBe(getIconHtml('Chapelle', 'À porte'));
    });

    it('chaque catégorie de poi-categories.json a sa propre icône (Potale comprise)', () => {
        const legend = new Set(getLegendGroups().map(g => g.category));
        for (const cat of taxonomy.categories) {
            if (cat.label === 'A définir') continue;
            expect(legend.has(cat.label), cat.label).toBe(true);
        }
        const potale = getLegendGroups().find(g => g.category === 'Potale');
        const autres = getLegendGroups().filter(g => g.category !== 'Potale').flatMap(g => g.variants.map(v => v.svg));
        expect(autres).not.toContain(potale.variants[0].svg);
    });
});
