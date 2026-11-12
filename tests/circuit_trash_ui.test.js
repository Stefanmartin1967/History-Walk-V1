// @vitest-environment jsdom
// Corbeille des circuits (src/circuit-trash-ui.js) : après une suppression
// définitive ou une restauration, la liste « Mes circuits » doit être redessinée
// AVEC sa barre d'outils, qui porte la pastille de la corbeille. Avant le
// 12/11/2026, seule la liste l'était : la pastille gardait l'ancien nombre.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const emit = vi.fn();
vi.mock('../src/events.js', () => ({ eventBus: { emit, on: vi.fn() } }));
vi.mock('../src/database.js', () => ({ restoreCircuit: vi.fn(async () => {}), deleteCircuitById: vi.fn(async () => {}) }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
// Shell de modale minimal : injecte le corps dans un overlay actif.
vi.mock('../src/modal.js', () => ({
    openHwModal: ({ body }) => {
        document.body.innerHTML = `<div class="hw-modal-overlay is-active"><div class="hw-modal"><div class="hw-modal-body">${body}</div></div></div>`;
        return new Promise(() => {});
    },
    closeHwModal: vi.fn(),
}));

const { state } = await import('../src/state.js');
const { openCircuitTrash, getTrashedCount } = await import('../src/circuit-trash-ui.js');

const flush = () => new Promise(r => setTimeout(r, 0));
// jsdom n'a pas CSS.escape (utilisé par le bouton « Restaurer »).
globalThis.CSS = globalThis.CSS || { escape: (s) => String(s) };

describe('corbeille des circuits — la pastille suit', () => {
    beforeEach(() => {
        emit.mockClear();
        state.myCircuits = [
            { id: 'c1', name: 'Boucle test', poiIds: ['a', 'b', 'a'], isDeleted: true },
            { id: 'c2', name: 'Gardé', poiIds: ['a', 'b'] },
        ];
    });

    it('suppression définitive : circuit retiré et liste + barre redessinées', async () => {
        expect(getTrashedCount()).toBe(1);
        openCircuitTrash();
        await flush();
        document.querySelector('[data-action="delete"][data-id="c1"]').click();
        document.querySelector('[data-confirm="ok"]').click();
        await flush();
        expect(getTrashedCount()).toBe(0);
        expect(state.myCircuits.map(c => c.id)).toEqual(['c2']);
        expect(emit).toHaveBeenCalledWith('ui:render-explorer-list');
    });

    it('restauration : liste + barre redessinées', async () => {
        vi.useFakeTimers();
        openCircuitTrash();
        await vi.runAllTimersAsync();
        document.querySelector('[data-action="restore"][data-id="c1"]').click();
        await vi.runAllTimersAsync();
        vi.useRealTimers();
        expect(getTrashedCount()).toBe(0);
        expect(emit).toHaveBeenCalledWith('ui:render-explorer-list');
    });
});
