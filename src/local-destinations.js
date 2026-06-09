// src/local-destinations.js
// Destinations BROUILLON locales (réunif C2a) — créées par le Scout en mode
// « Nouvelle », stockées dans l'IndexedDB admin (PAS dans destinations.json, PAS
// sur GitHub). On les scoute + cure en local ; la publication (push GitHub) est
// une étape séparée et explicite (C2b).
//
// C2a-1b (ici) = côté LECTURE/BOOT : fusionner les brouillons dans la liste des
// destinations + servir leur geojson depuis l'IndexedDB. La CRÉATION
// (createLocalDraftDestination, appelée par le Scout) arrive en C2a-2.
//
// Stockage (store appState) :
//   - 'draftDestinations'   : { [id]: entrée destination (status:'draft', custom:true) }
//   - 'draftGeoJSON_{id}'   : FeatureCollection des POIs (candidate:true)
//   - 'draftZones_{id}'     : FeatureCollection des zones (OSM) — lue par loadZonesForActive
//
// Visibilité : status:'draft' → les gardes EXISTANTES (boot app-startup.js:160 +
// filtre du sélecteur topbar) les masquent aux non-admins. De toute façon un
// non-admin (autre appareil) n'a aucun brouillon dans SON IndexedDB.
import { state } from './state.js';
import { getAppState } from './database.js';

// Interne : la map { id: entrée } des brouillons locaux.
async function getDraftDestinations() {
    return (await getAppState('draftDestinations')) || {};
}

// POIs d'un brouillon local (servi à la place du fetch GitHub par app-startup).
// IndexedDB indisponible/en échec → collection vide (pas de crash au boot).
export async function getDraftGeoJSON(id) {
    try {
        return (await getAppState(`draftGeoJSON_${id}`)) || { type: 'FeatureCollection', features: [] };
    } catch (e) {
        return { type: 'FeatureCollection', features: [] };
    }
}

// Fusionne les brouillons locaux dans state.destinations.maps (au boot, juste
// après setDestinations). Inconditionnel : leur status:'draft' suffit à les
// masquer aux non-admins via les gardes existantes. On n'écrase jamais une
// destination publiée du même id (sécurité). IndexedDB indisponible/en échec
// (test, SSR…) → aucun brouillon, le boot continue normalement.
export async function mergeLocalDraftDestinations() {
    let drafts;
    try {
        drafts = await getDraftDestinations();
    } catch (e) {
        return;
    }
    if (!drafts || !Object.keys(drafts).length) return;
    if (!state.destinations) state.destinations = { activeMapId: 'djerba', maps: {} };
    if (!state.destinations.maps) state.destinations.maps = {};
    for (const [id, entry] of Object.entries(drafts)) {
        const existing = state.destinations.maps[id];
        if (existing && !existing.custom) continue; // ne pas masquer une vraie dest publiée
        state.destinations.maps[id] = { ...entry, status: 'draft', custom: true };
    }
}
