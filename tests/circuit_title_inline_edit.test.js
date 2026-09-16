// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Régression du 16/09/2026 — renommage perdu à la publication.
//
// L'édition inline du titre remplace le <h2> par un <input>, puis par un NOUVEL
// <h2>. `DOM.circuitTitleText` (mis en cache au boot) et la référence prise à
// l'init désignaient ensuite l'ancien nœud, détaché : l'enregistrement y lisait
// l'ancien nom, l'en-tête n'était plus mis à jour, et un 2ᵉ renommage ne
// s'ouvrait plus. En prime, retirer l'<input> déclenchait son `blur`, qui
// rappelait la fin d'édition : Échap appliquait quand même la saisie.

const { sharedState } = vi.hoisted(() => ({
    sharedState: { isAdmin: true, activeCircuitId: null },
}));

const setCustomDraftName = vi.fn();
const saveCircuitDraft = vi.fn();
const persistCircuit = vi.fn(async () => {});

vi.mock('../src/state.js', () => ({
    state: sharedState,
    setCustomDraftName: (...a) => setCustomDraftName(...a),
}));
vi.mock('../src/ui-dom.js', () => ({ DOM: {} }));
vi.mock('../src/circuit.js', () => ({
    saveCircuitDraft: (...a) => saveCircuitDraft(...a),
    isCircuitTested: vi.fn(() => false),
}));
vi.mock('../src/circuit-view.js', () => ({ updateTransportSummary: vi.fn() }));
vi.mock('../src/circuit-actions.js', () => ({
    handleCircuitVisitedToggle: vi.fn(),
    setCircuitHidden: vi.fn(),
}));
vi.mock('../src/circuit-store.js', () => ({ persistCircuit: (...a) => persistCircuit(...a) }));
vi.mock('../src/data.js', () => ({ getPoiId: vi.fn() }));
vi.mock('../src/gpx.js', () => ({ generateAndDownloadGPX: vi.fn() }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } }));
vi.mock('../src/circuit-lookup.js', () => ({
    getActiveCircuit: vi.fn(() => null),
    findCircuitById: vi.fn((id) => ({ id, name: 'Nom enregistré' })),
}));

import { DOM } from '../src/ui-dom.js';
import { initCircuitPageEvents } from '../src/ui-circuit-page-events.js';

const title = () => document.getElementById('circuit-title-text');

function openEditor() {
    title().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = title();
    expect(input.tagName).toBe('INPUT');
    return input;
}

function press(input, key) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

beforeAll(() => {
    document.body.innerHTML = `
        <div id="circuit-panel" data-mode="create">
            <h2 class="cp-title" id="circuit-title-text">Boucle autour de Rym Beach</h2>
            <button id="cp-title-edit-btn"></button>
        </div>`;
    // Comme ui.js au boot : le cache pointe sur l'élément d'origine.
    DOM.circuitTitleText = title();
    initCircuitPageEvents();
});

beforeEach(() => {
    document.getElementById('circuit-panel').setAttribute('data-mode', 'create');
    sharedState.activeCircuitId = null;
    vi.clearAllMocks();
});

describe('édition inline du titre de circuit', () => {
    it('après un renommage, le cache DOM désigne le titre affiché', () => {
        const input = openEditor();
        input.value = 'Boucle autour de Rym Beach via le mausolée Lella Hadhria';
        press(input, 'Enter');

        expect(title().tagName).toBe('H2');
        expect(DOM.circuitTitleText).toBe(title());
        expect(DOM.circuitTitleText.isConnected).toBe(true);
        expect(title().textContent).toBe('Boucle autour de Rym Beach via le mausolée Lella Hadhria');
        expect(setCustomDraftName).toHaveBeenCalledTimes(1);
        expect(setCustomDraftName).toHaveBeenCalledWith('Boucle autour de Rym Beach via le mausolée Lella Hadhria');
    });

    it('un 2ᵉ renommage s\'ouvre (double-clic et crayon) et part dans l\'état', () => {
        let input = openEditor();
        input.value = 'Premier nom';
        press(input, 'Enter');

        input = openEditor();
        expect(input.value).toBe('Premier nom');
        input.value = 'Second nom';
        press(input, 'Enter');
        expect(setCustomDraftName).toHaveBeenLastCalledWith('Second nom');

        document.getElementById('cp-title-edit-btn').click();
        expect(title().tagName).toBe('INPUT');
        press(title(), 'Escape');
        expect(DOM.circuitTitleText).toBe(title());
    });

    it('Échap n\'applique pas la saisie (le blur qui suit ne relance rien)', () => {
        const before = title().textContent;
        const input = openEditor();
        input.value = 'Saisie abandonnée';
        press(input, 'Escape');

        expect(title().textContent).toBe(before);
        expect(setCustomDraftName).not.toHaveBeenCalled();
        expect(saveCircuitDraft).not.toHaveBeenCalled();
    });

    it('consultation admin : un seul renommage persisté, sous le même id', async () => {
        document.getElementById('circuit-panel').setAttribute('data-mode', 'consult');
        sharedState.activeCircuitId = 'HW-OFF';
        const input = openEditor();
        input.value = 'Nom corrigé';
        press(input, 'Enter');
        await Promise.resolve();

        expect(persistCircuit).toHaveBeenCalledTimes(1);
        expect(persistCircuit).toHaveBeenCalledWith({ id: 'HW-OFF', name: 'Nom corrigé' });
        expect(DOM.circuitTitleText).toBe(title());
    });
});
