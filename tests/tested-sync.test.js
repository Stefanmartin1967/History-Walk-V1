// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
    mockState: { isAdmin: true, currentMapId: 'djerba', testedCircuits: {} },
    getStoredTokenSpy: vi.fn(() => 'ghp_faketoken'),
    uploadSpy: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/state.js', () => ({ state: h.mockState }));
vi.mock('../src/github-sync.js', () => ({
    getStoredToken: (...a) => h.getStoredTokenSpy(...a),
    uploadFileToGitHub: (...a) => h.uploadSpy(...a),
}));
vi.mock('../src/config.js', () => ({
    GITHUB_OWNER: 'Stefanmartin1967',
    GITHUB_REPO: 'History-Walk-V1',
    GITHUB_PATHS: { tested: (mapId) => `public/circuits/tested_${mapId}.json` },
}));

import { pushTestedToGitHub, schedulePushTestedToGitHub } from '../src/tested-sync.js';

beforeEach(() => {
    vi.clearAllMocks();
    h.mockState.isAdmin = true;
    h.mockState.currentMapId = 'djerba';
    h.mockState.testedCircuits = {};
    h.getStoredTokenSpy.mockReturnValue('ghp_faketoken');
    h.uploadSpy.mockResolvedValue(undefined);
});

describe('pushTestedToGitHub — gardes', () => {
    it('ne push pas si non-admin', async () => {
        h.mockState.isAdmin = false;
        await pushTestedToGitHub();
        expect(h.uploadSpy).not.toHaveBeenCalled();
    });

    it('ne push pas si pas de token', async () => {
        h.getStoredTokenSpy.mockReturnValue(null);
        await pushTestedToGitHub();
        expect(h.uploadSpy).not.toHaveBeenCalled();
    });

    it('ne push pas si pas de carte active', async () => {
        h.mockState.currentMapId = null;
        await pushTestedToGitHub();
        expect(h.uploadSpy).not.toHaveBeenCalled();
    });
});

describe('pushTestedToGitHub — happy path', () => {
    it('upload un fichier tested_{mapId}.json au bon chemin avec le bon owner/repo', async () => {
        h.mockState.testedCircuits = { c1: true, c2: false, c3: true };
        await pushTestedToGitHub();

        expect(h.uploadSpy).toHaveBeenCalledTimes(1);
        const [file, token, owner, repo, path, msg] = h.uploadSpy.mock.calls[0];
        expect(file).toBeInstanceOf(File);
        expect(file.name).toBe('tested_djerba.json');
        expect(file.type).toBe('application/json');
        expect(token).toBe('ghp_faketoken');
        expect(owner).toBe('Stefanmartin1967');
        expect(repo).toBe('History-Walk-V1');
        expect(path).toBe('public/circuits/tested_djerba.json');
        // Le message de commit reflète le nombre de circuits === true (pas les false).
        expect(msg).toContain('2 circuits');
        expect(msg).toContain('tested_djerba.json');
    });

    it('sérialise le payload testedCircuits exact dans le fichier', async () => {
        h.mockState.testedCircuits = { circuitA: true, circuitB: false };
        await pushTestedToGitHub();
        const file = h.uploadSpy.mock.calls[0][0];
        const text = await file.text();
        expect(JSON.parse(text)).toEqual({ circuitA: true, circuitB: false });
    });

    it('payload vide → 0 circuits dans le message, push quand même', async () => {
        h.mockState.testedCircuits = {};
        await pushTestedToGitHub();
        expect(h.uploadSpy).toHaveBeenCalledTimes(1);
        expect(h.uploadSpy.mock.calls[0][5]).toContain('0 circuits');
    });
});

describe('pushTestedToGitHub — filet de sécurité (échec silencieux)', () => {
    it('un échec d\'upload ne propage pas l\'erreur (résout sans throw)', async () => {
        h.uploadSpy.mockRejectedValue(new Error('rate limit'));
        // Ne doit PAS rejeter — le CC reprend le relais via le diff engine.
        await expect(pushTestedToGitHub()).resolves.toBeUndefined();
    });
});

describe('schedulePushTestedToGitHub — debounce', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('coalesce plusieurs appels rapprochés en UN seul push après 2s', async () => {
        h.mockState.testedCircuits = { c1: true };
        schedulePushTestedToGitHub();
        schedulePushTestedToGitHub();
        schedulePushTestedToGitHub();

        // Avant le délai : rien.
        expect(h.uploadSpy).not.toHaveBeenCalled();

        // Après 2s : un seul push.
        await vi.advanceTimersByTimeAsync(2000);
        expect(h.uploadSpy).toHaveBeenCalledTimes(1);
    });

    it('ne déclenche rien avant l\'expiration du délai', async () => {
        schedulePushTestedToGitHub();
        await vi.advanceTimersByTimeAsync(1999);
        expect(h.uploadSpy).not.toHaveBeenCalled();
    });
});
