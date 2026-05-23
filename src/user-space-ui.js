// user-space-ui.js — Interface "Mon Espace" (côté utilisateur)
// Refonte V3 (handoff Claude Design 23/05/2026) : 2 onglets uniquement —
// Sauvegarde + Corbeille. Accent = thème (--cta-bg, comme CC Admin ; abandon
// de l'ambre). Shell custom `.me-overlay` conservé (tabs ARIA + clavier,
// mobile plein écran).
//
// Onglet Sauvegarde (fusion ex-Données + ex-Sécurité, allégé) :
//   - Sauvegarder (action n°1) : choix Légère/Complète + bouton adaptatif
//     (Télécharger desktop / Enregistrer·Partager mobile — le callback choisit).
//   - Restaurer (compact).
//   - Statut backup auto en footnote (1 ligne, plus de bouton "Forcer").
// Onglet Corbeille : Restaurer + Supprimer définitivement (confirmation).
//
// Le lieu de résidence a été RETIRÉ de Mon Espace (relocalisation au tri
// "Proximité" prévue dans un 2e temps — cf. mémoire chantier V2).

import { state } from './state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { getBackupStatusForUI } from './backup-auto-local.js';
import { getAllPoiPhotosForMap } from './database.js';

// Shell singleton — un seul "Mon Espace" ouvert à la fois.
let _meOverlay = null;
let _meEscHandler = null;

// État local non persistant.
let _activeTab = 'backup';        // 'backup' | 'trash'
let _backupChoice = 'light';      // 'light' | 'complete'
let _confirmId = null;            // id du circuit en attente de suppression définitive

