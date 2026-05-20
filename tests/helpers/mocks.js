// tests/helpers/mocks.js
// Helpers de mocks vitest partagés entre fichiers de tests. Évite que chaque
// test redéfinisse un sous-ensemble partiel d'un module — source historique
// du flake `circuit_actions_deletion.test.js` (audit 20/05/2026).
//
// Usage (factory pattern async — le seul compatible avec le hoisting de vi.mock) :
//
//   vi.mock('../src/database.js', async () => {
//     const { createDatabaseMock } = await import('./helpers/mocks.js');
//     return createDatabaseMock();
//   });
//
// Pour override une fonction spécifique :
//
//   vi.mock('../src/database.js', async () => {
//     const { createDatabaseMock } = await import('./helpers/mocks.js');
//     return createDatabaseMock({
//       getAppState: vi.fn(() => Promise.resolve({ foo: 'bar' }))
//     });
//   });

import { vi } from 'vitest';

/**
 * Mock complet et inerte de `src/database.js`. Toutes les fonctions sont des
 * `vi.fn()` qui résolvent à une valeur par défaut sûre (undefined / [] / {}).
 *
 * Pourquoi un mock COMPLET ? Beaucoup de modules importent indirectement
 * database.js (ex: backup-auto-local.js → saveAppState). Un mock partiel
 * cause des TypeError fire-and-forget → unhandled rejections.
 *
 * Liste maintenue à jour avec `src/database.js` (23 exports au 20/05/2026).
 */
export function createDatabaseMock(overrides = {}) {
    const base = {
        initDB: vi.fn(() => Promise.resolve()),
        getAppState: vi.fn(() => Promise.resolve(undefined)),
        saveAppState: vi.fn(() => Promise.resolve()),
        softDeleteCircuit: vi.fn(() => Promise.resolve()),
        restoreCircuit: vi.fn(() => Promise.resolve()),
        getAllPoiDataForMap: vi.fn(() => Promise.resolve({})),
        savePoiData: vi.fn(() => Promise.resolve()),
        deletePoiData: vi.fn(() => Promise.resolve()),
        batchSavePoiData: vi.fn(() => Promise.resolve()),
        getAllCircuitsForMap: vi.fn(() => Promise.resolve([])),
        saveCircuit: vi.fn(() => Promise.resolve()),
        deleteCircuitById: vi.fn(() => Promise.resolve()),
        clearAllUserData: vi.fn(() => Promise.resolve()),
        deleteDatabase: vi.fn(() => Promise.resolve()),
        getPoiPhotos: vi.fn(() => Promise.resolve([])),
        savePoiPhotos: vi.fn(() => Promise.resolve()),
        deletePoiPhotos: vi.fn(() => Promise.resolve()),
        getPendingAdminPhotos: vi.fn(() => Promise.resolve([])),
        getAllPendingAdminPhotos: vi.fn(() => Promise.resolve({})),
        setPendingAdminPhotos: vi.fn(() => Promise.resolve()),
        clearPendingAdminPhotos: vi.fn(() => Promise.resolve()),
        getAllPoiPhotosForMap: vi.fn(() => Promise.resolve({})),
        clearStore: vi.fn(() => Promise.resolve()),
    };
    return { ...base, ...overrides };
}

/**
 * Mock inerte de `src/backup-auto-local.js`. Évite que le `recordModification`
 * fire-and-forget appelé depuis les chemins user (data.js, circuit-actions.js,
 * desktopMode.js) ne déclenche un I/O réel pendant les tests.
 *
 * À utiliser dans tout test qui exerce un chemin user mutant (ajout / édition
 * / suppression de POI ou de circuit).
 */
export function createBackupAutoLocalMock(overrides = {}) {
    const base = {
        recordModification: vi.fn(() => Promise.resolve()),
        checkAndTriggerAutoBackup: vi.fn(() => Promise.resolve(false)),
        forceBackup: vi.fn(() => Promise.resolve(true)),
    };
    return { ...base, ...overrides };
}
