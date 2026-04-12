// user-space.js — Contrôleur "Mon Espace" (côté utilisateur)
import { state, setSelectedOfficialCircuitIds } from './state.js';
import { saveAppState, restoreCircuit } from './database.js';
import { showToast } from './toast.js';
import { openUserSpaceModal } from './user-space-ui.js';
import { exportDataForMobilePC, exportFullBackupPC, handleRestoreFile } from './fileManager.js';
import { renderExplorerList } from './ui-circuit-list.js';

export function openUserSpace() {
    const callbacks = {
        setSelection: setCircuitSelection,
        exportData: exportUserData,
        restoreData: restoreUserData,
        restoreCircuit: restoreDeletedCircuit,
    };
    openUserSpaceModal(callbacks);
}

async function setCircuitSelection(ids) {
    setSelectedOfficialCircuitIds(ids);
    await saveAppState('selectedOfficialCircuits', ids);
    renderExplorerList();
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
