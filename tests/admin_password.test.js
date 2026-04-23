import { describe, it, expect, vi } from 'vitest';

// verifyAdminPassword vit dans admin.js qui a beaucoup de co-imports (map, UI,
// eventBus, admin-control-center, etc.). On mock tout ce qui est hors scope
// pour isoler la primitive crypto.
vi.mock('../src/state.js', () => ({
    state: { isAdmin: false },
    setIsAdmin: vi.fn()
}));
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn() } }));
vi.mock('../src/utils.js', () => ({ downloadFile: vi.fn(), getPoiId: vi.fn() }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/ui-utils.js', () => ({ closeAllDropdowns: vi.fn() }));
vi.mock('../src/map.js', () => ({ map: null }));
vi.mock('../src/modal.js', () => ({ showAlert: vi.fn(), showConfirm: vi.fn() }));
vi.mock('../src/statistics.js', () => ({ ANIMAL_RANKS: [], MATERIAL_RANKS: [], GLOBAL_RANKS: [] }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/github-sync.js', () => ({ uploadFileToGitHub: vi.fn(), getStoredToken: vi.fn() }));
vi.mock('../src/gist-sync.js', () => ({ pullFromGist: vi.fn(), injectSyncIndicator: vi.fn() }));
vi.mock('../src/config.js', () => ({
    GITHUB_OWNER: 'test', GITHUB_REPO: 'test',
    RAW_BASE: 'http://test', GITHUB_PATHS: {}
}));
vi.mock('../src/admin-control-center.js', () => ({
    initAdminControlCenter: vi.fn(), openControlCenter: vi.fn(), addToDraft: vi.fn()
}));
vi.mock('../src/admin-geojson.js', () => ({ generateMasterGeoJSONData: vi.fn() }));

import { verifyAdminPassword } from '../src/admin.js';

// Le hash stocké correspond à un mot de passe que nous ne connaissons pas en
// clair (c'est le but — résistance pré-image SHA-256). On teste donc la logique
// autour : tout ce qui n'est PAS ce mdp doit renvoyer false, et la fonction
// doit toujours renvoyer un booléen, jamais throw.

describe('verifyAdminPassword', () => {
    describe('Mauvais mot de passe', () => {
        it('should reject empty string', async () => {
            expect(await verifyAdminPassword('')).toBe(false);
        });

        it('should reject common wrong passwords', async () => {
            expect(await verifyAdminPassword('admin')).toBe(false);
            expect(await verifyAdminPassword('password')).toBe(false);
            expect(await verifyAdminPassword('123456')).toBe(false);
            expect(await verifyAdminPassword('HistoryWalk')).toBe(false);
        });

        it('should reject random 16-char strings', async () => {
            expect(await verifyAdminPassword('x'.repeat(16))).toBe(false);
            expect(await verifyAdminPassword('abcdef0123456789')).toBe(false);
        });
    });

    describe('Edge cases — entrées invalides', () => {
        it('should return false (not throw) on null', async () => {
            expect(await verifyAdminPassword(null)).toBe(false);
        });

        it('should return false (not throw) on undefined', async () => {
            expect(await verifyAdminPassword(undefined)).toBe(false);
        });

        it('should return false (not throw) on non-string input', async () => {
            expect(await verifyAdminPassword(12345)).toBe(false);
            expect(await verifyAdminPassword({})).toBe(false);
            expect(await verifyAdminPassword([])).toBe(false);
            expect(await verifyAdminPassword(true)).toBe(false);
        });

        it('should handle very long strings without throwing (DoS guard)', async () => {
            expect(await verifyAdminPassword('a'.repeat(10000))).toBe(false);
            expect(await verifyAdminPassword('a'.repeat(100000))).toBe(false);
        });

        it('should handle unicode characters', async () => {
            expect(await verifyAdminPassword('مرحبا')).toBe(false);
            expect(await verifyAdminPassword('🔐🔑')).toBe(false);
            expect(await verifyAdminPassword('日本語')).toBe(false);
            expect(await verifyAdminPassword('café')).toBe(false);
        });

        it('should handle whitespace-only strings', async () => {
            expect(await verifyAdminPassword(' ')).toBe(false);
            expect(await verifyAdminPassword('   ')).toBe(false);
            expect(await verifyAdminPassword('\t\n')).toBe(false);
        });

        it('should handle control characters', async () => {
            expect(await verifyAdminPassword('\0')).toBe(false);
            expect(await verifyAdminPassword('abc\0def')).toBe(false);
        });
    });

    describe('Contrat', () => {
        it('should always return a boolean', async () => {
            const r = await verifyAdminPassword('wrong');
            expect(typeof r).toBe('boolean');
        });

        it('should be deterministic (no side effect between calls)', async () => {
            const r1 = await verifyAdminPassword('test123');
            const r2 = await verifyAdminPassword('test123');
            expect(r1).toBe(r2);
        });

        it('should treat different inputs independently', async () => {
            const r1 = await verifyAdminPassword('aaa');
            const r2 = await verifyAdminPassword('bbb');
            // Les deux faux, mais appels indépendants (pas de state partagé)
            expect(r1).toBe(false);
            expect(r2).toBe(false);
        });
    });
});
