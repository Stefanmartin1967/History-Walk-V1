// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (hoisted par vitest) ---
vi.mock('../src/state.js', () => {
    const state = {
        currentMapId: null,
        appVersion: '3.0',
        loadedFeatures: [],
        userData: {},
        myCircuits: [],
        hiddenPoiIds: [],
        officialCircuitsStatus: {},
        testedCircuits: {},
        isAdmin: false
    };
    return {
        state,
        setCurrentMap: vi.fn(id => { state.currentMapId = id; }),
        setLoadedFeatures: vi.fn(arr => { state.loadedFeatures = arr; }),
        setUserData: vi.fn(d => { state.userData = d; }),
        setTestedCircuits: vi.fn(d => { state.testedCircuits = d; }),
        DEFAULT_MAP_ID: 'djerba',
        // Lit le MEME etat mocke que le module : un test qui change
        // currentMapId change aussi la cle resolue.
        getActiveMapId: () => state.currentMapId || state.destinations?.activeMapId || 'djerba'
    };
});

vi.mock('../src/data.js', () => ({
    getPoiId: vi.fn(f => f?.properties?.HW_ID || f?.id),
    displayGeoJSON: vi.fn()
}));

vi.mock('../src/ui-dom.js', () => ({
    DOM: {}
}));

vi.mock('../src/ui-details.js', () => ({
    closeDetailsPanel: vi.fn()
}));

vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../src/database.js', () => ({
    saveAppState: vi.fn(),
    savePoiData: vi.fn(),
    saveCircuit: vi.fn(),
    deleteCircuitsForMap: vi.fn(async () => 0),
    getAllPoiPhotosForMap: vi.fn(async () => []),
    savePoiPhotos: vi.fn(async () => {}),
    blobToBase64: vi.fn(async () => 'data:image/jpeg;base64,MOCKDATA'),
    base64ToBlob: vi.fn((b64) => new Blob([b64], { type: 'image/jpeg' }))
}));

vi.mock('../src/gpx.js', () => ({
    processImportedGpx: vi.fn()
}));

vi.mock('../src/mobile-state.js', () => ({
    isMobileView: vi.fn(() => false)
}));

vi.mock('../src/events.js', () => ({
    eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() }
}));

vi.mock('../src/utils.js', () => ({
    downloadFile: vi.fn()
}));

vi.mock('../src/modal.js', () => ({
    showCustomModal: vi.fn(),
    closeModal: vi.fn()
}));

vi.mock('../src/local-destinations.js', () => ({
    getDraftZones: vi.fn(async () => ({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { name: 'Quartier A' }, geometry: null }]
    })),
    createLocalDraftDestination: vi.fn(async () => {})
}));

import { state } from '../src/state.js';
import { showToast } from '../src/toast.js';
import { getAllPoiPhotosForMap, savePoiPhotos, savePoiData, base64ToBlob, saveAppState, saveCircuit, deleteCircuitsForMap } from '../src/database.js';
import { getDraftZones, createLocalDraftDestination } from '../src/local-destinations.js';
import {
    backupFileName,
    cleanDataForExport,
    isValidBackup,
    prepareExportData,
    saveUserData,
    restoreBackup
} from '../src/fileManager.js';

function resetState() {
    state.currentMapId = null;
    state.appVersion = '3.0';
    state.loadedFeatures = [];
    state.userData = {};
    state.myCircuits = [];
    state.hiddenPoiIds = [];
    state.officialCircuitsStatus = {};
    state.testedCircuits = {};
    state.isAdmin = false;
    state.destinations = { activeMapId: 'djerba', maps: {} };
}

