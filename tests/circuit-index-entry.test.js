import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test du builder d'entrée d'index circuit (buildCircuitIndexEntry). Le format
// DOIT matcher scripts/generate-circuit-index.js (sinon drift entre l'index
// commité côté client et l'index régénéré par l'Action). On mocke toutes les
// dépendances de admin-control-center.js pour pouvoir l'importer ; getRealDistance
// est mocké à une valeur connue (le calcul Haversine réel est couvert ailleurs).
const h = vi.hoisted(() => ({ realDistance: 7200 }));

vi.mock('../src/state.js', () => ({ state: {}, setUserData: vi.fn() }));
vi.mock('../src/utils.js', () => ({
    getPoiId: (f) => f?.properties?.HW_ID,
    getRealDistance: () => h.realDistance,
    // Dégel de Zone : buildCircuitIndexEntry lit la zone du 1er POI via getDerivedZone.
    // En test (zones non chargées) il retombe sur la valeur stockée (overlay-aware).
    getDerivedZone: (f) => {
        const p = f?.properties;
        const v = p?.userData?.Zone !== undefined ? p.userData.Zone : p?.Zone;
        return (v || '').toString();
    },
}));
vi.mock('../src/gpx.js', () => ({ generateGPXString: vi.fn(() => '<gpx/>') }));
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/admin-geojson.js', () => ({ generateMasterGeoJSONData: vi.fn() }));
vi.mock('../src/github-sync.js', () => ({ uploadFileToGitHub: vi.fn(), deleteFileFromGitHub: vi.fn(), getStoredToken: vi.fn() }));
vi.mock('../src/config.js', () => ({
    GITHUB_OWNER: 'o', GITHUB_REPO: 'r', RAW_BASE: 'https://x',
    GITHUB_PATHS: { geojson: () => 'g', circuits: () => 'c', tested: () => 't' },
    PERSONAL_KEYS: [],
}));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn(), closeModal: vi.fn() }));
vi.mock('../src/database.js', () => ({
    saveAppState: vi.fn(), getAppState: vi.fn(), getPendingAdminPhotos: vi.fn(),
    setPendingAdminPhotos: vi.fn(), clearPendingAdminPhotos: vi.fn(), deletePoiData: vi.fn(),
}));
vi.mock('../src/photo-service.js', () => ({ uploadPhotoForPoi: vi.fn() }));
vi.mock('../src/admin-diff-engine.js', () => ({
    reconcileLocalChanges: vi.fn(), prepareDiffData: vi.fn(), purgeOrphanPendingPois: vi.fn(), purgeOrphanPendingCircuits: vi.fn(() => []),
    diffData: { pois: [], circuits: [], stats: {}, pendingPhotos: {}, originalFeatures: [] },
}));
vi.mock('../src/admin-control-ui.js', () => ({ openControlCenterModal: vi.fn(), renderTab: vi.fn() }));

import { buildCircuitIndexEntry } from '../src/admin-control-center.js';

describe('buildCircuitIndexEntry — format index circuit', () => {
    beforeEach(() => { h.realDistance = 7200; });

    it('produit une entrée au format attendu (aligné sur le script)', () => {
        const circuit = { id: 'HW-X', name: 'Boucle du Rym', description: 'desc perso', realTrack: [[1, 2], [3, 4]], poiIds: ['p1', 'p2'] };
        const features = [{ properties: { Zone: 'Taguermess' } }];
        const e = buildCircuitIndexEntry(circuit, features, 'djerba');

        expect(e.id).toBe('HW-X');
        expect(e.name).toBe('Boucle du Rym');
        expect(e.file).toBe('djerba/Boucle du Rym.gpx');           // <mapId>/<nom>.gpx
        expect(e.distance).toBe('7.2 km');                          // 7200 m → "7.2 km"
        expect(e.isOfficial).toBe(true);
        expect(e.hasRealTrack).toBe(true);
        expect(e.zone).toBe('Taguermess');                         // Zone du 1er POI
        expect(e.poiIds).toEqual(['p1', 'p2']);
        // Le script lit le <desc> de metadata (hardcodé par generateGPXString),
        // donc l'index porte toujours cette constante (pas la desc perso).
        expect(e.description).toBe('Circuit généré par Heripia — heripia.com');
    });

    it('formate la distance en km à 1 décimale', () => {
        h.realDistance = 12000;
        const e = buildCircuitIndexEntry({ id: 'i', name: 'n', poiIds: [] }, [], 'djerba');
        expect(e.distance).toBe('12.0 km');
    });

    it('omet `zone` si le 1er POI n\'a pas de Zone', () => {
        const e = buildCircuitIndexEntry({ id: 'i', name: 'n', poiIds: [] }, [{ properties: {} }], 'djerba');
        expect('zone' in e).toBe(false);
    });

    it('omet `zone` s\'il n\'y a aucun POI résolu', () => {
        const e = buildCircuitIndexEntry({ id: 'i', name: 'n', poiIds: [] }, [], 'djerba');
        expect('zone' in e).toBe(false);
    });

    it('respecte le mapId dans le chemin du fichier', () => {
        const e = buildCircuitIndexEntry({ id: 'i', name: 'Mon Circuit', poiIds: [] }, [], 'hammamet');
        expect(e.file).toBe('hammamet/Mon Circuit.gpx');
    });

    it('dédoublonne les poiIds (circuit en boucle) pour matcher l\'Action', () => {
        // Boucle : étape 1 = étape 4 (retour au départ) → poiIds [A,B,C,A].
        // generate-circuit-index.js dédoublonne via Set → [A,B,C]. On aligne.
        const e = buildCircuitIndexEntry(
            { id: 'i', name: 'Boucle', poiIds: ['A', 'B', 'C', 'A'] }, [], 'djerba'
        );
        expect(e.poiIds).toEqual(['A', 'B', 'C']);
    });
});
