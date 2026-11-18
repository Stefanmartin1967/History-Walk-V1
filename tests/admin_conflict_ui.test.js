// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Conflits à la publication (18/11/2026), écrans de la maquette validée :
// liste (section « Conflit », « Tout publier » bloqué), écran « Résoudre »
// (champ simple, position, texte en trois zones), téléphone (texte → PC).

const h = vi.hoisted(() => ({ mobile: false }));

vi.mock('../src/state.js', () => {
    const mod = { state: {} };
    mod.DEFAULT_MAP_ID = 'charleroi';
    mod.getActiveMapId = () => 'charleroi';
    mod.getDestinationLabel = () => 'Charleroi';
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
vi.mock('../src/mobile-state.js', () => ({ isMobileView: () => h.mobile }));
vi.mock('leaflet', () => {
    const chain = new Proxy(function () {}, { get: (_t, p) => (p === 'then' ? undefined : chain), apply: () => chain });
    return { default: chain };
});

import { openControlCenterModal, renderTab, setChangesSubView, closeCCModal } from '../src/admin-control-ui.js';

const BASE = 'Église classée depuis 1942. Transformée en 1956.';
function makeDiff() {
    return {
        pois: [
            {
                id: 'G', name: 'Grotte des Sarrasins', changes: [{ key: 'Position', old: 'a', new: 'b' }],
                conflicts: [
                    { key: 'Accès', kind: 'simple', base: '', online: 'Extérieur seulement', local: 'Intérieur visitable' },
                    { key: 'position', kind: 'position', base: [50.3627415, 4.4592714], online: [50.3630564, 4.4594862], local: [50.3627674, 4.4595641] },
                ],
            },
            {
                id: 'C', name: 'Église Saint-Christophe (Charleroi)', changes: [{ key: 'Description', old: 'a', new: 'b' }],
                conflicts: [{
                    key: 'description', kind: 'text', base: BASE,
                    local: 'Église classée depuis 1942. Transformée en 1956, selon Wikipédia.',
                    online: "Église classée depuis 1942. Transformée en 1956. La porte d'entrée, rue Charles II, porte une sculpture d'Oscar Jespers.",
                }],
            },
            { id: 'B', name: 'Beffroi de Charleroi', changes: [{ key: 'Accès', old: 'x', new: 'y' }] },
        ],
        circuits: [], pendingPhotos: {},
        stats: { poisModified: 3, conflictPois: 2, circuitsModified: 0, pendingPhotoCount: 0, testedChanged: 0, rejectedPending: 0 },
    };
}

let diff, callbacks;
const content = () => document.getElementById('admin-cc-content');
const click = (sel) => content().querySelector(sel).click();

const tick = () => new Promise(r => setTimeout(r, 0));

afterEach(async () => { closeCCModal(); await tick(); await new Promise(r => setTimeout(r, 400)); });

beforeEach(async () => {
    document.body.innerHTML = '';
    h.mobile = false;
    diff = makeDiff();
    callbacks = { resolveConflicts: vi.fn(), publishChanges: vi.fn() };
    setChangesSubView('lieux');
    openControlCenterModal(diff, callbacks);
    await new Promise(r => setTimeout(r, 60)); // la modale se monte (délégation, onglet initial) après 30 ms
    renderTab('changes', diff, callbacks);
});

describe('liste', () => {
    it('section Conflit avant Modifié, bannière, et « Tout publier » bloqué', () => {
        expect(content().querySelector('.cc-conflict-banner').textContent).toContain('2 conflits à résoudre');
        const groups = [...content().querySelectorAll('.cc-diff-group')].map(g => g.className);
        expect(groups[0]).toContain('cc-diff-group--conf');
        expect(content().querySelectorAll('.cc-diff--conflict')).toHaveLength(2);
        expect(content().querySelector('.cc-diff-group--mod').textContent).toContain('Beffroi');
        expect(document.getElementById('btn-cc-publish').disabled).toBe(true);
    });
});

describe('écran « Résoudre »', () => {
    it('champ simple et position : choix, « Ici » coché par défaut, choix renvoyés', () => {
        click('[data-action="resolve-conflict"][data-id="G"]');
        expect(content().querySelector('.cc-conflict-title').textContent).toBe('Grotte des Sarrasins');
        expect(content().querySelector('.cc-conflict-field--position').textContent).toContain('33 m');
        expect(content().querySelector('#cc-conflict-map')).not.toBeNull();
        // garder la version en ligne pour l'accès
        const online = content().querySelector('.cc-conflict-field[data-kind="simple"] input[value="online"]');
        online.checked = true;
        click('[data-action="conflict-apply"]');
        expect(callbacks.resolveConflicts).toHaveBeenCalledWith('G', [
            { key: 'Accès', choice: 'online' },
            { key: 'position', choice: 'local' },
        ]);
    });

    it('texte : trois zones, version finale réunie et modifiable', () => {
        click('[data-action="resolve-conflict"][data-id="C"]');
        expect(content().querySelectorAll('.cc-conflict-text')).toHaveLength(2);
        expect(content().querySelector('.cc-conflict-text-body--online mark').textContent).toContain('Oscar Jespers');
        expect(content().querySelector('.cc-conflict-merged')).not.toBeNull();
        const ta = content().querySelector('textarea[data-conflict-key="description"]');
        expect(ta.value).toBe("Église classée depuis 1942. Transformée en 1956, selon Wikipédia. La porte d'entrée, rue Charles II, porte une sculpture d'Oscar Jespers.");
        ta.value = 'Texte retouché.';
        click('[data-action="conflict-apply"]');
        expect(callbacks.resolveConflicts).toHaveBeenCalledWith('C', [{ key: 'description', choice: 'final', value: 'Texte retouché.' }]);
    });

    it('« Tout reprendre de celle-ci » remplit la version finale', () => {
        click('[data-action="resolve-conflict"][data-id="C"]');
        click('[data-action="conflict-take-all"][data-side="online"]');
        expect(content().querySelector('textarea').value).toContain('Oscar Jespers');
        expect(content().querySelector('textarea').value).not.toContain('selon Wikipédia');
    });

    it('« Plus tard » revient à la liste sans rien enregistrer', () => {
        click('[data-action="resolve-conflict"][data-id="G"]');
        click('.cc-conflict-actions [data-action="conflict-back"]');
        expect(content().querySelector('.cc-conflict-banner')).not.toBeNull();
        expect(callbacks.resolveConflicts).not.toHaveBeenCalled();
    });
});

// Une case par phrase (18/11/2026), cas réel de Stefan : la fiche n'avait pas
// de description au départ, tout le texte est disputé.
describe('une case par phrase', () => {
    const ONLINE = "Grotte visitable\nSombre à l'intérieur\nAttention, terrain glissant à la montée";
    const LOCAL = "Grotte\nCette grotte est noire à l'intérieur\nTable de pique nique à proximité";
    const open = () => {
        diff.pois = [{ id: 'S', name: 'Grotte des Sarrasins', changes: [{ key: 'Description', old: 'a', new: 'b' }],
            conflicts: [{ key: 'description', kind: 'text', base: undefined, online: ONLINE, local: LOCAL }] }];
        diff.stats.conflictPois = 1;
        renderTab('changes', diff, callbacks);
        click('[data-action="resolve-conflict"][data-id="S"]');
    };
    const box = (sentence) => [...content().querySelectorAll('input.cc-conflict-sentence')].find(b => b.dataset.sentence === sentence);
    const toggle = (b) => { b.checked = !b.checked; b.dispatchEvent(new Event('change', { bubbles: true })); };
    const ta = () => content().querySelector('textarea');

    it('cases cochées = phrases d’« Ici » ; pas de bloc « Prendre celle-ci »', () => {
        open();
        expect(content().querySelectorAll('input.cc-conflict-sentence')).toHaveLength(6);
        expect(box('Grotte').checked).toBe(true);
        expect(box('Attention, terrain glissant à la montée').checked).toBe(false);
        expect(content().querySelector('[data-action="conflict-take-passage"]')).toBeNull();
        expect(ta().value).toBe(LOCAL);
    });

    it('cocher une phrase en ligne l’ajoute à la fin ; décocher la retire', () => {
        open();
        toggle(box('Attention, terrain glissant à la montée'));
        expect(ta().value).toBe(LOCAL + '\nAttention, terrain glissant à la montée');
        toggle(box('Table de pique nique à proximité'));
        expect(ta().value).toBe("Grotte\nCette grotte est noire à l'intérieur\nAttention, terrain glissant à la montée");
        expect(box('Table de pique nique à proximité').checked).toBe(false);
    });

    it('« Tout reprendre » et retouche à la main : les cases suivent', () => {
        open();
        click('[data-action="conflict-take-all"][data-side="online"]');
        expect(box('Grotte visitable').checked).toBe(true);
        expect(box('Grotte').checked).toBe(false); // phrase entière : « Grotte » ≠ « Grotte visitable »
        expect(box('Table de pique nique à proximité').checked).toBe(false);
        ta().value = 'Grotte visitable';
        ta().dispatchEvent(new Event('input', { bubbles: true }));
        expect(box("Sombre à l'intérieur").checked).toBe(false);
    });
});

describe('téléphone', () => {
    it('un texte se règle sur le PC : pas de zone, rien renvoyé pour lui', () => {
        h.mobile = true;
        renderTab('changes', diff, callbacks);
        click('[data-action="resolve-conflict"][data-id="C"]');
        expect(content().querySelector('textarea')).toBeNull();
        expect(content().querySelector('.cc-conflict-later').textContent).toContain('sur le PC');
        click('[data-action="conflict-apply"]');
        expect(callbacks.resolveConflicts).not.toHaveBeenCalled();
    });
});