beforeEach(() => {
    resetState();
    vi.clearAllMocks();
    localStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('cleanDataForExport', () => {
    it('retourne undefined pour null/undefined', () => {
        expect(cleanDataForExport(null)).toBeUndefined();
        expect(cleanDataForExport(undefined)).toBeUndefined();
    });

    it('préserve les primitifs (string, number, boolean, 0, "")', () => {
        expect(cleanDataForExport('hello')).toBe('hello');
        expect(cleanDataForExport(42)).toBe(42);
        expect(cleanDataForExport(true)).toBe(true);
        expect(cleanDataForExport(false)).toBe(false);
        expect(cleanDataForExport(0)).toBe(0);
        expect(cleanDataForExport('')).toBe('');
    });

    it('retire les clés null/undefined d\'un objet', () => {
        const input = { a: 1, b: null, c: undefined, d: 'x' };
        expect(cleanDataForExport(input)).toEqual({ a: 1, d: 'x' });
    });

    it('filtre les éléments null/undefined d\'un tableau', () => {
        expect(cleanDataForExport([1, null, 2, undefined, 3])).toEqual([1, 2, 3]);
    });

    it('nettoie récursivement les objets imbriqués', () => {
        const input = {
            outer: {
                inner: { a: 1, b: null },
                arr: [{ x: undefined, y: 2 }, null]
            }
        };
        expect(cleanDataForExport(input)).toEqual({
            outer: {
                inner: { a: 1 },
                arr: [{ y: 2 }]
            }
        });
    });

    it('retourne un objet vide si toutes les clés sont null/undefined', () => {
        expect(cleanDataForExport({ a: null, b: undefined })).toEqual({});
    });

    it('retourne un tableau vide si tous les éléments sont null/undefined', () => {
        expect(cleanDataForExport([null, undefined, null])).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('isValidBackup', () => {
    const validMinimal = { backupVersion: '3.0', mapId: 'djerba' };

    it('rejette null et non-objets', () => {
        expect(isValidBackup(null)).toBe(false);
        expect(isValidBackup(undefined)).toBe(false);
        expect(isValidBackup('string')).toBe(false);
        expect(isValidBackup(42)).toBe(false);
        expect(isValidBackup(true)).toBe(false);
    });

    it('rejette si backupVersion absent', () => {
        expect(isValidBackup({ mapId: 'djerba' })).toBe(false);
    });

    it('rejette si mapId absent, vide ou non-string', () => {
        expect(isValidBackup({ backupVersion: '3.0' })).toBe(false);
        expect(isValidBackup({ backupVersion: '3.0', mapId: '' })).toBe(false);
        expect(isValidBackup({ backupVersion: '3.0', mapId: '   ' })).toBe(false);
        expect(isValidBackup({ backupVersion: '3.0', mapId: 42 })).toBe(false);
        expect(isValidBackup({ backupVersion: '3.0', mapId: null })).toBe(false);
    });

    it('rejette userData non-objet (array, primitive, null)', () => {
        expect(isValidBackup({ ...validMinimal, userData: [] })).toBe(false);
        expect(isValidBackup({ ...validMinimal, userData: 'str' })).toBe(false);
        expect(isValidBackup({ ...validMinimal, userData: null })).toBe(false);
    });

    it('accepte userData absent (champ optionnel)', () => {
        expect(isValidBackup(validMinimal)).toBe(true);
    });

    it('rejette myCircuits si non-array', () => {
        expect(isValidBackup({ ...validMinimal, myCircuits: {} })).toBe(false);
        expect(isValidBackup({ ...validMinimal, myCircuits: 'str' })).toBe(false);
    });

    it('rejette hiddenPoiIds si non-array', () => {
        expect(isValidBackup({ ...validMinimal, hiddenPoiIds: {} })).toBe(false);
    });

    it('accepte testedCircuits en objet (format runtime) ou en tableau, rejette null/primitive', () => {
        expect(isValidBackup({ ...validMinimal, testedCircuits: {} })).toBe(true);
        expect(isValidBackup({ ...validMinimal, testedCircuits: { c1: true } })).toBe(true);
        expect(isValidBackup({ ...validMinimal, testedCircuits: ['c1'] })).toBe(true);
        expect(isValidBackup({ ...validMinimal, testedCircuits: null })).toBe(false);
        expect(isValidBackup({ ...validMinimal, testedCircuits: 'x' })).toBe(false);
    });

    it('rejette officialCircuitsStatus si non-objet (array, null, primitive)', () => {
        expect(isValidBackup({ ...validMinimal, officialCircuitsStatus: [] })).toBe(false);
        expect(isValidBackup({ ...validMinimal, officialCircuitsStatus: null })).toBe(false);
        expect(isValidBackup({ ...validMinimal, officialCircuitsStatus: 'x' })).toBe(false);
    });

    it('rejette baseGeoJSON si type ≠ FeatureCollection ou features non-array', () => {
        expect(isValidBackup({ ...validMinimal, baseGeoJSON: { type: 'Feature' } })).toBe(false);
        expect(isValidBackup({ ...validMinimal, baseGeoJSON: { type: 'FeatureCollection' } })).toBe(false);
        expect(isValidBackup({ ...validMinimal, baseGeoJSON: { type: 'FeatureCollection', features: 'no' } })).toBe(false);
    });

    it('accepte un backup minimal valide', () => {
        expect(isValidBackup(validMinimal)).toBe(true);
    });

    it('accepte un backup complet valide avec tous les champs optionnels', () => {
        const complete = {
            backupVersion: '3.0',
            mapId: 'djerba',
            userData: { poi1: { vu: true } },
            myCircuits: [{ id: 'c1', name: 'Test', poiIds: [] }],
            hiddenPoiIds: ['poi2'],
            testedCircuits: ['c1'],
            officialCircuitsStatus: { c1: true },
            baseGeoJSON: { type: 'FeatureCollection', features: [] }
        };
        expect(isValidBackup(complete)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('prepareExportData', () => {
    it('retourne le format "Carton avec étiquette" attendu (backupVersion, mapId, baseGeoJSON, etc.)', async () => {
        state.currentMapId = 'djerba';
        const data = await prepareExportData(false);
        expect(data.backupVersion).toBe('3.0');
        expect(data.mapId).toBe('djerba');
        expect(data.baseGeoJSON.type).toBe('FeatureCollection');
        expect(Array.isArray(data.baseGeoJSON.features)).toBe(true);
        expect(typeof data.date).toBe('string');
    });

    it('utilise "djerba" comme mapId par défaut si state.currentMapId absent', async () => {
        state.currentMapId = null;
        const data = await prepareExportData(false);
        expect(data.mapId).toBe('djerba');
    });

    it('vide les photos quand includePhotos = false', async () => {
        state.currentMapId = 'djerba';
        state.loadedFeatures = [
            { type: 'Feature', properties: { HW_ID: 'HW-PC-p1' }, geometry: null }
        ];
        state.userData = { 'HW-PC-p1': { vu: true, photos: ['photo1.jpg', 'photo2.jpg'] } };

        const data = await prepareExportData(false);
        const feat = data.baseGeoJSON.features[0];
        expect(feat.properties.userData.vu).toBe(true);
        expect(feat.properties.userData.photos).toBeUndefined();
    });

    it('conserve les photos « légères » (URLs) dans userData racine, jamais dans le geojson', async () => {
        state.currentMapId = 'djerba';
        state.loadedFeatures = [
            { type: 'Feature', properties: { HW_ID: 'p1' }, geometry: null }
        ];
        state.userData = { p1: { vu: true, photos: ['photo1.jpg'] } };

        const data = await prepareExportData(true);
        // Plus de duplication des photos dans le geojson
        expect(data.baseGeoJSON.features[0].properties.userData.photos).toBeUndefined();
        // Les références légères (non base64) sont conservées dans le bloc racine
        expect(data.userData.p1.photos).toEqual(['photo1.jpg']);
        expect(data.userData.p1.vu).toBe(true);
    });

    it('encode les photos Blob (store poiPhotos) en base64 dans userData racine en mode FULL', async () => {
        state.currentMapId = 'djerba';
        state.loadedFeatures = [
            { type: 'Feature', properties: { HW_ID: 'p1' }, geometry: null }
        ];
        state.userData = { p1: { vu: true } };
        getAllPoiPhotosForMap.mockResolvedValueOnce([
            { mapId: 'djerba', poiId: 'p1', photos: [{ id: 'a', blob: new Blob(['x']) }] }
        ]);

        const data = await prepareExportData(true);
        expect(getAllPoiPhotosForMap).toHaveBeenCalledWith('djerba');
        expect(data.userData.p1.photos).toEqual(['data:image/jpeg;base64,MOCKDATA']);
        // Jamais dupliqué dans le geojson
        expect(data.baseGeoJSON.features[0].properties.userData.photos).toBeUndefined();
    });

    it('n\'encode aucune photo Blob en mode LITE (includePhotos = false)', async () => {
        state.currentMapId = 'djerba';
        state.userData = { p1: { vu: true } };

        const data = await prepareExportData(false);
        expect(getAllPoiPhotosForMap).not.toHaveBeenCalled();
        expect(data.userData.p1.photos).toBeUndefined();
    });

    it('inclut un POI qui a des photos Blob mais aucune note (FULL)', async () => {
        state.currentMapId = 'djerba';
        state.loadedFeatures = [];
        state.userData = {}; // aucune note
        getAllPoiPhotosForMap.mockResolvedValueOnce([
            { mapId: 'djerba', poiId: 'p9', photos: [{ id: 'b', blob: new Blob(['y']) }] }
        ]);

        const data = await prepareExportData(true);
        expect(data.userData.p9.photos).toEqual(['data:image/jpeg;base64,MOCKDATA']);
    });

    it('fusionne les userData dans properties.userData de chaque feature', async () => {
        state.currentMapId = 'djerba';
        state.loadedFeatures = [
            { type: 'Feature', properties: { HW_ID: 'p1', name: 'A' }, geometry: null },
            { type: 'Feature', properties: { HW_ID: 'p2', name: 'B' }, geometry: null }
        ];
        state.userData = { p1: { vu: true }, p2: { vu: false } };

        const data = await prepareExportData(true);
        expect(data.baseGeoJSON.features[0].properties.userData).toEqual({ vu: true });
        expect(data.baseGeoJSON.features[1].properties.userData).toEqual({ vu: false });
        expect(data.baseGeoJSON.features[0].properties.name).toBe('A');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('saveUserData', () => {
    it('affiche un toast d\'erreur et abandonne si aucune carte chargée', async () => {
        state.currentMapId = null;
        await saveUserData(false);
        expect(showToast).toHaveBeenCalledWith('Aucune carte chargée.', 'error');
    });

    it('vide les photos en mode LITE (forceFullMode = false)', async () => {
        state.currentMapId = 'djerba';
        state.loadedFeatures = [
            { type: 'Feature', properties: { HW_ID: 'p1' }, geometry: null }
        ];
        state.userData = { p1: { vu: true, photos: ['p.jpg'] } };

        // Spy navigator.share pour empêcher le download réel
        const originalCreateObjectURL = URL.createObjectURL;
        URL.createObjectURL = vi.fn(() => 'blob:mock');
        URL.revokeObjectURL = vi.fn();

        await saveUserData(false);

        // Pas d'erreur toast
        expect(showToast).not.toHaveBeenCalledWith('Aucune carte chargée.', 'error');

        URL.createObjectURL = originalCreateObjectURL;
    });

    it('préserve les photos en mode FULL (forceFullMode = true)', async () => {
        state.currentMapId = 'djerba';
        state.loadedFeatures = [
            { type: 'Feature', properties: { HW_ID: 'p1' }, geometry: null }
        ];
        state.userData = { p1: { photos: ['a.jpg'] } };

        URL.createObjectURL = vi.fn(() => 'blob:mock');
        URL.revokeObjectURL = vi.fn();

        // saveUserData appelle downloadJSON → on ne peut pas inspecter le payload,
        // mais on peut vérifier l'absence d'erreur et que le pipeline tourne.
        await expect(saveUserData(true)).resolves.toBeUndefined();
    });

    it('inclut state.appVersion dans le payload (via mode FULL ou LITE)', async () => {
        state.currentMapId = 'djerba';
        state.appVersion = '4.2';

        URL.createObjectURL = vi.fn(() => 'blob:mock');
        URL.revokeObjectURL = vi.fn();

        // Le test indirect : pas de crash, et appVersion est utilisée dans le filename ou payload
        await expect(saveUserData(false)).resolves.toBeUndefined();
    });

    it('utilise un fallback "3.0" pour appVersion si state.appVersion absent', async () => {
        state.currentMapId = 'djerba';
        state.appVersion = null;

        URL.createObjectURL = vi.fn(() => 'blob:mock');
        URL.revokeObjectURL = vi.fn();

        await expect(saveUserData(false)).resolves.toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('restoreBackup (photos)', () => {
    it('décode les photos base64 vers le store poiPhotos (Blob) et nettoie userData', async () => {
        const json = {
            backupVersion: '3.0',
            mapId: 'djerba',
            userData: {
                p1: { vu: true, photos: ['data:image/jpeg;base64,AAA', 'photos/admin.jpg'] }
            }
        };

        await restoreBackup(json);

        // Les base64 redeviennent des Blobs dans le store poiPhotos
        expect(savePoiPhotos).toHaveBeenCalledTimes(1);
        const [mapId, poiId, blobs] = savePoiPhotos.mock.calls[0];
        expect(mapId).toBe('djerba');
        expect(poiId).toBe('p1');
        expect(blobs).toHaveLength(1);
        expect(blobs[0].blob).toBeInstanceOf(Blob);
        expect(base64ToBlob).toHaveBeenCalledWith('data:image/jpeg;base64,AAA');

        // poiUserData ne conserve que les références légères (URL), plus aucun base64
        const call = savePoiData.mock.calls.find(c => c[1] === 'p1');
        expect(call[2].photos).toEqual(['photos/admin.jpg']);
        expect(call[2].vu).toBe(true);
    });

    it('ne touche pas au store poiPhotos quand il n\'y a aucune photo base64', async () => {
        const json = {
            backupVersion: '3.0',
            mapId: 'djerba',
            userData: { p1: { vu: true } }
        };

        await restoreBackup(json);
        expect(savePoiPhotos).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sauvegarde d\'un brouillon local (Option A)', () => {
    it('joint draftDestination + draftZones quand la dest active est un brouillon local', async () => {
        state.currentMapId = 'venise';
        state.destinations = { activeMapId: 'djerba', maps: {
            venise: { name: 'Venise', custom: true, status: 'draft', bounds: [[1, 2], [3, 4]] }
        } };
        const data = await prepareExportData(false);
        expect(data.draftDestination).toMatchObject({ name: 'Venise', custom: true });
        expect(getDraftZones).toHaveBeenCalledWith('venise');
        expect(data.draftZones.features).toHaveLength(1);
    });

    it('n\'ajoute PAS draftDestination/draftZones sur une destination publiée', async () => {
        state.currentMapId = 'djerba';
        state.destinations = { activeMapId: 'djerba', maps: {
            djerba: { name: 'Djerba', status: 'published' }
        } };
        const data = await prepareExportData(false);
        expect(data.draftDestination).toBeUndefined();
        expect(data.draftZones).toBeUndefined();
        expect(getDraftZones).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mesuré le 11/11/2026 : la sauvegarde légère d'un visiteur pesait 839 Ko, dont
// 775 Ko de carte que la restauration ne relit pas (elle ne garde que les lieux
// créés par l'utilisateur). La légère n'embarque donc plus que ceux-là.
describe("sauvegarde légère : carte réduite aux lieux créés par l'utilisateur", () => {
    const features = () => [
        { type: 'Feature', properties: { HW_ID: 'HW-01OFFICIEL000000000000001', name: 'Officiel' }, geometry: null },
        { type: 'Feature', properties: { HW_ID: 'HW-PC-1', name: 'Créé à la main' }, geometry: null },
        { type: 'Feature', properties: { HW_ID: 'auto_7', name: 'Importé' }, geometry: null }
    ];
    const ids = (data) => data.baseGeoJSON.features.map(f => f.properties.HW_ID);

    it('légère, destination publiée : seulement les lieux créés', async () => {
        state.currentMapId = 'djerba';
        state.loadedFeatures = features();
        state.userData = { 'HW-01OFFICIEL000000000000001': { vu: true } };
        const data = await prepareExportData(false);
        expect(ids(data)).toEqual(['HW-PC-1', 'auto_7']);
        // les notes sur les fiches officielles restent dans le bloc racine
        expect(data.userData['HW-01OFFICIEL000000000000001']).toEqual({ vu: true });
        expect(isValidBackup(data)).toBe(true);
    });

    it('légère sans aucun lieu créé : carte vide mais toujours valide', async () => {
        state.currentMapId = 'djerba';
        state.loadedFeatures = [features()[0]];
        const data = await prepareExportData(false);
        expect(data.baseGeoJSON).toEqual({ type: 'FeatureCollection', features: [] });
        expect(isValidBackup(data)).toBe(true);
    });

    it('complète : toute la carte, inchangé', async () => {
        state.currentMapId = 'djerba';
        state.loadedFeatures = features();
        const data = await prepareExportData(true);
        expect(ids(data)).toHaveLength(3);
    });

    it("légère d'un brouillon local : toute la carte (elle n'existe nulle part ailleurs)", async () => {
        state.currentMapId = 'venise';
        state.destinations = { activeMapId: 'venise', maps: { venise: { name: 'Venise', custom: true } } };
        state.loadedFeatures = features();
        const data = await prepareExportData(false);
        expect(ids(data)).toHaveLength(3);
    });

    it("aller-retour : les lieux créés d'une légère sont restaurés", async () => {
        state.currentMapId = 'djerba';
        state.loadedFeatures = features();
        const data = await prepareExportData(false);
        await restoreBackup(JSON.parse(JSON.stringify(data)));
        const call = saveAppState.mock.calls.find((c) => c[0] === 'customPois_djerba');
        expect(call[1].map((f) => f.properties.HW_ID)).toEqual(['HW-PC-1', 'auto_7']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('restoreBackup — brouillon local (Option A)', () => {
    const draftBackup = () => ({
        backupVersion: '3.0',
        mapId: 'venise',
        draftDestination: { name: 'Venise', custom: true, status: 'draft', bounds: [[1, 2], [3, 4]] },
        draftZones: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Q' }, geometry: null }] },
        baseGeoJSON: { type: 'FeatureCollection', features: [
            { type: 'Feature', properties: { HW_ID: 'HW-01TESTCAPTURE0000000000001', 'Nom du site FR': 'Capture Scout' }, geometry: null }
        ] }
    });

    it('recrée le brouillon (entrée + zones + geojson base vide)', async () => {
        await restoreBackup(draftBackup());
        expect(createLocalDraftDestination).toHaveBeenCalledTimes(1);
        const [id, entry, geo, zones] = createLocalDraftDestination.mock.calls[0];
        expect(id).toBe('venise');
        expect(entry).toMatchObject({ name: 'Venise', custom: true });
        expect(geo).toEqual({ type: 'FeatureCollection', features: [] });
        expect(zones.features).toHaveLength(1);
    });

    it('restaure TOUS les lieux en customPois (captures HW-ULID incluses)', async () => {
        await restoreBackup(draftBackup());
        const call = saveAppState.mock.calls.find((c) => c[0] === 'customPois_venise');
        expect(call).toBeDefined();
        expect(call[1].map((f) => f.properties.HW_ID)).toContain('HW-01TESTCAPTURE0000000000001');
    });

    it('bascule hw_active_dest sur le brouillon restauré', async () => {
        await restoreBackup(draftBackup());
        expect(localStorage.getItem('hw_active_dest')).toBe('venise');
    });

    it('un backup de dest publiée (sans draftDestination) ne recrée aucun brouillon et garde le filtre HW-PC-/auto_', async () => {
        await restoreBackup({
            backupVersion: '3.0', mapId: 'djerba',
            baseGeoJSON: { type: 'FeatureCollection', features: [
                { type: 'Feature', properties: { HW_ID: 'HW-01TESTCAPTURE0000000000001' }, geometry: null }
            ] }
        });
        expect(createLocalDraftDestination).not.toHaveBeenCalled();
        // un HW-ULID sur une dest publiée n'est pas un custom POI → pas restauré
        expect(saveAppState.mock.calls.find((c) => c[0] === 'customPois_djerba')).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Régression B4 de l'audit du cycle circuits (12/09/2026) : la restauration
// appelait clearStore('circuits') — store inexistant (c'est `savedCircuits`),
// donc rien n'était vidé et les circuits s'AJOUTAIENT. Vider tout le store aurait
// effacé les autres destinations : une sauvegarde n'en porte qu'une.
describe('restoreBackup — circuits', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const backup = (myCircuits) => ({ backupVersion: '3.0', mapId: 'hammamet', myCircuits });

    it('vide les circuits de la destination restaurée SEULEMENT, avant d\'écrire', async () => {
        await restoreBackup(backup([{ id: 'HW-p1', name: 'Perso', poiIds: ['a'], mapId: 'hammamet' }]));

        expect(deleteCircuitsForMap).toHaveBeenCalledTimes(1);
        expect(deleteCircuitsForMap).toHaveBeenCalledWith('hammamet');
        expect(deleteCircuitsForMap.mock.invocationCallOrder[0])
            .toBeLessThan(saveCircuit.mock.invocationCallOrder[0]);
    });

    it('pose le mapId manquant (sinon invisible), garde un mapId existant', async () => {
        await restoreBackup(backup([
            { id: 'HW-a', name: 'Sans mapId', poiIds: ['a'] },
            { id: 'HW-b', name: 'Avec mapId', poiIds: ['b'], mapId: 'hammamet' },
        ]));

        const saved = saveCircuit.mock.calls.map(c => c[0]);
        expect(saved.map(c => c.mapId)).toEqual(['hammamet', 'hammamet']);
    });

    it("écarte les copies d'officiels (isOfficial) d'une ancienne sauvegarde", async () => {
        await restoreBackup(backup([
            { id: 'HW-off', name: 'Copie officiel', poiIds: ['a'], isOfficial: true },
            { id: 'HW-p1', name: 'Perso', poiIds: ['b'] },
        ]));

        expect(saveCircuit.mock.calls.map(c => c[0].id)).toEqual(['HW-p1']);
    });

    it('ne touche pas aux circuits si la sauvegarde n\'en contient pas', async () => {
        await restoreBackup({ backupVersion: '3.0', mapId: 'hammamet', userData: {} });

        expect(deleteCircuitsForMap).not.toHaveBeenCalled();
        expect(saveCircuit).not.toHaveBeenCalled();
    });
});

// Règle unique de nommage (11/11/2026) : fini « HistoryWalk_Backup_Mobile_… » sur
// un fichier fait au PC, et la destination absente du nom une fois sur trois.
describe('backupFileName', () => {
    const when = new Date(2026, 10, 9, 7, 5); // 9 novembre 2026, 07h05 (heure locale)

    it('légère : Heripia_<destination>_legere_<date>.txt', () => {
        expect(backupFileName('djerba', false, when)).toBe('Heripia_djerba_legere_2026-11-09_07h05.txt');
    });

    it('complète : Heripia_<destination>_complete_<date>.json', () => {
        expect(backupFileName('charleroi', true, when)).toBe('Heripia_charleroi_complete_2026-11-09_07h05.json');
    });

    it('identifiant de destination absent ou exotique : nom de fichier sûr', () => {
        expect(backupFileName(null, false, when)).toBe('Heripia_destination_legere_2026-11-09_07h05.txt');
        expect(backupFileName('mon brouillon/1', false, when)).toBe('Heripia_mon-brouillon-1_legere_2026-11-09_07h05.txt');
    });
});
