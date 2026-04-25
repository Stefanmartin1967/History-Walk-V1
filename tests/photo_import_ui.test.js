// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/utils.js', () => ({
    resizeImage: vi.fn(() => Promise.resolve('data:image/jpeg;base64,fake'))
}));

import { showPhotoSelectionModal } from '../src/photo-import-ui.js';

function setupModalDOM() {
    document.body.innerHTML = `
        <div id="custom-modal-overlay">
            <div class="custom-modal-box">
                <h2 id="custom-modal-title"></h2>
                <div id="custom-modal-message"></div>
                <div id="custom-modal-actions"></div>
            </div>
        </div>
    `;
}

function makeItems(count) {
    return Array.from({ length: count }, (_, i) => ({
        file: new File(['x'], `photo-${i}.jpg`, { type: 'image/jpeg' }),
        coords: { lat: 35 + i * 0.001, lng: 10 + i * 0.001 }
    }));
}

beforeEach(() => {
    setupModalDOM();
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showPhotoSelectionModal — sécurité DOM', () => {
    it('overlay absent → resolve(null) sans throw', async () => {
        document.body.innerHTML = '';
        const result = await showPhotoSelectionModal('Title', 'Intro', makeItems(2));
        expect(result).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showPhotoSelectionModal — render structure', () => {
    it('définit le titre via title.textContent', () => {
        showPhotoSelectionModal('Mon Titre', 'intro', makeItems(2));
        expect(document.getElementById('custom-modal-title').textContent).toBe('Mon Titre');
    });

    it('intro avec \\n converti en <br>', () => {
        showPhotoSelectionModal('T', 'ligne1\nligne2', makeItems(1));
        const intro = document.querySelector('.photo-selection-intro');
        expect(intro.innerHTML).toContain('ligne1<br>ligne2');
    });

    it('grid #photo-selection-grid présent + ouverture overlay (active class)', () => {
        showPhotoSelectionModal('T', 'i', makeItems(2));
        expect(document.getElementById('photo-selection-grid')).not.toBeNull();
        expect(document.getElementById('custom-modal-overlay').classList.contains('active')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showPhotoSelectionModal — pagination', () => {
    it('items ≤ 9 (PAGE_SIZE) → pas de pagination controls', () => {
        showPhotoSelectionModal('T', 'i', makeItems(5));
        const pagination = document.querySelector('.pagination-controls');
        expect(pagination.children.length).toBe(0);
    });

    it('items > 9 → boutons Précédent/Suivant + pageInfo "Page X / Y"', () => {
        showPhotoSelectionModal('T', 'i', makeItems(20)); // 3 pages
        const pagination = document.querySelector('.pagination-controls');
        const buttons = pagination.querySelectorAll('button');
        expect(buttons).toHaveLength(2);
        expect(buttons[0].textContent).toContain('Précédent');
        expect(buttons[1].textContent).toContain('Suivant');
        const pageInfo = pagination.querySelector('span');
        expect(pageInfo.textContent).toBe('Page 1 / 3');
    });

    it('page 0 (initial) : bouton Précédent disabled, Suivant actif', () => {
        showPhotoSelectionModal('T', 'i', makeItems(20));
        const buttons = document.querySelectorAll('.pagination-controls button');
        expect(buttons[0].disabled).toBe(true);
        expect(buttons[1].disabled).toBe(false);
    });

    it('click Suivant deux fois → page 3/3, Suivant disabled, Précédent actif', () => {
        showPhotoSelectionModal('T', 'i', makeItems(20));
        const nextBtn = document.querySelectorAll('.pagination-controls button')[1];
        nextBtn.click(); // page 2
        nextBtn.click(); // page 3
        // Note : après chaque click, le DOM est re-render, on doit re-query
        const buttons = document.querySelectorAll('.pagination-controls button');
        const pageInfo = document.querySelector('.pagination-controls span');
        expect(pageInfo.textContent).toBe('Page 3 / 3');
        expect(buttons[0].disabled).toBe(false);
        expect(buttons[1].disabled).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showPhotoSelectionModal — sélection (selectAll par défaut)', () => {
    it('toutes les cartes ont class "selected" au rendu initial', () => {
        showPhotoSelectionModal('T', 'i', makeItems(3));
        const cards = document.querySelectorAll('.photo-selection-item');
        cards.forEach(c => {
            expect(c.classList.contains('selected')).toBe(true);
        });
    });

    it('click sur une carte → toggle .selected (true → false)', () => {
        showPhotoSelectionModal('T', 'i', makeItems(3));
        const card = document.querySelector('.photo-selection-item');
        expect(card.classList.contains('selected')).toBe(true);
        card.click();
        expect(card.classList.contains('selected')).toBe(false);
        card.click();
        expect(card.classList.contains('selected')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showPhotoSelectionModal — actions Import / Ignorer', () => {
    it('click Import → resolve(selectedItems) + ferme l\'overlay', async () => {
        const items = makeItems(3);
        const promise = showPhotoSelectionModal('T', 'i', items);
        const buttons = document.querySelectorAll('#custom-modal-actions button');
        buttons[0].click(); // Import (toutes pré-sélectionnées)

        const result = await promise;
        expect(result).toEqual(items);
        expect(document.getElementById('custom-modal-overlay').classList.contains('active')).toBe(false);
    });

    it('click Import après désélection partielle → resolve avec sous-ensemble', async () => {
        const items = makeItems(3);
        const promise = showPhotoSelectionModal('T', 'i', items);
        // Désélectionne la 1ère carte
        document.querySelectorAll('.photo-selection-item')[0].click();

        const importBtn = document.querySelectorAll('#custom-modal-actions button')[0];
        importBtn.click();

        const result = await promise;
        expect(result).toEqual([items[1], items[2]]);
    });

    it('sélection vide → bouton Import disabled (count=0)', () => {
        const items = makeItems(2);
        showPhotoSelectionModal('T', 'i', items);
        // Désélectionne tout
        document.querySelectorAll('.photo-selection-item').forEach(c => c.click());

        const importBtn = document.querySelectorAll('#custom-modal-actions button')[0];
        expect(importBtn.disabled).toBe(true);
    });

    it('click Ignorer → resolve(null) + ferme l\'overlay', async () => {
        const items = makeItems(2);
        const promise = showPhotoSelectionModal('T', 'i', items);
        const buttons = document.querySelectorAll('#custom-modal-actions button');
        // Pas d'extraAction : Ignorer est en index 1 (juste après Import)
        buttons[buttons.length - 1].click(); // dernier = Ignorer

        const result = await promise;
        expect(result).toBeNull();
        expect(document.getElementById('custom-modal-overlay').classList.contains('active')).toBe(false);
    });

    it('label Import dynamique : "${confirmLabel} (${count})"', () => {
        showPhotoSelectionModal('T', 'i', makeItems(3), 'Importer');
        const importBtn = document.querySelectorAll('#custom-modal-actions button')[0];
        // 3 items pré-sélectionnés
        expect(importBtn.textContent).toBe('Importer (3)');
        // Désélectionne 1
        document.querySelectorAll('.photo-selection-item')[0].click();
        expect(importBtn.textContent).toBe('Importer (2)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showPhotoSelectionModal — extraAction', () => {
    it('extraAction présent : 3 boutons (Import + Extra + Ignorer)', () => {
        showPhotoSelectionModal('T', 'i', makeItems(2), 'Importer', { label: 'Forcer', value: 'force' });
        const buttons = document.querySelectorAll('#custom-modal-actions button');
        expect(buttons).toHaveLength(3);
        expect(buttons[1].textContent).toContain('Forcer');
    });

    it('extraAction absent : 2 boutons seulement (Import + Ignorer)', () => {
        showPhotoSelectionModal('T', 'i', makeItems(2));
        const buttons = document.querySelectorAll('#custom-modal-actions button');
        expect(buttons).toHaveLength(2);
    });

    it('click extraAction → resolve avec selectedItems augmenté de .action = value', async () => {
        const items = makeItems(2);
        const promise = showPhotoSelectionModal('T', 'i', items, 'Importer', { label: 'Forcer', value: 'force-add' });
        const buttons = document.querySelectorAll('#custom-modal-actions button');
        buttons[1].click(); // Extra (Forcer)

        const result = await promise;
        expect(result).toHaveLength(2);
        expect(result[0]).toBe(items[0]);
        expect(result[1]).toBe(items[1]);
        expect(result.action).toBe('force-add');
    });
});
