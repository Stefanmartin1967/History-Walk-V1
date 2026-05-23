// user-space.js — Contrôleur "Mon Espace" (côté utilisateur)
import { state } from './state.js';
import { restoreCircuit, deleteCircuitById } from './database.js';
import { showToast } from './toast.js';
import { openUserSpaceModal } from './user-space-ui.js';
import { exportDataForMobilePC, exportFullBackupPC, handleRestoreFile, saveUserData } from './fileManager.js';
import { renderExplorerList } from './ui-circuit-list.js';
import { isMobileView } from './mobile-state.js';
import { resetBackupCounter } from './backup-auto-local.js';

export function openUserSpace() {
    const callbacks = {
        exportData: exportUserData,
        restoreData: restoreUserData,
        restoreCircuit: restoreDeletedCircuit,
        permanentlyDeleteCircuit,
    };
    openUserSpaceModal(callbacks);
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

async function restoreDeletedCircuit(circuitId) {
    const circuit = (state.myCircuits || []).find(c => String(c.id) === String(circuitId));
    await restoreCircuit(circuitId);
    if (circuit) {
        circuit.isDeleted = false;
        showToast(`Circuit "${circuit.name || 'Sans nom'}" restauré.`, 'success');
        renderExplorerList();
    }
}

/**
 * Suppression DÉFINITIVE d'un circuit de la corbeille (refonte Mon Espace V3).
 * Purge l'enregistrement IndexedDB + retire du state. N'affecte JAMAIS les POIs
 * (un circuit n'est qu'une liste d'IDs — cf. règle absolue du chantier).
 */
async function permanentlyDeleteCircuit(circuitId) {
    const circuit = (state.myCircuits || []).find(c => String(c.id) === String(circuitId));
    try {
        await deleteCircuitById(circuitId);
        const idx = (state.myCircuits || []).findIndex(c => String(c.id) === String(circuitId));
        if (idx >= 0) state.myCircuits.splice(idx, 1);
        showToast(`Circuit "${circuit?.name || 'Sans nom'}" supprimé définitivement.`, 'info');
        renderExplorerList();
    } catch (err) {
        console.error('[user-space] permanent delete failed', err);
        showToast("Impossible de supprimer le circuit.", 'error');
    }
}
