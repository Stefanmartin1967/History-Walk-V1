// events-global.js
// Listeners DOM globaux (desktop + mobile) qui ne rentrent ni dans le bus
// événementiel ni dans les setups spécifiques mobile/desktop. Aujourd'hui :
// les deux boutons de la barre circuit en haut de carte (vider, fermer).

import { clearCircuit } from './circuit.js';
import { state } from './state.js';
import { toggleSelectionMode } from './ui-circuit-editor.js';
import { showConfirm } from './modal.js';

export function setupGlobalEventListeners() {
    const btnClear = document.getElementById('btn-clear-circuit');
    if (btnClear) btnClear.addEventListener('click', () => clearCircuit(true));

    const btnClose = document.getElementById('close-circuit-panel-button');
    if (btnClose) {
        btnClose.addEventListener('click', async () => {
            if (state.currentCircuit.length > 0) {
                if (await showConfirm("Fermeture", "Voulez-vous vraiment fermer et effacer le brouillon du circuit ?", "Fermer", "Annuler", true)) {
                    await clearCircuit(false);
                    toggleSelectionMode(false);
                }
            } else {
                toggleSelectionMode(false);
            }
        });
    }
}
