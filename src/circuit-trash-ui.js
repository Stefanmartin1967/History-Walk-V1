// circuit-trash-ui.js — Corbeille des circuits supprimés.
// Détachée de Mon Espace (qui va disparaître) : la corbeille vit désormais à côté
// de « Mes circuits » via un bouton dans la toolbar de la sidebar. La modale
// utilise le shell V2 partagé (openHwModal).
//
// Cycle de vie d'un circuit supprimé :
//   ui-details.js → eventBus('poi:request-soft-delete') (non, c'est pour les POIs)
//   sidebar circuits → softDeleteCircuit() en DB + isDeleted=true en state
//   → ici : restauration ou purge définitive, avec confirm bloquant pour la purge.

import { state } from './state.js';
import { restoreCircuit, deleteCircuitById } from './database.js';
import { showToast } from './toast.js';
import { openHwModal, closeHwModal } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { renderExplorerList } from './ui-circuit-list.js';

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

/** Nombre de circuits actuellement en corbeille (utilisé pour le badge toolbar). */
export function getTrashedCount() {
    return (state.myCircuits || []).filter(c => c.isDeleted).length;
}

/**
 * Ouvre la modale Corbeille. Idempotent côté openHwModal (stacking interdit).
 */
export function openCircuitTrash() {
    openHwModal({
        size: 'md',
        icon: 'trash-2',
        title: 'Corbeille',
        body: renderBody(),
        footer: false,
        closeOnBackdrop: true,
        closeOnEscape: true,
    });
    // Listeners attachés après le paint du body (openHwModal injecte le HTML
    // synchroniquement, mais les data-action sont posés dans le markup ci-dessus).
    queueMicrotask(attachListeners);
}

function renderBody() {
    const deleted = (state.myCircuits || []).filter(c => c.isDeleted);
    if (deleted.length === 0) {
        return `
<div class="me-empty">
  <div class="me-empty-mark"><i data-lucide="package-check"></i></div>
  <p class="me-empty-title">Corbeille vide</p>
  <p class="me-empty-sub">
    Les circuits supprimés apparaîtront ici. Vous pourrez les restaurer
    ou les supprimer définitivement à tout moment.
  </p>
</div>`;
    }
    return `
<div class="me-stack">
  <section class="me-block" aria-labelledby="lbl-trash">
    <div class="me-block-head">
      <h3 class="me-block-title" id="lbl-trash">Circuits supprimés (${deleted.length})</h3>
    </div>
    <div class="me-hint">
      <i data-lucide="info"></i>
      <span>Restaurez pour récupérer un circuit, ou supprimez définitivement pour libérer l'espace.</span>
    </div>
    <div class="me-trash">
      ${deleted.map(c => {
          const safeName = escapeHtml(c.name || 'Circuit sans nom');
          const n = (c.poiIds || []).length;
          return `
        <div class="me-trash-item" id="ct-trash-${c.id}">
          <div class="me-trash-ico"><i data-lucide="route"></i></div>
          <div class="me-trash-text">
            <p class="me-trash-title">${safeName}</p>
            <p class="me-trash-meta">${n} lieu${n > 1 ? 'x' : ''} · supprimé</p>
          </div>
          <div class="me-trash-actions">
            <button class="me-btn secondary" data-action="restore" data-id="${c.id}" type="button">
              <i data-lucide="rotate-ccw"></i> Restaurer
            </button>
            <button class="me-btn danger" data-action="delete" data-id="${c.id}" type="button"
                    aria-label="Supprimer définitivement ${safeName}">
              <i data-lucide="trash-2"></i> Supprimer
            </button>
          </div>
        </div>`;
      }).join('')}
    </div>
  </section>
</div>`;
}

function getOverlayRoot() {
    return document.querySelector('.hw-modal-overlay.is-active') || document.querySelector('.hw-modal-overlay');
}

function rerender() {
    const root = getOverlayRoot();
    if (!root) return;
    const bodyEl = root.querySelector('.hw-modal-body');
    if (!bodyEl) return;
    bodyEl.innerHTML = renderBody();
    createIcons({ icons: appIcons, root: bodyEl });
    attachListeners();
}

