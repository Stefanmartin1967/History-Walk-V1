// @vitest-environment jsdom
//
// C2b — publishDraftToGitHub : on teste la LOGIQUE (validation, lecture/modif de
// destinations.json, ordre + chemins des 4 push, contenu publié) en moquant
// uploadFileToGitHub + le brouillon local. AUCUN push réel vers GitHub.
//
// Fix audit R1 (11/06/2026) : le geojson publié vient de generateMasterGeoJSONData
// (état AFFICHÉ : state.loadedFeatures + overlay userData), plus du snapshot
// draftGeoJSON_{id} figé à la création. On utilise ici le VRAI générateur
// (admin-geojson.js, pur) sur un state peuplé — le test couvre donc le contrat
// complet : capture incluse, curation appliquée, suppression exclue, clés perso
// purgées.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn(() => 'ghp_test'),
    uploadFileToGitHub: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../src/local-destinations.js', () => ({
    getDraftDestinations: vi.fn(),
    getDraftZones: vi.fn(),
    markLocalDraftPublished: vi.fn(async () => {}),
}));
vi.mock('../src/database.js', () => ({
    saveAppState: vi.fn(async () => {}),
    getAppState: vi.fn(async () => null),
}));

import { publishDraftToGitHub, officializeDestination } from '../src/publish-destination.js';
import { saveAppState } from '../src/database.js';
import { getStoredToken, uploadFileToGitHub } from '../src/github-sync.js';
import {
    getDraftDestinations, getDraftZones, markLocalDraftPublished,
} from '../src/local-destinations.js';
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

