// @vitest-environment jsdom
//
// MODÈLE C — cycle de vie GitHub d'une destination. On teste la LOGIQUE (validation,
// lecture/modif de destinations.json, ordre + chemins des push, contenu publié,
// garde-fou candidat) des 3 écritures, en moquant uploadFileToGitHub/deleteFileFromGitHub.
// AUCUN appel réel vers GitHub :
//   - registerDraftDestinationOnGitHub (création, status:draft, destinations.json EN DERNIER) ;
//   - setDestinationPublished (« Rendre publique » : geojson épuré + status flip) ;
//   - deleteDraftFromGitHub (suppression : entrée EN PREMIER, puis fichiers).
//
// Le geojson publié vient de generateMasterGeoJSONData (état AFFICHÉ : state.loadedFeatures
// + overlay userData) — VRAI générateur (admin-geojson.js, pur) sur un state peuplé.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn(() => 'ghp_test'),
    uploadFileToGitHub: vi.fn(async () => ({ ok: true })),
    deleteFileFromGitHub: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../src/database.js', () => ({
    saveAppState: vi.fn(async () => {}),
    getAppState: vi.fn(async () => null),
}));

import { registerDraftDestinationOnGitHub, setDestinationPublished, deleteDraftFromGitHub } from '../src/publish-destination.js';
import { saveAppState } from '../src/database.js';
import { getStoredToken, uploadFileToGitHub, deleteFileFromGitHub } from '../src/github-sync.js';
import { state } from '../src/state.js';

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

// L'état AFFICHÉ d'un brouillon LOCAL prêt à publier :
// — Pont : candidat CURÉ via overlay (userData.candidate=false) + renommé + clés perso.
// — Fontaine : POI curé (aucun flag candidate) — capture déjà validée.
// — Ruine OSM : candidat NON curé (candidate:true) → écarté du public + gardé en local.
// — Vieille citerne : SUPPRIMÉE (userData._deleted) → exclue.
function makeDraftFeatures() {
    return [
        {
            type: 'Feature',
            properties: {
                HW_ID: 'HW-01TESTPONT0000000000000001',
                'Nom du site FR': 'Pont', 'Catégorie': 'patrimoine', candidate: true,
                vu: true,
                userData: { 'Nom du site FR': 'Pont des Soupirs', candidate: false, notes: 'perso' },
            },
            geometry: { type: 'Point', coordinates: [12.35, 45.45] },
        },
        {
            type: 'Feature',
            properties: {
                HW_ID: 'HW-01TESTFONTAINE000000000001',
                'Nom du site FR': 'Fontaine', 'Catégorie': 'patrimoine',
            },
            geometry: { type: 'Point', coordinates: [12.36, 45.46] },
        },
        {
            type: 'Feature',
            properties: {
                HW_ID: 'HW-01TESTRUINE0000000000000001',
                'Nom du site FR': 'Ruine OSM', 'Catégorie': 'patrimoine', candidate: true,
            },
            geometry: { type: 'Point', coordinates: [12.37, 45.47] },
        },
        {
            type: 'Feature',
            properties: {
                HW_ID: 'HW-01TESTCITERNE000000000001',
                'Nom du site FR': 'Vieille citerne', 'Catégorie': 'patrimoine',
                userData: { _deleted: true },
            },
            geometry: { type: 'Point', coordinates: [12.38, 45.48] },
        },
    ];
}

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
    stubDestFetch(BASE_DEST);
    // Destination ACTIVE, avec son état affiché (les describes spécifiques l'écrasent).
    state.currentMapId = 'venise';
    state.customFeatures = [];
    state.hiddenPoiIds = [];
    state.destinations = { activeMapId: 'venise', maps: { venise: { name: 'Venise', status: 'draft' } } };
    state.loadedFeatures = makeDraftFeatures();
});

