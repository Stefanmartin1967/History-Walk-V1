import { describe, it, expect } from 'vitest';
import {
    isInJalelDirectoryScope,
    JALEL_DIRECTORY_MAP_ID,
    JALEL_DIRECTORY_CATEGORIES
} from '../src/utils.js';

// ============================================================================
// Portée du répertoire de Jalel Fathallah (« Répertoriage et recensement des
// mosquées de Djerba »). Pilote l'affichage de la ligne « Jalel checké » dans
// le Rich Editor : la case ne doit apparaître que là où la question a un sens.
// Demande de Stefan du 16/08/2026 — « pas de borj/fort, d'artisanat, resto ».
// ============================================================================

describe('isInJalelDirectoryScope', () => {
    it('couvre les mosquées et les mausolées de Djerba', () => {
        expect(isInJalelDirectoryScope('Mosquée', 'djerba')).toBe(true);
        expect(isInJalelDirectoryScope('Mausolée', 'djerba')).toBe(true);
    });

    it('couvre « A définir » — le cas où l\'on ouvre justement le répertoire', () => {
        // Sentinelle posée par Scout quand aucun tag OSM ne mappe une catégorie :
        // bâtiment repéré, pas encore identifié.
        expect(isInJalelDirectoryScope('A définir', 'djerba')).toBe(true);
    });

    it('exclut ce que le répertoire ne recense pas', () => {
        for (const cat of ['Fortification', 'Artisanat', 'Restaurant', 'Hôtel',
                           'Synagogue', 'Église', 'Musée', 'Puits', 'Menzel']) {
            expect(isInJalelDirectoryScope(cat, 'djerba')).toBe(false);
        }
    });

    it('exclut « Marabout », ancien libellé de Mausolée (#931)', () => {
        // Arbitrage Stefan 16/08 : les 4 fiches concernées sont recatégorisées à
        // la main plutôt que d'entretenir une valeur périmée dans le code.
        expect(isInJalelDirectoryScope('Marabout', 'djerba')).toBe(false);
    });

    it('exclut toute destination autre que Djerba, catégorie couverte ou non', () => {
        expect(isInJalelDirectoryScope('Mosquée', 'hammamet')).toBe(false);
        expect(isInJalelDirectoryScope('Mausolée', 'hammamet')).toBe(false);
        expect(isInJalelDirectoryScope('Mosquée', 'agadir')).toBe(false);
    });

    it('tolère les entrées vides sans lever', () => {
        expect(isInJalelDirectoryScope('', 'djerba')).toBe(false);
        expect(isInJalelDirectoryScope(undefined, 'djerba')).toBe(false);
        expect(isInJalelDirectoryScope('Mosquée', null)).toBe(false);
        expect(isInJalelDirectoryScope('Mosquée', undefined)).toBe(false);
    });

    it('les constantes exportées restent alignées avec la fonction', () => {
        expect(JALEL_DIRECTORY_MAP_ID).toBe('djerba');
        for (const cat of JALEL_DIRECTORY_CATEGORIES) {
            expect(isInJalelDirectoryScope(cat, JALEL_DIRECTORY_MAP_ID)).toBe(true);
        }
    });
});