function attachListeners() {
    const root = getOverlayRoot();
    if (!root) return;

    root.querySelectorAll('[data-action="restore"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const item = root.querySelector(`#ct-trash-${CSS.escape(id)}`);
            if (item) item.classList.add('is-restoring');
            btn.innerHTML = `<i data-lucide="check"></i> Restauré`;
            createIcons({ icons: appIcons, root: btn });
            await restoreDeletedCircuit(id);
            setTimeout(() => {
                rerender();
                renderExplorerList();
            }, 250);
        });
    });

    root.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => openConfirm(btn.dataset.id));
    });
}

async function restoreDeletedCircuit(circuitId) {
    const circuit = (state.myCircuits || []).find(c => String(c.id) === String(circuitId));
    await restoreCircuit(circuitId);
    if (circuit) {
        circuit.isDeleted = false;
        showToast(`Circuit "${circuit.name || 'Sans nom'}" restauré.`, 'success');
    }
}

async function permanentlyDeleteCircuit(circuitId) {
    const circuit = (state.myCircuits || []).find(c => String(c.id) === String(circuitId));
    try {
        await deleteCircuitById(circuitId);
        const idx = (state.myCircuits || []).findIndex(c => String(c.id) === String(circuitId));
        if (idx >= 0) state.myCircuits.splice(idx, 1);
        showToast(`Circuit "${circuit?.name || 'Sans nom'}" supprimé définitivement.`, 'info');
    } catch (err) {
        console.error('[circuit-trash] permanent delete failed', err);
        showToast("Impossible de supprimer le circuit.", 'error');
    }
}

// ─── Confirm dialog (surcouche dans la modale corbeille) ────────────────────
// On ne peut pas ré-empiler openHwModal (stacking interdit), donc on injecte
// une surcouche locale dans l'overlay courant. Pattern identique à l'ancien
// onglet corbeille de Mon Espace.

function openConfirm(circuitId) {
    const root = getOverlayRoot();
    if (!root) return;
    const modal = root.querySelector('.hw-modal');
    if (!modal) return;

    // Évite l'empilement de plusieurs confirms
    if (modal.querySelector('.ct-confirm-overlay')) return;

    const circuit = (state.myCircuits || []).find(c => String(c.id) === String(circuitId));
    const safeName = escapeHtml(circuit?.name || 'Circuit sans nom');

    const overlay = document.createElement('div');
    overlay.className = 'me-confirm-overlay ct-confirm-overlay is-active';
    overlay.setAttribute('aria-hidden', 'false');
    overlay.innerHTML = `
        <div class="me-confirm" role="alertdialog" aria-labelledby="ct-confirm-title" aria-describedby="ct-confirm-body">
            <div class="me-confirm-head">
                <div class="me-confirm-ico"><i data-lucide="alert-triangle"></i></div>
                <div class="me-confirm-title" id="ct-confirm-title">Supprimer définitivement&nbsp;?</div>
            </div>
            <p class="me-confirm-body" id="ct-confirm-body">
                Le circuit <strong>${safeName}</strong> sera retiré de la corbeille.
                Cette action est <strong>irréversible</strong> — il ne pourra plus être restauré.
            </p>
            <div class="me-confirm-actions">
                <button class="me-btn ghost" data-confirm="cancel" type="button">Annuler</button>
                <button class="me-btn danger-solid" data-confirm="ok" type="button">
                    <i data-lucide="trash-2"></i> Supprimer définitivement
                </button>
            </div>
        </div>
    `;
    modal.appendChild(overlay);
    createIcons({ icons: appIcons, root: overlay });

    const close = () => overlay.remove();

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    overlay.querySelector('[data-confirm="cancel"]')?.addEventListener('click', close);
    overlay.querySelector('[data-confirm="ok"]')?.addEventListener('click', async () => {
        close();
        await permanentlyDeleteCircuit(circuitId);
        rerender();
        renderExplorerList();
    });
}

// Helper exporté pour les tests / autres modules qui voudraient fermer la modale.
export { closeHwModal as closeCircuitTrash };
