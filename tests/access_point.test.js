// @vitest-environment jsdom
// Tests pour src/access-point.js — logique métier point d'accès v2 PR 2/5.
// On teste getAccessPointStatus (pur, sans deps) en isolation.
// prepoSeAccessPoint est testé via mocks complets sur osm-overpass + database + state.
// jsdom requis : la chaîne d'imports access-point.js → database.js → modal.js
// touche document/localStorage au top-level (listeners de délégation).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAccessPointStatus, ACCESS_POINT_THRESHOLD_M } from '../src/access-point.js';

describe('access-point — getAccessPointStatus', () => {
    it('retourne undefined si feature null/sans properties', () => {
        expect(getAccessPointStatus(null)).toBeUndefined();
        expect(getAccessPointStatus(undefined)).toBeUndefined();
        expect(getAccessPointStatus({})).toBeUndefined();
        expect(getAccessPointStatus({ properties: {} })).toBeUndefined();
    });
    it('retourne le status depuis properties si pas de userData', () => {
        const f = { properties: { accessPointStatus: 'osm' } };
        expect(getAccessPointStatus(f)).toBe('osm');
    });
    it('userData prime sur properties (overlay)', () => {
        const f = {
            properties: {
                accessPointStatus: 'osm',
                userData: { accessPointStatus: 'moved' },
            },
        };
        expect(getAccessPointStatus(f)).toBe('moved');
    });
    it('reconnaît les 4 valeurs valides + undefined', () => {
        for (const status of ['osm', 'moved', 'on-track', 'failed', undefined]) {
            const f = { properties: { userData: { accessPointStatus: status } } };
            expect(getAccessPointStatus(f)).toBe(status);
        }
    });
});

describe('access-point — ACCESS_POINT_THRESHOLD_M', () => {
    it('est une constante exportée à 10 m (cf. brief Design)', () => {
        expect(ACCESS_POINT_THRESHOLD_M).toBe(10);
    });
});

describe('access-point — prepoSeAccessPoint (mocks complets)', () => {
    let state, mocks;

    beforeEach(async () => {
        // Reset state.userData entre tests + mocks frais sur chaque dependance.
        vi.resetModules();
        const stateMod = await import('../src/state.js');
        state = stateMod.state;
        state.userData = {};
        state.currentMapId = 'djerba';
        state.loadedFeatures = [];

        mocks = {
            nearestHighway: vi.fn(),
            getCachedNearestWay: vi.fn().mockResolvedValue(null),
            setCachedNearestWay: vi.fn().mockResolvedValue(undefined),
            savePoiData: vi.fn().mockResolvedValue(undefined),
            schedulePush: vi.fn(),
        };
        vi.doMock('../src/osm-overpass.js', () => ({ nearestHighway: mocks.nearestHighway }));
        vi.doMock('../src/database.js', () => ({
            getCachedNearestWay: mocks.getCachedNearestWay,
            setCachedNearestWay: mocks.setCachedNearestWay,
            savePoiData: mocks.savePoiData,
        }));
        vi.doMock('../src/gist-sync.js', () => ({ schedulePush: mocks.schedulePush }));
    });
    afterEach(() => {
        vi.doUnmock('../src/osm-overpass.js');
        vi.doUnmock('../src/database.js');
        vi.doUnmock('../src/gist-sync.js');
    });

    function makeFeature(id, lon, lat) {
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: { HW_ID: id },
        };
    }

    it("status='osm' quand voie trouvée au-delà du seuil", async () => {
        mocks.nearestHighway.mockResolvedValue({ coords: [10.95, 33.81], distance: 18 });
        const { prepoSeAccessPoint } = await import('../src/access-point.js');
        const r = await prepoSeAccessPoint(makeFeature('POI1', 10.9457, 33.8076));
        expect(r.status).toBe('osm');
        expect(r.coords).toEqual([10.95, 33.81]);
        expect(state.userData.POI1.accessPoint).toEqual([10.95, 33.81]);
        expect(state.userData.POI1.accessPointStatus).toBe('osm');
    });

    it("status='on-track' quand voie trouvée DANS le seuil (POI sur voie)", async () => {
        mocks.nearestHighway.mockResolvedValue({ coords: [10.95, 33.81], distance: 8 });
        const { prepoSeAccessPoint } = await import('../src/access-point.js');
        const r = await prepoSeAccessPoint(makeFeature('POI2', 10.95, 33.81));
        expect(r.status).toBe('on-track');
        expect(r.coords).toBeNull();
        expect(state.userData.POI2.accessPoint).toBeNull();
        expect(state.userData.POI2.accessPointStatus).toBe('on-track');
    });

    it("status='failed' quand Overpass renvoie aucune voie (réponse null)", async () => {
        mocks.nearestHighway.mockResolvedValue(null);
        const { prepoSeAccessPoint } = await import('../src/access-point.js');
        const r = await prepoSeAccessPoint(makeFeature('POI3', 0, 0));
        expect(r.status).toBe('failed');
        expect(state.userData.POI3.accessPointStatus).toBe('failed');
    });

    it("status='failed' quand Overpass throws (réseau/timeout)", async () => {
        mocks.nearestHighway.mockRejectedValue(new Error('Network down'));
        const { prepoSeAccessPoint } = await import('../src/access-point.js');
        const r = await prepoSeAccessPoint(makeFeature('POI4', 0, 0));
        expect(r.status).toBe('failed');
        expect(r.error).toBeInstanceOf(Error);
        expect(state.userData.POI4.accessPointStatus).toBe('failed');
    });

    it('utilise le cache si présent (pas de fetch Overpass)', async () => {
        mocks.getCachedNearestWay.mockResolvedValue({ coords: [10.95, 33.81], distance: 22, fetchedAt: 1 });
        const { prepoSeAccessPoint } = await import('../src/access-point.js');
        const r = await prepoSeAccessPoint(makeFeature('POI5', 10.94, 33.80));
        expect(mocks.nearestHighway).not.toHaveBeenCalled();
        expect(r.status).toBe('osm');
        expect(r.distance).toBe(22);
    });

    it('force:true ignore le cache et re-fetch', async () => {
        mocks.getCachedNearestWay.mockResolvedValue({ coords: [10.95, 33.81], distance: 22, fetchedAt: 1 });
        mocks.nearestHighway.mockResolvedValue({ coords: [10.96, 33.82], distance: 15 });
        const { prepoSeAccessPoint } = await import('../src/access-point.js');
        const r = await prepoSeAccessPoint(makeFeature('POI6', 10.94, 33.80), { force: true });
        expect(mocks.nearestHighway).toHaveBeenCalledTimes(1);
        expect(r.coords).toEqual([10.96, 33.82]); // valeur fraîche, pas le cache
    });

    it('throws si feature invalide (pas de coords)', async () => {
        const { prepoSeAccessPoint } = await import('../src/access-point.js');
        await expect(prepoSeAccessPoint({ properties: { HW_ID: 'X' } }))
            .rejects.toThrow('Feature POI invalide');
    });
});
