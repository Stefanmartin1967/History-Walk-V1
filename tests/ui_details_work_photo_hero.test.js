// @vitest-environment jsdom
//
// Hero replié sur une photo de travail (05/09/2026) — le clic ouvre le VIEWER.
//
// Avant : le repli affichait la photo mais le hero restait routé vers la grille
// d'ajout, seul geste possible. On montrait donc une image qu'aucun clic ne
// permettait d'agrandir — alors que l'agrandir est tout l'intérêt (lire un
// panneau sur une capture, comparer un scan d'archive à une vue récente).
//
// Ce qui est vérifié ici : le ROUTAGE du clic selon l'état du hero, et le fait
// que le viewer reçoive TOUTES les références (le badge annonçait « N photos de
// travail » alors qu'une seule était atteignable).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/events.js', () => ({
    eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() },
}));

vi.mock('../src/state.js', () => ({
    state: {
        isAdmin: true,
        currentMapId: 'djerba',
        currentFeatureId: null,
        currentCircuitIndex: null,
        loadedFeatures: [],
        currentCircuit: [],
        userData: {},
    },
    setCurrentFeatureId: vi.fn(),
    setCurrentCircuitIndex: vi.fn(),
    setPoiFilterFromSearch: vi.fn(),
    getActiveDestinationName: vi.fn(() => 'Djerba'),
}));

vi.mock('../src/data.js', () => ({
    getPoiId: (f) => f?.properties?.HW_ID,
    getPatrimonialName: vi.fn(),
    updatePoiData: vi.fn(),
    updatePoiCoordinates: vi.fn(),
    isPendingPoi: vi.fn(() => false),
    discardPendingPoi: vi.fn(),
}));

vi.mock('../src/tts.js', () => ({ speakText: vi.fn() }));
vi.mock('../src/mobile-state.js', () => ({
    isMobileView: vi.fn(() => false),
    pushMobileLevel: vi.fn(),
    animateContainer: vi.fn(),
    setMobileHeaderSlot: vi.fn(),
    setMobileViewFooter: vi.fn(),
}));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));

// Le hero seul suffit : c'est lui qu'on clique. Les autres bindings de la fiche
// sortent tout seuls quand leur élément n'existe pas.
vi.mock('../src/templates.js', () => ({
    buildDetailsPanelHtml: () => `
        <div class="poi-hero is-empty is-clickable" id="poi-hero"
             role="button" tabindex="0" aria-label="Ajouter une photo">
            <i class="empty-icon"></i><span class="empty-label">Ajouter une photo</span>
        </div>`,
}));

vi.mock('../src/utils.js', () => ({ sanitizeHTML: vi.fn(s => s), openPoiOnMap: vi.fn() }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn() }));
vi.mock('../src/ui-sidebar.js', () => ({ switchSidebarTab: vi.fn() }));
vi.mock('../src/access-point-editor.js', () => ({ startAccessPointPlacement: vi.fn() }));
vi.mock('../src/help-popover.js', () => ({ configureHelp: vi.fn(), attachHelp: vi.fn() }));
vi.mock('../src/help-content.js', () => ({ GUIDE_LIRE_LIEU: {} }));
vi.mock('../src/private-notes.js', () => ({
    loadPrivateNote: vi.fn(() => Promise.resolve(null)),
    savePrivateNote: vi.fn(),
}));
vi.mock('../src/github-sync.js', () => ({ getStoredToken: vi.fn(() => null) }));

// vi.mock est hoisté au-dessus du corps du fichier : le panel doit l'être aussi,
// sinon la factory ci-dessous s'exécute avant la déclaration (TDZ).
const { panel } = vi.hoisted(() => ({ panel: document.createElement('div') }));
vi.mock('../src/ui-dom.js', () => ({
    DOM: { detailsPanel: panel, mobileMainContainer: document.createElement('div') },
}));

// Aucune vraie photo : c'est la condition du repli sur les photos de travail.
vi.mock('../src/database.js', () => ({
    getPoiPhotos: vi.fn(() => Promise.resolve([])),
    getPendingAdminPhotos: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../src/work-photos.js', () => ({
    getWorkPhotosById: vi.fn(() => []),
    loadWorkPhotoBlob: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../src/ui-photo-grid.js', () => ({
    openPhotoGrid: vi.fn(() => Promise.resolve({ saved: false })),
    downloadAllPhotos: vi.fn(),
}));

