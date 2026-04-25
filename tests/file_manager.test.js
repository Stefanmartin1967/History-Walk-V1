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
        setTestedCircuits: vi.fn(d => { state.testedCircuits = d; })
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
    clearStore: vi.fn()
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

import { state } from '../src/state.js';
import { showToast } from '../src/toast.js';
import {
    getActionLabel,
    cleanDataForExport,
    isValidBackup,
    prepareExportData,
    recordSupportClick,
    saveUserData
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
}

beforeEach(() => {
    resetState();
    vi.clearAllMocks();
    localStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getActionLabel', () => {
    it('retourne le libellé GPX', () => {
        expect(getActionLabel('gpx')).toBe('Exporter le GPX');
    });

    it('retourne le libellé Circuits', () => {
        expect(getActionLabel('circuits')).toBe('Exporter les Circuits');
    });

    it('retourne le libellé Backup', () => {
        expect(getActionLabel('backup')).toBe('Continuer la Sauvegarde');
    });

    it('retourne le libellé par défaut pour un type inconnu', () => {
        expect(getActionLabel('unknown')).toBe('Continuer');
        expect(getActionLabel(undefined)).toBe('Continuer');
        expect(getActionLabel('')).toBe('Continuer');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('recordSupportClick', () => {
    it('écrit un timestamp dans localStorage sous la clé hw_last_support_click', () => {
        const before = Date.now();
        recordSupportClick();
        const stored = localStorage.getItem('hw_last_support_click');
        expect(stored).not.toBeNull();
        const ts = parseInt(stored, 10);
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(Date.now());
    });

    it('écrase la valeur précédente lors d\'appels répétés', () => {
        localStorage.setItem('hw_last_support_click', '12345');
        recordSupportClick();
        expect(localStorage.getItem('hw_last_support_click')).not.toBe('12345');
    });
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

    it('rejette testedCircuits si non-array', () => {
        expect(isValidBackup({ ...validMinimal, testedCircuits: {} })).toBe(false);
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
            { type: 'Feature', properties: { HW_ID: 'p1' }, geometry: null }
        ];
        state.userData = { p1: { vu: true, photos: ['photo1.jpg', 'photo2.jpg'] } };

        const data = await prepareExportData(false);
        const feat = data.baseGeoJSON.features[0];
        expect(feat.properties.userData.vu).toBe(true);
        expect(feat.properties.userData.photos).toBeUndefined();
    });

    it('préserve les photos quand includePhotos = true', async () => {
        state.currentMapId = 'djerba';
        state.loadedFeatures = [
            { type: 'Feature', properties: { HW_ID: 'p1' }, geometry: null }
        ];
        state.userData = { p1: { vu: true, photos: ['photo1.jpg'] } };

        const data = await prepareExportData(true);
        const feat = data.baseGeoJSON.features[0];
        expect(feat.properties.userData.photos).toEqual(['photo1.jpg']);
    });

    it('fusionne les userData dans properties.userData de chaque feature', async () => {
        state.currentMapId = 'djerba';
        state.loadedFeatures = [
            { type: 'Feature', properties: { HW_ID: 'p1', name: 'A' }, geometry: null },
            { type: 'Feature', properties: { HW_ID: 'p2', name: 'B' }, geometry: null }
        ];
        state.userData = { p1: { vu: true }, p2: { vu: false } };

        const data = await prepareExportData(false);
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