// L'état AFFICHÉ de la destination active : le scénario exact du bug R1.
// — Pont : candidat du snapshot de création, RENOMMÉ ensuite via l'overlay
//   userData (curation, convention #608) + clés perso à purger.
// — Fontaine : POI CAPTURÉ APRÈS la création (absent du snapshot draftGeoJSON_).
// — Vieille citerne : SUPPRIMÉE après la création (userData._deleted).
function makeLoadedFeatures() {
    return [
        {
            type: 'Feature',
            properties: {
                HW_ID: 'HW-01TESTPONT0000000000000001',
                'Nom du site FR': 'Pont', 'Catégorie': 'patrimoine', candidate: true,
                vu: true,
                userData: { 'Nom du site FR': 'Pont des Soupirs', notes: 'perso' },
            },
            geometry: { type: 'Point', coordinates: [12.35, 45.45] },
        },
        {
            type: 'Feature',
            properties: {
                HW_ID: 'HW-01TESTFONTAINE000000000001',
                'Nom du site FR': 'Fontaine', 'Catégorie': 'patrimoine', candidate: true,
            },
            geometry: { type: 'Point', coordinates: [12.36, 45.46] },
        },
        {
            type: 'Feature',
            properties: {
                HW_ID: 'HW-01TESTCITERNE000000000001',
                'Nom du site FR': 'Vieille citerne', 'Catégorie': 'patrimoine', candidate: true,
                userData: { _deleted: true },
            },
            geometry: { type: 'Point', coordinates: [12.37, 45.47] },
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
    getDraftDestinations.mockResolvedValue({
        venise: {
            name: 'Venise', status: 'draft', custom: true,
            bounds: [[45.4, 12.3], [45.5, 12.4]], currency: 'EUR',
            startView: { center: [45.45, 12.35], zoom: 13 },
            file: null, zonesFile: null, circuitsFile: null,
        },
    });
    getDraftZones.mockResolvedValue({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { name: 'Zone A' }, geometry: { type: 'Polygon', coordinates: [] } }],
    });
    stubDestFetch(BASE_DEST);
    // Le brouillon est la destination ACTIVE, avec son état affiché.
    state.currentMapId = 'venise';
    state.loadedFeatures = makeLoadedFeatures();
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
        // 2 lieux publiés (la citerne supprimée est exclue), pas 1 (snapshot) ni 3.
        expect(res).toMatchObject({ id: 'venise', name: 'Venise', pois: 2, zones: 1 });
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

    it('publie l\'état AFFICHÉ : capture incluse, curation appliquée, suppression exclue (fix R1)', async () => {
        await publishDraftToGitHub('venise');
        const geoFile = uploadFileToGitHub.mock.calls[0][0];
        const features = JSON.parse(await fileText(geoFile)).features;

        const names = features.map((f) => f.properties['Nom du site FR']);
        expect(names).toContain('Pont des Soupirs');   // curation (rename overlay) appliquée
        expect(names).toContain('Fontaine');           // capture post-création incluse
        expect(names).not.toContain('Pont');           // l'ancien nom n'a pas survécu
        expect(names).not.toContain('Vieille citerne'); // supprimé → exclu
        expect(features).toHaveLength(2);
    });

    it('purge les clés personnelles et l\'overlay, conserve candidate:true et HW_ID', async () => {
        await publishDraftToGitHub('venise');
        const geoFile = uploadFileToGitHub.mock.calls[0][0];
        const pont = JSON.parse(await fileText(geoFile)).features
            .find((f) => f.properties['Nom du site FR'] === 'Pont des Soupirs');
        expect(pont.properties.vu).toBeUndefined();        // PERSONAL_KEY (directe)
        expect(pont.properties.notes).toBeUndefined();     // PERSONAL_KEY (via overlay)
        expect(pont.properties.userData).toBeUndefined();  // overlay aplati, jamais publié
        expect(pont.properties.candidate).toBe(true);
        expect(pont.properties.HW_ID).toBe('HW-01TESTPONT0000000000000001');
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

    it('refuse si le brouillon n\'est pas la destination active (aucun push)', async () => {
        state.currentMapId = 'djerba'; // l'admin a basculé ailleurs
        await expect(publishDraftToGitHub('venise')).rejects.toThrow(/destination active/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('refuse un état vide (aucun push)', async () => {
        state.loadedFeatures = [];
        await expect(publishDraftToGitHub('venise')).rejects.toThrow(/aucun lieu/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('refuse si tous les lieux sont supprimés (aucun push)', async () => {
        state.loadedFeatures = [{
            type: 'Feature',
            properties: { HW_ID: 'HW-01TESTX0000000000000000001', 'Nom du site FR': 'X', userData: { _deleted: true } },
            geometry: { type: 'Point', coordinates: [12.35, 45.45] },
        }];
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

// ── Officialiser (réunif) : draft→published + garde-fou candidat (option C) ──
const GH_DRAFT_DEST = {
    activeMapId: 'djerba',
    maps: {
        djerba: { name: 'Djerba', status: 'published', file: 'djerba.geojson' },
        venise: { name: 'Venise', status: 'draft', file: 'venise.geojson', zonesFile: 'venise-zones.geojson', circuitsFile: 'circuits/venise.json' },
    },
};

// Mix réaliste : 1 lieu curé (publiable) + 1 candidat non curé (à écarter du public).
function makeOfficializeFeatures() {
    return [
        {
            type: 'Feature',
            properties: { HW_ID: 'HW-CURATED0000000000000000001', 'Nom du site FR': 'Musée', 'Catégorie': 'patrimoine' },
            geometry: { type: 'Point', coordinates: [12.3, 45.4] },
        },
        {
            type: 'Feature',
            properties: { HW_ID: 'HW-CAND00000000000000000000001', 'Nom du site FR': 'Ruine OSM', 'Catégorie': 'patrimoine', candidate: true },
            geometry: { type: 'Point', coordinates: [12.4, 45.5] },
        },
    ];
}

describe('officializeDestination — réunif (draft→published)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getStoredToken.mockReturnValue('ghp_test');
        stubDestFetch(GH_DRAFT_DEST);
        state.currentMapId = 'venise';
        state.customFeatures = [];
        state.destinations = { activeMapId: 'venise', maps: { venise: { name: 'Venise', status: 'draft' } } };
        state.loadedFeatures = makeOfficializeFeatures();
    });

    it('pousse geojson PUIS destinations.json, flip status:"published", djerba intact', async () => {
        const res = await officializeDestination('venise');
        const paths = uploadFileToGitHub.mock.calls.map((c) => c[4]);
        expect(paths).toEqual(['public/venise.geojson', 'public/destinations.json']);

        const destFile = uploadFileToGitHub.mock.calls[1][0];
        const json = JSON.parse(await fileText(destFile));
        expect(json.maps.venise.status).toBe('published');
        expect(json.maps.djerba.status).toBe('published'); // intact
        expect(res).toMatchObject({ id: 'venise', name: 'Venise', pois: 1, candidatesKept: 1 });
    });

    it('garde-fou candidat : geojson public SANS le candidat, candidat PRÉSERVÉ en customPois', async () => {
        await officializeDestination('venise');
        const geoFile = uploadFileToGitHub.mock.calls[0][0];
        const names = JSON.parse(await fileText(geoFile)).features.map((f) => f.properties['Nom du site FR']);
        expect(names).toEqual(['Musée']);            // curé publié
        expect(names).not.toContain('Ruine OSM');    // candidat écarté du public

        // Préservé en local (customPois_venise) pour curation ultérieure.
        const call = saveAppState.mock.calls.find((c) => c[0] === 'customPois_venise');
        expect(call).toBeDefined();
        const savedIds = call[1].map((f) => f.properties.HW_ID);
        expect(savedIds).toContain('HW-CAND00000000000000000000001');
        expect(state.customFeatures.map((f) => f.properties.HW_ID)).toContain('HW-CAND00000000000000000000001');
    });

    it('reflète le statut « published » en mémoire (badge Brouillon retiré)', async () => {
        await officializeDestination('venise');
        expect(state.destinations.maps.venise.status).toBe('published');
    });

    it('sans candidat : pas d\'écriture customPois, candidatesKept=0', async () => {
        state.loadedFeatures = [makeOfficializeFeatures()[0]]; // Musée seul
        const res = await officializeDestination('venise');
        expect(res.candidatesKept).toBe(0);
        expect(saveAppState.mock.calls.find((c) => c[0] === 'customPois_venise')).toBeUndefined();
    });

    it('refuse sans token (aucun push)', async () => {
        getStoredToken.mockReturnValue(null);
        await expect(officializeDestination('venise')).rejects.toThrow(/token/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('refuse si la destination n\'est pas active (aucun push)', async () => {
        state.currentMapId = 'djerba';
        await expect(officializeDestination('venise')).rejects.toThrow(/active/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('refuse si déjà officialisée sur GitHub (aucun push)', async () => {
        stubDestFetch({ activeMapId: 'djerba', maps: { venise: { name: 'Venise', status: 'published' } } });
        await expect(officializeDestination('venise')).rejects.toThrow(/déjà officialisée/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('refuse si la destination est absente de destinations.json sur GitHub (aucun push)', async () => {
        stubDestFetch({ activeMapId: 'djerba', maps: { djerba: { name: 'Djerba', status: 'published' } } });
        await expect(officializeDestination('venise')).rejects.toThrow(/n'existe pas/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });
});
