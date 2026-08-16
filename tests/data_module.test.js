// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (hoisted par vitest) ---
vi.mock('../src/state.js', () => {
    const state = {
        currentMapId: 'djerba',
        loadedFeatures: [],
        customFeatures: [],
        userData: {},
        hiddenPoiIds: [],
        currentCircuit: [],
        activeCircuitId: null,
        isAdmin: false,
        isCircuitCreationMode: false,
        activeFilters: {
            zone: null,
            categories: [],
            vus: 'all',
            planifies: 'all',
            verified: 'all',
            photo: 'all',
            description: 'all',
            incontournablesOnly: false
        },
        selectionModeFilters: { hideVisited: false, hidePlanned: false }
    };
    return {
        state,
        setCurrentMap: vi.fn(),
        setLoadedFeatures: vi.fn(arr => { state.loadedFeatures = arr; }),
        setCustomFeatures: vi.fn(arr => { state.customFeatures = arr; }),
        setHiddenPoiIds: vi.fn(arr => { state.hiddenPoiIds = arr; }),
        setUserData: vi.fn(d => { state.userData = d; }),
        setActiveFilter: vi.fn((k, v) => { state.activeFilters[k] = v; })
    };
});

vi.mock('../src/events.js', () => ({
    eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() }
}));

vi.mock('../src/database.js', () => ({
    getAllPoiDataForMap: vi.fn(),
    getAllCircuitsForMap: vi.fn(),
    savePoiData: vi.fn(),
    getAppState: vi.fn(),
    saveAppState: vi.fn(),
    saveCircuit: vi.fn()
}));

vi.mock('../src/logger.js', () => ({
    logModification: vi.fn()
}));

vi.mock('../src/gist-sync.js', () => ({
    schedulePush: vi.fn()
}));

vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));