const TABS = [
    { id: 'backup', label: 'Sauvegarde', icon: 'hard-drive' },
    { id: 'trash',  label: 'Corbeille',  icon: 'trash-2' },
];

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function formatRelativeDate(date) {
    if (!date) return null;
    const days = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
    if (days === 0) return "aujourd'hui";
    if (days === 1) return "hier";
    if (days < 7) return `il y a ${days} jours`;
    if (days < 30) return `il y a ${Math.floor(days / 7)} semaine${days >= 14 ? 's' : ''}`;
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatSize(bytes) {
    if (!bytes || bytes < 1024) return null;
    if (bytes < 1024 * 1024) return `≈ ${Math.round(bytes / 1024)} Ko`;
    return `≈ ${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/**
 * Poids approximatif qu'ajouteront les photos perso à une sauvegarde Complète.
 * Somme la taille des Blobs du store poiPhotos × 1,37 (inflation base64).
 * Renvoie 0 si pas de photos / erreur (la pastille poids est alors masquée).
 */
async function estimatePhotoWeight(mapId) {
    try {
        const entries = await getAllPoiPhotosForMap(mapId);
        let bytes = 0;
        for (const e of entries) {
            for (const p of (e.photos || [])) bytes += (p.blob?.size || 0);
        }
        return Math.round(bytes * 1.37);
    } catch {
        return 0;
    }
}

export function openUserSpaceModal(callbacks) {
    if (_meOverlay) return;
    _activeTab = 'backup';

    const overlay = document.createElement('div');
    overlay.className = 'me-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'me-topbar-title');

    const trashCount = (state.myCircuits || []).filter(c => c.isDeleted).length;

    overlay.innerHTML = `
        <div class="me-modal" role="document">
            <header class="me-topbar">
                <div class="me-topbar-brand">
                    <div class="me-topbar-mark"><i data-lucide="luggage"></i></div>
                    <div class="me-topbar-text">
                        <h2 class="me-topbar-title" id="me-topbar-title">Mon Espace</h2>
                        <div class="me-topbar-sub">Vos sauvegardes et votre corbeille</div>
                    </div>
                </div>
                <div class="me-topbar-mobile" aria-hidden="true">
                    <div class="me-topbar-mobile-eyebrow">Mon Espace</div>
                    <div class="me-topbar-mobile-title" id="me-topbar-mobile-title">Sauvegarde</div>
                </div>
                <button class="me-close" type="button" id="me-close-btn"
                        aria-label="Fermer Mon Espace" title="Fermer">
                    <i data-lucide="x"></i>
                </button>
            </header>

            <div class="me-tabs" role="tablist" aria-label="Mon Espace — sections">
                ${TABS.map((t, i) => `
                    <button class="me-tab${i === 0 ? ' is-active' : ''}" type="button"
                            role="tab" id="me-tab-${t.id}"
                            aria-controls="me-panel"
                            aria-selected="${i === 0 ? 'true' : 'false'}"
                            tabindex="${i === 0 ? '0' : '-1'}"
                            data-tab="${t.id}">
                        <i data-lucide="${t.icon}"></i> ${t.label}${
                            t.id === 'trash'
                                ? ` <span class="count" id="me-trash-count"${trashCount === 0 ? ' style="display:none"' : ''}>${trashCount}</span>`
                                : ''
                        }
                    </button>
                `).join('')}
            </div>

            <section class="me-body" role="tabpanel" id="me-panel"
                     aria-labelledby="me-tab-backup">
                <div id="ue-content"></div>
            </section>

            <!-- Confirm dialog : suppression définitive (surcouche dans la modale) -->
            <div class="me-confirm-overlay" id="me-confirm-overlay" aria-hidden="true">
                <div class="me-confirm" role="alertdialog"
                     aria-labelledby="me-confirm-title" aria-describedby="me-confirm-body">
                    <div class="me-confirm-head">
                        <div class="me-confirm-ico"><i data-lucide="alert-triangle"></i></div>
                        <div class="me-confirm-title" id="me-confirm-title">Supprimer définitivement&nbsp;?</div>
                    </div>
                    <p class="me-confirm-body" id="me-confirm-body">
                        Le circuit <strong id="me-confirm-name">…</strong> sera retiré de la
                        corbeille. Cette action est <strong>irréversible</strong> — il ne
                        pourra plus être restauré.
                    </p>
                    <div class="me-confirm-actions">
                        <button class="me-btn ghost" id="me-confirm-cancel" type="button">Annuler</button>
                        <button class="me-btn danger-solid" id="me-confirm-ok" type="button">
                            <i data-lucide="trash-2"></i> Supprimer définitivement
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    _meOverlay = overlay;

    // Trigger CSS transition (paint avant ajout de la classe is-active).
    requestAnimationFrame(() => overlay.classList.add('is-active'));

    setTimeout(() => {
        overlay.querySelector('#me-close-btn')?.addEventListener('click', closeUserSpace);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeUserSpace();
        });

        // ESC : ferme d'abord le confirm s'il est ouvert, sinon la modale.
        _meEscHandler = (e) => {
            if (e.key !== 'Escape') return;
            const cov = _meOverlay?.querySelector('#me-confirm-overlay');
            if (cov && cov.classList.contains('is-active')) { closeConfirm(); return; }
            closeUserSpace();
        };
        document.addEventListener('keydown', _meEscHandler);

        // Tabs : clic + clavier (manual activation).
        const tabBtns = overlay.querySelectorAll('.me-tab');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => activateTab(btn.dataset.tab, callbacks));
            btn.addEventListener('keydown', (e) => handleTabKeydown(e, tabBtns, callbacks));
        });

        // Confirm dialog : Annuler + clic sur le fond ferme.
        overlay.querySelector('#me-confirm-cancel')?.addEventListener('click', closeConfirm);
        overlay.querySelector('#me-confirm-overlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'me-confirm-overlay') closeConfirm();
        });

        renderUserTab('backup', callbacks);
        createIcons({ icons: appIcons, root: overlay });
    }, 30);
}

function closeUserSpace() {
    if (!_meOverlay) return;
    _meOverlay.classList.remove('is-active');
    if (_meEscHandler) {
        document.removeEventListener('keydown', _meEscHandler);
        _meEscHandler = null;
    }
    const ov = _meOverlay;
    _meOverlay = null;
    setTimeout(() => ov.remove(), 220);
}

function activateTab(tabId, callbacks) {
    if (!_meOverlay) return;
    _activeTab = tabId;
    const tabBtns = _meOverlay.querySelectorAll('.me-tab');
    let activeBtn = null;
    tabBtns.forEach(btn => {
        const isTarget = btn.dataset.tab === tabId;
        btn.classList.toggle('is-active', isTarget);
        btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        btn.setAttribute('tabindex', isTarget ? '0' : '-1');
        if (isTarget) activeBtn = btn;
    });
    const panel = _meOverlay.querySelector('.me-body[role="tabpanel"]');
    if (panel) panel.setAttribute('aria-labelledby', `me-tab-${tabId}`);
    const mobileTitle = _meOverlay.querySelector('#me-topbar-mobile-title');
    if (mobileTitle) {
        const tab = TABS.find(t => t.id === tabId);
        if (tab) mobileTitle.textContent = tab.label;
    }
    if (activeBtn) {
        activeBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
    updateTrashCount();
    renderUserTab(tabId, callbacks);
}

function handleTabKeydown(e, tabBtns, callbacks) {
    const list = Array.from(tabBtns);
    const i = list.indexOf(e.target);
    if (i === -1) return;
    let next = null;
    if (e.key === 'ArrowRight') next = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activateTab(e.target.dataset.tab, callbacks);
        return;
    }
    if (next !== null) {
        e.preventDefault();
        list[next].focus();
    }
}

