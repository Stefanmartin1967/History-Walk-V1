// src/local-destinations.js
// MODÈLE C (bascule destinations) : une destination vit TOUJOURS sur GitHub
// (création GitHub-first, cf. publish-destination.registerDraftDestinationOnGitHub).
// Il n'y a PLUS de brouillon « local-only ». Ce module ne conserve donc que :
//   - getDraftDestinations / makeUniqueDestId : lecture du store legacy + suggestion
//     d'id unique (l'unicité réelle est garantie par le throw réseau de la création) ;
//   - deleteLocalDraftDestination : purge des données LOCALES d'une carte (appelée
//     par la suppression GitHub d'un brouillon, pour nettoyer l'appareil) ;
//   - createLocalDraftDestination / getDraftZones / saveDraftZones : helpers LEGACY
//     encore utilisés transitoirement (restoreBackup, attachLocalDraft, extension de
//     zones du Scout/recalc). RETIRÉS en PR-4b-2b avec le reste du sous-système local.
//
// Le merge au boot (mergeLocalDraftDestinations), le service du geojson local
// (getDraftGeoJSON) et le marquage de publication (markLocalDraftPublished) ont été
// RETIRÉS en PR-4b-2a (modèle C : le boot lit GitHub, pas l'IndexedDB).
import { state } from './state.js';
import { getAppState, saveAppState, deleteAppState, deleteAllMapData } from './database.js';

// La map { id: entrée } des brouillons locaux legacy (store appState). Lue par
// makeUniqueDestId et deleteLocalDraftDestination. En modèle C elle est normalement
// vide (purge one-shot des résidus prévue en 4b-2b).
export async function getDraftDestinations() {
    return (await getAppState('draftDestinations')) || {};
}

// Forge un id de destination unique à partir d'un nom (slug sans accents). Suggéreur :
// l'unicité réelle est vérifiée à la création GitHub (registerDraftDestinationOnGitHub
// lit destinations.json frais et refuse un id existant). On évite quand même une
// collision évidente avec une dest connue (mémoire) ou un résidu local.
export async function makeUniqueDestId(name) {
    const base = (name || 'destination')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // enlève les accents
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'destination';
    const taken = new Set([
        ...Object.keys(state.destinations?.maps || {}),
        ...Object.keys(await getDraftDestinations()),
    ]);
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
}

// LEGACY (retiré en 4b-2b) — recrée une entrée brouillon locale. Encore appelé par
// fileManager.restoreBackup (restauration d'anciens backups). Tout en IndexedDB.
export async function createLocalDraftDestination(id, entry, geojson, zones) {
    const drafts = await getDraftDestinations();
    drafts[id] = { ...entry, status: 'draft', custom: true };
    await saveAppState('draftDestinations', drafts);
    await saveAppState(`draftGeoJSON_${id}`, geojson || { type: 'FeatureCollection', features: [] });
    await saveAppState(`draftZones_${id}`, zones || { type: 'FeatureCollection', features: [] });
}

// LEGACY (retiré en 4b-2b) — zones (OSM) d'un brouillon local. Encore lu par
// fileManager.attachLocalDraft (sauvegarde). IndexedDB en échec → collection vide.
export async function getDraftZones(id) {
    try {
        return (await getAppState(`draftZones_${id}`)) || { type: 'FeatureCollection', features: [] };
    } catch (e) {
        return { type: 'FeatureCollection', features: [] };
    }
}

// LEGACY (retiré en 4b-2b) — persiste les zones étendues. Encore appelé par
// scout.js (capture) et recalc-zones.js dans leurs branches `custom` (mortes pour un
// brouillon modèle C, custom:false).
export async function saveDraftZones(id, zones) {
    await saveAppState(`draftZones_${id}`, zones || { type: 'FeatureCollection', features: [] });
}

// Purge des données LOCALES d'une carte (appelée par la suppression GitHub d'un
// brouillon, admin-control-ui : deleteDraftFromGitHub puis purge locale). Retire :
// l'entrée legacy draftDestinations (si résidu) + son geojson/zones + ses captures
// (customPois) + les caches zones offline + TOUTES les données IDB indexées par mapId
// (userData/curation, circuits perso, photos blob, cache OSM) + la boîte de scan.
// Best-effort sur les clés annexes (un résidu est inoffensif).
export async function deleteLocalDraftDestination(id) {
    if (!id) return;
    // 1. Entrée brouillon legacy : retirer la clé si elle existe (résidu).
    const drafts = await getDraftDestinations();
    if (drafts[id]) {
        delete drafts[id];
        await saveAppState('draftDestinations', drafts);
    }
    // 2. Clés appState dédiées à cette carte.
    for (const key of [`draftGeoJSON_${id}`, `draftZones_${id}`, `customPois_${id}`, `lastZones_${id}`, `lastZones_etag_${id}`]) {
        try { await deleteAppState(key); } catch (e) { /* best-effort */ }
    }
    // 3. Toutes les données IDB de la carte (poiUserData, savedCircuits, poiPhotos, osmNearestWay).
    try { await deleteAllMapData(id); } catch (e) { /* best-effort */ }
    // 4. Préférence locale (boîte de scan Scout).
    try { localStorage.removeItem(`scout_box_${id}`); } catch (e) { /* ignore */ }
    // 5. Reflet mémoire immédiat : retirer la dest de la liste en cours (avant reload).
    if (state.destinations?.maps?.[id]) delete state.destinations.maps[id];
}