// ── MODÈLE C (PR-4a) ─────────────────────────────────────────────────────────
describe('registerDraftDestinationOnGitHub — création GitHub-first (status:draft)', () => {
    const ENTRY = {
        name: 'Sozopol', bounds: [[42.4, 27.6], [42.5, 27.8]],
        startView: { center: [42.42, 27.7], zoom: 13 }, currency: '', country: 'bg',
    };
    const ZONES = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Z1' }, geometry: { type: 'Polygon', coordinates: [] } }] };

    it('pousse 4 fichiers : geojson → zones → index circuits → destinations.json EN DERNIER', async () => {
        stubDestFetch(BASE_DEST); // ne contient que djerba
        await registerDraftDestinationOnGitHub('sozopol', ENTRY, ZONES);
        expect(uploadFileToGitHub).toHaveBeenCalledTimes(4);
        const paths = uploadFileToGitHub.mock.calls.map((c) => c[4]);
        expect(paths).toEqual([
            'public/sozopol.geojson',
            'public/sozopol-zones.geojson',
            'public/circuits/sozopol.json',
            'public/destinations.json',
        ]);
    });

    it('le geojson poussé est VIDE et l\'entrée destinations.json est status:draft (schéma complet)', async () => {
        stubDestFetch(BASE_DEST);
        await registerDraftDestinationOnGitHub('sozopol', ENTRY, ZONES);
        const geo = JSON.parse(await fileText(uploadFileToGitHub.mock.calls[0][0]));
        expect(geo.features).toEqual([]);
        const dest = JSON.parse(await fileText(uploadFileToGitHub.mock.calls[3][0]));
        expect(dest.maps.djerba).toBeDefined(); // intact
        expect(dest.maps.sozopol).toMatchObject({
            name: 'Sozopol', status: 'draft',
            file: 'sozopol.geojson', circuitsFile: 'circuits/sozopol.json', zonesFile: 'sozopol-zones.geojson',
            country: 'bg',
        });
    });

    it('retourne { id, name, entry } avec l\'entrée draft construite', async () => {
        stubDestFetch(BASE_DEST);
        const res = await registerDraftDestinationOnGitHub('sozopol', ENTRY, ZONES);
        expect(res).toMatchObject({ id: 'sozopol', name: 'Sozopol' });
        expect(res.entry.status).toBe('draft');
    });

    it('refuse sans token (aucun push)', async () => {
        getStoredToken.mockReturnValue(null);
        await expect(registerDraftDestinationOnGitHub('sozopol', ENTRY, ZONES)).rejects.toThrow(/token/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('refuse si l\'id existe DÉJÀ sur GitHub (collision réseau — filet d\'unicité)', async () => {
        stubDestFetch({ activeMapId: 'djerba', maps: { djerba: { status: 'published' }, sozopol: { status: 'draft' } } });
        await expect(registerDraftDestinationOnGitHub('sozopol', ENTRY, ZONES)).rejects.toThrow(/existe déjà/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });
});

describe('setDestinationPublished — « Rendre publique » (draft → published)', () => {
    beforeEach(() => {
        // La dest à publier est ACTIVE, avec son état affiché (lieux curés + candidat).
        state.currentMapId = 'sozopol';
        state.customFeatures = [];
        state.loadedFeatures = makeDraftFeatures();
        state.destinations = { activeMapId: 'sozopol', maps: { sozopol: { name: 'Sozopol', status: 'draft' } } };
        stubDestFetch({ activeMapId: 'djerba', maps: { djerba: { status: 'published' }, sozopol: { name: 'Sozopol', status: 'draft' } } });
    });

    it('pousse le geojson ÉPURÉ (candidats exclus) PUIS destinations.json (status flip)', async () => {
        const res = await setDestinationPublished('sozopol');
        expect(uploadFileToGitHub).toHaveBeenCalledTimes(2);
        const paths = uploadFileToGitHub.mock.calls.map((c) => c[4]);
        expect(paths).toEqual(['public/sozopol.geojson', 'public/destinations.json']); // geojson AVANT destinations.json
        const geo = JSON.parse(await fileText(uploadFileToGitHub.mock.calls[0][0]));
        const names = geo.features.map((f) => f.properties['Nom du site FR']);
        expect(names).toContain('Pont des Soupirs'); // curé (overlay) → publié
        expect(names).toContain('Fontaine');         // curé → publié
        expect(names).not.toContain('Ruine OSM');     // candidat non curé → EXCLU
        expect(names).not.toContain('Vieille citerne'); // supprimé → exclu
        const dest = JSON.parse(await fileText(uploadFileToGitHub.mock.calls[1][0]));
        expect(dest.maps.sozopol.status).toBe('published');
        expect(res).toMatchObject({ id: 'sozopol', name: 'Sozopol', pois: 2, candidatesKept: 1 });
    });

    it('met de côté les candidats non curés en local (customPois) avant publication', async () => {
        await setDestinationPublished('sozopol');
        expect(saveAppState).toHaveBeenCalledWith('customPois_sozopol', expect.arrayContaining([
            expect.objectContaining({ properties: expect.objectContaining({ HW_ID: 'HW-01TESTRUINE0000000000000001' }) }),
        ]));
    });

    it('exclut un candidat SUPPRIMÉ (hiddenPoiIds) de la mise de côté — pas de résurrection au reload', async () => {
        // « Ruine OSM » (candidat) a été SUPPRIMÉE en curation → masquée via hiddenPoiIds
        // sans être retirée de loadedFeatures (deletePoi). Sans le garde, la mise de côté
        // la ré-injecterait dans customPois → elle ressusciterait « à curer » au reload.
        state.hiddenPoiIds = ['HW-01TESTRUINE0000000000000001'];
        const res = await setDestinationPublished('sozopol');
        // Le seul candidat étant supprimé → aucune mise de côté (pas d'écriture customPois).
        const customCall = saveAppState.mock.calls.find((c) => c[0] === 'customPois_sozopol');
        const setAsideIds = customCall ? customCall[1].map((f) => f.properties.HW_ID) : [];
        expect(setAsideIds).not.toContain('HW-01TESTRUINE0000000000000001');
        expect(res.candidatesKept).toBe(0);
        // Toujours absente du geojson public (candidat → épuré dans tous les cas).
        const geo = JSON.parse(await fileText(uploadFileToGitHub.mock.calls[0][0]));
        expect(geo.features.map((f) => f.properties['Nom du site FR'])).not.toContain('Ruine OSM');
    });

    it('reflet mémoire : status=published ET custom=false', async () => {
        state.destinations.maps.sozopol.custom = true; // résidu éventuel
        await setDestinationPublished('sozopol');
        expect(state.destinations.maps.sozopol.status).toBe('published');
        expect(state.destinations.maps.sozopol.custom).toBe(false);
    });

    it('refuse si la destination n\'est pas active (aucun push)', async () => {
        state.currentMapId = 'djerba';
        await expect(setDestinationPublished('sozopol')).rejects.toThrow(/active/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('refuse s\'il n\'y a aucun lieu CURÉ (évite une dest publique à 0 lieu)', async () => {
        // Que des candidats non curés + un supprimé → 0 lieu publiable.
        state.loadedFeatures = makeDraftFeatures().filter((f) =>
            ['HW-01TESTRUINE0000000000000001', 'HW-01TESTCITERNE000000000001'].includes(f.properties.HW_ID));
        await expect(setDestinationPublished('sozopol')).rejects.toThrow(/aucun lieu/i);
    });

    it('refuse sans token / si introuvable / si déjà publiée (aucun push)', async () => {
        getStoredToken.mockReturnValue(null);
        await expect(setDestinationPublished('sozopol')).rejects.toThrow(/token/i);

        getStoredToken.mockReturnValue('ghp_test');
        stubDestFetch({ activeMapId: 'djerba', maps: { djerba: { status: 'published' } } });
        await expect(setDestinationPublished('sozopol')).rejects.toThrow(/introuvable/i);

        stubDestFetch({ activeMapId: 'djerba', maps: { sozopol: { name: 'Sozopol', status: 'published' } } });
        await expect(setDestinationPublished('sozopol')).rejects.toThrow(/déjà publiée/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });
});

describe('deleteDraftFromGitHub — suppression d\'un brouillon GitHub (PR-4b-1)', () => {
    it('retire l\'entrée destinations.json EN PREMIER, puis supprime les fichiers (geojson/zones/index/tested)', async () => {
        stubDestFetch({ activeMapId: 'djerba', maps: { djerba: { status: 'published' }, sozopol: { name: 'Sozopol', status: 'draft' } } });
        const res = await deleteDraftFromGitHub('sozopol');

        // 1 push destinations.json (sans l'entrée sozopol).
        expect(uploadFileToGitHub).toHaveBeenCalledTimes(1);
        expect(uploadFileToGitHub.mock.calls[0][4]).toBe('public/destinations.json');
        const dest = JSON.parse(await fileText(uploadFileToGitHub.mock.calls[0][0]));
        expect(dest.maps.sozopol).toBeUndefined();
        expect(dest.maps.djerba).toBeDefined(); // intact

        // Suppressions de fichiers, APRÈS le push de destinations.json. tested_{id}.json
        // inclus (un brouillon a pu le pousser via un circuit marqué « Fait »).
        const delPaths = deleteFileFromGitHub.mock.calls.map((c) => c[3]);
        expect(delPaths).toEqual([
            'public/sozopol.geojson',
            'public/sozopol-zones.geojson',
            'public/circuits/sozopol.json',
            'public/circuits/tested_sozopol.json',
        ]);
        // Ordre : destinations.json (upload) AVANT toute suppression de fichier.
        expect(uploadFileToGitHub.mock.invocationCallOrder[0])
            .toBeLessThan(deleteFileFromGitHub.mock.invocationCallOrder[0]);
        expect(res).toMatchObject({ id: 'sozopol', name: 'Sozopol', removedFromGitHub: true });
    });

    it('refuse de supprimer une destination PUBLIÉE (aucun push/suppression)', async () => {
        stubDestFetch({ activeMapId: 'djerba', maps: { djerba: { name: 'Djerba', status: 'published' } } });
        await expect(deleteDraftFromGitHub('djerba')).rejects.toThrow(/publiée/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
        expect(deleteFileFromGitHub).not.toHaveBeenCalled();
    });

    it('no-op GitHub si l\'id n\'est pas sur GitHub (résidu purement local)', async () => {
        stubDestFetch({ activeMapId: 'djerba', maps: { djerba: { status: 'published' } } });
        const res = await deleteDraftFromGitHub('hammamet');
        expect(res).toEqual({ id: 'hammamet', removedFromGitHub: false });
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
        expect(deleteFileFromGitHub).not.toHaveBeenCalled();
    });

    it('refuse sans token (aucun push/suppression)', async () => {
        getStoredToken.mockReturnValue(null);
        await expect(deleteDraftFromGitHub('sozopol')).rejects.toThrow(/token/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
        expect(deleteFileFromGitHub).not.toHaveBeenCalled();
    });

    it('une suppression de fichier en échec ne bloque pas (best-effort)', async () => {
        stubDestFetch({ activeMapId: 'djerba', maps: { sozopol: { name: 'Sozopol', status: 'draft' } } });
        deleteFileFromGitHub.mockRejectedValueOnce(new Error('404 not found'));
        const res = await deleteDraftFromGitHub('sozopol');
        expect(res.removedFromGitHub).toBe(true); // l'entrée a bien été retirée
        expect(deleteFileFromGitHub).toHaveBeenCalledTimes(4); // on tente les 4 malgré l'échec du 1er
    });
});
