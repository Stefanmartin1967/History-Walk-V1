// @vitest-environment jsdom
//
// C2b — publishDraftToGitHub : on teste la LOGIQUE (validation, lecture/modif de
// destinations.json, ordre + chemins des 4 push, purge des clés perso) en moquant
// uploadFileToGitHub + le brouillon local. AUCUN push réel vers GitHub.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn(() => 'ghp_test'),
    uploadFileToGitHub: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../src/local-destinations.js', () => ({
    getDraftDestinations: vi.fn(),
    getDraftGeoJSON: vi.fn(),
    getDraftZones: vi.fn(),
    markLocalDraftPublished: vi.fn(async () => {}),
}));

import { publishDraftToGitHub } from '../src/publish-destination.js';
import { getStoredToken, uploadFileToGitHub } from '../src/github-sync.js';
import {
    getDraftDestinations, getDraftGeoJSON, getDraftZones, markLocalDraftPublished,
} from '../src/local-destinations.js';

// destinations.json tel que renvoyé par la Contents API (content = base64 UTF-8).
function stubDestFetch(json) {
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(json))));
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ content: b64, sha: 'sha-dest' }),
    })));
}

const BASE_DEST = {
    activeMapId: 'djerba',
    maps: { djerba: { name: 'Djerba', status: 'published', file: 'djerba.geojson' } },
};

// jsdom File hérite de Blob → .text() ; fallback FileReader au cas où.
async function fileText(file) {
    if (typeof file.text === 'function') return file.text();
    return new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsText(file);
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    getStoredToken.mockReturnValue('ghp_test');
    getDraftDestinations.mockResolvedValue({
        venise: {
            name: 'Venise', status: 'draft', custom: true,
            bounds: [[45.4, 12.3], [45.5, 12.4]], currency: 'EUR',
            startView: { center: [45.45, 12.35], zoom: 13 },
            file: null, zonesFile: null, circuitsFile: null,
        },
    });
    getDraftGeoJSON.mockResolvedValue({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: { 'Nom du site FR': 'Pont', 'Catégorie': 'patrimoine', candidate: true, vu: true, notes: 'perso' },
            geometry: { type: 'Point', coordinates: [12.35, 45.45] },
        }],
    });
    getDraftZones.mockResolvedValue({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { name: 'Zone A' }, geometry: { type: 'Polygon', coordinates: [] } }],
    });
    stubDestFetch(BASE_DEST);
});

describe('publishDraftToGitHub — C2b', () => {
    it('pousse 4 fichiers dans l\'ordre data → index → destinations.json', async () => {
        const res = await publishDraftToGitHub('venise');
        expect(uploadFileToGitHub).toHaveBeenCalledTimes(4);
        const paths = uploadFileToGitHub.mock.calls.map((c) => c[4]); // 5e arg = path
        expect(paths).toEqual([
            'public/venise.geojson',
            'public/venise-zones.geojson',
            'public/circuits/venise.json',
            'public/destinations.json',
        ]);
        expect(res).toMatchObject({ id: 'venise', name: 'Venise', pois: 1, zones: 1 });
        expect(markLocalDraftPublished).toHaveBeenCalledWith('venise');
    });

    it('écrit l\'entrée en status:"draft" (chemins canoniques) sans toucher djerba', async () => {
        await publishDraftToGitHub('venise');
        const destFile = uploadFileToGitHub.mock.calls[3][0];
        const json = JSON.parse(await fileText(destFile));
        expect(json.maps.venise).toMatchObject({
            name: 'Venise', status: 'draft',
            file: 'venise.geojson', zonesFile: 'venise-zones.geojson', circuitsFile: 'circuits/venise.json',
            currency: 'EUR',
        });
        expect(json.maps.venise.startView).toEqual({ center: [45.45, 12.35], zoom: 13 });
        expect(json.maps.djerba.status).toBe('published'); // intact
    });

    it('retire les clés personnelles mais conserve candidate:true', async () => {
        await publishDraftToGitHub('venise');
        const geoFile = uploadFileToGitHub.mock.calls[0][0];
        const props = JSON.parse(await fileText(geoFile)).features[0].properties;
        expect(props.vu).toBeUndefined();
        expect(props.notes).toBeUndefined();
        expect(props.candidate).toBe(true);
        expect(props['Nom du site FR']).toBe('Pont');
    });

    it('l\'index des circuits est un tableau vide', async () => {
        await publishDraftToGitHub('venise');
        const idxFile = uploadFileToGitHub.mock.calls[2][0];
        expect(JSON.parse(await fileText(idxFile))).toEqual([]);
    });

    it('refuse sans token (aucun push)', async () => {
        getStoredToken.mockReturnValue(null);
        await expect(publishDraftToGitHub('venise')).rejects.toThrow(/token/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('refuse un brouillon vide (aucun push)', async () => {
        getDraftGeoJSON.mockResolvedValue({ type: 'FeatureCollection', features: [] });
        await expect(publishDraftToGitHub('venise')).rejects.toThrow(/aucun lieu/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('refuse si l\'id est déjà PUBLIÉ sur GitHub (aucun push)', async () => {
        stubDestFetch({ activeMapId: 'djerba', maps: { venise: { name: 'Venise', status: 'published' } } });
        await expect(publishDraftToGitHub('venise')).rejects.toThrow(/déjà publiée/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('autorise la re-publication d\'un brouillon déjà en draft sur GitHub', async () => {
        stubDestFetch({ activeMapId: 'djerba', maps: { venise: { name: 'Venise', status: 'draft' } } });
        await expect(publishDraftToGitHub('venise')).resolves.toMatchObject({ id: 'venise' });
        expect(uploadFileToGitHub).toHaveBeenCalledTimes(4);
    });
});
