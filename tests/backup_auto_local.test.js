// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// backup-auto-local — Phase 1, Couche 1 (protection données user)
//
// Le module compte les modifications user et déclenche un download automatique
// du backup quand un seuil est atteint :
//   - 10 modifications depuis le dernier backup, OU
//   - 3 jours écoulés depuis le dernier backup ET au moins 1 modif
// Skippé en mode admin (l'admin a son flow CC).
// ============================================================================

const h = vi.hoisted(() => ({
    mockState: { isAdmin: false, currentMapId: 'djerba' },
    appStateStore: new Map(),
    saveUserDataSpy: vi.fn(() => Promise.resolve()),
    showToastSpy: vi.fn(),
}));

vi.mock('../src/state.js', () => ({ state: h.mockState }));

vi.mock('../src/database.js', () => ({
    getAppState: (key) => Promise.resolve(h.appStateStore.get(key) ?? null),
    saveAppState: (key, value) => {
        h.appStateStore.set(key, value);
        return Promise.resolve();
    },
}));

vi.mock('../src/toast.js', () => ({
    showToast: (...args) => h.showToastSpy(...args),
}));

vi.mock('../src/fileManager.js', () => ({
    saveUserData: (force) => h.saveUserDataSpy(force),
}));

import {
    recordModification,
    checkAndTriggerAutoBackup,
    forceBackup,
    getBackupStatusForUI,
    _resetCacheForTests,
    _getCacheForTests,
    _flushAutoBackupForTests,
} from '../src/backup-auto-local.js';

const STATE_KEY = 'backup_auto_local_state';
const MODIFS_THRESHOLD = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
    vi.clearAllMocks();
    h.appStateStore.clear();
    h.mockState.isAdmin = false;
    _resetCacheForTests();
});

afterEach(async () => {
    // Draine le trigger lancé en arrière-plan par recordModification, pour qu'il
    // ne se termine pas pendant le test suivant (cause racine du flake).
    await _flushAutoBackupForTests();
});

