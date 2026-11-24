// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Nettoyage > « Lieux rejetés » (24/11/2026, maquette écran 64 validée par Stefan) :
// l'ancienne modale « Corbeille des rejets » devient un 3e sous-onglet.

const h = vi.hoisted(() => ({
    rejected: {},
    addPoi: vi.fn(async () => {}),
    confirm: vi.fn(async () => true),
    subtabsHtml: '',
    onSub: null,
}));

vi.mock('../src/state.js', () => ({
    state: { myCircuits: [], officialCircuits: [], currentMapId: 'djerba' },
    removeMyCircuit: vi.fn(), setOfficialCircuits: vi.fn(), getActiveMapId: () => 'djerba',
}));
vi.mock('../src/repo-read.js', () => ({ fetchRepoFile: vi.fn(async () => ({ ok: true, json: async () => [] })) }));
vi.mock('../src/github-sync.js', () => ({ getStoredToken: () => null, deleteFileFromGitHub: vi.fn(), uploadFileToGitHub: vi.fn() }));
vi.mock('../src/config.js', () => ({ GITHUB_OWNER: 'o', GITHUB_REPO: 'r', GITHUB_PATHS: { circuits: () => 'x' } }));
vi.mock('../src/database.js', () => ({ deleteCircuitById: vi.fn(), restoreCircuit: vi.fn() }));
vi.mock('../src/circuit-deletion-state.js', () => ({ setOfficialCircuitDeleted: vi.fn(), noteServerDeletedCircuit: vi.fn(), withoutServerDeletedCircuits: (x) => x }));
vi.mock('../src/circuit-store.js', () => ({ forgetDeletedCircuit: vi.fn() }));
vi.mock('../src/events.js', () => ({ eventBus: { emit: vi.fn() } }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/modal.js', () => ({ showConfirm: h.confirm }));
vi.mock('../src/admin-cc-topbar.js', () => ({
    setTopbarSubtabs: (html, cb) => { h.subtabsHtml = html; h.onSub = cb; },
}));
vi.mock('../src/rejected.js', () => ({
    get rejectedData() { return h.rejected; },
    rejectedCount: () => Object.keys(h.rejected).length,
    removeRejected: (ref) => { delete h.rejected[ref]; },
    clearRejected: () => { for (const k of Object.keys(h.rejected)) delete h.rejected[k]; },
}));
vi.mock('../src/rejected-store.js', () => ({ savePendingRejected: vi.fn(async () => {}), pushRejected: vi.fn(async () => {}) }));
vi.mock('../src/data.js', () => ({ addPoiFeature: h.addPoi }));

import { renderMaintenanceTab } from '../src/admin-maintenance.js';

let box;
const openRejected = async () => {
    renderMaintenanceTab(box);
    await vi.waitFor(() => expect(h.onSub).not.toBeNull());
    await vi.waitFor(() => expect(h.subtabsHtml).toContain('Lieux rejetés'));
    h.onSub('rejected');
};

beforeEach(() => {
    h.rejected = {
        'node/1': { osm_ref: 'node/1', name: 'Puits', category: 'Puits', lat: 33.8, lng: 10.9, rejectedAt: Date.UTC(2026, 10, 2, 12) },
        'node/2': { osm_ref: 'node/2', name: 'Fort', category: 'Fortification', lat: 33.7, lng: 10.8 },
    };
    h.addPoi.mockClear(); h.confirm.mockClear();
    h.onSub = null; h.subtabsHtml = '';
    document.body.innerHTML = '<div id="box"></div>';
    box = document.getElementById('box');
});

describe('Nettoyage > Lieux rejetés', () => {
    it('3e sous-onglet avec le compte', async () => {
        await openRejected();
        const tabs = [...new DOMParser().parseFromString(h.subtabsHtml, 'text/html').querySelectorAll('[data-sub]')]
            .map(b => [b.dataset.sub, b.textContent.replace(/\s+/g, ' ').trim()]);
        expect(tabs.map(t => t[0])).toEqual(['trash', 'server', 'rejected']);
        expect(tabs[2][1]).toBe('Lieux rejetés2');
    });
    it('liste, date, phrase explicative', async () => {
        await openRejected();
        expect(box.textContent).toContain('Lieux rejetés au tri · 2');
        expect(box.textContent).toContain('Puits · rejeté le 02/11/2026');
        expect(box.textContent).toContain('Restaurer remet le lieu dans les lieux à vérifier');
        expect(box.querySelectorAll('[data-action="restore-rejected"]').length).toBe(2);
        expect(box.textContent).not.toContain('Mode lecture seule');
    });
    it('Restaurer re-crée la capture et retire le lieu de la liste', async () => {
        await openRejected();
        box.querySelector('[data-ref="node/1"]').click();
        await vi.waitFor(() => expect(box.textContent).toContain('Lieux rejetés au tri · 1'));
        expect(h.addPoi).toHaveBeenCalledTimes(1);
        expect(h.addPoi.mock.calls[0][0].properties).toMatchObject({ candidate: true, osm_ref: 'node/1', 'Nom du site FR': 'Puits' });
    });
    it('Tout vider demande confirmation puis vide', async () => {
        await openRejected();
        box.querySelector('[data-action="clear-rejected"]').click();
        await vi.waitFor(() => expect(box.textContent).toContain('Aucun lieu rejeté.'));
        expect(h.confirm).toHaveBeenCalledTimes(1);
    });
});
