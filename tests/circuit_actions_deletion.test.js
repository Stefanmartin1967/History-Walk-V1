import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks complets : performCircuitDeletion orchestre DB (softDeleteCircuit),
// state (setOfficialCircuits, setHasUnexportedChanges), circuit (clearCircuit),
// data (applyFilters) et mobile (isMobileView). On vérifie les bons appels
// avec les bons arguments selon la branche prise.

vi.mock('../src/state.js', () => ({
    state: {
        isAdmin: false,
        activeCircuitId: null,
        currentMapId: 'djerba',
        myCircuits: [],
        officialCircuits: [],
        deletedOfficialCircuitIds: [],
        loadedFeatures: []
    },
    addMyCircuit: vi.fn(),
    updateMyCircuit: vi.fn(),
    setActiveCircuitId: vi.fn(),
    setHasUnexportedChanges: vi.fn(),
    setUserData: vi.fn(),
    setOfficialCircuits: vi.fn((circuits) => {
        // On réplique la mutation pour que les assertions `state.officialCircuits`
        // puissent vérifier l'état post-appel.
        state.officialCircuits = circuits || [];
    }),
    setDeletedOfficialCircuitIds: vi.fn((ids) => {
        state.deletedOfficialCircuitIds = ids || [];
    })
}));

// Mock database.js via le helper partagé — couvre tous les exports
// (sinon `recordModification` fire-and-forget de circuit-actions.js déclenche
// une cascade `getBackupState → saveAppState undefined → TypeError`
// unhandled-rejection 7×). Root cause du flake documenté avant fix 21/05/2026.
vi.mock('../src/database.js', async () => {
    const { createDatabaseMock } = await import('./helpers/mocks.js');
    return createDatabaseMock();
});

// Mock backup-auto-local.js : double sécurité. Même si database.js était bien
// mocké, le module backup-auto-local maintient un singleton `_cache` partagé
// entre tous les `it` du fichier (8 ici). Court-circuiter ici garantit
// l'isolation totale (pas d'I/O, pas d'état persistant entre tests).
vi.mock('../src/backup-auto-local.js', async () => {
    const { createBackupAutoLocalMock } = await import('./helpers/mocks.js');
    return createBackupAutoLocalMock();
});

vi.mock('../src/circuit.js', () => ({
    clearCircuit: vi.fn(() => Promise.resolve()),
    setCircuitVisitedState: vi.fn(),
    generateCircuitName: vi.fn()
}));

vi.mock('../src/data.js', () => ({
    applyFilters: vi.fn(),
    getPoiId: (f) => f?.properties?.HW_ID || f?.id || null
}));

