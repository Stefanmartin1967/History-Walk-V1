// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// admin-maintenance — onglet Nettoyage, sous-vue « Circuits publiés »
//
// Régression du 04/09/2026 : la poubelle de cet écran ne supprimait QUE le
// fichier GPX et laissait l'entrée dans public/circuits/<map>.json. L'Action
// `update-circuits.yml` était censée recoller l'index, mais elle est morte
// depuis le 25/05/2026 → l'item restait affiché à l'identique (la liste est
// construite depuis l'index) et le circuit restait listé côté visiteur avec un
// GPX en 404.
//
// On teste la chaîne complète bouton → handler → DEUX écritures serveur, pas
// seulement la fonction : c'est le câblage `data-id` qui manquait.
// ============================================================================

const INDEX = [
    { id: 'HW-1', name: 'Circuit A', file: 'djerba/A.gpx', distance: '4 km' },
    { id: 'HW-2', name: 'Circuit B', file: 'djerba/B.gpx', distance: '6 km' },
];

// vi.mock est hissé en tête de fichier : tout ce que ses factories référencent
// doit passer par vi.hoisted(), sinon « Cannot access X before initialization ».
const H = vi.hoisted(() => {
    const state = {
        currentMapId: 'djerba',
        myCircuits: [],
        officialCircuits: [],
        activeCircuitId: null,
    };
    return {
        state,
        setOfficialCircuits: vi.fn((list) => { state.officialCircuits = list; }),
        fetchWithTimeout: vi.fn(),
        deleteFileFromGitHub: vi.fn(),
        uploadFileToGitHub: vi.fn(),
        setOfficialCircuitDeleted: vi.fn(async () => []),
        noteServerDeletedCircuit: vi.fn(),
        showConfirm: vi.fn(async () => true),
        showToast: vi.fn(),
        emit: vi.fn(),
    };
});
const {
    state, setOfficialCircuits, fetchWithTimeout, deleteFileFromGitHub,
    uploadFileToGitHub, setOfficialCircuitDeleted, noteServerDeletedCircuit,
    showConfirm, showToast, emit,
} = H;

vi.mock('../src/state.js', () => ({
    state: H.state,
    removeMyCircuit: vi.fn(),
    setOfficialCircuits: H.setOfficialCircuits,
}));
vi.mock('../src/net.js', () => ({ fetchWithTimeout: H.fetchWithTimeout }));
vi.mock('../src/github-sync.js', () => ({
    getStoredToken: () => 'TOKEN',
    deleteFileFromGitHub: H.deleteFileFromGitHub,
    uploadFileToGitHub: H.uploadFileToGitHub,
}));
vi.mock('../src/database.js', () => ({ deleteCircuitById: vi.fn(), restoreCircuit: vi.fn() }));
vi.mock('../src/circuit-deletion-state.js', () => ({
    setOfficialCircuitDeleted: H.setOfficialCircuitDeleted,
}));
vi.mock('../src/admin-diff-engine.js', () => ({
    noteServerDeletedCircuit: H.noteServerDeletedCircuit,
}));
vi.mock('../src/events.js', () => ({ eventBus: { emit: H.emit, on: vi.fn() } }));
vi.mock('../src/toast.js', () => ({ showToast: H.showToast }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/modal.js', () => ({ showConfirm: H.showConfirm }));
vi.mock('../src/admin-cc-topbar.js', () => ({ setTopbarSubtabs: vi.fn() }));

import { renderMaintenanceTab } from '../src/admin-maintenance.js';
import { setTopbarSubtabs } from '../src/admin-cc-topbar.js';

/** Réponse fetch OK portant une copie de l'index. */
const okIndex = (idx = INDEX) => ({ ok: true, json: async () => JSON.parse(JSON.stringify(idx)) });

// Callback de sous-onglet que le module confie au topbar du shell.
let subtabClick = null;

/** Rend l'onglet, bascule sur « Circuits publiés », attend la liste. */
async function renderServerView() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderMaintenanceTab(container);
    await vi.waitFor(() => {
        if (!subtabClick) throw new Error('scan pas terminé');
    });
    subtabClick('server');
    await vi.waitFor(() => {
        if (!container.querySelector('[data-action="delete-server"]')) throw new Error('pas encore rendu');
    });
    return container;
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    state.officialCircuits = [{ id: 'HW-1', name: 'Circuit A' }, { id: 'HW-2', name: 'Circuit B' }];
    state.activeCircuitId = null;
    fetchWithTimeout.mockResolvedValue(okIndex());
    deleteFileFromGitHub.mockResolvedValue({});
    uploadFileToGitHub.mockResolvedValue({});
    showConfirm.mockResolvedValue(true);

    // La sous-vue par défaut est « Corbeille locale ». Le sous-onglet vit dans
    // le topbar du shell : on capture le callback pour simuler le clic sur
    // « Circuits publiés » depuis le test (l'appeler ici rentrerait en
    // récursion, renderResults ré-appelant setTopbarSubtabs).
    subtabClick = null;
    setTopbarSubtabs.mockImplementation((html, onClick) => { subtabClick = onClick; });
});

