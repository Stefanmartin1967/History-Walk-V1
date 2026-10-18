// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 18/10/2026 — l'éditeur n'enregistre que les champs MODIFIÉS sur une fiche
// publiée. Avant, il recopiait tout le formulaire (~25 champs) dans l'overlay
// `userData`, qui prime sur le fichier publié : corriger les horaires figeait
// aussi nom, catégorie, source… et l'utilisateur ne recevait plus aucune
// correction publiée ensuite par l'admin sur cette fiche.
// On exerce le vrai formulaire (DOM jsdom) et la vraie persistance
// (poi-persistence.js), seule la base IndexedDB est simulée.

vi.mock('leaflet', () => ({ default: {} }));
vi.mock('../src/map.js', () => ({ map: {}, startMarkerDrag: vi.fn(), refreshMapMarkers: vi.fn() }));
vi.mock('../src/state.js', () => {
    const mod = {
        state: {
            loadedFeatures: [], customFeatures: [], userData: {}, currentMapId: 'djerba',
            isAdmin: false, currentCircuit: null, currentFeatureId: null,
        },
        POI_CATEGORIES: ['Café', 'Mosquée'],
        APP_VERSION: 'test',
        DEFAULT_MAP_ID: 'djerba',
        getActiveDestinationCountry: () => 'tn',
        getActiveDestinationName: () => 'Djerba',
    };
    mod.getActiveMapId = () => mod.state.currentMapId;
    return mod;
});
vi.mock('../src/zones.js', () => ({ zonesData: null, zoneCacheGet: () => undefined, zoneCacheSet: () => {} }));
vi.mock('../src/utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getZoneFromCoords: () => 'Houmt Souk',
}));
vi.mock('../src/data.js', () => ({
    getPoiId: (f) => f?.properties?.HW_ID,
    commitPendingPoiIfNeeded: vi.fn(() => Promise.resolve()),
    updatePoiCoordinates: vi.fn(() => Promise.resolve()),
    updatePoiData: vi.fn(),
    addPoiFeature: vi.fn(),
    applyFilters: vi.fn(),
    getFilteredFeatures: vi.fn(() => []),
}));
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn() } }));
vi.mock('../src/database.js', () => ({
    saveAppState: vi.fn(() => Promise.resolve()),
    savePoiData: vi.fn(() => Promise.resolve()),
    deletePoiData: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/gist-sync.js', () => ({ schedulePush: vi.fn() }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/ui-details.js', () => ({ openDetailsPanel: vi.fn(), closeDetailsPanel: vi.fn() }));
vi.mock('../src/modal.js', () => ({
    // La vraie modale V2 injecte en-tête, corps et pied : on fait pareil, à plat.
    openHwModal: ({ subheader = '', body = '', footer = '' }) => {
        document.body.innerHTML = `<div class="hw-modal-overlay is-active"><div class="hw-modal">
            <div class="hw-modal-header"><button class="hw-modal-close"></button></div>
            ${subheader}${body}<div class="hw-modal-footer">${footer}</div></div></div>`;
    },
    closeHwModal: vi.fn(() => { document.body.innerHTML = ''; }),
    showConfirm: vi.fn(() => Promise.resolve(false)),
    suspendHwModal: vi.fn(),
    resumeHwModal: vi.fn(),
}));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/help-popover.js', () => ({
    configureHelp: vi.fn(),
    helpButton: () => document.createElement('button'),
    helpInline: () => document.createElement('span'),
}));
vi.mock('../src/help-content.js', () => ({
    GUIDE_LIEU: {}, HELP_LIEU_ZONE: {}, HELP_LIEU_CATEGORIE: {}, HELP_LIEU_DESC_COURTE: {}, HELP_LIEU_SOURCE: {},
}));
vi.mock('../src/work-photos.js', () => ({
    getWorkPhotosById: () => [], getKeptWorkPhotosById: () => [], setWorkPhotoKept: vi.fn(),
    uploadWorkPhoto: vi.fn(), loadWorkPhotoBlob: vi.fn(),
}));
vi.mock('../src/suggestion-email.js', () => ({ buildNewPlaceSuggestion: vi.fn(() => ({ url: '' })) }));
vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn(() => null), uploadFileToGitHub: vi.fn(), deleteFileFromGitHub: vi.fn(),
}));
vi.mock('../src/private-notes.js', async (importOriginal) => ({
    ...(await importOriginal()),
    savePrivateNote: vi.fn(() => Promise.resolve()),
}));

