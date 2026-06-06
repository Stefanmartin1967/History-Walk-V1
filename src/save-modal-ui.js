// save-modal-ui.js — Modale « Sauvegarder » (ex-Mon Espace, PR3 dissolution).
// Ouverte depuis le menu Outils PC (#btn-tools-backup) et la section Outils
// du menu mobile (#mob-action-backup). Utilise le shell V2 partagé openHwModal,
// avec les classes de contenu .me-* qui survivent dans me-userspace.css.
//
// Choix Légère/Complète :
//   - Légère  → Web Share natif sur mobile (transport/partage), download sur PC.
//   - Complète → toujours téléchargement classique (sauvegarde locale d'archive)
//     — pas de Web Share, cf. justification dans [[project_backup_lite_vs_complete_rationale]].

import { state } from './state.js';
import { isMobileView } from './mobile-state.js';
import { openHwModal, closeHwModal } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { getBackupStatusForUI, resetBackupCounter } from './backup-auto-local.js';
import { getAllPoiPhotosForMap } from './database.js';
import {
    exportDataForMobilePC,
    exportFullBackupPC,
    handleRestoreFile,
    saveUserData,
} from './fileManager.js';

let _backupChoice = 'light'; // 'light' | 'complete' — persisté entre re-renders

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

async function estimatePhotoWeight(mapId) {
    try {
        const entries = await getAllPoiPhotosForMap(mapId);
        let bytes = 0;
        for (const e of entries) {
            for (const p of (e.photos || [])) bytes += (p.blob?.size || 0);
        }
        return Math.round(bytes * 1.37); // inflation base64
    } catch {
        return 0;
    }
}

/**
 * Sauvegarde manuelle. Complète = toujours téléchargement local (jamais
 * Web Share). Légère = Web Share sur mobile, download sur PC.
 * Reset le compteur d'auto-backup à la fin (l'user vient de produire un
 * backup à jour → évite la redondance).
 */
async function exportUserData(mode) {
    const includePhotos = (mode === 'complete');
    if (includePhotos) {
        await exportFullBackupPC();
    } else if (isMobileView()) {
        await saveUserData(false);
    } else {
        await exportDataForMobilePC();
    }
    try {
        await resetBackupCounter();
    } catch (err) {
        console.warn('[save-modal] resetBackupCounter failed (non bloquant)', err);
    }
}

function getOverlayRoot() {
    return document.querySelector('.hw-modal-overlay.is-active') || document.querySelector('.hw-modal-overlay');
}

async function renderBody(bodyEl) {
    const status = await getBackupStatusForUI();
    const lastLbl = status.lastDate ? formatRelativeDate(status.lastDate) : null;
    const sel = _backupChoice;

    const photoWeight = formatSize(await estimatePhotoWeight(state.currentMapId));
    // Si la modale a été fermée pendant l'await → on abandonne silencieusement.
    if (!bodyEl.isConnected) return;
    const completeNote = photoWeight ? ` · ${photoWeight} de photos` : '';

    // Libellé adaptatif du bouton d'action (cohérent avec PR2) :
    // - Légère sur mobile  → Web Share natif (« Enregistrer · Partager »)
    // - Légère sur PC      → téléchargement classique (« Télécharger »)
    // - Complète partout   → téléchargement classique (« Télécharger »)
    const shareOnMobile = (sel === 'light' && isMobileView());
    const btnIcon = shareOnMobile ? 'share-2' : 'download';
    const btnLabel = shareOnMobile ? 'Enregistrer · Partager' : 'Télécharger';

    bodyEl.innerHTML = `
<div class="me-stack">

  <section class="me-block me-block-hero" aria-labelledby="lbl-save">
    <div class="me-block-head">
      <h3 class="me-block-title me-block-title-lg" id="lbl-save">Sauvegarder</h3>
    </div>
    <p class="me-block-desc">
      Exportez vos données dans un fichier portable. Choisissez ce que vous voulez inclure.
    </p>

    <div class="me-choice" role="radiogroup" aria-labelledby="lbl-save">
      <label class="me-choice-card ${sel === 'light' ? 'is-selected' : ''}" data-choice="light">
        <input type="radio" name="sm-backup-mode" value="light" ${sel === 'light' ? 'checked' : ''}>
        <span class="me-choice-radio" aria-hidden="true"></span>
        <span class="me-choice-name"><i data-lucide="feather"></i> Légère</span>
        <span class="me-choice-desc">Vos notes, lieux visités et circuits.</span>
        <span class="me-choice-size"><em>sans photos</em></span>
      </label>
      <label class="me-choice-card ${sel === 'complete' ? 'is-selected' : ''}" data-choice="complete">
        <input type="radio" name="sm-backup-mode" value="complete" ${sel === 'complete' ? 'checked' : ''}>
        <span class="me-choice-radio" aria-hidden="true"></span>
        <span class="me-choice-name"><i data-lucide="archive"></i> Complète</span>
        <span class="me-choice-desc">Tout, <strong>+ vos photos</strong>.</span>
        <span class="me-choice-size"><em>avec photos${completeNote}</em></span>
      </label>
    </div>

    <button class="me-btn primary block" id="sm-btn-backup" type="button">
      <i data-lucide="${btnIcon}"></i> ${btnLabel}
    </button>
  </section>

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
        <button class="me-btn secondary" id="sm-btn-restore" type="button">
          <i data-lucide="folder-open"></i> Choisir un fichier…
        </button>
      </div>
    </div>
    <input type="file" id="sm-restore-loader" accept=".json,.txt" class="is-hidden">
  </section>

  <p class="me-footnote" aria-label="Statut du backup auto local">
    <i data-lucide="shield-check"></i>
    <span>${
        lastLbl
            ? `Protection auto active · dernier backup&nbsp;: <strong>${lastLbl}</strong>`
            : `Protection auto active · une sauvegarde de secours est créée régulièrement.`
    }</span>
  </p>

</div>`;

    createIcons({ icons: appIcons, root: bodyEl });
    attachListeners(bodyEl);
}

function attachListeners(bodyEl) {
    bodyEl.querySelectorAll('.me-choice-card').forEach(card => {
        card.addEventListener('click', (e) => {
            e.preventDefault();
            _backupChoice = card.dataset.choice;
            renderBody(bodyEl);
        });
    });

    bodyEl.querySelector('#sm-btn-backup')?.addEventListener('click', () => {
        exportUserData(_backupChoice);
    });

    bodyEl.querySelector('#sm-btn-restore')?.addEventListener('click', () => {
        bodyEl.querySelector('#sm-restore-loader')?.click();
    });
    bodyEl.querySelector('#sm-restore-loader')?.addEventListener('change', (event) => {
        handleRestoreFile(event);
        closeHwModal(); // la restauration enchaîne sur un reload → on ferme la modale
    });
}

/**
 * Ouvre la modale Sauvegarder. Idempotent (stacking interdit côté openHwModal).
 */
export function openSaveModal() {
    openHwModal({
        size: 'lg',
        icon: 'luggage',
        title: 'Sauvegarder',
        subheader: 'Sauvegardez vos données pour les retrouver plus tard ou les transférer.',
        body: '<div id="sm-body-mount"></div>',
        footer: false,
        closeOnBackdrop: true,
        closeOnEscape: true,
    });

    queueMicrotask(() => {
        const root = getOverlayRoot();
        const bodyEl = root?.querySelector('.hw-modal-body');
        if (bodyEl) renderBody(bodyEl);
    });
}
