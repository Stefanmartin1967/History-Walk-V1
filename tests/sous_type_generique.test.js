// Sous-type « Générique » retiré (10/10/2026) — décision de Stefan : aucun nom
// ne convenait, on laisse vide (constat C3 du 03/10 : le visiteur lisait
// « Générique » sur la fiche sans rien en apprendre).
//
// Vérifie la taxonomie et la légende des icônes. Les données (fichiers publiés)
// sont migrées par scripts/migrate-sous-type-generique.mjs ; les données
// locales au chargement (clearGenericSubtypeInPoiData, database.js).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLegendGroups } from '../src/poi-icons.js';

const taxonomy = JSON.parse(readFileSync(resolve(import.meta.dirname, '../public/poi-categories.json'), 'utf8'));

describe('sous-type « Générique » retiré', () => {
    it('la taxonomie ne le propose plus, pour aucune catégorie', () => {
        const labels = taxonomy.categories.flatMap(c => (c.sousTypes || []).map(st => st.label));
        expect(labels).not.toContain('Générique');
        const mosquee = taxonomy.categories.find(c => c.label === 'Mosquée');
        expect(mosquee.sousTypes.map(st => st.label)).toEqual(['À minaret', 'À coupoles', 'Fortifiée']);
    });

    it('légende : l\'icône sans sous-type s\'appelle « Mosquée », plus « Générique »', () => {
        const mosquee = getLegendGroups().find(g => g.category === 'Mosquée');
        expect(mosquee.variants.map(v => v.label)).toEqual(['À minaret', 'À coupoles', 'Fortifiée', 'Mosquée']);
        const all = getLegendGroups().flatMap(g => g.variants.map(v => v.label));
        expect(all).not.toContain('Générique');
    });

    it('légende : toujours 27 icônes distinctes (handoff #22)', () => {
        const total = getLegendGroups().reduce((n, g) => n + g.variants.length, 0);
        expect(total).toBe(27);
    });
});
