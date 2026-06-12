// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    closeModal,
    closeHwModal,
    showCustomModal,
    showConfirm,
    showPrompt,
    showAlert
} from '../src/modal.js';

// Migration V2 : showAlert/showConfirm/showPrompt/showCustomModal délèguent à
// openHwModal (système hw-modal). Le DOM produit est .hw-modal-overlay /
// .hw-modal-title / .hw-modal-body / .hw-modal-footer, plus des boutons
// avec data-attributes [data-confirm-action], [data-prompt-action],
// [data-alert-action] écoutés via délégation au top-level du module.

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    // Nettoyage : ferme toute modale V2 qui traînerait pour ne pas polluer le
    // test suivant (les listeners globaux sont module-level et persistent).
    closeHwModal();
    document.body.innerHTML = '';
    vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('closeModal', () => {
    it('retire la class "active" de l\'overlay legacy si présent', () => {
        document.body.innerHTML = `<div id="custom-modal-overlay" class="active"></div>`;
        const overlay = document.getElementById('custom-modal-overlay');
        closeModal();
        expect(overlay.classList.contains('active')).toBe(false);
    });

    it('no-op silencieux si aucune modale (pas de throw)', () => {
        expect(() => closeModal()).not.toThrow();
    });

    it('ferme aussi la modale V2 active', () => {
        showCustomModal('T', 'msg');
        expect(document.querySelector('.hw-modal-overlay.is-active')).toBeTruthy();
        closeModal();
        expect(document.querySelector('.hw-modal-overlay.is-active')).toBeFalsy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showCustomModal', () => {
    it('ouvre une modale V2 avec le titre fourni', () => {
        showCustomModal('Mon Titre', 'contenu');
        expect(document.querySelector('.hw-modal-title').textContent).toBe('Mon Titre');
    });

    it('content string → body.innerHTML = string', () => {
        showCustomModal('T', '<span>html-content</span>');
        const body = document.querySelector('.hw-modal-body');
        expect(body.innerHTML).toBe('<span>html-content</span>');
        expect(body.querySelector('span').textContent).toBe('html-content');
    });

    it('content HTMLElement → body contient l\'élément', () => {
        const el = document.createElement('div');
        el.id = 'custom-content';
        el.textContent = 'inner';
        showCustomModal('T', el);
        const found = document.getElementById('custom-content');
        expect(found).toBeTruthy();
        expect(found.textContent).toBe('inner');
    });

    it('actions string → footer.innerHTML = string', () => {
        showCustomModal('T', 'msg', '<button id="x">X</button>');
        expect(document.getElementById('x')).toBeTruthy();
    });

    it('actions HTMLElement → footer contient l\'élément', () => {
        const btn = document.createElement('button');
        btn.id = 'btn-action';
        btn.textContent = 'Go';
        showCustomModal('T', 'msg', btn);
        const found = document.getElementById('btn-action');
        expect(found).toBeTruthy();
        expect(found.textContent).toBe('Go');
    });

    it('customClass est silencieusement ignoré (rétro-compat V2)', () => {
        showCustomModal('T', 'msg', null, 'modal-special');
        expect(document.querySelector('.hw-modal-overlay')).toBeTruthy();
        expect(document.querySelector('.modal-special')).toBeFalsy();
    });

    it('marque l\'overlay actif (is-active)', () => {
        showCustomModal('T', 'msg');
        expect(document.querySelector('.hw-modal-overlay').classList.contains('is-active')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showConfirm', () => {
    it('retourne une Promise', async () => {
        const p = showConfirm('T', 'M');
        expect(p).toBeInstanceOf(Promise);
        document.querySelector('[data-confirm-action="cancel"]')?.click();
        await p;
    });

    it('click confirm → resolve(true) et ferme la modale', async () => {
        const p = showConfirm('Suppr?', 'Sûr ?', 'Oui', 'Non');
        document.querySelector('[data-confirm-action="confirm"]').click();
        const result = await p;
        expect(result).toBe(true);
        expect(document.querySelector('.hw-modal-overlay.is-active')).toBeFalsy();
    });

    it('click cancel → resolve(false) et ferme la modale', async () => {
        const p = showConfirm('Suppr?', 'Sûr ?');
        document.querySelector('[data-confirm-action="cancel"]').click();
        const result = await p;
        expect(result).toBe(false);
        expect(document.querySelector('.hw-modal-overlay.is-active')).toBeFalsy();
    });

    it('utilise les labels custom passés en argument', async () => {
        const p = showConfirm('T', 'M', 'Supprimer', 'Garder');
        const confirmBtn = document.querySelector('[data-confirm-action="confirm"]');
        const cancelBtn = document.querySelector('[data-confirm-action="cancel"]');
        expect(confirmBtn.textContent).toBe('Supprimer');
        expect(cancelBtn.textContent).toBe('Garder');
        cancelBtn.click();
        await p;
    });

    it('isDanger=true → bouton confirm a class "btn-danger" (vs btn-primary)', async () => {
        const p = showConfirm('T', 'M', 'OK', 'NO', true);
        const confirmBtn = document.querySelector('[data-confirm-action="confirm"]');
        expect(confirmBtn.classList.contains('btn-danger')).toBe(true);
        expect(confirmBtn.classList.contains('btn-primary')).toBe(false);
        confirmBtn.click();
        await p;
    });

    it('isDanger=false (default) → bouton confirm a class "btn-primary"', async () => {
        const p = showConfirm('T', 'M');
        const confirmBtn = document.querySelector('[data-confirm-action="confirm"]');
        expect(confirmBtn.classList.contains('btn-primary')).toBe(true);
        expect(confirmBtn.classList.contains('btn-danger')).toBe(false);
        confirmBtn.click();
        await p;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showPrompt', () => {
    it('retourne une Promise', async () => {
        const p = showPrompt('T', 'M');
        document.querySelector('[data-prompt-action="cancel"]')?.click();
        await p;
    });

    it('click Valider → resolve(value de l\'input)', async () => {
        const p = showPrompt('Renommer', 'Nouveau nom :');
        const input = document.getElementById('hw-prompt-input');
        input.value = 'mon nouveau nom';
        document.querySelector('[data-prompt-action="confirm"]').click();
        const result = await p;
        expect(result).toBe('mon nouveau nom');
    });

    it('click Annuler → resolve(null)', async () => {
        const p = showPrompt('T', 'M');
        document.querySelector('[data-prompt-action="cancel"]').click();
        const result = await p;
        expect(result).toBeNull();
    });

    it('defaultValue est pré-rempli dans l\'input', async () => {
        const p = showPrompt('T', 'M', 'valeur initiale');
        const input = document.getElementById('hw-prompt-input');
        expect(input.value).toBe('valeur initiale');
        document.querySelector('[data-prompt-action="cancel"]').click();
        await p;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Accessibilité AC1 (audit Vague 4 PR3) : rôle dialogue + restitution du focus.
// Le CYCLAGE du Tab (trapHwFocus) n'est pas testable sous jsdom (offsetParent
// toujours null → liste des focusables vide) : il est vérifié en preview.
describe('accessibilité modale (AC1)', () => {
    it('la modale porte role="dialog", aria-modal et un aria-labelledby qui pointe le titre', async () => {
        const p = showConfirm('Titre accessible', 'M');
        const modal = document.querySelector('.hw-modal');
        expect(modal.getAttribute('role')).toBe('dialog');
        expect(modal.getAttribute('aria-modal')).toBe('true');
        const labelledby = modal.getAttribute('aria-labelledby');
        expect(labelledby).toBeTruthy();
        const titleEl = document.getElementById(labelledby);
        expect(titleEl).toBeTruthy();
        expect(titleEl.textContent).toBe('Titre accessible');
        document.querySelector('[data-confirm-action="cancel"]').click();
        await p;
    });

    it('chaque modale a un id de titre unique (pas de collision aria-labelledby)', async () => {
        // NB : l'overlay fermé reste 300ms dans le DOM (transition) → on cible
        // toujours la modale ACTIVE, pas la première du document.
        const activeModal = () => document.querySelector('.hw-modal-overlay.is-active .hw-modal');
        const p1 = showConfirm('A', 'M');
        const id1 = activeModal().getAttribute('aria-labelledby');
        document.querySelector('.hw-modal-overlay.is-active [data-confirm-action="cancel"]').click();
        await p1;
        const p2 = showConfirm('B', 'M');
        const id2 = activeModal().getAttribute('aria-labelledby');
        document.querySelector('.hw-modal-overlay.is-active [data-confirm-action="cancel"]').click();
        await p2;
        expect(id1).not.toBe(id2);
    });

    it('à l\'ouverture, le focus entre dans la modale (repli croix sous jsdom)', async () => {
        const p = showConfirm('T', 'M');
        const modal = document.querySelector('.hw-modal');
        expect(modal.contains(document.activeElement)).toBe(true);
        document.querySelector('[data-confirm-action="cancel"]').click();
        await p;
    });

    it('à la fermeture, le focus revient sur l\'élément qui a ouvert la modale', async () => {
        const btn = document.createElement('button');
        btn.id = 'opener-btn';
        document.body.appendChild(btn);
        btn.focus();
        expect(document.activeElement).toBe(btn);
        const p = showConfirm('T', 'M');
        expect(document.activeElement).not.toBe(btn);
        document.querySelector('[data-confirm-action="cancel"]').click();
        await p;
        expect(document.activeElement).toBe(btn);
    });

    it('ouvreur disparu entre-temps → fermeture sans throw, focus non restauré', async () => {
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        btn.focus();
        const p = showConfirm('T', 'M');
        btn.remove();
        expect(() => document.querySelector('[data-confirm-action="cancel"]').click()).not.toThrow();
        await p;
        expect(document.activeElement).not.toBe(btn);
    });

    it('chaînage A→B : fermer B restitue le focus à l\'ouvreur initial (hérité)', async () => {
        const btn = document.createElement('button');
        btn.id = 'origin';
        document.body.appendChild(btn);
        btn.focus();
        const pA = showConfirm('A', 'M');
        // B s'ouvre pendant que A est active (stacking interdit → A fermée).
        // Le focus vit dans A → B doit hériter de l'ouvreur de A (le bouton).
        const pB = showConfirm('B', 'M');
        await pA; // A a été résolue par le remplacement
        document.querySelector('[data-confirm-action="cancel"]').click();
        await pB;
        expect(document.activeElement).toBe(btn);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('showAlert', () => {
    it('retourne une Promise', async () => {
        const p = showAlert('T', 'M');
        document.querySelector('[data-alert-action="ok"]')?.click();
        await p;
    });

    it('click OK → resolve() et ferme la modale', async () => {
        const p = showAlert('Info', 'Ceci est une alerte', 'Compris');
        const btn = document.querySelector('[data-alert-action="ok"]');
        expect(btn.textContent).toBe('Compris');
        btn.click();
        await expect(p).resolves.toBeUndefined();
        expect(document.querySelector('.hw-modal-overlay.is-active')).toBeFalsy();
    });

    it('customClass est silencieusement ignoré (rétro-compat V2)', async () => {
        const p = showAlert('T', 'M', 'OK', 'modal-info');
        expect(document.querySelector('.hw-modal-overlay')).toBeTruthy();
        expect(document.querySelector('.modal-info')).toBeFalsy();
        document.querySelector('[data-alert-action="ok"]').click();
        await p;
    });

    it('onReady callback appelé avec { messageContainer, overlay }', async () => {
        vi.useFakeTimers();
        const onReady = vi.fn();
        const p = showAlert('T', 'M', 'OK', null, onReady);

        // V2 utilise setTimeout(30) pour appeler onReady après render
        await vi.advanceTimersByTimeAsync(50);
        expect(onReady).toHaveBeenCalledTimes(1);
        const arg = onReady.mock.calls[0][0];
        expect(arg.messageContainer).toBe(document.querySelector('.hw-modal-body'));
        expect(arg.overlay).toBe(document.querySelector('.hw-modal-overlay'));

        vi.useRealTimers();
        document.querySelector('[data-alert-action="ok"]').click();
        await p;
    });
});
