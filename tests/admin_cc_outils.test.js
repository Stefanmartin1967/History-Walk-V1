// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Centre de Contrôle (23/11/2026, maquette écrans 61-63 validée par Stefan) :
// tableau de bord sans outils + « N lieux à vérifier » ; onglet Outils en groupes ;
// les deux outils GeoJSON retirés.

const h = vi.hoisted(() => ({ onlyCandidates: vi.fn() }));

vi.mock('../src/state.js', () => {
    const mod = { state: { loadedFeatures: [], hiddenPoiIds: [], destinations: { maps: {} }, currentMapId: 'djerba' } };
    mod.DEFAULT_MAP_ID = 'djerba';
    mod.getActiveMapId = () => 'djerba';
    mod.getDestinationLabel = () => 'Djerba';
    return mod;
});
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn(() => 'x'), getStoredUsername: vi.fn(() => null),
    saveToken: vi.fn(), validateToken: vi.fn(), uploadFileToGitHub: vi.fn(),
}));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/modal.js', () => ({ openHwModal: vi.fn(), closeHwModal: vi.fn() }));
vi.mock('../src/admin-maintenance.js', () => ({ renderMaintenanceTab: vi.fn() }));
vi.mock('../src/mobile-state.js', () => ({ isMobileView: () => false }));
vi.mock('../src/filter-panel.js', () => ({ showOnlyCandidates: h.onlyCandidates }));
vi.mock('leaflet', () => {
    const chain = new Proxy(function () {}, { get: (_t, p) => (p === 'then' ? undefined : chain), apply: () => chain });
    return { default: chain };
});

import { state } from '../src/state.js';
import { openControlCenterModal, renderTab, closeCCModal } from '../src/admin-control-ui.js';

const diff = () => ({ pois: [], circuits: [], pendingPhotos: {}, stats: { poisModified: 0, circuitsModified: 0, pendingPhotoCount: 0, testedChanged: 0, rejectedPending: 0 } });
const content = () => document.getElementById('admin-cc-content');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const feat = (id, candidate) => ({ properties: { HW_ID: id, ...(candidate ? { candidate: true } : {}) } });

beforeEach(async () => {
    document.body.innerHTML = '';
    state.loadedFeatures = [feat('a'), feat('c1', true), feat('c2', true), feat('c3', true)];
    state.hiddenPoiIds = ['c3']; // capture supprimée : ne compte pas
    openControlCenterModal(diff(), {});
    await tick(60);
});
afterEach(async () => { closeCCModal(); await tick(400); });

describe('tableau de bord', () => {
    it('« Tout est synchronisé » + « 2 lieux à vérifier », sans les outils', async () => {
        renderTab('dashboard', diff(), {});
        await tick();
        expect(content().textContent).toContain('Tout est synchronisé.');
        expect(content().querySelector('#btn-cc-to-verify').textContent).toContain('2 lieux à vérifier sur Djerba');
        expect(content().querySelector('#btn-cc-tool-scout')).toBeNull();
    });
    it('clic → la carte n’affiche que les lieux à vérifier', async () => {
        renderTab('dashboard', diff(), {});
        await tick();
        content().querySelector('#btn-cc-to-verify').click();
        await vi.waitFor(() => expect(h.onlyCandidates).toHaveBeenCalled());
        expect(h.onlyCandidates).toHaveBeenCalled();
    });
    it('aucune capture → pas de ligne', async () => {
        state.loadedFeatures = [feat('a')];
        renderTab('dashboard', diff(), {});
        await tick();
        expect(content().querySelector('#btn-cc-to-verify')).toBeNull();
    });
});

describe('onglet Outils', () => {
    it('existe entre Modifications et Nettoyage', () => {
        const tabs = [...document.querySelectorAll('.cc-nav-item')].map(b => b.dataset.tab);
        expect(tabs.slice(0, 4)).toEqual(['dashboard', 'changes', 'tools', 'maintenance']);
    });
    it('groupes Lieux, Circuits, Destination ; plus de GeoJSON', async () => {
        renderTab('tools', diff(), {});
        await tick();
        const titles = [...content().querySelectorAll('.cc-section-title')].map(t => t.textContent);
        expect(titles).toEqual(['Lieux', 'Circuits', 'Destination']);
        expect(content().querySelector('#btn-cc-tool-mode-donnees')).not.toBeNull();
        expect(content().querySelector('#btn-cc-upload-circuit-card')).not.toBeNull();
        expect(content().textContent).not.toContain('GeoJSON');
        expect(content().querySelector('#btn-cc-to-verify')).toBeNull();
    });
});
