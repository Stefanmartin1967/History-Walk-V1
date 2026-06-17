// src/local-destinations.js
// Destinations BROUILLON locales (réunif C2a) — créées par le Scout en mode
// « Nouvelle », stockées dans l'IndexedDB admin (PAS dans destinations.json, PAS
// sur GitHub). On les scoute + cure en local ; la publication (push GitHub) est
// une étape séparée et explicite (C2b).
//
// C2a-1b = côté LECTURE/BOOT : fusionner les brouillons dans la liste des
// destinations + servir leur geojson depuis l'IndexedDB.
// C2a-2 = côté CRÉATION : createLocalDraftDestination (appelé par le Scout en mode
// « Nouvelle ») + makeUniqueDestId.
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
import { getAppState, saveAppState, deleteAppState } from './database.js';

// La map { id: entrée } des brouillons locaux. Exportée pour C2b (publication).
export async function getDraftDestinations() {
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
    const supersededByGitHub = [];
    for (const [id, entry] of Object.entries(drafts)) {
        const existing = state.destinations.maps[id];
        if (existing && !existing.custom) {
            // Une vraie dest (GitHub) porte cet id → GitHub gagne (on ne masque pas
            // une dest publiée). Si c'est NOTRE brouillon publié (C2b) désormais
            // déployé sur GitHub Pages, on nettoie sa copie locale devenue inutile.
            // Un id qui collisionne sans drapeau publishedToGitHub est laissé tel quel.
            if (entry.publishedToGitHub) supersededByGitHub.push(id);
            continue;
        }
        state.destinations.maps[id] = { ...entry, status: 'draft', custom: true };
    }
    // Nettoyage HORS boucle (removeLocalDraft réécrit draftDestinations). Best-effort.
    for (const id of supersededByGitHub) {
        try { await removeLocalDraft(id); } catch (e) { /* ignore */ }
    }
}

// Forge un id de destination unique à partir d'un nom (slug sans accents), sans
// collision avec une dest publiée NI un autre brouillon. (C2a-2, Scout.)
export async function makeUniqueDestId(name) {
    const base = (name || 'destination')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // enlève les accents
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

// Crée un brouillon de destination LOCAL : entrée + geojson (POIs candidats) +
// zones. Tout en IndexedDB, aucune écriture GitHub. (C2a-2, Scout mode Nouvelle.)
export async function createLocalDraftDestination(id, entry, geojson, zones) {
    const drafts = await getDraftDestinations();
    drafts[id] = { ...entry, status: 'draft', custom: true };
    await saveAppState('draftDestinations', drafts);
    await saveAppState(`draftGeoJSON_${id}`, geojson || { type: 'FeatureCollection', features: [] });
    await saveAppState(`draftZones_${id}`, zones || { type: 'FeatureCollection', features: [] });
}

// Zones (OSM) d'un brouillon local — lues à la publication GitHub (C2b).
// IndexedDB en échec → collection vide (pas de crash).
export async function getDraftZones(id) {
    try {
        return (await getAppState(`draftZones_${id}`)) || { type: 'FeatureCollection', features: [] };
    } catch (e) {
        return { type: 'FeatureCollection', features: [] };
    }
}

// Met à jour les zones (OSM) d'un brouillon LOCAL en IndexedDB. Le Scout étend les
// zones à la boîte de capture (cf. scout.js capture) ; cette persistance les conserve
// au reload pour un brouillon local. Une dest GitHub a, elle, son fichier
// {id}-zones.geojson comme source de vérité (mis à jour par « Compléter les quartiers »).
export async function saveDraftZones(id, zones) {
    await saveAppState(`draftZones_${id}`, zones || { type: 'FeatureCollection', features: [] });
}

// Retire un brouillon LOCAL (entrée + geojson + zones) une fois sa version GitHub
// détectée live (C2b) : la copie locale n'a plus lieu d'être. Interne (appelé par
// mergeLocalDraftDestinations). Best-effort sur les clés annexes (un résidu
// draftGeoJSON_/draftZones_ orphelin est inoffensif).
async function removeLocalDraft(id) {
    const drafts = await getDraftDestinations();
    if (drafts[id]) {
        delete drafts[id];
        await saveAppState('draftDestinations', drafts);
    }
    try { await deleteAppState(`draftGeoJSON_${id}`); } catch (e) { /* best-effort */ }
    try { await deleteAppState(`draftZones_${id}`); } catch (e) { /* best-effort */ }
}

// Marque un brouillon local comme PUBLIÉ sur GitHub (C2b) SANS le supprimer : tant
// que GitHub Pages n'a pas redéployé (~1-2 min), la copie locale reste la source
// affichée sur cet appareil (reload compris). mergeLocalDraftDestinations nettoie
// la copie locale au 1er boot où la version GitHub (entrée non-custom) est détectée.
export async function markLocalDraftPublished(id) {
    const drafts = await getDraftDestinations();
    if (drafts[id]) {
        drafts[id] = { ...drafts[id], publishedToGitHub: true };
        await saveAppState('draftDestinations', drafts);
    }
}
