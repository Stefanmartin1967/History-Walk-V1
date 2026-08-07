import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// admin-diff-engine.js — purgeOrphanPendingPois.
// Fix 07/08/2026 : un échec réseau lors de prepareDiffData laissait
// originalFeatures à [], que purgeOrphanPendingPois interprétait à tort comme
// « le dépôt est vide » — purgeant toute suppression en attente comme un
// fantôme. Un lieu réellement supprimé pouvait alors être republié tel quel
// (cas vécu : "Mosquée Robbana"). diffData.fetchFailed distingue maintenant
// « confirmé absent » de « on n'a pas pu vérifier ».
// ============================================================================

vi.mock('../src/state.js', () => ({
    state: {
        currentMapId: 'djerba',
        userData: {}
    }
}));

vi.mock('../src/net.js', () => ({
    fetchWithTimeout: vi.fn()
}));

vi.mock('../src/utils.js', () => ({
    getPoiId: (f) => f.properties.HW_ID || f.id,
    getPoiName: (f) => f.properties.Nom || 'Sans nom',
    isCandidate: () => false
}));

vi.mock('../src/config.js', () => ({
    RAW_BASE: 'https://raw.githubusercontent.com/fake/repo/main',
    GITHUB_PATHS: {
        geojson: (mapId) => `public/${mapId}.geojson`,
        circuits: (mapId) => `public/${mapId}-circuits.json`,
        tested: (mapId) => `public/${mapId}-tested.json`
    },
    PERSONAL_KEYS: ['vu', 'vuManual', 'notes', 'incontournable', 'visitedByCircuits']
}));

vi.mock('../src/database.js', () => ({
    getAllPendingAdminPhotos: vi.fn(async () => ({})),
    savePoiData: vi.fn(async () => {}),
    deletePoiData: vi.fn(async () => {})
}));

import { diffData, purgeOrphanPendingPois } from '../src/admin-diff-engine.js';

function buildFeature(id, properties = {}) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 33] }, properties: { HW_ID: id, ...properties } };
}

describe('admin-diff-engine — purgeOrphanPendingPois', () => {
    beforeEach(() => {
        diffData.pois = [];
        diffData.originalFeatures = [];
        diffData.fetchFailed = false;
    });

    it('fix 07/08 : ne purge RIEN si diffData.fetchFailed est true, même une suppression sans original', async () => {
        diffData.fetchFailed = true;
        diffData.originalFeatures = []; // tel que laissé par un fetch en échec
        const adminDraft = {
            pendingPois: {
                poi_1: { type: 'delete' }
            }
        };
        const purged = await purgeOrphanPendingPois(adminDraft);
        expect(purged).toEqual([]);
        expect(adminDraft.pendingPois.poi_1).toBeDefined();
    });

    it('comportement existant préservé : purge une suppression fantôme (fetch réussi, POI absent du dépôt)', async () => {
        diffData.fetchFailed = false;
        diffData.originalFeatures = []; // confirmé vide, pas un échec
        const adminDraft = {
            pendingPois: {
                poi_fantome: { type: 'delete' }
            }
        };
        const purged = await purgeOrphanPendingPois(adminDraft);
        expect(purged).toEqual(['poi_fantome']);
        expect(adminDraft.pendingPois.poi_fantome).toBeUndefined();
    });

    it('comportement existant préservé : garde une suppression légitime (fetch réussi, POI présent dans le dépôt)', async () => {
        diffData.fetchFailed = false;
        diffData.originalFeatures = [buildFeature('poi_reel', { Nom: 'Réel' })];
        const adminDraft = {
            pendingPois: {
                poi_reel: { type: 'delete' }
            }
        };
        const purged = await purgeOrphanPendingPois(adminDraft);
        expect(purged).toEqual([]);
        expect(adminDraft.pendingPois.poi_reel).toBeDefined();
    });
});
