// backup-modal.js
// Modale de sauvegarde unifiée (système V2 hw-modal).
// Remplace la modale HTML inline historique #backup-modal qui vivait
// dans index.html avec 4 IDs (btn-backup-full, btn-backup-lite,
// btn-backup-cancel, btn-open-backup-modal).

import { openHwModal, closeHwModal } from './modal.js';
import { updateBackupSizeEstimates } from './ui-utils.js';

export function showBackupModal() {
    const body = `
        <p class="muted" style="text-align:center;margin-bottom:16px">Choisissez le format de votre sauvegarde :</p>

        <button class="hw-row backup-option-btn" id="btn-backup-full" type="button" style="width:100%;cursor:pointer;text-align:left;background:transparent;border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:10px">
            <div class="icn" style="background:var(--brand-soft);color:var(--brand-2);width:40px;height:40px"><i data-lucide="image"></i></div>
            <div class="lbl">
                <b>Complet (PC)</b>
                <span>Données + Photos</span>
            </div>
            <span class="meta" id="backup-size-full">Calcul…</span>
        </button>

        <button class="hw-row backup-option-btn" id="btn-backup-lite" type="button" style="width:100%;cursor:pointer;text-align:left;background:transparent;border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:0">
            <div class="icn" style="background:var(--ok-soft);color:var(--ok);width:40px;height:40px"><i data-lucide="file-text"></i></div>
            <div class="lbl">
                <b>Texte seul (Mobile)</b>
                <span>Rapide & léger</span>
            </div>
            <span class="meta" id="backup-size-lite">Calcul…</span>
        </button>
    `;

    const footer = `
        <button class="hw-btn hw-btn-ghost" data-backup-action="cancel">Annuler</button>
    `;

    const promise = openHwModal({
        size: 'sm',
        icon: 'save',
        title: 'Sauvegarder',
        body,
        footer,
    });

    // Attache les listeners et calcule les tailles après ouverture du DOM
    setTimeout(() => {
        updateBackupSizeEstimates();

        const isMobile = window.innerWidth <= 768;

        document.getElementById('btn-backup-full')?.addEventListener('click', () => {
            import('./fileManager.js').then(({ handleExportWithContribution, exportFullBackupPC, saveUserData }) => {
                handleExportWithContribution('backup', () => {
                    if (!isMobile) exportFullBackupPC();
                    else saveUserData(true);
                    closeHwModal();
                });
            });
        });

        document.getElementById('btn-backup-lite')?.addEventListener('click', () => {
            import('./fileManager.js').then(({ handleExportWithContribution, exportDataForMobilePC, saveUserData }) => {
                handleExportWithContribution('backup', () => {
                    if (!isMobile) exportDataForMobilePC();
                    else saveUserData(false);
                    closeHwModal();
                });
            });
        });

        document.querySelector('[data-backup-action="cancel"]')?.addEventListener('click', () => {
            closeHwModal();
        });
    }, 30);

    return promise;
}