export function renderUserTab(tab, callbacks) {
    const container = document.getElementById('ue-content');
    if (!container) return;
    if (tab === 'backup') renderBackup(container, callbacks);
    else if (tab === 'trash') renderTrash(container, callbacks);
}

// ─── ONGLET SAUVEGARDE ──────────────────────────────────────────────────────

async function renderBackup(container, callbacks) {
    const status = await getBackupStatusForUI();
    if (!_meOverlay || _activeTab !== 'backup') return; // onglet changé pendant l'await
    const lastLbl = status.lastDate ? formatRelativeDate(status.lastDate) : null;
    const sel = _backupChoice;

    const photoWeight = formatSize(await estimatePhotoWeight(state.currentMapId));
    if (!_meOverlay || _activeTab !== 'backup') return;
    const completeNote = photoWeight ? ` · ${photoWeight} de photos` : '';

    container.innerHTML = `
<div class="me-stack">

  <!-- Sauvegarder (action n°1, absorbe Partager via bouton adaptatif) -->
  <section class="me-block me-block-hero" aria-labelledby="lbl-save">
    <div class="me-block-head">
      <h3 class="me-block-title me-block-title-lg" id="lbl-save">Sauvegarder</h3>
    </div>
    <p class="me-block-desc">
      Exportez vos données dans un fichier portable. Choisissez ce que vous voulez inclure.
    </p>

    <div class="me-choice" role="radiogroup" aria-labelledby="lbl-save">
      <label class="me-choice-card ${sel === 'light' ? 'is-selected' : ''}" data-choice="light">
        <input type="radio" name="me-backup-mode" value="light" ${sel === 'light' ? 'checked' : ''}>
        <span class="me-choice-radio" aria-hidden="true"></span>
        <span class="me-choice-name"><i data-lucide="feather"></i> Légère</span>
        <span class="me-choice-desc">Vos notes, lieux visités et circuits.</span>
        <span class="me-choice-size"><em>sans photos</em></span>
      </label>
      <label class="me-choice-card ${sel === 'complete' ? 'is-selected' : ''}" data-choice="complete">
        <input type="radio" name="me-backup-mode" value="complete" ${sel === 'complete' ? 'checked' : ''}>
        <span class="me-choice-radio" aria-hidden="true"></span>
        <span class="me-choice-name"><i data-lucide="archive"></i> Complète</span>
        <span class="me-choice-desc">Tout, <strong>+ vos photos</strong>.</span>
        <span class="me-choice-size"><em>avec photos${completeNote}</em></span>
      </label>
    </div>

    <button class="me-btn primary block" id="btn-ue-backup" type="button">
      <span class="me-btn-on-desktop"><i data-lucide="download"></i> Télécharger</span>
      <span class="me-btn-on-mobile"><i data-lucide="share-2"></i> Enregistrer · Partager</span>
    </button>
  </section>

  <!-- Restaurer (secondaire, compact) -->
  <section class="me-block" aria-labelledby="lbl-restore">
    <div class="me-block-head">
      <h3 class="me-block-title" id="lbl-restore">Restaurer</h3>
    </div>
    <div class="me-status-card">
      <div class="me-status-row">
        <div class="me-status-ico"><i data-lucide="upload"></i></div>
        <div class="me-status-text">
          <p class="me-status-title">Recharger un fichier de sauvegarde</p>
          <div class="me-status-sub">Formats acceptés : <strong>.json</strong>, <strong>.txt</strong></div>
        </div>
        <button class="me-btn secondary" id="btn-ue-restore" type="button">
          <i data-lucide="folder-open"></i> Choisir un fichier…
        </button>
      </div>
    </div>
    <input type="file" id="ue-restore-loader" accept=".json,.txt" class="is-hidden">
  </section>

  <!-- Statut backup auto (1 ligne discrète) -->
  <p class="me-footnote" aria-label="Statut du backup auto local">
    <i data-lucide="shield-check"></i>
    <span>${
        lastLbl
            ? `Protection auto active · dernier backup&nbsp;: <strong>${lastLbl}</strong>`
            : `Protection auto active · une sauvegarde de secours est créée régulièrement.`
    }</span>
  </p>

</div>`;

    createIcons({ icons: appIcons, root: container });
    attachBackupListeners(container, callbacks);
}

