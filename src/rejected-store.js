// rejected-store.js — garde sur l'appareil et envoi des rejets de curation Scout
// (02/11/2026, plan validé par Stefan).
//
// Un rejet (suppression d'un candidat, data.js deletePoi) n'est plus poussé
// sur-le-champ : un commit et un déploiement par rejet, intenable avec les ~3000
// candidats du scan de la Wallonie. Les rejets en attente (rejected.js) sont gardés
// en IndexedDB (`pendingRejected_{dest}`) pour survivre à un rechargement, puis
// partent en UN commit :
//   - à « Tout publier » (admin-control-center.js), qui les compte dans le Centre
//     de Contrôle (stats.rejectedPending, admin-diff-engine.js) ;
//   - ou avec une action de la corbeille (rejected-trash-ui.js), qui pousse le
//     fichier entier tout de suite, comme avant.
import { getAppState, saveAppState } from './database.js';
import { rejectedData, pendingRejected, setPendingRejected, markRejectedPublished } from './rejected.js';

const storeKey = (mapId) => `pendingRejected_${mapId}`;

/** Relit les rejets en attente de la destination (boot, avant les rejets publiés). */
export async function loadPendingRejected(mapId) {
    let data = null;
    try { data = await getAppState(storeKey(mapId)); } catch (_) { /* IDB indispo : rien en attente */ }
    setPendingRejected(data);
}

/** Enregistre les rejets en attente sur l'appareil. */
export async function savePendingRejected(mapId) {
    await saveAppState(storeKey(mapId), pendingRejected);
}

/**
 * Pousse le fichier des rejets entier (publiés + en attente) en un commit. Les
 * rejets envoyés sortent de l'attente seulement si l'envoi réussit ; un rejet
 * ajouté pendant l'envoi reste en attente. L'erreur remonte (token absent, réseau).
 */
export async function pushRejected(mapId, onProgress) {
    const sent = Object.keys(pendingRejected);
    const { pushDestinationRejected } = await import('./publish-destination.js');
    await pushDestinationRejected(mapId, rejectedData, onProgress);
    markRejectedPublished(sent);
    await savePendingRejected(mapId);
}
