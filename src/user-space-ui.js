// user-space-ui.js — Interface "Mon Espace" (côté utilisateur)
// Étape intermédiaire dissolution Mon Espace (PR1, 06/06/2026) : la Corbeille a
// migré dans « Mes circuits » (cf. circuit-trash-ui.js). Mon Espace ne porte
// plus que la Sauvegarde — mono-écran, plus de tablist. Sera entièrement
// dissous en PR3 (le point d'entrée Sauvegarde déménage vers Outils en PR2).
//
// Sauvegarde (fusion ex-Données + ex-Sécurité, allégé) :
//   - Sauvegarder (action n°1) : choix Légère/Complète + bouton adaptatif
//     (Télécharger desktop / Enregistrer·Partager mobile — le callback choisit).
//   - Restaurer (compact).
//   - Statut backup auto en footnote (1 ligne, plus de bouton "Forcer").

import { state } from './state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { getBackupStatusForUI } from './backup-auto-local.js';
import { getAllPoiPhotosForMap } from './database.js';

// Shell singleton — un seul "Mon Espace" ouvert à la fois.
let _meOverlay = null;
let _meEscHandler = null;

// État local non persistant.
let _backupChoice = 'light';      // 'light' | 'complete'

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

    const overlay = document.createElement('div');
    overlay.className = 'me-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'me-topbar-title');

    overlay.innerHTML = `
        <div class="me-modal" role="document">
            <header class="me-topbar">
                <div class="me-topbar-brand">
                    <div class="me-topbar-mark"><i data-lucide="luggage"></i></div>
                    <div class="me-topbar-text">
                        <h2 class="me-topbar-title" id="me-topbar-title">Mon Espace</h2>
                        <div class="me-topbar-sub">Vos sauvegardes</div>
                    </div>
                </div>
                <div class="me-topbar-mobile" aria-hidden="true">
                    <div class="me-topbar-mobile-eyebrow">Mon Espace</div>
                    <div class="me-topbar-mobile-title">Sauvegarde</div>
                </div>
                <button class="me-close" type="button" id="me-close-btn"
                        aria-label="Fermer Mon Espace" title="Fermer">
                    <i data-lucide="x"></i>
                </button>
            </header>

            <section class="me-body">
                <div id="ue-content"></div>
            </section>
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

        _meEscHandler = (e) => {
            if (e.key === 'Escape') closeUserSpace();
        };
        document.addEventListener('keydown', _meEscHandler);

        renderBackup(document.getElementById('ue-content'), callbacks);
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

// ─── SAUVEGARDE ─────────────────────────────────────────────────────────────

async function renderBackup(container, callbacks) {
    if (!container) return;
    const status = await getBackupStatusForUI();
    if (!_meOverlay) return; // modale fermée pendant l'await
    const lastLbl = status.lastDate ? formatRelativeDate(status.lastDate) : null;
    const sel = _backupChoice;

    const photoWeight = formatSize(await estimatePhotoWeight(state.currentMapId));
    if (!_meOverlay) return;
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
            renderBackup(container, callbacks);
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
