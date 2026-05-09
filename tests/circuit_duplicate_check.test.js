import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// circuit-actions.checkCircuitDuplicate (PR B1)
//
// Détection de doublon à la source : compare la signature `poiIds` du circuit
// local à celles des circuits déjà publiés sur GitHub. Doit skipper
// silencieusement (return null) sans token, sans poiIds, ou en cas d'erreur
// réseau — la sauvegarde ne doit JAMAIS être bloquée par cette vérification.
// ============================================================================

global.fetch = vi.fn();

vi.mock('../src/state.js', () => ({
    state: { currentMapId: 'djerba' },
    addMyCircuit: vi.fn(),
    updateMyCircuit: vi.fn(),
    setActiveCircuitId: vi.fn(),
    setHasUnexportedChanges: vi.fn(),
    setOfficialCircuits: vi.fn(),
    removeMyCircuit: vi.fn()
}));

vi.mock('../src/database.js', () => ({
    deleteCircuitById: vi.fn(),
    softDeleteCircuit: vi.fn(),
    getAppState: vi.fn(),
    saveCircuit: vi.fn()
}));

vi.mock('../src/circuit.js', () => ({
    clearCircuit: vi.fn(),
    setCircuitVisitedState: vi.fn(),
    generateCircuitName: vi.fn()
}));

vi.mock('../src/data.js', () => ({
    applyFilters: vi.fn(),
    getPoiId: vi.fn(),
    passesUserFilters: vi.fn(),
    passesStructuralFilters: vi.fn()
}));

vi.mock('../src/mobile-state.js', () => ({ isMobileView: vi.fn() }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn() }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/utils.js', () => ({ generateHWID: vi.fn() }));
vi.mock('../src/gpx.js', () => ({ generateAndDownloadGPX: vi.fn() }));
vi.mock('../src/ui-dom.js', () => ({ DOM: {} }));

// Token mockable per-test
const mockGetStoredToken = vi.fn();
vi.mock('../src/github-sync.js', () => ({
    getStoredToken: () => mockGetStoredToken()
}));

import { checkCircuitDuplicate } from '../src/circuit-actions.js';

describe('checkCircuitDuplicate (PR B1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetStoredToken.mockReturnValue('ghp_fake_token');
        global.fetch.mockReset();
    });

    it('retourne null si pas de token (skip silencieux)', async () => {
        mockGetStoredToken.mockReturnValue(null);
        const r = await checkCircuitDuplicate(['p1', 'p2']);
        expect(r).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('retourne null si poiIds vide ou null', async () => {
        expect(await checkCircuitDuplicate([])).toBeNull();
        expect(await checkCircuitDuplicate(null)).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('retourne le circuit existant si signature poiIds identique', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ([
                { id: 'c_other', name: 'Autre', poiIds: ['x', 'y'] },
                { id: 'c_match', name: 'Doublon', poiIds: ['p1', 'p2', 'p3'] }
            ])
        });
        const r = await checkCircuitDuplicate(['p1', 'p2', 'p3']);
        expect(r).toEqual({ id: 'c_match', name: 'Doublon', poiIds: ['p1', 'p2', 'p3'] });
    });

    it('retourne null si aucun circuit n\'a la même signature', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ([
                { id: 'c1', name: 'A', poiIds: ['x', 'y'] },
                { id: 'c2', name: 'B', poiIds: ['x', 'y', 'z'] }
            ])
        });
        const r = await checkCircuitDuplicate(['p1', 'p2']);
        expect(r).toBeNull();
    });

    it('respecte excludeId : ne renvoie pas le circuit en cours d\'édition', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ([
                { id: 'editing', name: 'Self', poiIds: ['p1', 'p2'] }
            ])
        });
        const r = await checkCircuitDuplicate(['p1', 'p2'], 'editing');
        expect(r).toBeNull();
    });

    it('signature distance n\'est PAS un critère (validation Stefan : poiIds seul)', async () => {
        // Avant B1, le critère incluait la distance — non fiable car calculée
        // différemment selon contextes (orthodromique live vs valeur stockée).
        // Ici les poiIds matchent même si on imagine des distances divergentes.
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ([
                { id: 'c1', name: 'Match', poiIds: ['a', 'b', 'c'], distance: '1.5 km' }
            ])
        });
        const r = await checkCircuitDuplicate(['a', 'b', 'c']);
        expect(r?.id).toBe('c1');
    });

    it('retourne null si fetch 404 (fichier absent → skip silencieux)', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 404 });
        const r = await checkCircuitDuplicate(['p1']);
        expect(r).toBeNull();
    });

    it('retourne null si erreur réseau (offline → skip silencieux)', async () => {
        global.fetch.mockRejectedValue(new Error('Network error'));
        const r = await checkCircuitDuplicate(['p1']);
        expect(r).toBeNull();
    });

    it('signature ordre-sensible : [a,b] ≠ [b,a]', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ([
                { id: 'c1', name: 'Reverse', poiIds: ['b', 'a'] }
            ])
        });
        const r = await checkCircuitDuplicate(['a', 'b']);
        expect(r).toBeNull();
    });

    it('gère les circuits sans poiIds dans le remote (filtre via join("|"))', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ([
                { id: 'c_legacy', name: 'Legacy' }, // pas de poiIds
                { id: 'c_match', name: 'Match', poiIds: ['x'] }
            ])
        });
        const r = await checkCircuitDuplicate(['x']);
        expect(r?.id).toBe('c_match');
    });
});
