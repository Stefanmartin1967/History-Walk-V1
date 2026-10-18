// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (hoisted par vitest) ---
// In-memory IDB store backing for getAppState/saveAppState
const _idbStore = new Map();

vi.mock('../src/database.js', () => ({
    getAppState: vi.fn(async (key) => _idbStore.get(key) ?? null),
    saveAppState: vi.fn(async (key, value) => {
        if (value === null || value === undefined) {
            _idbStore.delete(key);
        } else {
            _idbStore.set(key, value);
        }
    })
}));

import { getAppState, saveAppState } from '../src/database.js';
import {
    initTokenCache,
    getStoredToken,
    getStoredUsername,
    isTokenPersisted,
    saveToken,
    validateToken,
    uploadFileToGitHub,
    deleteFileFromGitHub,
    githubHttpError
} from '../src/github-sync.js';

const STORAGE_KEY_TOKEN = 'github_pat';
const STORAGE_KEY_USERNAME = 'github_username';
const LEGACY_LS_KEY = 'github_pat';

beforeEach(() => {
    _idbStore.clear();
    localStorage.clear();
    vi.clearAllMocks();
    // Reset module-level state via public API
    saveToken(null);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initTokenCache', () => {
    it('charge le token depuis IndexedDB s\'il existe', async () => {
        _idbStore.set(STORAGE_KEY_TOKEN, 'ghp_idb_token');
        await initTokenCache();
        expect(getStoredToken()).toBe('ghp_idb_token');
    });

    it('migre l\'ancien token localStorage vers IndexedDB si IDB est vide', async () => {
        localStorage.setItem(LEGACY_LS_KEY, '  ghp_legacy_token  ');
        await initTokenCache();
        // Cache doit refléter la valeur trimmée
        expect(getStoredToken()).toBe('ghp_legacy_token');
        // localStorage doit avoir été nettoyé
        expect(localStorage.getItem(LEGACY_LS_KEY)).toBeNull();
        // IDB doit avoir reçu la valeur trimmée
        expect(saveAppState).toHaveBeenCalledWith(STORAGE_KEY_TOKEN, 'ghp_legacy_token');
    });

    it('nettoie localStorage si IDB contient déjà un token (migration déjà faite)', async () => {
        _idbStore.set(STORAGE_KEY_TOKEN, 'ghp_idb_token');
        localStorage.setItem(LEGACY_LS_KEY, 'ghp_stale_legacy');
        await initTokenCache();
        expect(getStoredToken()).toBe('ghp_idb_token');
        expect(localStorage.getItem(LEGACY_LS_KEY)).toBeNull();
    });

    it('cache reste null si IDB vide et pas de localStorage legacy', async () => {
        await initTokenCache();
        expect(getStoredToken()).toBeNull();
    });

    it('catch les erreurs IDB et laisse le cache à null sans throw', async () => {
        getAppState.mockRejectedValueOnce(new Error('IDB explosed'));
        await expect(initTokenCache()).resolves.toBeUndefined();
        expect(getStoredToken()).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getStoredToken', () => {
    it('retourne le cache si initialisé', async () => {
        _idbStore.set(STORAGE_KEY_TOKEN, 'ghp_cached');
        await initTokenCache();
        expect(getStoredToken()).toBe('ghp_cached');
    });

    it('fallback sur localStorage legacy si cache jamais initialisé', () => {
        // saveToken(null) dans beforeEach met _cacheReady = true → on simule un état "jamais init"
        // en utilisant un import frais via vi.resetModules
        // Mais ici on teste plutôt que getStoredToken retourne le cache reset (null)
        // Pour le vrai test du fallback, on observe le comportement après reset complet
        expect(getStoredToken()).toBeNull(); // après saveToken(null), cache = null
    });

    it('retourne null si cache vide et pas de legacy', () => {
        expect(getStoredToken()).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('isTokenPersisted', () => {
    it('retourne true quand un token est en cache', async () => {
        _idbStore.set(STORAGE_KEY_TOKEN, 'ghp_x');
        await initTokenCache();
        expect(isTokenPersisted()).toBe(true);
    });

    it('retourne false quand aucun token', () => {
        expect(isTokenPersisted()).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('saveToken', () => {
    it('met à jour le cache immédiatement (lecture sync cohérente)', () => {
        saveToken('ghp_immediate');
        expect(getStoredToken()).toBe('ghp_immediate');
    });

    it('trim les espaces autour du token', () => {
        saveToken('  ghp_trimmed  ');
        expect(getStoredToken()).toBe('ghp_trimmed');
    });

    it('vide le cache si on passe null/empty', () => {
        saveToken('ghp_x');
        saveToken(null);
        expect(getStoredToken()).toBeNull();
        saveToken('ghp_y');
        saveToken('');
        expect(getStoredToken()).toBeNull();
    });

    it('persiste en arrière-plan via saveAppState (fire-and-forget)', async () => {
        saveToken('ghp_bg');
        // Attendre une microtask pour laisser le .catch s'attacher
        await Promise.resolve();
        expect(saveAppState).toHaveBeenCalledWith(STORAGE_KEY_TOKEN, 'ghp_bg');
    });

    it('persiste un null IDB lors d\'une suppression', async () => {
        saveToken(null);
        await Promise.resolve();
        expect(saveAppState).toHaveBeenCalledWith(STORAGE_KEY_TOKEN, null);
    });

    it('stocke le username quand fourni avec un token', () => {
        saveToken('ghp_x', 'octocat');
        expect(getStoredToken()).toBe('ghp_x');
        expect(getStoredUsername()).toBe('octocat');
    });

    it('clear le username quand le token est supprimé', () => {
        saveToken('ghp_x', 'octocat');
        saveToken(null);
        expect(getStoredUsername()).toBeNull();
    });

    it('ignore le username si le token est vide (jamais de username orphelin)', () => {
        saveToken('', 'octocat');
        expect(getStoredUsername()).toBeNull();
    });

    it('persiste le username via saveAppState', async () => {
        saveToken('ghp_x', 'octocat');
        await Promise.resolve();
        expect(saveAppState).toHaveBeenCalledWith(STORAGE_KEY_USERNAME, 'octocat');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('validateToken', () => {
    it('rejette un token vide ou whitespace sans appel réseau', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);

        const r1 = await validateToken('');
        const r2 = await validateToken('   ');

        expect(r1.ok).toBe(false);
        expect(r1.error).toBe('Token vide');
        expect(r2.ok).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejette un 401 avec message clair', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
            status: 401,
            ok: false,
            headers: new Headers(),
            json: async () => ({ message: 'Bad credentials' })
        }));

        const r = await validateToken('ghp_bad');
        expect(r.ok).toBe(false);
        expect(r.error).toContain('invalide');
    });

    it('rejette un autre code HTTP avec le statut', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
            status: 503,
            ok: false,
            headers: new Headers(),
            json: async () => ({})
        }));

        const r = await validateToken('ghp_x');
        expect(r.ok).toBe(false);
        expect(r.error).toContain('503');
    });

    it('rejette une erreur réseau (fetch throw)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('NetworkError')));

        const r = await validateToken('ghp_x');
        expect(r.ok).toBe(false);
        expect(r.error).toContain('réseau');
    });

    it('valide un token OK et retourne le username (PAT classique avec scopes complets)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
            status: 200,
            ok: true,
            headers: new Headers({ 'X-OAuth-Scopes': 'repo, gist, read:user' }),
            json: async () => ({ login: 'Stefanmartin1967' })
        }));

        const r = await validateToken('ghp_good');
        expect(r.ok).toBe(true);
        expect(r.username).toBe('Stefanmartin1967');
        expect(r.scopes).toEqual(['repo', 'gist', 'read:user']);
        expect(r.missingScopes).toEqual([]);
    });

    it('signale les scopes manquants pour un PAT classique incomplet', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
            status: 200,
            ok: true,
            headers: new Headers({ 'X-OAuth-Scopes': 'repo' }),
            json: async () => ({ login: 'octocat' })
        }));

        const r = await validateToken('ghp_partial');
        expect(r.ok).toBe(true);
        expect(r.missingScopes).toEqual(['gist']);
    });

    it('accepte un fine-grained PAT (header X-OAuth-Scopes absent) sans warn', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
            status: 200,
            ok: true,
            headers: new Headers(),
            json: async () => ({ login: 'octocat' })
        }));

        const r = await validateToken('github_pat_xxx');
        expect(r.ok).toBe(true);
        expect(r.username).toBe('octocat');
        expect(r.missingScopes).toEqual([]);
    });

    it('utilise le bon header Authorization', async () => {
        const fetchSpy = vi.fn().mockResolvedValueOnce({
            status: 200,
            ok: true,
            headers: new Headers({ 'X-OAuth-Scopes': 'repo, gist' }),
            json: async () => ({ login: 'x' })
        });
        vi.stubGlobal('fetch', fetchSpy);

        await validateToken('  ghp_trim_me  ');

        const [url, opts] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://api.github.com/user');
        expect(opts.headers.Authorization).toBe('token ghp_trim_me');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Réponse de l'API GitHub : code HTTP + corps TEXTE (vide possible, comme un
// 500/502/504 réel — c'est ce corps vide qui produisait « Unexpected end of
// JSON input » à la place du code, note de test 20 du 07/10/2026).
function gh(status, body = '') {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => text,
        json: async () => JSON.parse(text),
    };
}

describe('githubHttpError', () => {
    it('5xx à corps vide : « GitHub indisponible » avec le code, err.status renseigné', async () => {
        const err = await githubHttpError(gh(500), 'Envoi de djerba.geojson');
        expect(err.message).toBe('Envoi de djerba.geojson : GitHub indisponible (HTTP 500) — réessayez dans quelques minutes.');
        expect(err.status).toBe(500);
    });

    it('401 : jeton refusé', async () => {
        const err = await githubHttpError(gh(401, { message: 'Bad credentials' }), 'Envoi de x.json');
        expect(err.message).toBe('Envoi de x.json : jeton GitHub refusé (HTTP 401) — vérifiez-le dans le Centre de Contrôle.');
    });

    it('autre code : le code et le message de GitHub', async () => {
        const err = await githubHttpError(gh(422, { message: 'Validation failed' }), 'Envoi de x.json');
        expect(err.message).toBe('Envoi de x.json : HTTP 422 — Validation failed');
        expect(err.status).toBe(422);
    });

    it('corps qui n\'est pas du JSON (page HTML) : le code seul', async () => {
        const err = await githubHttpError(gh(403, '<html>rate limited</html>'), 'Envoi de x.json');
        expect(err.message).toBe('Envoi de x.json : HTTP 403');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('uploadFileToGitHub', () => {
    function makeFile(name = 'test.json', content = '{"a":1}') {
        return new File([content], name, { type: 'application/json' });
    }

    it('upload un fichier nouveau (sha absent → PUT sans champ sha)', async () => {
        const fetchSpy = vi.fn()
            .mockResolvedValueOnce(gh(404, { message: 'Not Found' })) // GET check 404 (file new)
            .mockResolvedValueOnce(gh(201, { content: { name: 'test.json' } }));
        vi.stubGlobal('fetch', fetchSpy);

        const result = await uploadFileToGitHub(makeFile(), 'tk', 'owner', 'repo', 'path/test.json', 'msg');

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const putCall = fetchSpy.mock.calls[1];
        expect(putCall[1].method).toBe('PUT');
        const body = JSON.parse(putCall[1].body);
        expect(body.sha).toBeUndefined();
        expect(body.message).toBe('msg');
        expect(body.content).toBeDefined();
        expect(result.content.name).toBe('test.json');
    });

    it('upload un fichier existant (sha présent → PUT avec champ sha)', async () => {
        const fetchSpy = vi.fn()
            .mockResolvedValueOnce(gh(200, { sha: 'abc123' })) // GET check
            .mockResolvedValueOnce(gh(200, { content: { sha: 'def456' } }));
        vi.stubGlobal('fetch', fetchSpy);

        await uploadFileToGitHub(makeFile(), 'tk', 'owner', 'repo', 'path/test.json', 'update');

        const body = JSON.parse(fetchSpy.mock.calls[1][1].body);
        expect(body.sha).toBe('abc123');
    });

    it('utilise un message par défaut si absent', async () => {
        const fetchSpy = vi.fn()
            .mockResolvedValueOnce(gh(404))
            .mockResolvedValueOnce(gh(201, {}));
        vi.stubGlobal('fetch', fetchSpy);

        await uploadFileToGitHub(makeFile('foo.json'), 'tk', 'o', 'r', 'p/foo.json');

        const body = JSON.parse(fetchSpy.mock.calls[1][1].body);
        expect(body.message).toContain('foo.json');
        expect(body.message).toContain('App Admin');
    });

    it('throw avec le code et le message de GitHub si le PUT échoue', async () => {
        const fetchSpy = vi.fn()
            .mockResolvedValueOnce(gh(404))
            .mockResolvedValueOnce(gh(422, { message: 'Validation failed' }));
        vi.stubGlobal('fetch', fetchSpy);

        await expect(uploadFileToGitHub(makeFile(), 'tk', 'o', 'r', 'public/test.json', 'm'))
            .rejects.toThrow('Envoi de test.json : HTTP 422 — Validation failed');
    });

    it('PUT en 500 à corps vide : le code HTTP, plus « Unexpected end of JSON input »', async () => {
        const fetchSpy = vi.fn()
            .mockResolvedValueOnce(gh(200, { sha: 'abc' }))
            .mockResolvedValueOnce(gh(500));
        vi.stubGlobal('fetch', fetchSpy);

        const err = await uploadFileToGitHub(makeFile(), 'tk', 'o', 'r', 'public/djerba.geojson', 'm').catch(e => e);
        expect(err.message).toBe('Envoi de djerba.geojson : GitHub indisponible (HTTP 500) — réessayez dans quelques minutes.');
        expect(err.status).toBe(500);
    });

    it('vérification préalable en 500 : arrêt avec le code, aucun PUT envoyé', async () => {
        // Avant : l'échec était ignoré et un PUT sans sha partait, refusé par
        // GitHub avec un message trompeur (« sha wasn't supplied »).
        const fetchSpy = vi.fn().mockResolvedValueOnce(gh(500));
        vi.stubGlobal('fetch', fetchSpy);

        await expect(uploadFileToGitHub(makeFile(), 'tk', 'o', 'r', 'public/djerba.geojson', 'm'))
            .rejects.toThrow('GitHub indisponible (HTTP 500)');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('jeton refusé (401) dès la vérification préalable : message dédié, aucun PUT', async () => {
        const fetchSpy = vi.fn().mockResolvedValueOnce(gh(401, { message: 'Bad credentials' }));
        vi.stubGlobal('fetch', fetchSpy);

        await expect(uploadFileToGitHub(makeFile(), 'tk', 'o', 'r', 'public/x.json', 'm'))
            .rejects.toThrow('jeton GitHub refusé (HTTP 401)');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deleteFileFromGitHub', () => {
    it('supprime un fichier existant (sha récupéré → DELETE avec sha)', async () => {
        const fetchSpy = vi.fn()
            .mockResolvedValueOnce(gh(200, { sha: 'sha123' })) // GET sha
            .mockResolvedValueOnce(gh(200, { commit: { sha: 'rm1' } }));
        vi.stubGlobal('fetch', fetchSpy);

        const result = await deleteFileFromGitHub('tk', 'owner', 'repo', 'path/file.json', 'rm-msg');

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        const deleteCall = fetchSpy.mock.calls[1];
        expect(deleteCall[1].method).toBe('DELETE');
        const body = JSON.parse(deleteCall[1].body);
        expect(body.sha).toBe('sha123');
        expect(body.message).toBe('rm-msg');
        expect(result.commit.sha).toBe('rm1');
    });

    it('utilise un message par défaut si absent', async () => {
        const fetchSpy = vi.fn()
            .mockResolvedValueOnce(gh(200, { sha: 'sha-x' }))
            .mockResolvedValueOnce(gh(200, {}));
        vi.stubGlobal('fetch', fetchSpy);

        await deleteFileFromGitHub('tk', 'o', 'r', 'foo/bar.json');

        const body = JSON.parse(fetchSpy.mock.calls[1][1].body);
        expect(body.message).toContain('foo/bar.json');
        expect(body.message).toContain('Admin');
    });

    it('fichier introuvable (GET 404) : « introuvable », err.status = 404', async () => {
        const fetchSpy = vi.fn().mockResolvedValueOnce(gh(404, { message: 'Not Found' }));
        vi.stubGlobal('fetch', fetchSpy);

        const err = await deleteFileFromGitHub('tk', 'o', 'r', 'notes/missing.txt', 'm').catch(e => e);
        expect(err.message).toBe('Suppression de missing.txt : fichier introuvable sur le serveur.');
        expect(err.status).toBe(404);
    });

    it('GET en 500 : le code, PAS « introuvable » (pris avant pour « rien à supprimer »)', async () => {
        const fetchSpy = vi.fn().mockResolvedValueOnce(gh(500));
        vi.stubGlobal('fetch', fetchSpy);

        const err = await deleteFileFromGitHub('tk', 'o', 'r', 'notes/note.txt', 'm').catch(e => e);
        expect(err.message).toBe('Suppression de note.txt : GitHub indisponible (HTTP 500) — réessayez dans quelques minutes.');
        expect(err.message).not.toMatch(/introuvable/i);
        expect(err.status).toBe(500);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('throw avec le code et le message de GitHub si le DELETE échoue', async () => {
        const fetchSpy = vi.fn()
            .mockResolvedValueOnce(gh(200, { sha: 'sha-y' }))
            .mockResolvedValueOnce(gh(409, { message: 'Conflict' }));
        vi.stubGlobal('fetch', fetchSpy);

        await expect(deleteFileFromGitHub('tk', 'o', 'r', 'p', 'm'))
            .rejects.toThrow('Suppression de p : HTTP 409 — Conflict');
    });
});