import { state } from '../src/state.js';
import { savePoiData } from '../src/database.js';
import { closeHwModal } from '../src/modal.js';
import { eventBus } from '../src/events.js';
import { getStoredToken } from '../src/github-sync.js';
import { savePrivateNote } from '../src/private-notes.js';
import { getPoiProp } from '../src/utils.js';
import { RichEditor } from '../src/richEditor.js';

const ID = 'HW-01TESTCAFE0000000000000000';

function publishedCafe(extra = {}) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [10.85, 33.87] },
        properties: {
            HW_ID: ID, 'Nom du site FR': 'Café Test', 'Catégorie': 'Café',
            Source: 'Relevé 2025', Horaires: '7h-20h', 'Téléphone': '+216 75 650 000',
            ...extra,
        },
    };
}

const field = (id) => document.getElementById(id);
function type(id, value) {
    const el = field(id);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}
async function save() {
    field('btn-save-rich-poi').click();
    await vi.waitFor(() => expect(closeHwModal).toHaveBeenCalled());
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    state.loadedFeatures = [];
    state.customFeatures = [];
    state.userData = {};
    state.isAdmin = false;
    vi.mocked(getStoredToken).mockReturnValue(null);
});

describe('fiche publiée : seuls les champs modifiés entrent dans l\'overlay', () => {
    it('visiteur : corrige les horaires → overlay = horaires seuls, une correction admin ultérieure lui parvient', async () => {
        const f = publishedCafe();
        state.loadedFeatures = [f];

        await RichEditor.openForEdit(ID);
        type('rich-poi-hours', '8h-12h');
        await save();

        expect(state.userData[ID]).toEqual({ Horaires: '8h-12h' });
        expect(savePoiData).toHaveBeenCalledWith('djerba', ID, { Horaires: '8h-12h' });

        // L'admin corrige ensuite la source dans le fichier publié : le visiteur
        // la voit (avant, sa copie gelée « Relevé 2025 » la masquait).
        f.properties.Source = 'Relevé 2026';
        expect(getPoiProp(f, 'Source')).toBe('Relevé 2026');
        expect(getPoiProp(f, 'Horaires')).toBe('8h-12h');
    });

    it('admin : même règle — overlay = champ modifié seul, le Control Center est prévenu', async () => {
        state.isAdmin = true;
        state.loadedFeatures = [publishedCafe()];

        await RichEditor.openForEdit(ID);
        type('rich-poi-source', 'Relevé 2026');
        await save();

        expect(state.userData[ID]).toEqual({ Source: 'Relevé 2026' });
        expect(eventBus.emit).toHaveBeenCalledWith('admin:poi-edited', { id: ID, type: 'update' });
    });

    it('enregistrer sans rien changer n\'écrit rien (pas d\'overlay vide)', async () => {
        state.loadedFeatures = [publishedCafe()];

        await RichEditor.openForEdit(ID);
        await save();

        expect(state.userData[ID]).toBeUndefined();
        expect(savePoiData).not.toHaveBeenCalled();
    });

    it('un champ modifié puis remis à sa valeur d\'origine n\'est pas écrit', async () => {
        state.loadedFeatures = [publishedCafe()];

        await RichEditor.openForEdit(ID);
        type('rich-poi-hours', '8h-12h');
        type('rich-poi-hours', '7h-20h');
        await save();

        expect(state.userData[ID]).toBeUndefined();
    });

    it('overlay déjà présent : le champ modifié s\'y ajoute, le reste de l\'overlay est conservé', async () => {
        const f = publishedCafe();
        state.loadedFeatures = [f];
        state.userData[ID] = { vu: true, photos: ['p1.jpg'] };
        f.properties.userData = state.userData[ID];

        await RichEditor.openForEdit(ID);
        type('rich-poi-hours', '8h-12h');
        await save();

        expect(state.userData[ID]).toEqual({ vu: true, photos: ['p1.jpg'], Horaires: '8h-12h' });
    });

    it('visiteur, description officielle masquée laissée vide : rien d\'écrit sur la description', async () => {
        state.loadedFeatures = [publishedCafe({ description: 'Texte de travail non publié.' })];

        await RichEditor.openForEdit(ID);
        expect(field('rich-poi-desc-long').value).toBe('');
        type('rich-poi-hours', '8h-12h');
        await save();

        expect(state.userData[ID]).toEqual({ Horaires: '8h-12h' });
    });

    it('visiteur, description masquée : il écrit la sienne → enregistrée', async () => {
        state.loadedFeatures = [publishedCafe({ description: 'Texte de travail non publié.' })];

        await RichEditor.openForEdit(ID);
        type('rich-poi-desc-long', 'Ma description.');
        await save();

        expect(state.userData[ID]).toEqual({ description: 'Ma description.' });
    });

    it('visiteur qui colle une référence OSM : osm_ref écrit, « OSM vérifié » et sa date (admin) non', async () => {
        state.loadedFeatures = [publishedCafe()];

        await RichEditor.openForEdit(ID);
        type('rich-poi-osm-ref', 'https://www.openstreetmap.org/node/123456');
        await save();

        expect(state.userData[ID]).toEqual({ osm_ref: 'node/123456' });
    });

    it('admin qui colle une référence OSM : osm_ref + osmChecked + date du jour', async () => {
        state.isAdmin = true;
        state.loadedFeatures = [publishedCafe()];

        await RichEditor.openForEdit(ID);
        type('rich-poi-osm-ref', 'https://www.openstreetmap.org/node/123456');
        await save();

        expect(state.userData[ID]).toEqual({
            osm_ref: 'node/123456', osmChecked: true, osmCheckedDate: new Date().toISOString().slice(0, 10),
        });
    });
});

