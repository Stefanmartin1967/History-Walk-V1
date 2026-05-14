// user-space.js — Contrôleur "Mon Espace" (côté utilisateur)
import { state } from './state.js';
import { restoreCircuit } from './database.js';
import { showToast } from './toast.js';
import { openUserSpaceModal } from './user-space-ui.js';
import { exportDataForMobilePC, exportFullBackupPC, handleRestoreFile } from './fileManager.js';
import { renderExplorerList } from './ui-circuit-list.js';

export function openUserSpace() {
    const callbacks = {
        // setSelection retiré 14/05/2026 (refonte Mon Espace V2 PR1) : la sélection
        // de circuits via checklist a été remplacée par le bouton "Cacher ce
        // circuit" (fiche circuit, câblé en PR2) qui pilote state.hiddenCircuitIds.
        exportData: exportUserData,
        restoreData: restoreUserData,
        restoreCircuit: restoreDeletedCircuit,
    };
    openUserSpaceModal(callbacks);
}

async function exportUserData(includePhotos) {
    if (includePhotos) {
        await exportFullBackupPC();
    } else {
        await exportDataForMobilePC();
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
