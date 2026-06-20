// rejected-trash-ui.js — Corbeille des rejets de curation Scout.
// PR-2 du chantier rejets : liste les objets OSM REJETÉS (tombstones, rejected.js)
// de la destination active, avec RESTAURATION par item (re-crée le candidat depuis
// l'instantané, sans re-scanner) + « Tout vider » (bulk). Ouverte depuis une carte
// du Centre de Contrôle (Outils). Calquée sur circuit-trash-ui.js (même shell V2
// openHwModal + confirm inline, mêmes classes me-*).
//
// Cycle : un candidat supprimé (data.js deletePoi) est tombstoné (osm_ref) → ici on
// le restaure (removeRejected + addPoiFeature candidate:true) ou on vide tout.
import { state } from './state.js';
import { rejectedData, setRejectedData, removeRejected, rejectedCount } from './rejected.js';
import { addPoiFeature } from './data.js';
import { showToast } from './toast.js';
import { openHwModal } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { getStoredToken } from './github-sync.js';
import { escapeHtml } from './utils.js';

/** Ouvre la modale Corbeille des rejets. Idempotent (openHwModal interdit le stacking). */
export function openRejectedTrash() {
    openHwModal({
        size: 'md',
        icon: 'trash-2',
        title: 'Corbeille des rejets',
        body: renderBody(),
        footer: false,
        closeOnBackdrop: true,
        closeOnEscape: true,
    });
    // Listeners après le paint du body (openHwModal injecte le HTML synchroniquement).
    queueMicrotask(attachListeners);
}

function renderBody() {
    const refs = Object.keys(rejectedData);
    if (refs.length === 0) {
        return `
<div class="me-empty">
  <div class="me-empty-mark"><i data-lucide="package-check"></i></div>
  <p class="me-empty-title">Aucun objet rejeté</p>
  <p class="me-empty-sub">
    Quand tu supprimes un candidat pendant la curation, il atterrit ici et n'est plus
    re-proposé au scan. Tu pourras le restaurer à tout moment.
  </p>
</div>`;
    }
    return `
<div class="me-stack">
  <section class="me-block" aria-labelledby="lbl-rejtrash">
    <div class="me-block-head">
      <h3 class="me-block-title" id="lbl-rejtrash">Objets rejetés (${refs.length})</h3>
      <button class="me-btn ghost" data-action="clear-all" type="button">
        <i data-lucide="trash-2"></i> Tout vider
      </button>
    </div>
    <div class="me-hint">
      <i data-lucide="info"></i>
      <span>Restaure un objet pour le récupérer comme candidat à curer ; il ne sera plus ignoré au scan.</span>
    </div>
    <div class="me-trash">
      ${refs.map(ref => {
          const r = rejectedData[ref] || {};
          const safeName = escapeHtml(r.name || 'Sans nom');
          const meta = escapeHtml(r.category || 'Catégorie ?');
          return `
        <div class="me-trash-item" id="rj-trash-${escapeHtml(ref)}">
          <div class="me-trash-ico"><i data-lucide="map-pin-off"></i></div>
          <div class="me-trash-text">
            <p class="me-trash-title">${safeName}</p>
            <p class="me-trash-meta">${meta} · ${escapeHtml(ref)}</p>
          </div>
          <div class="me-trash-actions">
            <button class="me-btn secondary" data-action="restore" data-ref="${escapeHtml(ref)}" type="button">
              <i data-lucide="rotate-ccw"></i> Restaurer
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
            btn.disabled = true;
            btn.innerHTML = '<i data-lucide="check"></i> Restauré';
            createIcons({ icons: appIcons, root: btn });
            await restoreRejected(btn.dataset.ref);
            setTimeout(rerender, 250);
        });
    });

    const clearBtn = root.querySelector('[data-action="clear-all"]');
    if (clearBtn) clearBtn.addEventListener('click', openClearConfirm);
}

// Pousse le fichier rejets (best-effort). Sans token → gardé en mémoire (le fichier
// reste inchangé ; ré-aligné au prochain rejet/restauration avec token).
function pushRejected() {
    if (!getStoredToken()) return;
    import('./publish-destination.js')
        .then(({ pushDestinationRejected }) => pushDestinationRejected(state.currentMapId, rejectedData))
        .catch(e => console.warn('[rejets] push échoué (gardé en mémoire) :', e));
}

// Restaure UN rejet : re-crée le candidat depuis l'instantané (pas de re-scan) puis
// retire le tombstone et pousse. Si la re-création échoue, on NE retire PAS le rejet.
async function restoreRejected(osmRef) {
    const rec = rejectedData[osmRef];
    if (!rec) return;
    try {
        await addPoiFeature({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [Number(rec.lng), Number(rec.lat)] },
            properties: {
                'Nom du site FR': rec.name || '',
                ...(rec.nameAr ? { 'Nom du site arabe': rec.nameAr } : {}),
                'Catégorie': rec.category || 'A définir',
                ...(rec.osm_ref ? { osm_ref: rec.osm_ref } : {}),
                candidate: true,
            },
        }, { draft: false });
    } catch (e) {
        console.warn('[rejets] re-création du candidat échouée :', e);
        showToast('Restauration échouée.', 'error', 3500);
        return;
    }
    removeRejected(osmRef);
    showToast(`« ${rec.name || 'Sans nom'} » restauré comme candidat à curer.`, 'success', 3200);
    pushRejected();
}

// ─── Confirm « Tout vider » (surcouche dans la modale — stacking openHwModal interdit) ──
function openClearConfirm() {
    const root = getOverlayRoot();
    if (!root) return;
    const modal = root.querySelector('.hw-modal');
    if (!modal || modal.querySelector('.rj-confirm-overlay')) return;

    const n = rejectedCount();
    const overlay = document.createElement('div');
    overlay.className = 'me-confirm-overlay rj-confirm-overlay is-active';
    overlay.setAttribute('aria-hidden', 'false');
    overlay.innerHTML = `
        <div class="me-confirm" role="alertdialog" aria-labelledby="rj-confirm-title" aria-describedby="rj-confirm-body">
            <div class="me-confirm-head">
                <div class="me-confirm-ico"><i data-lucide="alert-triangle"></i></div>
                <div class="me-confirm-title" id="rj-confirm-title">Tout vider&nbsp;?</div>
            </div>
            <p class="me-confirm-body" id="rj-confirm-body">
                Les <strong>${n}</strong> objet(s) rejeté(s) seront de nouveau proposés au prochain scan de la zone.
            </p>
            <div class="me-confirm-actions">
                <button class="me-btn ghost" data-confirm="cancel" type="button">Annuler</button>
                <button class="me-btn danger-solid" data-confirm="ok" type="button">
                    <i data-lucide="trash-2"></i> Tout vider
                </button>
            </div>
        </div>
    `;
    modal.appendChild(overlay);
    createIcons({ icons: appIcons, root: overlay });

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-confirm="cancel"]')?.addEventListener('click', close);
    overlay.querySelector('[data-confirm="ok"]')?.addEventListener('click', () => {
        close();
        setRejectedData({});
        showToast('Rejets vidés.', 'info', 2800);
        pushRejected();
        rerender();
    });
}
