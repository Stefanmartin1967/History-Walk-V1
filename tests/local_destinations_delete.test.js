// @vitest-environment jsdom
//
// Option A — deleteLocalDraftDestination : suppression d'un brouillon LOCAL de
// destination. On teste la LOGIQUE de purge (entrée draftDestinations, clés
// appState de la carte, données IDB par mapId, boîte de scan localStorage, reflet
// mémoire) en moquant database.js. Aucune écriture IDB réelle.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/database.js', () => ({
    getAppState: vi.fn(),
    saveAppState: vi.fn(async () => {}),
    deleteAppState: vi.fn(async () => {}),
    deleteAllMapData: vi.fn(async () => ({ poiUserData: 0, savedCircuits: 0, poiPhotos: 0, osmNearestWay: 0 })),
}));

import { deleteLocalDraftDestination } from '../src/local-destinations.js';
import { getAppState, saveAppState, deleteAppState, deleteAllMapData } from '../src/database.js';
import { state } from '../src/state.js';

beforeEach(() => {
    vi.clearAllMocks();
    // getDraftDestinations() lit getAppState('draftDestinations').
    getAppState.mockResolvedValue({
        hammamet: { name: 'Hammamet', custom: true, status: 'draft' },
        sousse: { name: 'Sousse', custom: true, status: 'draft' },
    });
    state.destinations = { activeMapId: 'djerba', maps: {
        djerba: { name: 'Djerba', status: 'published' },
        hammamet: { name: 'Hammamet', custom: true, status: 'draft' },
        sousse: { name: 'Sousse', custom: true, status: 'draft' },
    } };
    localStorage.setItem('scout_box_hammamet', '{"north":1}');
});

describe('deleteLocalDraftDestination — suppression brouillon local (Option A)', () => {
    it('retire l\'entrée de draftDestinations sans toucher les autres brouillons', async () => {
        await deleteLocalDraftDestination('hammamet');
        const call = saveAppState.mock.calls.find((c) => c[0] === 'draftDestinations');
        expect(call).toBeDefined();
        expect(Object.keys(call[1])).toEqual(['sousse']); // hammamet retiré, sousse conservé
    });

    it('supprime les clés appState dédiées à la carte', async () => {
        await deleteLocalDraftDestination('hammamet');
        const deleted = deleteAppState.mock.calls.map((c) => c[0]);
        expect(deleted).toEqual(expect.arrayContaining([
            'draftGeoJSON_hammamet', 'draftZones_hammamet', 'customPois_hammamet',
            'lastGeoJSON_hammamet', 'lastGeoJSON_etag_hammamet',
            'lastZones_hammamet', 'lastZones_etag_hammamet',
        ]));
    });

    it('purge toutes les données IDB indexées par mapId (userData/circuits/photos/OSM)', async () => {
        await deleteLocalDraftDestination('hammamet');
        expect(deleteAllMapData).toHaveBeenCalledWith('hammamet');
    });

    it('retire la boîte de scan localStorage', async () => {
        await deleteLocalDraftDestination('hammamet');
        expect(localStorage.getItem('scout_box_hammamet')).toBeNull();
    });

    it('retire la dest de state.destinations.maps (reflet mémoire), garde Djerba', async () => {
        await deleteLocalDraftDestination('hammamet');
        expect(state.destinations.maps.hammamet).toBeUndefined();
        expect(state.destinations.maps.djerba).toBeDefined();
        expect(state.destinations.maps.sousse).toBeDefined();
    });

    it('no-op si id vide (aucune écriture)', async () => {
        await deleteLocalDraftDestination('');
        expect(saveAppState).not.toHaveBeenCalled();
        expect(deleteAppState).not.toHaveBeenCalled();
        expect(deleteAllMapData).not.toHaveBeenCalled();
    });
});
