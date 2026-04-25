// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    closeModal,
    showCustomModal,
    showConfirm,
    showPrompt,
    showAlert
} from '../src/modal.js';

// Helper: build the modal DOM that the module expects
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

beforeEach(() => {
    setupModalDOM();
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('closeModal', () => {
    it('retire la class "active" de l\'overlay', () => {
        const overlay = document.getElementById('custom-modal-overlay');
        overlay.classList.add('active');
        closeModal();
        expect(overlay.classList.contains('active')).toBe(false);
    });

    it('no-op silencieux si overlay absent (pas de throw)', () => {
        document.body.innerHTML = '';
        expect(() => closeModal()).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showCustomModal', () => {
    it('définit le titre via title.textContent', () => {
        showCustomModal('Mon Titre', 'contenu');
        expect(document.getElementById('custom-modal-title').textContent).toBe('Mon Titre');
    });

    it('content string → message.innerHTML = string', () => {
        showCustomModal('T', '<span>html-content</span>');
        const msg = document.getElementById('custom-modal-message');
        expect(msg.innerHTML).toBe('<span>html-content</span>');
        expect(msg.querySelector('span').textContent).toBe('html-content');
    });

    it('content HTMLElement → message.appendChild(element)', () => {
        const el = document.createElement('div');
        el.id = 'custom-content';
        el.textContent = 'inner';
        showCustomModal('T', el);
        expect(document.getElementById('custom-content')).toBe(el);
    });

    it('actions string → actions.innerHTML = string', () => {
        showCustomModal('T', 'msg', '<button id="x">X</button>');
        expect(document.getElementById('x')).toBeTruthy();
    });

    it('actions HTMLElement → actions.appendChild(element)', () => {
        const btn = document.createElement('button');
        btn.id = 'btn-action';
        showCustomModal('T', 'msg', btn);
        expect(document.getElementById('btn-action')).toBe(btn);
    });

    it('customClass est ajouté à box.classList', () => {
        showCustomModal('T', 'msg', null, 'modal-special');
        const box = document.querySelector('.custom-modal-box');
        expect(box.classList.contains('modal-special')).toBe(true);
    });

    it('ouvre l\'overlay (ajout class "active")', () => {
        showCustomModal('T', 'msg');
        expect(document.getElementById('custom-modal-overlay').classList.contains('active')).toBe(true);
    });

    it('no-op si overlay absent (pas de throw)', () => {
        document.body.innerHTML = '';
        expect(() => showCustomModal('T', 'msg')).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showConfirm', () => {
    it('retourne une Promise', () => {
        const p = showConfirm('T', 'M');
        expect(p).toBeInstanceOf(Promise);
        // Resolve to clean up
        const cancelBtn = document.querySelectorAll('#custom-modal-actions button')[1];
        cancelBtn?.click();
        return p;
    });

    it('click confirm → resolve(true) et closeModal', async () => {
        const p = showConfirm('Suppr?', 'Sûr ?', 'Oui', 'Non');
        const btns = document.querySelectorAll('#custom-modal-actions button');
        const confirmBtn = btns[0]; // confirm est en premier
        confirmBtn.click();

        const result = await p;
        expect(result).toBe(true);
        expect(document.getElementById('custom-modal-overlay').classList.contains('active')).toBe(false);
    });

    it('click cancel → resolve(false) et closeModal', async () => {
        const p = showConfirm('Suppr?', 'Sûr ?');
        const btns = document.querySelectorAll('#custom-modal-actions button');
        const cancelBtn = btns[1];
        cancelBtn.click();

        const result = await p;
        expect(result).toBe(false);
        expect(document.getElementById('custom-modal-overlay').classList.contains('active')).toBe(false);
    });

    it('utilise les labels custom passés en argument', () => {
        showConfirm('T', 'M', 'Supprimer', 'Garder');
        const btns = document.querySelectorAll('#custom-modal-actions button');
        expect(btns[0].textContent).toBe('Supprimer');
        expect(btns[1].textContent).toBe('Garder');
    });

    it('isDanger=true → bouton confirm a class "danger" (vs "primary")', () => {
        showConfirm('T', 'M', 'OK', 'NO', true);
        const confirmBtn = document.querySelector('#custom-modal-actions button');
        expect(confirmBtn.classList.contains('danger')).toBe(true);
        expect(confirmBtn.classList.contains('primary')).toBe(false);
    });

    it('isDanger=false (default) → bouton confirm a class "primary"', () => {
        showConfirm('T', 'M');
        const confirmBtn = document.querySelector('#custom-modal-actions button');
        expect(confirmBtn.classList.contains('primary')).toBe(true);
        expect(confirmBtn.classList.contains('danger')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showPrompt', () => {
    it('retourne une Promise', () => {
        const p = showPrompt('T', 'M');
        const btns = document.querySelectorAll('#custom-modal-actions button');
        btns[1]?.click(); // cancel
        return p;
    });

    it('click Valider → resolve(value de l\'input)', async () => {
        const p = showPrompt('Renommer', 'Nouveau nom :');
        const input = document.getElementById('custom-modal-input');
        input.value = 'mon nouveau nom';

        const btns = document.querySelectorAll('#custom-modal-actions button');
        btns[0].click(); // Valider

        const result = await p;
        expect(result).toBe('mon nouveau nom');
    });

    it('click Annuler → resolve(null)', async () => {
        const p = showPrompt('T', 'M');
        const btns = document.querySelectorAll('#custom-modal-actions button');
        btns[1].click(); // Annuler

        const result = await p;
        expect(result).toBeNull();
    });

    it('defaultValue est pré-rempli dans l\'input', () => {
        showPrompt('T', 'M', 'valeur initiale');
        const input = document.getElementById('custom-modal-input');
        expect(input.value).toBe('valeur initiale');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showAlert', () => {
    it('retourne une Promise', () => {
        const p = showAlert('T', 'M');
        document.querySelector('#custom-modal-actions button')?.click();
        return p;
    });

    it('click OK → resolve() et closeModal', async () => {
        const p = showAlert('Info', 'Ceci est une alerte', 'Compris');
        const btn = document.querySelector('#custom-modal-actions button');
        expect(btn.textContent).toBe('Compris');
        btn.click();

        await expect(p).resolves.toBeUndefined();
        expect(document.getElementById('custom-modal-overlay').classList.contains('active')).toBe(false);
    });

    it('customClass appliqué sur box', () => {
        const p = showAlert('T', 'M', 'OK', 'modal-info');
        const box = document.querySelector('.custom-modal-box');
        expect(box.classList.contains('modal-info')).toBe(true);
        document.querySelector('#custom-modal-actions button').click();
        return p;
    });

    it('onReady callback appelé avec { messageContainer, overlay }', () => {
        const onReady = vi.fn();
        const p = showAlert('T', 'M', 'OK', null, onReady);

        expect(onReady).toHaveBeenCalledTimes(1);
        const arg = onReady.mock.calls[0][0];
        expect(arg.messageContainer).toBe(document.getElementById('custom-modal-message'));
        expect(arg.overlay).toBe(document.getElementById('custom-modal-overlay'));

        document.querySelector('#custom-modal-actions button').click();
        return p;
    });
});
