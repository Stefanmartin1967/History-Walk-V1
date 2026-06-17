// @vitest-environment jsdom
//
// Modèle 2-phases (Option A) — publishDestination : on teste la LOGIQUE (validation,
// lecture/modif de destinations.json, ordre + chemins des 4 push, contenu publié,
// garde-fou candidat) en moquant uploadFileToGitHub + le brouillon local. AUCUN
// push réel vers GitHub.
//
// Le geojson publié vient de generateMasterGeoJSONData (état AFFICHÉ :
// state.loadedFeatures + overlay userData) — on utilise le VRAI générateur
// (admin-geojson.js, pur) sur un state peuplé. Le test couvre donc le contrat
// complet : capture incluse, curation appliquée, suppression exclue, candidat non
// curé écarté du public ET préservé en local, clés perso purgées.

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

import { publishDestination } from '../src/publish-destination.js';
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
    state.customFeatures = [];
    state.destinations = { activeMapId: 'venise', maps: { venise: { name: 'Venise', status: 'draft', custom: true } } };
    state.loadedFeatures = makeDraftFeatures();
});

describe('publishDestination — modèle 2-phases (brouillon local → publiée)', () => {
    it('pousse 4 fichiers dans l\'ordre data → index → destinations.json', async () => {
        const res = await publishDestination('venise');
        expect(uploadFileToGitHub).toHaveBeenCalledTimes(4);
        const paths = uploadFileToGitHub.mock.calls.map((c) => c[4]); // 5e arg = path
        expect(paths).toEqual([
            'public/venise.geojson',
            'public/venise-zones.geojson',
            'public/circuits/venise.json',
            'public/destinations.json',
        ]);
        // 2 lieux curés publiés (Pont des Soupirs + Fontaine) ; Ruine candidate + citerne exclues.
        expect(res).toMatchObject({ id: 'venise', name: 'Venise', pois: 2, zones: 1, candidatesKept: 1 });
        expect(markLocalDraftPublished).toHaveBeenCalledWith('venise');
    });

    it('écrit l\'entrée en status:"published" (chemins canoniques) sans toucher djerba', async () => {
        await publishDestination('venise');
        const destFile = uploadFileToGitHub.mock.calls[3][0];
        const json = JSON.parse(await fileText(destFile));
        expect(json.maps.venise).toMatchObject({
            name: 'Venise', status: 'published',
            file: 'venise.geojson', zonesFile: 'venise-zones.geojson', circuitsFile: 'circuits/venise.json',
            currency: 'EUR',
        });
        expect(json.maps.venise.startView).toEqual({ center: [45.45, 12.35], zoom: 13 });
        expect(json.maps.djerba.status).toBe('published'); // intact
    });

    it('publie l\'état AFFICHÉ : curation appliquée, capture incluse, suppression + candidat non curé exclus', async () => {
        await publishDestination('venise');
        const geoFile = uploadFileToGitHub.mock.calls[0][0];
        const features = JSON.parse(await fileText(geoFile)).features;

        const names = features.map((f) => f.properties['Nom du site FR']);
        expect(names).toContain('Pont des Soupirs');   // candidat curé (rename overlay) publié
        expect(names).toContain('Fontaine');           // lieu curé inclus
        expect(names).not.toContain('Pont');           // l'ancien nom n'a pas survécu
        expect(names).not.toContain('Ruine OSM');      // candidat NON curé écarté du public
        expect(names).not.toContain('Vieille citerne'); // supprimé → exclu
        expect(features).toHaveLength(2);
    });

    it('garde-fou candidat : Ruine OSM PRÉSERVÉE en customPois (et state.customFeatures)', async () => {
        await publishDestination('venise');
        const call = saveAppState.mock.calls.find((c) => c[0] === 'customPois_venise');
        expect(call).toBeDefined();
        const savedIds = call[1].map((f) => f.properties.HW_ID);
        expect(savedIds).toContain('HW-01TESTRUINE0000000000000001');
        expect(state.customFeatures.map((f) => f.properties.HW_ID)).toContain('HW-01TESTRUINE0000000000000001');
    });

    it('graduation + purge : candidate retiré, clés perso et overlay absents du geojson public', async () => {
        await publishDestination('venise');
        const geoFile = uploadFileToGitHub.mock.calls[0][0];
        const pont = JSON.parse(await fileText(geoFile)).features
            .find((f) => f.properties['Nom du site FR'] === 'Pont des Soupirs');
        expect(pont.properties.candidate).toBeUndefined(); // gradué (candidate:false retiré)
        expect(pont.properties.vu).toBeUndefined();        // PERSONAL_KEY (directe)
        expect(pont.properties.notes).toBeUndefined();     // PERSONAL_KEY (via overlay)
        expect(pont.properties.userData).toBeUndefined();  // overlay aplati, jamais publié
        expect(pont.properties.HW_ID).toBe('HW-01TESTPONT0000000000000001');
    });

    it('reflète « published » + custom:false en mémoire (badge Brouillon + carte Publier retirés)', async () => {
        await publishDestination('venise');
        expect(state.destinations.maps.venise.status).toBe('published');
        expect(state.destinations.maps.venise.custom).toBe(false);
    });

    it('l\'index des circuits est un tableau vide', async () => {
        await publishDestination('venise');
        const idxFile = uploadFileToGitHub.mock.calls[2][0];
        expect(JSON.parse(await fileText(idxFile))).toEqual([]);
    });

    it('sans candidat non curé : candidatesKept=0, pas d\'écriture customPois', async () => {
        // Retire la Ruine candidate → ne reste que des lieux curés + 1 supprimé.
        state.loadedFeatures = makeDraftFeatures().filter((f) => f.properties['Nom du site FR'] !== 'Ruine OSM');
        const res = await publishDestination('venise');
        expect(res.candidatesKept).toBe(0);
        expect(saveAppState.mock.calls.find((c) => c[0] === 'customPois_venise')).toBeUndefined();
    });

    it('refuse sans token (aucun push)', async () => {
        getStoredToken.mockReturnValue(null);
        await expect(publishDestination('venise')).rejects.toThrow(/token/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('refuse si le brouillon n\'est pas la destination active (aucun push)', async () => {
        state.currentMapId = 'djerba'; // l'admin a basculé ailleurs
        await expect(publishDestination('venise')).rejects.toThrow(/destination active/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('refuse si le brouillon est introuvable en local (aucun push)', async () => {
        getDraftDestinations.mockResolvedValue({});
        await expect(publishDestination('venise')).rejects.toThrow(/introuvable/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('refuse s\'il n\'y a aucun lieu curé (que des candidats non curés) — aucun push', async () => {
        state.loadedFeatures = [{
            type: 'Feature',
            properties: { HW_ID: 'HW-01TESTONLYCAND00000000001', 'Nom du site FR': 'Candidat seul', candidate: true },
            geometry: { type: 'Point', coordinates: [12.35, 45.45] },
        }];
        await expect(publishDestination('venise')).rejects.toThrow(/aucun lieu/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('refuse si l\'id est déjà PUBLIÉ sur GitHub (aucun push)', async () => {
        stubDestFetch({ activeMapId: 'djerba', maps: { venise: { name: 'Venise', status: 'published' } } });
        await expect(publishDestination('venise')).rejects.toThrow(/déjà publiée/i);
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });
});