describe('Nettoyage — la liste vient de l’index', () => {
    it('rend un bouton de suppression portant l’id du circuit', async () => {
        const container = await renderServerView();
        const btns = container.querySelectorAll('[data-action="delete-server"]');
        expect(btns.length).toBe(2);
        // data-id est le câblage qui manquait : sans lui le handler ne peut pas
        // retrouver l'entrée d'index à retirer.
        expect([...btns].map(b => b.dataset.id)).toEqual(['HW-1', 'HW-2']);
        expect(btns[0].dataset.path).toBe('public/circuits/djerba/A.gpx');
    });

    it('re-scanne le serveur à CHAQUE ouverture de l’onglet', async () => {
        await renderServerView();
        const first = fetchWithTimeout.mock.calls.length;
        expect(first).toBeGreaterThan(0);
        await renderServerView();
        // Avant le correctif, un drapeau `_scanned` figeait la liste sur le
        // premier scan de la session → l'admin revoyait un état périmé.
        expect(fetchWithTimeout.mock.calls.length).toBeGreaterThan(first);
    });
});

describe('Nettoyage — suppression complète', () => {
    it('supprime le GPX ET retire l’entrée d’index', async () => {
        const container = await renderServerView();
        container.querySelector('[data-id="HW-1"]').click();

        await vi.waitFor(() => expect(uploadFileToGitHub).toHaveBeenCalled());

        expect(deleteFileFromGitHub).toHaveBeenCalledWith(
            'TOKEN', expect.any(String), expect.any(String),
            'public/circuits/djerba/A.gpx', expect.stringContaining('Circuit A')
        );

        const [file, , , , path] = uploadFileToGitHub.mock.calls[0];
        expect(path).toBe('public/circuits/djerba.json');
        const written = JSON.parse(await file.text());
        expect(written.map(c => c.id)).toEqual(['HW-2']);
    });

    it('nettoie l’index même si le GPX est déjà absent (orphelin à réparer)', async () => {
        deleteFileFromGitHub.mockRejectedValue(new Error('Fichier introuvable sur le serveur'));
        const container = await renderServerView();
        container.querySelector('[data-id="HW-2"]').click();

        await vi.waitFor(() => expect(uploadFileToGitHub).toHaveBeenCalled());
        const written = JSON.parse(await uploadFileToGitHub.mock.calls[0][0].text());
        expect(written.map(c => c.id)).toEqual(['HW-1']);
    });

    it('n’écrit RIEN sur l’index si sa relecture échoue', async () => {
        const container = await renderServerView();
        // Le fetch de relecture (post-clic) tombe : ne surtout pas publier un []
        // qui viderait l'index entier.
        fetchWithTimeout.mockResolvedValue({ ok: false, status: 500 });
        container.querySelector('[data-id="HW-1"]').click();

        await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('Erreur'), 'error'
        ));
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });

    it('retire le circuit de state.officialCircuits et purge l’intention en attente', async () => {
        const container = await renderServerView();
        container.querySelector('[data-id="HW-1"]').click();

        await vi.waitFor(() => expect(uploadFileToGitHub).toHaveBeenCalled());
        // Sinon un officiel ouvert dans la session (realTrack chargé) repasserait
        // « NOUVEAU » au diff suivant, et la publication le recréerait.
        expect(setOfficialCircuits).toHaveBeenCalledWith([{ id: 'HW-2', name: 'Circuit B' }]);
        expect(setOfficialCircuitDeleted).toHaveBeenCalledWith('HW-1', false);
        expect(emit).toHaveBeenCalledWith('circuit:list-updated');
    });

    it('prévient le moteur de diff et demande son recalcul', async () => {
        const container = await renderServerView();
        container.querySelector('[data-id="HW-1"]').click();

        await vi.waitFor(() => expect(uploadFileToGitHub).toHaveBeenCalled());
        // Sans ce signal, une relecture d'index en retard ferait réapparaître le
        // circuit en « SUPPRESSION » et « Tout publier » pousserait un commit vide.
        expect(noteServerDeletedCircuit).toHaveBeenCalledWith('HW-1');
        expect(emit).toHaveBeenCalledWith('admin:circuit-server-deleted', 'HW-1');
    });

    it('ne prévient PAS le moteur de diff si l’écriture a échoué', async () => {
        const container = await renderServerView();
        fetchWithTimeout.mockResolvedValue({ ok: false, status: 500 });
        container.querySelector('[data-id="HW-1"]').click();

        await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('Erreur'), 'error'
        ));
        expect(noteServerDeletedCircuit).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalledWith('admin:circuit-server-deleted', 'HW-1');
    });

    it('ne touche à rien si l’admin annule la confirmation', async () => {
        showConfirm.mockResolvedValue(false);
        const container = await renderServerView();
        container.querySelector('[data-id="HW-1"]').click();
        await Promise.resolve();
        expect(deleteFileFromGitHub).not.toHaveBeenCalled();
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });
});
