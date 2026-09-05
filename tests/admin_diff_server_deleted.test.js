import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// admin-diff-engine — filtre des circuits supprimés du SERVEUR par l'app.
//
// Contexte (04/09/2026) : l'onglet Nettoyage écrit directement sur GitHub
// (GPX + entrée d'index). La relecture de l'index passe par
// raw.githubusercontent, qui peut encore servir la version d'AVANT l'écriture
// pendant quelques secondes. Le diff comparait alors un local à jour à un
// remote en retard → « SUPPRESSION » sur un circuit déjà parti, puis
// « Tout publier » poussait des commits vides.
//
// Reproduit en preview avant correctif : relecture à jour → 0 diff ;
// relecture périmée → « Tout publier 1 ».
// ============================================================================

global.fetch = vi.fn();

vi.mock('../src/state.js', () => ({
    state: {
        currentMapId: 'djerba',
        loadedFeatures: [],
        customFeatures: [],
        userData: {},
        officialCircuits: [],
        myCircuits: [],
        testedCircuits: {}
    }
}));

vi.mock('../src/data.js', () => ({
    getPoiId: (f) => f.properties.HW_ID || f.id,
    getPoiName: (f) => f.properties.Nom || 'Sans nom'
}));

vi.mock('../src/database.js', () => ({
    getAllPendingAdminPhotos: vi.fn(() => Promise.resolve({})),
    savePoiData: vi.fn(() => Promise.resolve()),
    deletePoiData: vi.fn(() => Promise.resolve())
}));

import { state } from '../src/state.js';
import { prepareDiffData, diffData } from '../src/admin-diff-engine.js';
import {
    noteServerDeletedCircuit,
    _resetServerDeletedCircuits,
} from '../src/circuit-deletion-state.js';

const REMOTE = [
    { id: 'HW-A', name: 'Circuit A', file: 'djerba/A.gpx', poiIds: ['p1'] },
    { id: 'HW-B', name: 'Circuit B', file: 'djerba/B.gpx', poiIds: ['p2'] },
];

/** Le « serveur » renvoie l'index passé — c'est le levier de tous ces tests. */
function serveIndex(circuits) {
    global.fetch.mockImplementation((url) => {
        if (url.includes('.geojson')) {
            return Promise.resolve({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) });
        }
        if (url.includes('tested_')) {
            return Promise.resolve({ ok: true, json: async () => ({}) });
        }
        return Promise.resolve({ ok: true, json: async () => circuits });
    });
}

const emptyDraft = () => ({ pendingPois: {}, pendingCircuits: {} });

beforeEach(() => {
    vi.clearAllMocks();
    _resetServerDeletedCircuits();
    // Local à jour : l'app a supprimé HW-A, il ne reste que HW-B.
    state.officialCircuits = [{ id: 'HW-B', name: 'Circuit B', poiIds: ['p2'], realTrack: [] }];
    state.myCircuits = [];
});

describe('prepareDiffData — relecture d’index en retard', () => {
    it('sans le filtre : un remote périmé produit une SUPPRESSION fantôme', async () => {
        // C'est le comportement à couvrir, pas à corriger : si le circuit a
        // réellement disparu du local sans que l'app l'ait supprimé côté
        // serveur, la SUPPRESSION est légitime.
        serveIndex(REMOTE);
        await prepareDiffData(emptyDraft());
        expect(diffData.circuits.map(c => c.id)).toEqual(['HW-A']);
        expect(diffData.circuits[0].isDeletion).toBe(true);
    });

    it('après noteServerDeletedCircuit : plus de fantôme, même si le remote est périmé', async () => {
        noteServerDeletedCircuit('HW-A');
        serveIndex(REMOTE); // le serveur liste ENCORE HW-A
        await prepareDiffData(emptyDraft());
        expect(diffData.circuits).toEqual([]);
        expect(diffData.stats.circuitsModified).toBe(0);
    });

    it('normalise le type de l’id (number local vs string dans l’index)', async () => {
        noteServerDeletedCircuit(1771316521571);
        serveIndex([{ id: '1771316521571', name: 'Legacy', file: 'djerba/L.gpx', poiIds: [] }]);
        await prepareDiffData(emptyDraft());
        expect(diffData.circuits).toEqual([]);
    });

    it('ne masque QUE le circuit supprimé — les autres écarts restent visibles', async () => {
        noteServerDeletedCircuit('HW-A');
        // HW-C est absent du local sans avoir été supprimé par l'app : il doit
        // toujours ressortir en SUPPRESSION.
        serveIndex([...REMOTE, { id: 'HW-C', name: 'Circuit C', file: 'djerba/C.gpx', poiIds: ['p3'] }]);
        await prepareDiffData(emptyDraft());
        expect(diffData.circuits.map(c => c.id)).toEqual(['HW-C']);
    });

    it('quand le remote est à jour, le filtre ne change rien', async () => {
        noteServerDeletedCircuit('HW-A');
        serveIndex([REMOTE[1]]); // serveur déjà à jour
        await prepareDiffData(emptyDraft());
        expect(diffData.circuits).toEqual([]);
    });
});
