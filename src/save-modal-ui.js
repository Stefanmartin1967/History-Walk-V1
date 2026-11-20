// save-modal-ui.js — Modale « Sauvegarder » (ex-Mon Espace, PR3 dissolution).
// Ouverte depuis le menu Outils PC (#btn-tools-backup) et la section Outils
// du menu mobile (#mob-action-backup). Utilise le shell V2 partagé openHwModal,
// avec les classes de contenu .me-* qui survivent dans me-userspace.css.
//
// Deux sauvegardes (20/11/2026, Données / Photos remplacent Légère / Complète,
// maquette « synchro users » écran 14 validée par Stefan) :
//   - Données → visites, notes, lieux, circuits : petit fichier, Web Share natif
//     sur mobile (transport/partage), téléchargement sur PC ;
//   - Photos  → les photos seulement, dans leur propre fichier (lourd) :
//     téléchargement local (photo-backup.js). Séparées, elles ne font plus
//     planter la restauration des données sur un téléphone modeste.

import { state } from './state.js';
import { isMobileView } from './mobile-state.js';
import { openHwModal, closeHwModal } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { getBackupStatusForUI, resetBackupCounter } from './backup-auto-local.js';
import { getAllPoiPhotosForMap } from './database.js';
import {
    exportDataForMobilePC,
    handleRestoreFile,
    saveUserData,
    backupFileName,
} from './fileManager.js';
import { exportPhotosBackup } from './photo-backup.js';
import { getLastRestore } from './restore-apply.js';
import { runUndo } from './restore-ui.js';

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
        return Math.round(bytes * 1.37); // inflation base64 dans le fichier
    } catch {
        return 0;
    }
}

/**
 * « Sauvegarder mes données » : Web Share sur mobile, téléchargement sur PC.
 * Reset le compteur d'auto-backup à la fin (l'user vient de produire un
 * backup à jour → évite la redondance).
 */
async function exportData() {
    if (isMobileView()) await saveUserData();
    else await exportDataForMobilePC();
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

    const photoWeight = formatSize(await estimatePhotoWeight(state.currentMapId));
    // Dernière restauration annulable (19/11/2026, restauration qui fusionne).
    const lastRestore = await getLastRestore(state.currentMapId);
    const undoDate = lastRestore?.undo && lastRestore.at
        ? new Date(lastRestore.at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : null;
    // Si la modale a été fermée pendant l'await → on abandonne silencieusement.
    if (!bodyEl.isConnected) return;
    const photosNote = photoWeight ? `Vos photos seulement · ${photoWeight}` : 'Vos photos seulement';

    bodyEl.innerHTML = `
<div class="me-stack">

  <section class="me-block me-block-hero" aria-labelledby="lbl-save">
    <div class="me-block-head">
      <h3 class="me-block-title me-block-title-lg" id="lbl-save">Sauvegarder</h3>
    </div>
    <p class="me-block-desc">Garder une copie dans un fichier.</p>

    <div class="me-choice">
      <button class="me-choice-card is-action" id="sm-btn-data" type="button">
        <span class="me-choice-name"><i data-lucide="${isMobileView() ? 'share-2' : 'download'}"></i> Sauvegarder mes données</span>
        <span class="me-choice-desc">Visites, notes, lieux, circuits.</span>
      </button>
      <button class="me-choice-card is-action" id="sm-btn-photos" type="button">
        <span class="me-choice-name"><i data-lucide="image"></i> Sauvegarder mes photos</span>
        <span class="me-choice-desc">${photosNote}</span>
      </button>
    </div>
  </section>

  <section class="me-block" aria-labelledby="lbl-restore">
    <div class="me-block-head">
      <h3 class="me-block-title" id="lbl-restore">Restaurer</h3>
    </div>
    <div class="me-status-card">
      <div class="me-status-row">
        <div class="me-status-ico"><i data-lucide="upload"></i></div>
        <div class="me-status-text">
          <p class="me-status-title">Ajouter le contenu d'un fichier de sauvegarde</p>
          <div class="me-status-sub">Il est réuni avec ce qui est sur cet appareil. Si un même texte diffère, vous choisissez.</div>
        </div>
        <button class="me-btn secondary" id="sm-btn-restore" type="button">
          <i data-lucide="folder-open"></i> Choisir un fichier…
        </button>
      </div>
    </div>
    <input type="file" id="sm-restore-loader" accept=".json,.txt" class="is-hidden">
    ${undoDate ? `<button class="me-btn secondary" id="sm-btn-undo-restore" type="button">
      <i data-lucide="rotate-ccw"></i> Annuler la dernière restauration (${undoDate})
    </button>` : ''}
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
    bodyEl.querySelector('#sm-btn-data')?.addEventListener('click', () => { exportData(); });
    bodyEl.querySelector('#sm-btn-photos')?.addEventListener('click', () => {
        exportPhotosBackup((mapId) => backupFileName(mapId, 'photos'));
    });

    bodyEl.querySelector('#sm-btn-restore')?.addEventListener('click', () => {
        bodyEl.querySelector('#sm-restore-loader')?.click();
    });
    bodyEl.querySelector('#sm-btn-undo-restore')?.addEventListener('click', () => {
        closeHwModal();
        runUndo(state.currentMapId);
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