let _hwidCounter = 0;
vi.mock('../src/utils.js', () => ({
    getPoiId: vi.fn(f => f?.properties?.HW_ID || f?.id),
    getPoiName: vi.fn(f => f?.properties?.name || 'Unknown'),
    generateHWID: vi.fn(() => `HW-${String(++_hwidCounter).padStart(26, '0')}`),
    // Dégel de Zone : passesStructuralFilters lit désormais getDerivedZone (et non la
    // valeur stockée). Le mock réplique son repli (zones non chargées → valeur stockée
    // overlay-aware), suffisant pour les tests de filtre par zone.
    getDerivedZone: vi.fn(f => (f?.properties?.userData?.Zone ?? f?.properties?.Zone) || ''),
    // Overlay-aware comme le vrai (userData prime) : deletePoi lit l'osm_ref par ce
    // canal, un osm_ref reporté pendant la curation vivant dans userData.
    getPoiProp: vi.fn((f, k) => f?.properties?.userData?.[k] ?? f?.properties?.[k]),
    isCandidate: vi.fn(() => false),
    // Checklist de vérification : réplique la règle « une référence renseignée
    // vaut vérifié » (utils.js). Les regex reprennent normalizeOsmRef et
    // mapsPlaceUrl — une saisie non reconnaissable ne doit PAS valoir vérifié.
    isOsmChecked: vi.fn(p => !!p?.osmChecked || /(node|way|relation)\/\d+/i.test(p?.osm_ref || '')),
    isMapsChecked: vi.fn(p => !!p?.mapsChecked || /^https?:\/\//i.test((p?.maps_ref || '').trim()))
}));

// Tombstones de curation : on espionne addRejected sans toucher au vrai store, et on
// neutralise le push GitHub (import dynamique fire-and-forget dans deletePoi).
vi.mock('../src/rejected.js', () => ({
    addRejected: vi.fn(),
    rejectedData: {},
}));
vi.mock('../src/publish-destination.js', () => ({
    pushDestinationRejected: vi.fn(() => Promise.resolve()),
}));

// Dégel de Zone : le déplacement d'un POI invalide le cache de zone dérivée au lieu
// de figer la zone. On mocke zones.js pour espionner deleteZoneCacheEntry.
vi.mock('../src/zones.js', () => ({
    deleteZoneCacheEntry: vi.fn()
}));

vi.mock('../src/admin-control-center.js', () => ({
    addToDraft: vi.fn(),
    getMigrationId: vi.fn(),
    getAdminDraft: vi.fn(() => ({ pendingPois: {}, modifications: {} }))
}));

vi.mock('../src/url-utils.js', () => ({
    getDomainFromUrl: vi.fn()
}));

import { state } from '../src/state.js';
import { saveAppState, savePoiData, saveCircuit } from '../src/database.js';
import { addToDraft, getMigrationId, getAdminDraft } from '../src/admin-control-center.js';
import { schedulePush } from '../src/gist-sync.js';
import { showToast } from '../src/toast.js';
import { logModification } from '../src/logger.js';
import { eventBus } from '../src/events.js';
import { deleteZoneCacheEntry } from '../src/zones.js';
import { isCandidate } from '../src/utils.js';
import { addRejected } from '../src/rejected.js';
import {
    recomputeVu,
    applyFilters,
    getFilteredFeatures,
    passesUserFilters,
    passesStructuralFilters,
    isPendingPoi,
    addPendingPoiFeature,
    commitPendingPoiIfNeeded,
    discardPendingPoi,
    updatePoiData,
    addPoiFeature,
    updatePoiCoordinates,
    deletePoi,
    checkAndApplyMigrations
} from '../src/data.js';

function poi(id, props = {}) {
    return {
        type: 'Feature',
        properties: { HW_ID: id, ...props },
        geometry: { type: 'Point', coordinates: [10, 35] }
    };
}

function resetState() {
    state.currentMapId = 'djerba';
    state.loadedFeatures = [];
    state.customFeatures = [];
    state.userData = {};
    state.hiddenPoiIds = [];
    state.currentCircuit = [];
    state.activeCircuitId = null;
    state.isAdmin = false;
    state.isCircuitCreationMode = false;
    state.activeFilters = {
        zone: null,
        categories: [],
        vus: 'all',
        planifies: 'all',
        verified: 'all',
        candidate: 'all',
        introuvableCarte: 'all',
        workPhotos: 'all',
        photo: 'all',
        description: 'all',
        incontournablesOnly: false
    };
    _hwidCounter = 0;
}

beforeEach(() => {
    resetState();
    vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('applyFilters — P2 auto-reset du filtre Zone vidée', () => {
    const lastFiltered = () => {
        const calls = eventBus.emit.mock.calls.filter(c => c[0] === 'data:filtered');
        return calls.length ? calls[calls.length - 1][1] : null;
    };

    it('reset la zone à null quand elle est vide MAIS que des POI existent ailleurs', () => {
        state.loadedFeatures = [poi('b', { Zone: 'B' })]; // aucun POI en zone A
        state.activeFilters.zone = 'A';
        applyFilters();
        expect(state.activeFilters.zone).toBe(null);
        // émet le jeu recalculé (toutes zones → b visible), une seule fois côté résultat
        expect(lastFiltered().map(f => f.properties.HW_ID)).toEqual(['b']);
    });

    it('NE reset PAS si la zone filtrée contient encore des POI', () => {
        state.loadedFeatures = [poi('a', { Zone: 'A' }), poi('b', { Zone: 'B' })];
        state.activeFilters.zone = 'A';
        applyFilters();
        expect(state.activeFilters.zone).toBe('A');
        expect(lastFiltered().map(f => f.properties.HW_ID)).toEqual(['a']);
    });

    it('NE reset PAS quand le vide vient d\'un AUTRE filtre (sans zone ce serait vide aussi)', () => {
        state.loadedFeatures = [poi('a', { Zone: 'A', 'Catégorie': 'Musée' }), poi('b', { Zone: 'B', 'Catégorie': 'Musée' })];
        state.activeFilters.zone = 'A';
        state.activeFilters.categories = ['Fortification']; // ne matche rien
        applyFilters();
        expect(state.activeFilters.zone).toBe('A'); // la zone n'est pas le coupable
        expect(lastFiltered()).toEqual([]);
    });

    it('NE reset rien quand aucune zone n\'est filtrée (résultat vide global)', () => {
        state.loadedFeatures = [];
        state.activeFilters.zone = null;
        applyFilters();
        expect(state.activeFilters.zone).toBe(null);
        expect(lastFiltered()).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('recomputeVu', () => {
    it('no-op si userData null/undefined (pas de throw)', () => {
        expect(() => recomputeVu(null)).not.toThrow();
        expect(() => recomputeVu(undefined)).not.toThrow();
    });

    it('vu = true si vuManual === true', () => {
        const ud = { vuManual: true };
        recomputeVu(ud);
        expect(ud.vu).toBe(true);
    });

    it('vu = true si visitedByCircuits a au moins une entrée', () => {
        const ud = { visitedByCircuits: ['c1'] };
        recomputeVu(ud);
        expect(ud.vu).toBe(true);
    });

    it('vu = false si ni vuManual ni visitedByCircuits', () => {
        const ud = {};
        recomputeVu(ud);
        expect(ud.vu).toBe(false);
    });

    it('vu = true si vuManual=true ET visitedByCircuits=[] (manual prime)', () => {
        const ud = { vuManual: true, visitedByCircuits: [] };
        recomputeVu(ud);
        expect(ud.vu).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('isPendingPoi', () => {
    it('retourne false si POI absent de loadedFeatures', () => {
        expect(isPendingPoi('unknown')).toBe(false);
    });

    it('retourne false si POI présent mais non pending', () => {
        state.loadedFeatures = [poi('p1')];
        expect(isPendingPoi('p1')).toBe(false);
    });

    it('retourne true si POI présent avec _pending=true', () => {
        state.loadedFeatures = [poi('p1', { _pending: true })];
        expect(isPendingPoi('p1')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getFilteredFeatures', () => {
    it('retourne [] si state.loadedFeatures absent', () => {
        state.loadedFeatures = null;
        expect(getFilteredFeatures()).toEqual([]);
    });

    it('exclut les POI dans hiddenPoiIds', () => {
        state.loadedFeatures = [poi('p1'), poi('p2')];
        state.hiddenPoiIds = ['p1'];
        const r = getFilteredFeatures();
        expect(r).toHaveLength(1);
        expect(r[0].properties.HW_ID).toBe('p2');
    });

    it('filtre par activeFilters.zone (Zone string match)', () => {
        state.loadedFeatures = [poi('p1', { Zone: 'A' }), poi('p2', { Zone: 'B' })];
        state.activeFilters.zone = 'A';
        const r = getFilteredFeatures();
        expect(r).toHaveLength(1);
        expect(r[0].properties.HW_ID).toBe('p1');
    });

    it('filtre par activeFilters.categories (multi-select array.includes)', () => {
        state.loadedFeatures = [
            poi('p1', { 'Catégorie': 'Hotel' }),
            poi('p2', { 'Catégorie': 'Plage' }),
            poi('p3', { 'Catégorie': 'Mosquée' })
        ];
        state.activeFilters.categories = ['Hotel', 'Mosquée'];
        const r = getFilteredFeatures();
        expect(r.map(f => f.properties.HW_ID).sort()).toEqual(['p1', 'p3']);
    });

    it('incontournable bypass tous les filtres user (sauf hidden/zone/cat)', () => {
        state.loadedFeatures = [poi('p1', { incontournable: true, userData: { vu: true } })];
        state.activeFilters.vus = 'hide'; // normalement filtrerait les vus
        const r = getFilteredFeatures();
        expect(r).toHaveLength(1);
    });

    it('POIs du circuit actif passent toujours (même si vus + filter actif)', () => {
        const p1 = poi('p1', { userData: { vu: true } });
        state.loadedFeatures = [p1];
        state.currentCircuit = [p1];
        state.activeCircuitId = 'c1';
        state.activeFilters.vus = 'hide';
        const r = getFilteredFeatures();
        expect(r).toHaveLength(1);
    });

    it('mode standard : activeFilters.vus exclut les POIs vus', () => {
        state.loadedFeatures = [
            poi('p1', { userData: { vu: true } }),
            poi('p2', { userData: { vu: false } })
        ];
        state.activeFilters.vus = 'hide';
        const r = getFilteredFeatures();
        expect(r.map(f => f.properties.HW_ID)).toEqual(['p2']);
    });

    // Test obsolète supprimé (10/05/2026, PR cleanup tests) :
    // "mode standard : activeFilters.planifies exclut les POIs avec planifieCounter > 0"
    // testait l'ancienne logique où planifieCounter était stocké dans userData.
    // Depuis le 03/05/2026 (cf. circuit-actions.js:174), le compteur est calculé
    // à la volée via computePlanifieCounter(poiId) — getFilteredFeatures n'inspecte
    // plus userData.planifieCounter, donc ce test ne peut plus fonctionner tel quel.

    it('mode sélection : utilise activeFilters comme partout (pas de filtre dédié)', () => {
        // PR #398 : selectionModeFilters supprimé. En mode sélection, le filtrage
        // suit les filtres topbar comme en mode normal — un seul système.
        state.loadedFeatures = [
            poi('p1', { userData: { vu: true } }),
            poi('p2', { userData: { vu: false } })
        ];
        state.isCircuitCreationMode = true;
        state.activeFilters.vus = 'hide';
        const r = getFilteredFeatures();
        expect(r.map(f => f.properties.HW_ID)).toEqual(['p2']);
    });

    it('admin : activeFilters.verified=hide exclut les POIs verified', () => {
        state.loadedFeatures = [
            poi('p1', { verified: true }),
            poi('p2', { verified: false }),
            poi('p3', {})
        ];
        state.activeFilters.verified = 'hide';
        const r = getFilteredFeatures();
        expect(r.map(f => f.properties.HW_ID).sort()).toEqual(['p2', 'p3']);
    });

    it('admin : activeFilters.verified=only n\'affiche que les POIs verified', () => {
        state.loadedFeatures = [
            poi('p1', { verified: true }),
            poi('p2', { verified: false }),
            poi('p3', {})
        ];
        state.activeFilters.verified = 'only';
        const r = getFilteredFeatures();
        expect(r.map(f => f.properties.HW_ID)).toEqual(['p1']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('passesUserFilters', () => {
    it('retourne false pour feature null/undefined', () => {
        expect(passesUserFilters(null)).toBe(false);
        expect(passesUserFilters(undefined)).toBe(false);
    });

    it('out si POI dans hiddenPoiIds', () => {
        state.hiddenPoiIds = ['p1'];
        expect(passesUserFilters(poi('p1'))).toBe(false);
    });

    it('hidden bat incontournable (POI caché reste caché même incontournable)', () => {
        state.hiddenPoiIds = ['p1'];
        expect(passesUserFilters(poi('p1', { incontournable: true }))).toBe(false);
    });

    it('incontournable bypasse vus + planifies', () => {
        state.activeFilters.vus = 'hide';
        state.activeFilters.planifies = 'hide';
        const f = poi('p1', { incontournable: true, userData: { vu: true, planifieCounter: 5 } });
        expect(passesUserFilters(f)).toBe(true);
    });

    it('POI du circuit actif bypasse les filtres user', () => {
        const p1 = poi('p1', { userData: { vu: true } });
        state.loadedFeatures = [p1];
        state.currentCircuit = [p1];
        state.activeCircuitId = 'c1';
        state.activeFilters.vus = 'hide';
        expect(passesUserFilters(p1)).toBe(true);
    });

    it('mode standard : vus=true exclut un POI vu (non incontournable)', () => {
        state.activeFilters.vus = 'hide';
        expect(passesUserFilters(poi('p1', { userData: { vu: true } }))).toBe(false);
    });

    // Test obsolète supprimé (10/05/2026, PR cleanup tests) :
    // "mode standard : planifies=true exclut planifieCounter > 0" testait
    // l'ancienne API stockée userData.planifieCounter. Maintenant calculé à la
    // volée via computePlanifieCounter(poiId) — passer { userData: { planifieCounter: 1 } }
    // ne déclenche plus l'exclusion. Logique testée différemment dans les tests
    // de computePlanifieCounter directement (cf. data_module.test.js plus haut).

    it('mode sélection : aucune branche dédiée — activeFilters.vus pilote', () => {
        // PR #398 : la branche state.isCircuitCreationMode a été retirée de
        // passesUserFilters. activeFilters.vus est la source de vérité unique.
        state.isCircuitCreationMode = true;
        state.activeFilters.vus = 'hide';
        expect(passesUserFilters(poi('p1', { userData: { vu: true } }))).toBe(false);
        // Et inversement : si activeFilters.vus='all', aucune exclusion
        state.activeFilters.vus = 'all';
        expect(passesUserFilters(poi('p2', { userData: { vu: true } }))).toBe(true);
    });

    it('admin : verified=hide exclut les POIs verified=true', () => {
        state.activeFilters.verified = 'hide';
        expect(passesUserFilters(poi('p1', { verified: true }))).toBe(false);
        expect(passesUserFilters(poi('p2', { verified: false }))).toBe(true);
    });

    it('admin : verified=only n\'affiche que les POIs verified=true', () => {
        state.activeFilters.verified = 'only';
        expect(passesUserFilters(poi('p1', { verified: true }))).toBe(true);
        expect(passesUserFilters(poi('p2', { verified: false }))).toBe(false);
    });

    it('P8 : introuvableCarte=only n\'affiche que les lieux flaggés', () => {
        state.activeFilters.introuvableCarte = 'only';
        expect(passesUserFilters(poi('p1', { introuvableCarte: true }))).toBe(true);
        expect(passesUserFilters(poi('p2', {}))).toBe(false);
    });

    it('P8 : introuvableCarte=hide exclut les lieux flaggés', () => {
        state.activeFilters.introuvableCarte = 'hide';
        expect(passesUserFilters(poi('p1', { introuvableCarte: true }))).toBe(false);
        expect(passesUserFilters(poi('p2', {}))).toBe(true);
    });

    // Photos de travail (16/08/2026) — références dans userData.workPhotos, clé
    // personnelle jamais présente dans le geojson : le filtre lit donc le merge
    // properties+userData, comme le fait la fiche.
    it('workPhotos=only n\'affiche que les lieux ayant des photos de travail', () => {
        state.activeFilters.workPhotos = 'only';
        expect(passesUserFilters(poi('p1', { userData: { workPhotos: ['djerba/work_p1_1.jpg'] } }))).toBe(true);
        // Liste vide (toutes retirées à l'import des vraies photos) = sans repère
        expect(passesUserFilters(poi('p2', { userData: { workPhotos: [] } }))).toBe(false);
        expect(passesUserFilters(poi('p3', {}))).toBe(false);
    });

    it('workPhotos=hide exclut les lieux ayant des photos de travail', () => {
        state.activeFilters.workPhotos = 'hide';
        expect(passesUserFilters(poi('p1', { userData: { workPhotos: ['djerba/work_p1_1.jpg'] } }))).toBe(false);
        expect(passesUserFilters(poi('p2', {}))).toBe(true);
    });

    it('admin : photo=only n\'affiche que les POIs avec photo', () => {
        state.activeFilters.photo = 'only';
        expect(passesUserFilters(poi('p1', { photos: ['url'] }))).toBe(true);
        expect(passesUserFilters(poi('p2', {}))).toBe(false);
    });

    it('description=hide exclut les POIs avec description PUBLIÉE (défaut OFF, 09/08/2026)', () => {
        state.activeFilters.description = 'hide';
        expect(passesUserFilters(poi('p1', { description: 'Texte', descriptionPublic: true }))).toBe(false);
        expect(passesUserFilters(poi('p2', {}))).toBe(true);
        // Une description non publiée (defaut) ne compte pas comme "a une description"
        // pour un non-admin — cohérence avec templates.js (rien à afficher, rien à filtrer).
        expect(passesUserFilters(poi('p3', { description: 'Texte' }))).toBe(true);
    });

    it('description=hide : un admin voit un brouillon comme "a une description" (rien à publier depuis l\'éditeur)', () => {
        state.activeFilters.description = 'hide';
        state.isAdmin = true;
        expect(passesUserFilters(poi('p1', { description: 'Texte' }))).toBe(false);
        state.isAdmin = false;
    });

    it('par défaut (aucun filtre actif) : POI passe', () => {
        expect(passesUserFilters(poi('p1'))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('passesStructuralFilters', () => {
    it('retourne false pour feature null/undefined', () => {
        expect(passesStructuralFilters(null)).toBe(false);
        expect(passesStructuralFilters(undefined)).toBe(false);
    });

    it('par défaut (aucun filtre) : POI passe', () => {
        expect(passesStructuralFilters(poi('p1', { Zone: 'A' }))).toBe(true);
    });

    it('filtre zone : POI hors zone exclu', () => {
        state.activeFilters.zone = 'A';
        expect(passesStructuralFilters(poi('p1', { Zone: 'B' }))).toBe(false);
        expect(passesStructuralFilters(poi('p2', { Zone: 'A' }))).toBe(true);
    });

    it('skipZone:true ignore le filtre zone', () => {
        state.activeFilters.zone = 'A';
        expect(passesStructuralFilters(poi('p1', { Zone: 'B' }), { skipZone: true })).toBe(true);
    });

    it('filtre catégorie multi : POI hors liste exclu', () => {
        state.activeFilters.categories = ['Mosquée', 'Plage'];
        expect(passesStructuralFilters(poi('p1', { 'Catégorie': 'Restaurant' }))).toBe(false);
        expect(passesStructuralFilters(poi('p2', { 'Catégorie': 'Mosquée' }))).toBe(true);
    });

    it('skipZone:true conserve le filtre catégorie', () => {
        state.activeFilters.zone = 'A';
        state.activeFilters.categories = ['Mosquée'];
        const f = poi('p1', { Zone: 'B', 'Catégorie': 'Restaurant' });
        // skipZone passe le filtre Zone, mais catégorie échoue toujours
        expect(passesStructuralFilters(f, { skipZone: true })).toBe(false);
    });

    it('categories=[] équivaut à pas de filtre catégorie', () => {
        state.activeFilters.categories = [];
        expect(passesStructuralFilters(poi('p1', { 'Catégorie': 'Restaurant' }))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('addPendingPoiFeature', () => {
    it('génère un HW_ID si absent ou format invalide', () => {
        const f = { type: 'Feature', properties: {}, geometry: null };
        addPendingPoiFeature(f);
        expect(f.properties.HW_ID).toMatch(/^HW-/);
        expect(f.properties.HW_ID.length).toBe(29);
    });

    it('préserve un HW_ID valide existant', () => {
        const validId = 'HW-' + '1'.repeat(26);
        const f = poi(validId);
        addPendingPoiFeature(f);
        expect(f.properties.HW_ID).toBe(validId);
    });

    it('marque le feature avec _pending=true et l\'ajoute à loadedFeatures + customFeatures', () => {
        const f = { type: 'Feature', properties: {}, geometry: null };
        addPendingPoiFeature(f);
        expect(f.properties._pending).toBe(true);
        expect(state.loadedFeatures).toContain(f);
        expect(state.customFeatures).toContain(f);
    });

    it('initialise userData[id] et lie properties.userData', () => {
        const f = { type: 'Feature', properties: {}, geometry: null };
        addPendingPoiFeature(f);
        const id = f.properties.HW_ID;
        expect(state.userData[id]).toBeDefined();
        expect(f.properties.userData).toBe(state.userData[id]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('commitPendingPoiIfNeeded', () => {
    it('no-op si POI absent de loadedFeatures', async () => {
        await commitPendingPoiIfNeeded('unknown');
        expect(saveAppState).not.toHaveBeenCalled();
    });

    it('no-op si POI présent mais non pending', async () => {
        state.loadedFeatures = [poi('p1')];
        await commitPendingPoiIfNeeded('p1');
        expect(saveAppState).not.toHaveBeenCalled();
    });

    it('retire le flag _pending et persiste customPois + lastGeoJSON', async () => {
        const f = poi('p1', { _pending: true });
        state.loadedFeatures = [f];
        state.customFeatures = [f];

        await commitPendingPoiIfNeeded('p1');

        expect(f.properties._pending).toBeUndefined();
        expect(saveAppState).toHaveBeenCalledWith('customPois_djerba', state.customFeatures);
        expect(saveAppState).toHaveBeenCalledWith('lastGeoJSON_djerba', expect.objectContaining({
            type: 'FeatureCollection',
            features: expect.arrayContaining([f])
        }));
    });

    it('admin : addToDraft("poi", id, { type: "creation" }) si state.isAdmin', async () => {
        const f = poi('p1', { _pending: true });
        state.loadedFeatures = [f];
        state.isAdmin = true;

        await commitPendingPoiIfNeeded('p1');

        expect(addToDraft).toHaveBeenCalledWith('poi', 'p1', { type: 'creation' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('discardPendingPoi', () => {
    it('retire le POI pending de loadedFeatures', () => {
        const f = poi('p1', { _pending: true });
        state.loadedFeatures = [f, poi('p2')];
        discardPendingPoi('p1');
        expect(state.loadedFeatures.map(x => x.properties.HW_ID)).toEqual(['p2']);
    });

    it('retire le POI pending de customFeatures', () => {
        const f = poi('p1', { _pending: true });
        state.loadedFeatures = [f];
        state.customFeatures = [f];
        discardPendingPoi('p1');
        expect(state.customFeatures).toHaveLength(0);
    });

    it('cleanup userData[id] s\'il est vide', () => {
        const f = poi('p1', { _pending: true });
        state.loadedFeatures = [f];
        state.userData['p1'] = {}; // empty
        discardPendingPoi('p1');
        expect(state.userData['p1']).toBeUndefined();
    });

    it('préserve userData[id] s\'il contient des champs (pas de cleanup destructif)', () => {
        const f = poi('p1', { _pending: true });
        state.loadedFeatures = [f];
        state.userData['p1'] = { vuManual: true };
        discardPendingPoi('p1');
        expect(state.userData['p1']).toEqual({ vuManual: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updatePoiData', () => {
    it('initialise userData[poiId] si absent', async () => {
        await updatePoiData('p1', 'notes', 'hello');
        expect(state.userData['p1']).toBeDefined();
        expect(state.userData['p1'].notes).toBe('hello');
    });

    it('cas key="vu" : écrit vuManual et recalcule vu (jamais directement vu)', async () => {
        await updatePoiData('p1', 'vu', true);
        expect(state.userData['p1'].vuManual).toBe(true);
        expect(state.userData['p1'].vu).toBe(true);
    });

    it('cas key="vu" : value=false écrit vuManual=false', async () => {
        state.userData['p1'] = { vuManual: true, vu: true, visitedByCircuits: [] };
        await updatePoiData('p1', 'vu', false);
        expect(state.userData['p1'].vuManual).toBe(false);
        expect(state.userData['p1'].vu).toBe(false);
    });

    it('cas key autre : écrit la valeur directement', async () => {
        await updatePoiData('p1', 'planifie', true);
        expect(state.userData['p1'].planifie).toBe(true);
    });

    it('sync feature.properties.userData après update', async () => {
        const f = poi('p1');
        state.loadedFeatures = [f];
        await updatePoiData('p1', 'notes', 'sync');
        expect(f.properties.userData).toBe(state.userData['p1']);
    });

    it('savePoiData + showToast "Enregistré" + schedulePush appelés', async () => {
        await updatePoiData('p1', 'notes', 'x');
        expect(savePoiData).toHaveBeenCalledWith('djerba', 'p1', state.userData['p1']);
        expect(showToast).toHaveBeenCalledWith('Enregistré', 'success', 1500);
        expect(schedulePush).toHaveBeenCalled();
    });

    it.each([
        ['Catégorie', 'Hotel'],
        ['Zone', 'Houmt Souk'],
        ['vu', true],
        ['vuManual', true],
        // 'planifieCounter' retiré du test paramétré (10/05/2026) : depuis le
        // 03/05/2026 ce champ n'est plus stocké dans userData (calculé à la volée),
        // donc updatePoiData('p1', 'planifieCounter', X) ne déclenche plus
        // applyFilters/data:filtered.
        ['incontournable', true],
        ['verified', true],
        // Filtres "État de la fiche" (refonte Claude Design) : photos / description
        // (clé canonique : `description` lowercase, depuis l'unification).
        ['photos', ['url']],
        ['description', 'Long texte'],
        // Photos de travail : ajout/retrait depuis le Rich Editor pendant que le
        // filtre « Photos de travail » peut être actif.
        ['workPhotos', ['djerba/work_p1_1.jpg']],
    ])('emit data:filtered (via applyFilters) si key="%s" affecte les filtres', async (key, value) => {
        await updatePoiData('p1', key, value);
        expect(eventBus.emit).toHaveBeenCalledWith('data:filtered', expect.anything());
    });

    it.each([
        ['notes', 'x'],
        ['planifie', true],
    ])('PAS d\'emit data:filtered si key="%s" n\'affecte pas les filtres', async (key, value) => {
        await updatePoiData('p1', key, value);
        expect(eventBus.emit).not.toHaveBeenCalledWith('data:filtered', expect.anything());
    });

    it('admin + key non-personal : addToDraft appelé', async () => {
        state.isAdmin = true;
        await updatePoiData('p1', 'Catégorie', 'Hotel');
        expect(addToDraft).toHaveBeenCalledWith('poi', 'p1', { key: 'Catégorie', value: 'Hotel' });
    });

    it('admin + key personal (vu/notes/planifie) : PAS de addToDraft', async () => {
        state.isAdmin = true;
        await updatePoiData('p1', 'vu', true);
        await updatePoiData('p1', 'notes', 'private');
        await updatePoiData('p1', 'planifieCounter', 3);
        expect(addToDraft).not.toHaveBeenCalled();
    });

    it('régression A1 : admin + `incontournable` ou `hidden` (perso) : PAS de addToDraft', async () => {
        // Avant le fix A1, la liste PERSONAL_KEYS locale dans data.js
        // ne contenait pas `incontournable` ni `hidden` → marquer un POI
        // comme favori côté admin créait un draft, ce qui menait à une
        // fuite de données perso dans le geojson public au publish.
        state.isAdmin = true;
        await updatePoiData('p1', 'incontournable', true);
        await updatePoiData('p1', 'hidden', true);
        await updatePoiData('p1', 'vuManual', true);
        await updatePoiData('p1', 'visitedByCircuits', ['c1']);
        expect(addToDraft).not.toHaveBeenCalled();
    });

    it('non-admin + key non-personal : PAS de addToDraft', async () => {
        state.isAdmin = false;
        await updatePoiData('p1', 'Catégorie', 'Hotel');
        expect(addToDraft).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('addPoiFeature', () => {
    it('génère un HW_ID si absent ou format invalide', async () => {
        const f = { type: 'Feature', properties: {}, geometry: null };
        await addPoiFeature(f);
        expect(f.properties.HW_ID).toMatch(/^HW-/);
        expect(f.properties.HW_ID.length).toBe(29);
    });

    it('préserve un HW_ID valide existant', async () => {
        const validId = 'HW-' + '1'.repeat(26);
        const f = poi(validId);
        await addPoiFeature(f);
        expect(f.properties.HW_ID).toBe(validId);
    });

    it('ajoute le feature à loadedFeatures + customFeatures sans flag _pending', async () => {
        const f = poi('HW-' + '2'.repeat(26));
        await addPoiFeature(f);
        expect(state.loadedFeatures).toContain(f);
        expect(state.customFeatures).toContain(f);
        expect(f.properties._pending).toBeUndefined();
    });

    it('persiste customPois immédiatement via saveAppState (vs addPendingPoiFeature qui ne persiste pas)', async () => {
        const f = poi('HW-' + '3'.repeat(26));
        await addPoiFeature(f);
        expect(saveAppState).toHaveBeenCalledWith('customPois_djerba', state.customFeatures);
    });

    it('admin : addToDraft creation appelé', async () => {
        state.isAdmin = true;
        const f = poi('HW-' + '4'.repeat(26));
        await addPoiFeature(f);
        expect(addToDraft).toHaveBeenCalledWith('poi', 'HW-' + '4'.repeat(26), { type: 'creation' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updatePoiCoordinates', () => {
    it('initialise userData[poiId] avec lat/lng', async () => {
        await updatePoiCoordinates('p1', 36.5, 10.7);
        expect(state.userData['p1'].lat).toBe(36.5);
        expect(state.userData['p1'].lng).toBe(10.7);
    });

    it('met à jour la geometry du feature ([lng, lat] order GeoJSON)', async () => {
        const f = poi('p1');
        state.loadedFeatures = [f];
        await updatePoiCoordinates('p1', 36.5, 10.7);
        expect(f.geometry.coordinates).toEqual([10.7, 36.5]);
    });

    it('déplacement : met à jour les coords et NE FIGE PLUS la Zone (dégel) — invalide le cache', async () => {
        const f = poi('p1', { Zone: 'AncienneZone' });
        state.loadedFeatures = [f];
        await updatePoiCoordinates('p1', 36.5, 10.7);
        // Coordonnées mises à jour ([lng, lat]).
        expect(f.geometry.coordinates).toEqual([10.7, 36.5]);
        // Dégel : la Zone n'est PLUS gelée sur le POI (elle se dérivera des coords).
        expect(f.properties.Zone).toBe('AncienneZone'); // inchangée, pas réécrite
        // Le cache de zone dérivée de ce POI est invalidé.
        expect(deleteZoneCacheEntry).toHaveBeenCalledWith('p1');
    });

    it('met à jour customFeatures et persiste customPois si POI custom', async () => {
        const f = poi('p1');
        state.loadedFeatures = [f];
        state.customFeatures = [f];
        await updatePoiCoordinates('p1', 36.5, 10.7);
        expect(state.customFeatures[0].geometry.coordinates).toEqual([10.7, 36.5]);
        expect(saveAppState).toHaveBeenCalledWith('customPois_djerba', state.customFeatures);
    });

    it('savePoiData + logModification appelés systématiquement', async () => {
        await updatePoiCoordinates('p1', 36.5, 10.7);
        expect(savePoiData).toHaveBeenCalledWith('djerba', 'p1', state.userData['p1']);
        expect(logModification).toHaveBeenCalledWith(
            'p1',
            'Deplacement',
            'All',
            null,
            expect.stringContaining('36.50000')
        );
    });

    it('admin : addToDraft coords avec originalLat/Lng capturés AVANT mutation', async () => {
        const f = poi('p1');
        f.geometry.coordinates = [9.0, 33.0]; // [lng, lat] initial
        state.loadedFeatures = [f];
        state.isAdmin = true;

        await updatePoiCoordinates('p1', 36.5, 10.7);

        expect(addToDraft).toHaveBeenCalledWith('poi', 'p1', {
            type: 'coords',
            lat: 36.5,
            lng: 10.7,
            originalLat: 33.0,
            originalLng: 9.0
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deletePoi', () => {
    it('initialise hiddenPoiIds si absent et y ajoute le poiId', async () => {
        state.hiddenPoiIds = null;
        await deletePoi('p1');
        expect(state.hiddenPoiIds).toContain('p1');
    });

    it('persiste hiddenPois via saveAppState', async () => {
        await deletePoi('p1');
        expect(saveAppState).toHaveBeenCalledWith('hiddenPois_djerba', state.hiddenPoiIds);
    });

    it('évite le doublon dans hiddenPoiIds', async () => {
        state.hiddenPoiIds = ['p1'];
        await deletePoi('p1');
        const occurrences = state.hiddenPoiIds.filter(id => id === 'p1').length;
        expect(occurrences).toBe(1);
    });

    it('retire de customFeatures + persiste customPois si POI custom', async () => {
        const f = poi('p1');
        state.customFeatures = [f, poi('p2')];
        await deletePoi('p1');
        expect(state.customFeatures.map(x => x.properties.HW_ID)).toEqual(['p2']);
        expect(saveAppState).toHaveBeenCalledWith('customPois_djerba', state.customFeatures);
    });

    it('admin : addToDraft delete + flag _deleted sur properties.userData', async () => {
        const f = poi('p1');
        state.loadedFeatures = [f];
        state.isAdmin = true;

        await deletePoi('p1');

        expect(addToDraft).toHaveBeenCalledWith('poi', 'p1', { type: 'delete' });
        expect(f.properties.userData._deleted).toBe(true);
    });

    it('admin + CANDIDAT : retrait local SANS intention de suppression GitHub (anti-fantôme CC)', async () => {
        // Un candidat scout n'est jamais publié → pas d'original GitHub. Enregistrer
        // une intention de suppression créerait une entrée fantôme « SUPPRESSION /
        // Inconnu » dans le CC. On ne doit donc PAS appeler addToDraft ni poser _deleted.
        const f = poi('cand_1', { candidate: true });
        state.loadedFeatures = [f];
        state.customFeatures = [f];
        state.isAdmin = true;
        isCandidate.mockReturnValueOnce(true);

        await deletePoi('cand_1');

        expect(addToDraft).not.toHaveBeenCalled();
        expect(f.properties.userData?._deleted).toBeUndefined();
        // Retrait local effectif (customFeatures + hiddenPoiIds).
        expect(state.customFeatures.find(x => x.properties.HW_ID === 'cand_1')).toBeUndefined();
        expect(state.hiddenPoiIds).toContain('cand_1');
    });

    it('emit data:filtered (via applyFilters) après suppression', async () => {
        await deletePoi('p1');
        expect(eventBus.emit).toHaveBeenCalledWith('data:filtered', expect.anything());
    });

    it('tombstone un POI porteur d\'osm_ref (re-scan ne le re-propose pas)', async () => {
        const f = poi('p1', { osm_ref: 'way/386328373' });
        state.loadedFeatures = [f];
        state.isAdmin = true;

        await deletePoi('p1');

        expect(addRejected).toHaveBeenCalledWith(expect.objectContaining({ osm_ref: 'way/386328373' }));
    });

    it('lit l\'osm_ref via l\'overlay userData (report de fusion non encore publié)', async () => {
        const f = poi('p1');
        f.properties.userData = { osm_ref: 'node/42' };
        state.loadedFeatures = [f];
        state.isAdmin = true;

        await deletePoi('p1');

        expect(addRejected).toHaveBeenCalledWith(expect.objectContaining({ osm_ref: 'node/42' }));
    });

    it('{ tombstone: false } : aucun rejet posé (fusion de doublon — l\'objet OSM est repris par le lieu gardé)', async () => {
        const f = poi('cand_1', { osm_ref: 'way/386328373', candidate: true });
        state.loadedFeatures = [f];
        state.customFeatures = [f];
        state.isAdmin = true;
        isCandidate.mockReturnValueOnce(true);

        await deletePoi('cand_1', { tombstone: false });

        expect(addRejected).not.toHaveBeenCalled();
        expect(state.hiddenPoiIds).toContain('cand_1');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('checkAndApplyMigrations (stage-then-commit)', () => {
    beforeEach(() => {
        state.isAdmin = true;
        state.myCircuits = [];
        state.officialCircuits = [];
        // getAdminDraft renvoie un brouillon vide par défaut (cf. mock global)
        getAdminDraft.mockReturnValue({ pendingPois: {}, modifications: {} });
    });

    it('happy path : ID legacy migré, saves OK → mutations mémoire appliquées', async () => {
        const f = poi('gen_old1');
        state.loadedFeatures = [f];
        state.userData['gen_old1'] = { vu: true, notes: 'avant' };

        await checkAndApplyMigrations();

        // HW_ID réécrit vers HW-ULID
        expect(f.properties.HW_ID).toMatch(/^HW-/);
        expect(f.properties.HW_ID.length).toBe(29);
        const newId = f.properties.HW_ID;

        // userData : nouvelle clé pointe vers les mêmes données
        expect(state.userData[newId]).toEqual({ vu: true, notes: 'avant' });

        // Persistance : 3 saveAppState (userData, hiddenPois, customPois)
        expect(saveAppState).toHaveBeenCalledWith('userData', expect.anything());
        expect(saveAppState).toHaveBeenCalledWith('hiddenPois_djerba', expect.anything());
        expect(saveAppState).toHaveBeenCalledWith('customPois_djerba', expect.anything());

        // Brouillon admin : entrée migration enregistrée
        expect(addToDraft).toHaveBeenCalledWith('poi', newId, { type: 'migration', oldId: 'gen_old1' });

        // Toast succès
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('IDs unifiés'), 'success');
    });

    it('persist failure : saveAppState rejette → AUCUNE mutation mémoire (garantie clé)', async () => {
        const f = poi('gen_old2');
        state.loadedFeatures = [f];
        state.userData['gen_old2'] = { vu: true };

        saveAppState.mockRejectedValueOnce(new Error('IndexedDB quota exceeded'));

        await checkAndApplyMigrations();

        // HW_ID inchangé
        expect(f.properties.HW_ID).toBe('gen_old2');

        // Aucune nouvelle clé dans userData
        expect(Object.keys(state.userData)).toEqual(['gen_old2']);

        // Pas de tracking admin
        expect(addToDraft).not.toHaveBeenCalled();

        // Toast erreur affiché
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Échec'), 'error');
    });

    it('no-op : aucun ID legacy → aucun save ni draft tenté', async () => {
        const validHwId = 'HW-' + '1'.repeat(26);
        const f = poi(validHwId);
        state.loadedFeatures = [f];

        await checkAndApplyMigrations();

        expect(saveAppState).not.toHaveBeenCalled();
        expect(saveCircuit).not.toHaveBeenCalled();
        expect(addToDraft).not.toHaveBeenCalled();
        expect(f.properties.HW_ID).toBe(validHwId);
    });
});
