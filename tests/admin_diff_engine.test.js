import { describe, it, expect, vi, beforeEach } from 'vitest';

// Nous devons mocker (simuler) l'état global et les fonctions fetch du système
// car le moteur dépend de `state` et télécharge des fichiers depuis GitHub.

// 1. On mock le fetch global
global.fetch = vi.fn();

// 2. On mock le state
vi.mock('../src/state.js', () => ({
    state: {
        currentMapId: 'djerba',
        loadedFeatures: [],
        customFeatures: [],
        userData: {},
        officialCircuits: [],
        myCircuits: []
    }
}));

// 3. On mock les helpers de données
vi.mock('../src/data.js', () => ({
    getPoiId: (f) => f.properties.HW_ID || f.id,
    getPoiName: (f) => f.properties.Nom || 'Sans nom'
}));

// 4. On mock database.js pour éviter l'initialisation d'IndexedDB (indisponible sous jsdom).
// admin-diff-engine importe getAllPendingAdminPhotos, qui déclenche initDB si non stubbé.
vi.mock('../src/database.js', () => ({
    getAllPendingAdminPhotos: vi.fn(() => Promise.resolve({}))
}));

import { state } from '../src/state.js';
import { prepareDiffData, diffData } from '../src/admin-diff-engine.js';

describe('Admin Diff Engine - Sécurité des Publications', () => {

    beforeEach(() => {
        // Réinitialiser les mocks et l'état avant chaque test
        vi.clearAllMocks();
        state.loadedFeatures = [];
        state.customFeatures = [];
        state.userData = {};
        state.officialCircuits = [];
        state.myCircuits = [];
        diffData.pois = [];
        diffData.circuits = [];

        // Simuler le serveur GitHub qui renvoie un GeoJSON vide et des circuits vides par défaut
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ type: 'FeatureCollection', features: [] })
        });

        // Surcharge pour le deuxième appel (circuits.json)
        global.fetch.mockImplementation((url) => {
            if (url.includes('.geojson')) {
                return Promise.resolve({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) });
            }
            if (url.includes('.json')) {
                return Promise.resolve({ ok: true, json: async () => ([]) });
            }
            return Promise.reject(new Error('URL non gérée'));
        });
    });

    it('TEST 1: NE DOIT PAS proposer un circuit sans trace réelle (Brouillon)', async () => {
        // --- PRÉPARATION (Arrange) ---
        // On crée un circuit "brouillon" (sans realTrack ou realTrack vide)
        state.myCircuits = [{
            id: 'circuit_brouillon_123',
            name: 'Mon Beau Circuit en cours',
            poiIds: ['poi1', 'poi2'],
            realTrack: [] // TRACE VIDE = BROUILLON
        }];

        const adminDraft = { pendingPois: {}, pendingCircuits: {} };

        // --- ACTION (Act) ---
        const result = await prepareDiffData(adminDraft);

        // --- VÉRIFICATION (Assert) ---
        // Le circuit ne doit PAS se retrouver dans diffData.circuits (ni création, ni modification)
        expect(result.circuits.length).toBe(0);

        // Si ce test passe, cela garantit que vous ne publierez jamais un circuit cassé !
    });

    it('TEST 2: DOIT proposer un circuit avec une trace valide', async () => {
         // --- PRÉPARATION ---
         state.myCircuits = [{
            id: 'circuit_valide_456',
            name: 'Circuit Fini',
            poiIds: ['poi1', 'poi2'],
            realTrack: [[10.1, 11.2], [10.2, 11.3]] // TRACE VALIDE
        }];

        const adminDraft = { pendingPois: {}, pendingCircuits: {} };

        // --- ACTION ---
        const result = await prepareDiffData(adminDraft);

        // --- VÉRIFICATION ---
        expect(result.circuits.length).toBe(1);
        expect(result.circuits[0].id).toBe('circuit_valide_456');
        expect(result.circuits[0].isCreation).toBe(true);
    });

    it('TEST 3: DOIT proposer la suppression d\'un circuit si effacé localement (Ghost Prevention)', async () => {
        // --- PRÉPARATION ---
        // 1. Le serveur (GitHub) connaît un circuit
        global.fetch.mockImplementation((url) => {
            if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) });
            if (url.includes('.json')) return Promise.resolve({
                ok: true,
                json: async () => ([{ id: 'circuit_serveur_789', name: 'Vieux Circuit' }])
            });
        });

        // 2. Localement, l'utilisateur a mis le circuit dans la corbeille (isDeleted: true)
        state.myCircuits = [{
            id: 'circuit_serveur_789',
            name: 'Vieux Circuit',
            isDeleted: true
        }];

        const adminDraft = { pendingPois: {}, pendingCircuits: {} };

        // --- ACTION ---
        const result = await prepareDiffData(adminDraft);

        // --- VÉRIFICATION ---
        // Le moteur doit voir que le circuit existe sur le serveur, mais est supprimé localement.
        // Il doit donc ordonner sa suppression.
        expect(result.circuits.length).toBe(1);
        expect(result.circuits[0].isDeletion).toBe(true);
        expect(result.circuits[0].changes[0].new).toBe('SUPPRESSION');
    });

    it('TEST 4: DOIT ignorer les modifications personnelles "invisibles" (Visites, Notes persos) sur un POI', async () => {
        // --- PRÉPARATION ---
        // 1. Le serveur a un lieu classique
        const remotePoi = {
            type: 'Feature',
            properties: { HW_ID: 'poi_1', Nom: 'Phare' },
            geometry: { type: 'Point', coordinates: [10, 20] }
        };
        global.fetch.mockImplementation((url) => {
            if (url.includes('.geojson')) return Promise.resolve({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [remotePoi] }) });
            if (url.includes('.json')) return Promise.resolve({ ok: true, json: async () => ([]) });
        });

        // 2. Localement, le lieu existe
        state.loadedFeatures = [remotePoi];

        // 3. MAIS, l'admin a visité le lieu et mis une note perso (userData).
        // Cela NE DOIT PAS déclencher une mise à jour sur le serveur officiel !
        state.userData = {
            'poi_1': { visited: true, notes: 'Super endroit, je reviendrai.' }
        };

        // On simule que l'adminDraft a "pisté" cette modification par erreur (via reconcile)
        const adminDraft = { pendingPois: { 'poi_1': { type: 'update' } }, pendingCircuits: {} };

        // --- ACTION ---
        const result = await prepareDiffData(adminDraft);

        // --- VÉRIFICATION ---
        // Puisque visited et notes sont filtrés, le moteur ne doit trouver "aucune" modification publiable
        // (diffData.pois doit être vide)
        expect(result.pois.length).toBe(0);
        expect(result.stats.poisModified).toBe(0);
    });
});
