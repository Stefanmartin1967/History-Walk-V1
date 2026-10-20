// circuit-photos-offline.js
// Photos des étapes gardées hors-ligne dès qu'on ouvre un circuit en ligne
// (3ᵉ PR du chantier hors-ligne, validée par Stefan le 20/10/2026).
//
// Avant, une photo n'était gardée que si on avait ouvert la fiche de son lieu
// en ligne : sur le terrain, la plupart des fiches d'un circuit préparé
// s'affichaient sans photo (mesuré : 1 photo sur 5, celle de l'en-tête du
// circuit). Or c'est la photo qui permet de reconnaître le bon bâtiment.
//
//  - Photos publiées (tout le monde) : la PREMIÈRE de chaque étape, celle du
//    haut de la fiche — 0,6 Mo par circuit en général, 3,3 Mo au plus (mesuré
//    le 20/10/2026 ; toutes les photos feraient jusqu'à 23,5 Mo). Demandées une
//    à une, en basse priorité ; le service worker les garde (route
//    `poi-photos`, vite.config.js) et ne redemande pas une photo déjà gardée.
//  - Photos de travail (admin seulement) : TOUTES celles des étapes, gardées
//    comprises (sous-ensemble de workPhotos), dans la base de l'appareil
//    (loadWorkPhotoBlob) — sans limite, comme à l'ouverture d'une fiche.
//
// Rien hors-ligne (repris au retour du réseau si un circuit est ouvert) ni en
// mode « économie de données ». Ouvrir un autre circuit arrête le précédent.

import { state } from './state.js';
import { getPoiId } from './data.js';
import { getPoiProp } from './utils.js';
import { isOffline, onNetworkBack } from './network-status.js';
import { getWorkPhotosById, loadWorkPhotoBlob } from './work-photos.js';

let generation = 0;

// Seules les photos du site, sous /photos/, sont gardées par le service worker
// (même motif que sa route) : en télécharger une autre ne servirait à rien.
const KEPT_BY_SERVICE_WORKER = /\/photos\/[^?]+\.jpg(\?.*)?$/i;
function isKeptByServiceWorker(path) {
    try {
        const url = new URL(path, document.baseURI);
        return url.origin === location.origin && KEPT_BY_SERVICE_WORKER.test(url.href);
    } catch {
        return false;
    }
}

/**
 * Garde hors-ligne les photos des étapes d'un circuit (lieux du circuit).
 * Sans attente pour l'appelant : tourne en arrière-plan, sans message.
 */
export async function keepCircuitPhotosOffline(features) {
    const run = ++generation;
    if (isOffline() || navigator.connection?.saveData) return;
    const stillWanted = () => run === generation && !isOffline();
    const steps = features || [];

    for (const feature of steps) {
        const first = getPoiProp(feature, 'photos')?.[0];
        if (typeof first !== 'string' || !isKeptByServiceWorker(first)) continue;
        if (!stillWanted()) return;
        try {
            const response = await fetch(first, { priority: 'low' });
            await response.blob(); // lue jusqu'au bout : la photo est entière en cache
        } catch {
            // Réseau perdu en route : repris au retour du réseau.
        }
    }

    if (!state.isAdmin) return;
    for (const feature of steps) {
        for (const path of getWorkPhotosById(getPoiId(feature))) {
            if (!stillWanted()) return;
            await loadWorkPhotoBlob(path); // déjà gardée : lue dans la base, sans réseau
        }
    }
}

// Circuit ouvert sans réseau : ses photos sont gardées dès que le réseau revient.
onNetworkBack(() => {
    if (state.activeCircuitId) keepCircuitPhotosOffline(state.currentCircuit);
});