function attachBackupListeners(container, callbacks) {
    container.querySelectorAll('.me-choice-card').forEach(card => {
        card.addEventListener('click', (e) => {
            e.preventDefault();
            _backupChoice = card.dataset.choice;
            renderUserTab('backup', callbacks);
        });
    });

    document.getElementById('btn-ue-backup')?.addEventListener('click', () => {
        // Le callback choisit download (desktop) ou partage natif (mobile)
        // selon la plateforme, et reset le compteur backup-auto.
        if (callbacks.exportData) callbacks.exportData(_backupChoice);
    });

    document.getElementById('btn-ue-restore')?.addEventListener('click', () => {
        document.getElementById('ue-restore-loader')?.click();
    });
    document.getElementById('ue-restore-loader')?.addEventListener('change', (e) => {
        if (callbacks.restoreData) callbacks.restoreData(e);
    });
}

// ─── ONGLET CORBEILLE ───────────────────────────────────────────────────────

function renderTrash(container, callbacks) {
    const deleted = (state.myCircuits || []).filter(c => c.isDeleted);

    if (deleted.length === 0) {
        container.innerHTML = `
<div class="me-empty">
  <div class="me-empty-mark"><i data-lucide="package-check"></i></div>
  <p class="me-empty-title">Corbeille vide</p>
  <p class="me-empty-sub">
    Les circuits supprimés apparaîtront ici. Vous pourrez les restaurer
    ou les supprimer définitivement à tout moment.
  </p>
</div>`;
        createIcons({ icons: appIcons, root: container });
        return;
    }

    container.innerHTML = `
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
        <div class="me-trash-item" id="ue-trash-${c.id}">
          <div class="me-trash-ico"><i data-lucide="route"></i></div>
          <div class="me-trash-text">
            <p class="me-trash-title">${safeName}</p>
            <p class="me-trash-meta">${n} POI${n > 1 ? 's' : ''} · supprimé</p>
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

    createIcons({ icons: appIcons, root: container });
    attachTrashListeners(container, callbacks);
}

function attachTrashListeners(container, callbacks) {
    container.querySelectorAll('[data-action="restore"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const item = document.getElementById(`ue-trash-${id}`);
            if (item) item.classList.add('is-restoring');
            btn.innerHTML = `<i data-lucide="check"></i> Restauré`;
            createIcons({ icons: appIcons, root: btn });
            // Attendre la restauration (async) AVANT de re-render, sinon le circuit
            // réapparaît (re-render avant que isDeleted soit repassé à false).
            if (callbacks.restoreCircuit) await callbacks.restoreCircuit(id);
            setTimeout(() => {
                renderUserTab('trash', callbacks);
                updateTrashCount();
            }, 250);
        });
    });

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => openConfirm(btn.dataset.id, callbacks));
    });
}

function updateTrashCount() {
    const n = (state.myCircuits || []).filter(c => c.isDeleted).length;
    const el = _meOverlay?.querySelector('#me-trash-count');
    if (el) {
        el.textContent = String(n);
        el.style.display = n > 0 ? '' : 'none';
    }
}

// ─── CONFIRM (suppression définitive) ───────────────────────────────────────

function openConfirm(id, callbacks) {
    _confirmId = id;
    const ov = _meOverlay?.querySelector('#me-confirm-overlay');
    if (!ov) return;
    const circuit = (state.myCircuits || []).find(c => String(c.id) === String(id));
    const nameEl = ov.querySelector('#me-confirm-name');
    if (nameEl) nameEl.textContent = circuit?.name || 'Circuit sans nom';

    // (Re)bind le bouton OK à chaque ouverture (capture id + callbacks via onclick,
    // pas addEventListener → pas d'empilement de listeners).
    const okBtn = ov.querySelector('#me-confirm-ok');
    if (okBtn) {
        okBtn.onclick = async () => {
            const target = _confirmId;
            closeConfirm();
            // Attendre la purge (async) AVANT de re-render, sinon l'item reste
            // affiché (re-render avant que le splice du state soit effectué).
            if (callbacks.permanentlyDeleteCircuit && target != null) {
                await callbacks.permanentlyDeleteCircuit(target);
            }
            renderUserTab('trash', callbacks);
            updateTrashCount();
        };
    }

    ov.classList.add('is-active');
    ov.setAttribute('aria-hidden', 'false');
}

function closeConfirm() {
    const ov = _meOverlay?.querySelector('#me-confirm-overlay');
    if (!ov) return;
    ov.classList.remove('is-active');
    ov.setAttribute('aria-hidden', 'true');
    _confirmId = null;
}
