import { describe, it, expect, vi, beforeEach } from 'vitest';

// Rejets de candidats en attente (02/11/2026) : comptés par le diff du Centre de
// Contrôle (stats.rejectedPending), sinon rejeter seul laissait « Tout est
// synchronisé » et « Tout publier » inactif.

global.fetch = vi.fn(async (url) => ({
    ok: true,
    json: async () => (url.includes('.geojson') ? { type: 'FeatureCollection', features: [] } : url.includes('tested_') ? {} : []),
}));

vi.mock('../src/state.js', () => ({
    state: { currentMapId: 'charleroi', loadedFeatures: [], customFeatures: [], userData: {}, officialCircuits: [], myCircuits: [], testedCircuits: {} },
    DEFAULT_MAP_ID: 'djerba',
    getActiveMapId: () => 'charleroi',
}));
vi.mock('../src/database.js', () => ({
    getAllPendingAdminPhotos: vi.fn(() => Promise.resolve({})),
    savePoiData: vi.fn(() => Promise.resolve()),
    deletePoiData: vi.fn(() => Promise.resolve()),
}));

import { prepareDiffData, diffData } from '../src/admin-diff-engine.js';
import { addRejected, clearRejected } from '../src/rejected.js';

const emptyDraft = () => ({ pendingPois: {}, pendingCircuits: {} });

beforeEach(() => clearRejected());

describe('prepareDiffData — rejets en attente', () => {
    it('compte les rejets pas encore publiés', async () => {
        addRejected({ osm_ref: 'node/1' });
        addRejected({ osm_ref: 'way/2' });
        await prepareDiffData(emptyDraft());
        expect(diffData.stats.rejectedPending).toBe(2);
    });

    it('aucun rejet en attente → 0', async () => {
        await prepareDiffData(emptyDraft());
        expect(diffData.stats.rejectedPending).toBe(0);
    });
});