describe('note privée (heripia-travail) sur une fiche publiée', () => {
    it('note inchangée : rien envoyé (l\'envoyer « undefined » effacerait celle du dépôt)', async () => {
        vi.mocked(getStoredToken).mockReturnValue('fake-token');
        const f = publishedCafe();
        state.loadedFeatures = [f];
        state.userData[ID] = { notes: 'Note existante' };
        f.properties.userData = state.userData[ID];

        await RichEditor.openForEdit(ID);
        type('rich-poi-hours', '8h-12h');
        await save();

        expect(savePrivateNote).not.toHaveBeenCalled();
        expect(state.userData[ID]).toEqual({ notes: 'Note existante', Horaires: '8h-12h' });
    });

    it('note modifiée : envoyée', async () => {
        vi.mocked(getStoredToken).mockReturnValue('fake-token');
        const f = publishedCafe();
        state.loadedFeatures = [f];
        state.userData[ID] = { notes: 'Note existante' };
        f.properties.userData = state.userData[ID];

        await RichEditor.openForEdit(ID);
        type('rich-poi-notes', 'Note revue');
        await save();

        expect(savePrivateNote).toHaveBeenCalledWith('djerba', ID, 'Note revue');
    });
});

describe('lieu local (custom) : enregistrement complet, inchangé', () => {
    it('écrit tout le formulaire dans le lieu lui-même, pas dans l\'overlay', async () => {
        const f = publishedCafe();
        state.loadedFeatures = [f];
        state.customFeatures = [f];

        await RichEditor.openForEdit(ID);
        type('rich-poi-hours', '8h-12h');
        await save();

        expect(f.properties.Horaires).toBe('8h-12h');
        // Champs non touchés réécrits (comportement d'avant, voulu pour un lieu local).
        expect(f.properties['Nom du site FR']).toBe('Café Test');
        expect(f.properties.Source).toBe('Relevé 2025');
        // Seuls les champs perso (notes…) vont dans l'overlay d'un lieu local.
        expect(state.userData[ID]?.Horaires).toBeUndefined();
        expect(state.userData[ID]?.Source).toBeUndefined();
    });
});