// ─────────────────────────────────────────────────────────────────────────────
// recordModification — incrémente, persiste, déclenche
// ─────────────────────────────────────────────────────────────────────────────
describe('recordModification', () => {
    it('incrémente le compteur et persiste', async () => {
        await recordModification();
        const stored = h.appStateStore.get(STATE_KEY);
        expect(stored.count).toBe(1);
        expect(stored.lastTimestamp).toBe(0);
    });

    it('cumul des appels successifs', async () => {
        for (let i = 0; i < 5; i++) await recordModification();
        // recordModification déclenche checkAndTriggerAutoBackup en arrière-plan ;
        // on attend sa fin de façon déterministe (plus de setTimeout fragile).
        await _flushAutoBackupForTests();
        expect(h.appStateStore.get(STATE_KEY).count).toBe(5);
        expect(h.saveUserDataSpy).not.toHaveBeenCalled();
    });

    it('skip si state.isAdmin (pas de modif comptée)', async () => {
        h.mockState.isAdmin = true;
        await recordModification();
        expect(h.appStateStore.has(STATE_KEY)).toBe(false);
    });

    it('déclenche un auto-backup au seuil de 10 modifs', async () => {
        for (let i = 0; i < 10; i++) await recordModification();
        await _flushAutoBackupForTests();

        expect(h.saveUserDataSpy).toHaveBeenCalledTimes(1);
        expect(h.saveUserDataSpy).toHaveBeenCalledWith(false); // mode LITE
        // Le compteur est reset après backup
        const after = h.appStateStore.get(STATE_KEY);
        expect(after.count).toBe(0);
        expect(after.lastTimestamp).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkAndTriggerAutoBackup — logique de seuil
// ─────────────────────────────────────────────────────────────────────────────
describe('checkAndTriggerAutoBackup', () => {
    it('ne déclenche rien si count=0', async () => {
        const fired = await checkAndTriggerAutoBackup();
        expect(fired).toBe(false);
        expect(h.saveUserDataSpy).not.toHaveBeenCalled();
    });

    it('ne déclenche rien si count<10 et <3 jours', async () => {
        h.appStateStore.set(STATE_KEY, { count: 5, lastTimestamp: Date.now() - DAY_MS });
        _resetCacheForTests();
        const fired = await checkAndTriggerAutoBackup();
        expect(fired).toBe(false);
    });

    it('déclenche au seuil exact (10)', async () => {
        h.appStateStore.set(STATE_KEY, { count: 10, lastTimestamp: 0 });
        _resetCacheForTests();
        const fired = await checkAndTriggerAutoBackup();
        expect(fired).toBe(true);
        expect(h.saveUserDataSpy).toHaveBeenCalledTimes(1);
    });

    it('déclenche au-delà du seuil (count > MODIFS_THRESHOLD)', async () => {
        h.appStateStore.set(STATE_KEY, { count: 25, lastTimestamp: 0 });
        _resetCacheForTests();
        const fired = await checkAndTriggerAutoBackup();
        expect(fired).toBe(true);
    });

    it('déclenche après 3 jours avec count > 0', async () => {
        const fourDaysAgo = Date.now() - 4 * DAY_MS;
        h.appStateStore.set(STATE_KEY, { count: 1, lastTimestamp: fourDaysAgo });
        _resetCacheForTests();
        const fired = await checkAndTriggerAutoBackup();
        expect(fired).toBe(true);
    });

    it('ne déclenche PAS après 3 jours si count=0 (no-op si rien à sauver)', async () => {
        const fourDaysAgo = Date.now() - 4 * DAY_MS;
        h.appStateStore.set(STATE_KEY, { count: 0, lastTimestamp: fourDaysAgo });
        _resetCacheForTests();
        const fired = await checkAndTriggerAutoBackup();
        expect(fired).toBe(false);
    });

    it('ne déclenche PAS si state.isAdmin', async () => {
        h.mockState.isAdmin = true;
        h.appStateStore.set(STATE_KEY, { count: 50, lastTimestamp: 0 });
        _resetCacheForTests();
        const fired = await checkAndTriggerAutoBackup();
        expect(fired).toBe(false);
    });

    it('reset le state après un backup réussi (count=0, timestamp=now)', async () => {
        const before = Date.now();
        h.appStateStore.set(STATE_KEY, { count: 12, lastTimestamp: 0 });
        _resetCacheForTests();
        await checkAndTriggerAutoBackup();
        const after = h.appStateStore.get(STATE_KEY);
        expect(after.count).toBe(0);
        expect(after.lastTimestamp).toBeGreaterThanOrEqual(before);
    });

    it('emet un toast d\'information avec le motif', async () => {
        h.appStateStore.set(STATE_KEY, { count: 15, lastTimestamp: 0 });
        _resetCacheForTests();
        await checkAndTriggerAutoBackup();
        expect(h.showToastSpy).toHaveBeenCalled();
        const [msg, level] = h.showToastSpy.mock.calls[0];
        expect(msg).toContain('Backup auto téléchargé');
        expect(msg).toContain('15 modifications'); // motif inclus
        expect(level).toBe('info');
    });

    it('régression : lastTimestamp=0 ne déclenche PAS sur le critère temps (faux positif boot)', async () => {
        // Avant fix : lastTimestamp=0 donnait elapsedDays=Infinity, ce qui
        // matchait DAYS_THRESHOLD=3 dès la 1re modif → backup spam au boot.
        // Maintenant, le critère temps ne s'applique que si lastTimestamp>0.
        h.appStateStore.set(STATE_KEY, { count: 5, lastTimestamp: 0 });
        _resetCacheForTests();
        const fired = await checkAndTriggerAutoBackup();
        expect(fired).toBe(false);
        expect(h.saveUserDataSpy).not.toHaveBeenCalled();
    });

    it('régression : déclenchements concurrents → un seul backup (mutex)', async () => {
        // Avant fix : recordModification appelle checkAndTriggerAutoBackup en
        // void (sans await). Plusieurs modifs successives au seuil pouvaient
        // lancer N checks parallèles qui voyaient tous count>=10 et tous
        // déclenchaient saveUserData → N backups. Maintenant guard mutex.
        h.appStateStore.set(STATE_KEY, { count: 12, lastTimestamp: 0 });
        _resetCacheForTests();
        // Lance 5 checks en parallèle (sans await individuel)
        const promises = [];
        for (let i = 0; i < 5; i++) promises.push(checkAndTriggerAutoBackup());
        const results = await Promise.all(promises);
        // Un seul a fait le travail
        expect(results.filter(r => r === true).length).toBe(1);
        expect(h.saveUserDataSpy).toHaveBeenCalledTimes(1);
    });

    it('si saveUserData échoue, ne reset pas le state (retry futur)', async () => {
        h.saveUserDataSpy.mockImplementationOnce(() => Promise.reject(new Error('disk full')));
        h.appStateStore.set(STATE_KEY, { count: 11, lastTimestamp: 0 });
        _resetCacheForTests();
        const fired = await checkAndTriggerAutoBackup();
        expect(fired).toBe(false);
        // Le state n'a pas été reset — la prochaine modif redéclenchera
        const after = h.appStateStore.get(STATE_KEY);
        expect(after.count).toBe(11);
        expect(after.lastTimestamp).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// forceBackup — bouton "Forcer un backup maintenant"
// ─────────────────────────────────────────────────────────────────────────────
describe('forceBackup', () => {
    it('appelle saveUserData(false), reset le compteur, set timestamp', async () => {
        const before = Date.now();
        h.appStateStore.set(STATE_KEY, { count: 4, lastTimestamp: 0 });
        _resetCacheForTests();

        const ok = await forceBackup();
        expect(ok).toBe(true);
        expect(h.saveUserDataSpy).toHaveBeenCalledWith(false);
        const after = h.appStateStore.get(STATE_KEY);
        expect(after.count).toBe(0);
        expect(after.lastTimestamp).toBeGreaterThanOrEqual(before);
    });

    it('emet un toast de succès', async () => {
        await forceBackup();
        expect(h.showToastSpy).toHaveBeenCalledWith('Backup téléchargé.', 'success');
    });

    it('retourne false et toast erreur si saveUserData throw', async () => {
        h.saveUserDataSpy.mockImplementationOnce(() => Promise.reject(new Error('quota')));
        const ok = await forceBackup();
        expect(ok).toBe(false);
        expect(h.showToastSpy).toHaveBeenCalledWith('Impossible de créer le backup.', 'error');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBackupStatusForUI — affichage onglet Sécurité
// ─────────────────────────────────────────────────────────────────────────────
describe('getBackupStatusForUI', () => {
    it('retourne {count: 0, lastDate: null} si aucun état persistant', async () => {
        const s = await getBackupStatusForUI();
        expect(s.count).toBe(0);
        expect(s.lastDate).toBeNull();
        expect(s.daysSince).toBeNull();
        expect(s.modifsThreshold).toBe(MODIFS_THRESHOLD);
        expect(s.daysThreshold).toBe(3);
    });

    it('retourne lastDate et daysSince calculés quand timestamp existe', async () => {
        const twoDaysAgo = Date.now() - 2 * DAY_MS;
        h.appStateStore.set(STATE_KEY, { count: 7, lastTimestamp: twoDaysAgo });
        _resetCacheForTests();
        const s = await getBackupStatusForUI();
        expect(s.count).toBe(7);
        expect(s.lastDate).toBeInstanceOf(Date);
        expect(s.daysSince).toBe(2);
    });
});
