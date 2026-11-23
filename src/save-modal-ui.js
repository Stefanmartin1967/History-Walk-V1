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
import { googleSectionHtml, bindGoogleSection } from './google-link-ui.js';
import { getSyncChoice } from './sync-reminders.js';
import { eventBus } from './events.js';

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
    // Relié à Google (écran 15) : les données suivent par le compte ; le fichier
    // sert surtout aux photos, les données restent possibles par un lien.
    const choice = state.isAdmin ? null : getSyncChoice();
    const linked = choice === 'google';
    const dataCard = `
      <button class="me-choice-card is-action" id="sm-btn-data" type="button">
        <span class="me-choice-name"><i data-lucide="${isMobileView() ? 'share-2' : 'download'}"></i> Sauvegarder mes données</span>
        <span class="me-choice-desc">Visites, notes, lieux, circuits.</span>
      </button>`;
    const photosCard = `
      <button class="me-choice-card is-action" id="sm-btn-photos" type="button">
        <span class="me-choice-name"><i data-lucide="image"></i> Sauvegarder mes photos</span>
        <span class="me-choice-desc">${photosNote}</span>
      </button>`;
    const saveBlock = linked
        ? `<div class="me-choice me-choice--single">${photosCard}</div>
    <button class="sm-text-link" id="sm-btn-data" type="button">Sauvegarder aussi mes données dans un fichier</button>`
        : `<div class="me-choice">${dataCard}${photosCard}</div>`;
    const restoreTitle = linked ? 'Restaurer mes photos' : "Ajouter le contenu d'un fichier de sauvegarde";
    const restoreSub = linked ? "Elles s'ajoutent à celles de cet appareil." : 'Il est réuni avec ce qui est sur cet appareil. Si un même texte diffère, vous choisissez.';
    // Ligne du bas : la copie de secours (sauvegardes en fichier) ou ce qui n'est
    // que sur cet appareil (pas encore choisi). Rien une fois relié, ni en admin.
    let footnote = '';
    if (choice === 'file') {
        footnote = lastLbl
            ? `Copie de secours automatique en fichier · dernière&nbsp;: <strong>${lastLbl}</strong>`
            : 'Copie de secours automatique en fichier · une copie est téléchargée régulièrement.';
    } else if (!linked && !state.isAdmin && status.count > 0) {
        footnote = `${status.count} modification${status.count > 1 ? 's' : ''}${status.lastDate ? ' depuis votre dernière sauvegarde' : ''} sur cet appareil seulement.`;
    }

    bodyEl.innerHTML = `
<div class="me-stack">
${googleSectionHtml()}

  <section class="me-block me-block-hero" aria-labelledby="lbl-save">
    <div class="me-block-head">
      <h3 class="me-block-title me-block-title-lg" id="lbl-save">Garder une copie dans un fichier</h3>
    </div>

    ${saveBlock}
  </section>

  <section class="me-block" aria-labelledby="lbl-restore">
    <div class="me-block-head">
      <h3 class="me-block-title" id="lbl-restore">Restaurer</h3>
    </div>
    <div class="me-status-card">
      <div class="me-status-row">
        <div class="me-status-ico"><i data-lucide="upload"></i></div>
        <div class="me-status-text">
          <p class="me-status-title">${restoreTitle}</p>
          <div class="me-status-sub">${restoreSub}</div>
        </div>
        <button class="me-btn secondary" id="sm-btn-restore" type="button">
          <i data-lucide="folder-open"></i> Choisir un fichier…
        </button>
      </div>
    </div>
    <input type="file" id="sm-restore-loader" accept=".json,.txt" class="is-hidden">
    ${linked ? '<button class="sm-text-link" id="sm-btn-restore-data" type="button">Restaurer aussi un fichier de données</button>' : ''}
    ${undoDate ? `<button class="me-btn secondary" id="sm-btn-undo-restore" type="button">
      <i data-lucide="rotate-ccw"></i> Annuler la dernière restauration (${undoDate})
    </button>` : ''}
  </section>

  ${footnote ? `<p class="me-footnote" aria-label="Copie de secours">
    <i data-lucide="${choice === 'file' ? 'shield-check' : 'smartphone'}"></i>
    <span>${footnote}</span>
  </p>` : ''}

</div>`;

    createIcons({ icons: appIcons, root: bodyEl });
    attachListeners(bodyEl);
    bindGoogleSection(bodyEl);
}

// Relié, déconnecté, effacé ou « sauvegarde en fichier » : l'écran ouvert se
// redessine (les parties fichier et restauration changent avec l'état).
eventBus.on('google:link-changed', () => {
    const bodyEl = getOverlayRoot()?.querySelector('.hw-modal-body');
    if (bodyEl?.querySelector('#gl-mount')) void renderBody(bodyEl);
});

function attachListeners(bodyEl) {
    bodyEl.querySelector('#sm-btn-data')?.addEventListener('click', () => { exportData(); });
    bodyEl.querySelector('#sm-btn-photos')?.addEventListener('click', () => {
        exportPhotosBackup((mapId) => backupFileName(mapId, 'photos'));
    });

    bodyEl.querySelector('#sm-btn-restore')?.addEventListener('click', () => {
        bodyEl.querySelector('#sm-restore-loader')?.click();
    });
    // Relié : le même fichier ouvre aussi une sauvegarde de données.
    bodyEl.querySelector('#sm-btn-restore-data')?.addEventListener('click', () => {
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
        subheader: 'Retrouvez vos données sur tous vos appareils, et gardez-en une copie.',
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
