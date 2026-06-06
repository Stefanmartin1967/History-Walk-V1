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
 * Sauvegarde manuelle (PR2 dissolution, 06/06/2026). `mode` = 'light' | 'complete'.
 *
 * Légère = sauvegarde de mobilité : partage natif (Web Share) sur mobile,
 *   téléchargement classique sur PC. Petite, transportable, partageable.
 * Complète = sauvegarde locale : téléchargement classique sur les DEUX
 *   plateformes (pas de Web Share). Justification : la dualité LITE/COMPLETE
 *   existe pour protéger la restauration sur mobile bas de gamme (mesure :
 *   ~120 Mo de heap pour une Complète typique → partage natif inadapté). La
 *   Complète vit en local jusqu'à un éventuel transfert manuel par l'user.
 *
 * Dans tous les cas, on remet le compteur d'auto-backup à zéro (l'user
 * vient de produire un backup à jour → évite l'auto-backup redondant).
 */
async function exportUserData(mode) {
    const includePhotos = (mode === 'complete');
    if (includePhotos) {
        // Complète : téléchargement local (jamais de Web Share, cf. justification)
        await exportFullBackupPC();
    } else if (isMobileView()) {
        // Légère mobile : Web Share natif avec fallback download
        await saveUserData(false);
    } else {
        // Légère PC : téléchargement classique
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