vi.mock('../src/mobile-state.js', () => ({ isMobileView: vi.fn(() => false) }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn() }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/utils.js', () => ({ generateHWID: vi.fn() }));
vi.mock('../src/gpx.js', () => ({ generateAndDownloadGPX: vi.fn() }));
vi.mock('../src/ui.js', () => ({ DOM: {} }));

import { state, setHasUnexportedChanges, setOfficialCircuits, setDeletedOfficialCircuitIds } from '../src/state.js';
import { softDeleteCircuit, saveAppState } from '../src/database.js';
import { clearCircuit } from '../src/circuit.js';
import { applyFilters } from '../src/data.js';
import { isMobileView } from '../src/mobile-state.js';
import { performCircuitDeletion } from '../src/circuit-actions.js';

describe('performCircuitDeletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.isAdmin = false;
        state.activeCircuitId = null;
        state.currentMapId = 'djerba';
        state.myCircuits = [];
        state.officialCircuits = [];
        state.deletedOfficialCircuitIds = [];
        state.loadedFeatures = [];
        isMobileView.mockReturnValue(false);
        // Rétablit le comportement de setOfficialCircuits (vi.clearAllMocks le reset)
        setOfficialCircuits.mockImplementation((circuits) => {
            state.officialCircuits = circuits || [];
        });
        setDeletedOfficialCircuitIds.mockImplementation((ids) => {
            state.deletedOfficialCircuitIds = ids || [];
        });
    });

    describe('Circuit officiel', () => {
        it('refuse la suppression si non-admin', async () => {
            state.officialCircuits = [{ id: 'off1', name: 'Off 1' }];
            state.isAdmin = false;

            const r = await performCircuitDeletion('off1');

            expect(r).toEqual({
                success: false,
                message: 'Impossible de supprimer un circuit officiel.'
            });
            // Aucune modification ne doit avoir eu lieu
            expect(softDeleteCircuit).not.toHaveBeenCalled();
            expect(setOfficialCircuits).not.toHaveBeenCalled();
            expect(setHasUnexportedChanges).not.toHaveBeenCalled();
        });

        it('autorise la suppression mémoire si admin', async () => {
            state.officialCircuits = [
                { id: 'off1', name: 'Off 1' },
                { id: 'off2', name: 'Off 2' }
            ];
            state.isAdmin = true;

            const r = await performCircuitDeletion('off1');

            expect(r.success).toBe(true);
            // setOfficialCircuits appelé avec la liste filtrée (off2 seulement)
            expect(setOfficialCircuits).toHaveBeenCalledTimes(1);
            const remaining = setOfficialCircuits.mock.calls[0][0];
            expect(remaining).toHaveLength(1);
            expect(remaining[0].id).toBe('off2');
            // Admin ne touche pas à softDeleteCircuit (circuits officiels pas
            // stockés dans la table circuits locale)
            expect(softDeleteCircuit).not.toHaveBeenCalled();
            expect(setHasUnexportedChanges).toHaveBeenCalledWith(true);
        });

        it('PERSISTE l\'intention de suppression (survit à un F5)', async () => {
            // Régression : le retrait n'était qu'en mémoire, or officialCircuits
            // est reconstruit depuis l'index distant à chaque démarrage → un F5
            // avant publication ressuscitait le circuit et faisait disparaître la
            // ligne « SUPPRESSION » du Centre de Contrôle, sans rien signaler.
            state.officialCircuits = [{ id: 'off1', name: 'Off 1' }];
            state.isAdmin = true;

            await performCircuitDeletion('off1');

            expect(state.deletedOfficialCircuitIds).toEqual(['off1']);
            expect(saveAppState).toHaveBeenCalledWith('deletedOfficialCircuitIds', ['off1']);
        });

        it('normalise les ids (number vs string) pour router vers la branche officielle', async () => {
            // Les ids officiels sont stringifiés au chargement (app-startup.js).
            // Avec une comparaison stricte, un id numérique retombait dans la
            // branche « circuit perso » et appelait softDeleteCircuit à tort.
            state.officialCircuits = [{ id: '1771435443094', name: 'Off num' }];
            state.isAdmin = true;

            const r = await performCircuitDeletion(1771435443094);

            expect(r.success).toBe(true);
            expect(softDeleteCircuit).not.toHaveBeenCalled();
            expect(state.deletedOfficialCircuitIds).toEqual(['1771435443094']);
        });
    });

    describe('Circuit standard (utilisateur)', () => {
        it('appelle softDeleteCircuit et marque le circuit en mémoire', async () => {
            state.myCircuits = [
                { id: 'my1', name: 'Mon circuit', isDeleted: false }
            ];

            const r = await performCircuitDeletion('my1');

            expect(r.success).toBe(true);
            expect(r.message).toBe('Le circuit a été déplacé dans la corbeille.');
            expect(softDeleteCircuit).toHaveBeenCalledWith('my1');
            expect(state.myCircuits[0].isDeleted).toBe(true);
            expect(setHasUnexportedChanges).toHaveBeenCalledWith(true);
        });

        it('tolère un id absent de myCircuits (pas de crash)', async () => {
            state.myCircuits = [];

            const r = await performCircuitDeletion('unknown');

            expect(r.success).toBe(true);
            expect(softDeleteCircuit).toHaveBeenCalledWith('unknown');
        });
    });

    describe('Nettoyage du circuit actif', () => {
        it('appelle clearCircuit(false) si le circuit supprimé était actif', async () => {
            state.myCircuits = [{ id: 'my1', isDeleted: false }];
            state.activeCircuitId = 'my1';

            await performCircuitDeletion('my1');

            expect(clearCircuit).toHaveBeenCalledWith(false);
        });

        it('ne touche pas au circuit actif si un autre circuit est supprimé', async () => {
            state.myCircuits = [
                { id: 'my1', isDeleted: false },
                { id: 'my2', isDeleted: false }
            ];
            state.activeCircuitId = 'my2';

            await performCircuitDeletion('my1');

            expect(clearCircuit).not.toHaveBeenCalled();
        });
    });

    describe('applyFilters selon le device', () => {
        it('appelle applyFilters en desktop', async () => {
            state.myCircuits = [{ id: 'my1' }];
            isMobileView.mockReturnValue(false);

            await performCircuitDeletion('my1');

            expect(applyFilters).toHaveBeenCalled();
        });

        it('n\'appelle PAS applyFilters en mobile', async () => {
            state.myCircuits = [{ id: 'my1' }];
            isMobileView.mockReturnValue(true);

            await performCircuitDeletion('my1');

            expect(applyFilters).not.toHaveBeenCalled();
        });
    });

    describe('Gestion d\'erreur', () => {
        it('renvoie un échec si softDeleteCircuit throw', async () => {
            state.myCircuits = [{ id: 'my1' }];
            softDeleteCircuit.mockRejectedValueOnce(new Error('DB locked'));

            const r = await performCircuitDeletion('my1');

            expect(r).toEqual({
                success: false,
                message: 'Erreur technique : impossible de supprimer le circuit.'
            });
        });

        it('renvoie un échec si clearCircuit throw', async () => {
            state.myCircuits = [{ id: 'my1' }];
            state.activeCircuitId = 'my1';
            clearCircuit.mockRejectedValueOnce(new Error('boom'));

            const r = await performCircuitDeletion('my1');

            expect(r.success).toBe(false);
        });
    });
});
