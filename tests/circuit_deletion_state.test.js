import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// circuit-deletion-state — filtre des suppressions serveur confirmées.
//
// L'index `circuits/<map>.json` se relit via raw.githubusercontent, qui peut
// encore servir la version d'AVANT une écriture pendant quelques secondes.
// Cinq lecteurs comparent cet index à l'état local ; sans ce filtre partagé,
// chacun ressuscitait à sa façon un circuit déjà supprimé (liste Nettoyage
// figée, « SUPPRESSION » fantôme au diff, commit vide à la publication,
// faux doublon à la création, restauration d'un circuit sans GPX).
// ============================================================================

vi.mock('../src/state.js', () => ({
    state: { deletedOfficialCircuitIds: [] },
    setDeletedOfficialCircuitIds: vi.fn(),
}));
vi.mock('../src/database.js', () => ({ saveAppState: vi.fn(() => Promise.resolve()) }));

import {
    noteServerDeletedCircuit,
    withoutServerDeletedCircuits,
    _resetServerDeletedCircuits,
} from '../src/circuit-deletion-state.js';

const INDEX = [
    { id: 'HW-A', name: 'A' },
    { id: 'HW-B', name: 'B' },
    { id: 'HW-C', name: 'C' },
];

beforeEach(() => _resetServerDeletedCircuits());

describe('withoutServerDeletedCircuits', () => {
    it('rend la liste telle quelle tant que rien n’a été supprimé', () => {
        // Même référence : pas de copie inutile sur le chemin courant.
        expect(withoutServerDeletedCircuits(INDEX)).toBe(INDEX);
    });

    it('retire un circuit dont la suppression serveur est confirmée', () => {
        noteServerDeletedCircuit('HW-B');
        expect(withoutServerDeletedCircuits(INDEX).map(c => c.id)).toEqual(['HW-A', 'HW-C']);
    });

    it('cumule les suppressions successives (campagne de nettoyage)', () => {
        noteServerDeletedCircuit('HW-A');
        noteServerDeletedCircuit('HW-C');
        expect(withoutServerDeletedCircuits(INDEX).map(c => c.id)).toEqual(['HW-B']);
    });

    it('normalise le type de l’id (number posé, string dans l’index)', () => {
        noteServerDeletedCircuit(1771316521571);
        const idx = [{ id: '1771316521571', name: 'Legacy' }, { id: 'HW-A', name: 'A' }];
        expect(withoutServerDeletedCircuits(idx).map(c => c.id)).toEqual(['HW-A']);
    });

    it('ne touche pas aux circuits non supprimés', () => {
        noteServerDeletedCircuit('HW-INCONNU');
        expect(withoutServerDeletedCircuits(INDEX)).toHaveLength(3);
    });

    it('encaisse une entrée non-tableau ou des entrées vides', () => {
        noteServerDeletedCircuit('HW-A');
        expect(withoutServerDeletedCircuits(null)).toEqual([]);
        expect(withoutServerDeletedCircuits(undefined)).toEqual([]);
        // Un index malformé ne doit pas faire exploser un écran d'admin :
        // l'entrée nulle traverse le filtre sans le faire lever, HW-A part.
        expect(withoutServerDeletedCircuits([null, { id: 'HW-A' }, { id: 'HW-B' }]))
            .toEqual([null, { id: 'HW-B' }]);
    });
});