// Import dynamique dans le code (évite un cycle) — vi.mock le couvre aussi.
vi.mock('../src/ui-photo-viewer.js', () => ({
    openPhotoViewer: vi.fn(() => Promise.resolve()),
}));

import { state } from '../src/state.js';
import { getWorkPhotosById, loadWorkPhotoBlob } from '../src/work-photos.js';
import { openPhotoGrid } from '../src/ui-photo-grid.js';
import { openPhotoViewer } from '../src/ui-photo-viewer.js';
import { openDetailsPanel } from '../src/ui-details.js';

document.body.appendChild(panel);

const blob = (name) => new Blob([name], { type: 'image/jpeg' });

/** Laisse tourner les hydratations async (hero + note privée) avant d'agir. */
async function settle() {
    // Macrotâche et pas seulement microtâches : le viewer est chargé par un
    // import() dynamique (évite un cycle ui-details ↔ ui-photo-viewer), qui ne
    // se résout pas dans le même tour de boucle.
    for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0));
}

async function openPoi(workPaths = []) {
    getWorkPhotosById.mockReturnValue(workPaths);
    state.loadedFeatures = [{ properties: { HW_ID: 'HW-1' }, geometry: { coordinates: [10, 33] } }];
    state.currentFeatureId = 0;
    openDetailsPanel(0);
    await settle();
    return document.getElementById('poi-hero');
}

beforeEach(() => {
    vi.clearAllMocks();
    state.isAdmin = true;
    panel.innerHTML = '';
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:work-${++n}`);
    URL.revokeObjectURL = vi.fn();
    loadWorkPhotoBlob.mockImplementation((p) => Promise.resolve(blob(p)));
});

describe('Repli du hero sur les photos de travail (admin)', () => {
    it('annonce le geste réel : aria-label « Voir… », pas « Ajouter une photo »', async () => {
        const hero = await openPoi(['work/a.jpg', 'work/b.jpg']);

        expect(hero.classList.contains('has-work-photo')).toBe(true);
        expect(hero.getAttribute('aria-label')).toBe('Voir les 2 photos de travail');
    });

    it('une seule photo → libellé au singulier', async () => {
        const hero = await openPoi(['work/a.jpg']);

        expect(hero.getAttribute('aria-label')).toBe('Voir la photo de travail');
    });

    it("le clic ouvre le viewer avec TOUTES les photos, pas la grille d'ajout", async () => {
        const hero = await openPoi(['work/a.jpg', 'work/b.jpg', 'work/c.jpg']);

        hero.click();
        await settle();

        expect(openPhotoGrid).not.toHaveBeenCalled();
        expect(openPhotoViewer).toHaveBeenCalledTimes(1);
        expect(openPhotoViewer.mock.calls[0][0]).toEqual(['blob:work-2', 'blob:work-3', 'blob:work-4']);
        expect(openPhotoViewer.mock.calls[0][1]).toBe(0);
    });

    it('révoque les objectURL du viewer à sa fermeture (pas de fuite)', async () => {
        const hero = await openPoi(['work/a.jpg', 'work/b.jpg']);

        hero.click();
        await settle();

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:work-2');
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:work-3');
    });

    it('référence non rapatriée et hors-ligne → sautée, le viewer montre le reste', async () => {
        loadWorkPhotoBlob.mockImplementation((p) =>
            Promise.resolve(p === 'work/b.jpg' ? null : blob(p)));

        const hero = await openPoi(['work/a.jpg', 'work/b.jpg']);
        hero.click();
        await settle();

        expect(openPhotoViewer).toHaveBeenCalledTimes(1);
        expect(openPhotoViewer.mock.calls[0][0]).toHaveLength(1);
    });
});

describe('Ce que le repli ne change pas', () => {
    it("lieu sans photo de travail → le clic ouvre toujours la grille d'ajout", async () => {
        const hero = await openPoi([]);

        expect(hero.classList.contains('has-work-photo')).toBe(false);
        hero.click();
        await settle();

        expect(openPhotoGrid).toHaveBeenCalledWith('HW-1');
        expect(openPhotoViewer).not.toHaveBeenCalled();
    });

    it('visiteur : aucun repli (les photos de travail ne sont pas les siennes)', async () => {
        state.isAdmin = false;

        const hero = await openPoi(['work/a.jpg']);

        expect(hero.classList.contains('has-work-photo')).toBe(false);
        hero.click();
        await settle();

        expect(openPhotoViewer).not.toHaveBeenCalled();
        expect(openPhotoGrid).toHaveBeenCalledWith('HW-1');
    });
});
