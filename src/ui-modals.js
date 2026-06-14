import { state } from './state.js';
import { getPoiId, getPatrimonialName, deletePoi } from './data.js';
import { showConfirm } from './modal.js';
import { closeDetailsPanel } from './ui-details.js';
import { isMobileView } from './mobile-state.js';
import { eventBus } from './events.js';

export function initUiModalsListeners() {
    eventBus.on('poi:request-soft-delete', (idOrIndex) => requestSoftDelete(idOrIndex));
}

// --- FONCTION DE SUPPRESSION DOUCE (Déplacée de main.js) ---
export async function requestSoftDelete(idOrIndex) {
    let feature;
    if (typeof idOrIndex === 'number' && state.loadedFeatures[idOrIndex]) {
        feature = state.loadedFeatures[idOrIndex];
    } else {
        feature = state.loadedFeatures[state.currentFeatureId];
    }
    if (!feature) return;

    let poiId;
    try { poiId = getPoiId(feature); } catch (e) { poiId = feature.properties.HW_ID || feature.id; }
    const poiName = getPatrimonialName(feature);

    const msg = isMobileView()
        ? `ATTENTION !\n\nVoulez-vous vraiment placer "${poiName}" dans la corbeille ?`
        : `ATTENTION !\n\nVoulez-vous vraiment signaler "${poiName}" pour suppression ?`;

    if (await showConfirm("Suppression", msg, "Supprimer", "Garder", true)) {
        await deletePoi(poiId);

        // On ferme le panneau
        closeDetailsPanel(true);

        // Refresh selon mode
        if (isMobileView()) {
            eventBus.emit('mobile:switch-view', 'circuits'); // Refresh liste
        }
    }
}
