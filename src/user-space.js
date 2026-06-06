// user-space.js — Contrôleur "Mon Espace" (côté utilisateur)
// Étape intermédiaire dissolution (PR1, 06/06/2026) : la Corbeille a migré dans
// circuit-trash-ui.js (point d'entrée = bouton dans la sidebar Mes circuits).
// Mon Espace ne porte plus que la Sauvegarde (voir user-space-ui.js).

import { openUserSpaceModal } from './user-space-ui.js';
import { exportDataForMobilePC, exportFullBackupPC, handleRestoreFile, saveUserData } from './fileManager.js';
import { isMobileView } from './mobile-state.js';
import { resetBackupCounter } from './backup-auto-local.js';

export function openUserSpace() {
    openUserSpaceModal({
        exportData: exportUserData,
        restoreData: restoreUserData,
    });
}

/**
 * Sauvegarde manuelle (refonte Mon Espace V3). `mode` = 'light' | 'complete'.
 * Bouton adaptatif : sur mobile → partage natif (Web Share + fallback), sur
 * desktop → téléchargement direct. Dans tous les cas, on remet le compteur
 * d'auto-backup à zéro (l'utilisateur vient de produire un backup à jour →
 * évite que l'auto-backup se redéclenche juste après).
 */
async function exportUserData(mode) {
    const includePhotos = (mode === 'complete');
    if (isMobileView()) {
        await saveUserData(includePhotos);
    } else if (includePhotos) {
        await exportFullBackupPC();
    } else {
        await exportDataForMobilePC();
    }
    try {
        await resetBackupCounter();
    } catch (err) {
        console.warn('[user-space] resetBackupCounter failed (non bloquant)', err);
    }
}

function restoreUserData(event) {
    handleRestoreFile(event);
}
