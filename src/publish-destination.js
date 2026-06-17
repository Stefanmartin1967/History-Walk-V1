// src/publish-destination.js
// Cycle de vie destination — modèle 2-PHASES (Option A, 17/06/2026).
//
// Phase ÉDITION : le brouillon vit UNIQUEMENT en local (IndexedDB, custom:true).
// RIEN n'est poussé sur GitHub. On scoute + cure tranquillement, admin-only.
//
// Phase PUBLIÉE : « Publier cette destination » → publishDestination() pousse,
// pour la PREMIÈRE et SEULE fois, les 4 fichiers sur GitHub en status:"published"
// (visible de tous). Plus d'étape « brouillon GitHub » intermédiaire : un brouillon
// se travaille en local puis passe public d'un coup (le multi-appareils n'est pas
// un besoin — décision Option A). Remplace les anciennes registerDraftDestinationOnGitHub
// (push à la création), publishDraftToGitHub (brouillon GitHub) et officializeDestination.
//
// Pousse via uploadFileToGitHub (github-sync.js, Contents API, 1 PUT/fichier, gère
// le SHA create/update), DANS CET ORDRE — données D'ABORD, destinations.json EN
// DERNIER : si un push casse en route, destinations.json n'est pas touché → aucune
// entrée ne pointe vers un fichier manquant.
//
// SOURCE DU GEOJSON : generateMasterGeoJSONData (state.loadedFeatures + overlay
// userData = l'état AFFICHÉ) — même générateur que « Tout publier » du CC. Il
// fusionne captures (customPois_{id}), curation (overlay) et suppressions
// (userData._deleted), et purge déjà PERSONAL_KEYS, photos base64 et accessPoint.
//
// GARDE-FOU CANDIDAT : un candidat Scout NON curé ne devient JAMAIS public. On le
// met de côté en local (customPois_{id}) puis on pousse le geojson SANS candidats
// (keepCandidates:false). Il réapparaît au boot (curable) ; une fois curé, « Tout
// publier » le publiera sur la dest désormais publiée.
import { state, setCustomFeatures } from './state.js';
import { fetchWithTimeout } from './net.js';
import { getDraftDestinations, getDraftZones, markLocalDraftPublished } from './local-destinations.js';
import { generateMasterGeoJSONData } from './admin-geojson.js';
import { getStoredToken, uploadFileToGitHub } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, GITHUB_PATHS } from './config.js';
import { isCandidate, getPoiId } from './utils.js';
import { saveAppState } from './database.js';

// Emballe un objet en File JSON indenté (uploadFileToGitHub lit un File → base64
// UTF-8 via FileReader, donc les accents passent correctement).
function jsonFile(obj, name) {
    return new File([JSON.stringify(obj, null, 2) + '\n'], name, { type: 'application/json' });
}

// Lit le destinations.json ACTUEL sur GitHub (contenu frais via la Contents API,
// no-store) → base de la modification (read → add → write). destinations.json est
// minuscule (< 2 Ko) donc jamais tronqué par la limite 1 Mo de l'API.
async function fetchDestinationsJson(token) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATHS.destinations()}`;
    const res = await fetchWithTimeout(url, {
        headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
        cache: 'no-store',
    });
    if (!res.ok) throw new Error('Lecture de destinations.json impossible sur GitHub.');
    const data = await res.json();
    const bin = atob((data.content || '').replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
}

/**
 * Publie un brouillon LOCAL de destination sur GitHub en status:"published" — le
 * 1er et SEUL push (modèle 2-phases, Option A). La destination passe directement
 * de « brouillon local admin-only » à « publiée, visible de tous ».
 *
 * Pousse 4 fichiers (données d'abord, destinations.json en dernier). Le brouillon
 * local n'est retiré QU'EN CAS de succès complet (markLocalDraftPublished + cleanup
 * au boot suivant par mergeLocalDraftDestinations) ; sinon on retente.
 *
 * @param {string} id  id du brouillon local (= destination active)
 * @param {(msg:string)=>void} [onProgress]  callback d'avancement (pour l'UI)
 * @returns {Promise<{id:string, name:string, pois:number, zones:number, candidatesKept:number}>}
 */
export async function publishDestination(id, onProgress = () => {}) {
    // — 1. Pré-vol (validation locale) —
    const token = getStoredToken();
    if (!token) throw new Error('Aucun token GitHub connecté (onglet Connexion du Centre de Contrôle).');

    const drafts = await getDraftDestinations();
    const entry = drafts[id];
    if (!entry) throw new Error('Ce brouillon est introuvable en local.');

    // generateMasterGeoJSONData lit state.loadedFeatures = la destination ACTIVE.
    // L'UI ne propose la publication que sur celle-ci ; ce garde protège tout appel
    // programmatique futur d'une publication croisée.
    if (id !== state.currentMapId) {
        throw new Error('Ce brouillon n\'est pas la destination active — basculez dessus avant de publier.');
    }

    // — 2. Lecture fraîche de destinations.json sur GitHub (read → add → write) —
    onProgress('Lecture de la liste des destinations…');
    const dest = await fetchDestinationsJson(token);
    if (!dest.maps) dest.maps = {};
    if (dest.maps[id] && dest.maps[id].status === 'published') {
        throw new Error(`Une destination « ${id} » est déjà publiée sur GitHub.`);
    }

    // — 3. Garde-fou candidat : mettre de côté les candidats non curés en local
    //      AVANT de pousser le geojson public épuré (ils restent curables ensuite). —
    const candidates = (state.loadedFeatures || []).filter(isCandidate);
    if (candidates.length > 0) {
        onProgress('Mise de côté des lieux encore à curer…');
        // Fusion par HW_ID avec les customFeatures déjà présents (capture locale).
        const byId = new Map((state.customFeatures || []).map((f) => [getPoiId(f), f]));
        candidates.forEach((f) => byId.set(getPoiId(f), f));
        const mergedCustom = [...byId.values()];
        setCustomFeatures(mergedCustom);
        await saveAppState(`customPois_${id}`, mergedCustom);
    }

    // — 4. Geojson PUBLIC sans candidats (keepCandidates:false) —
    const geo = generateMasterGeoJSONData([], { keepCandidates: false });
    if (!geo || !geo.features || geo.features.length === 0) {
        throw new Error('Aucun lieu curé à publier — valide au moins un lieu (bouton « Valider ») avant de publier.');
    }
    const zones = await getDraftZones(id);
    const cleanZones = { type: 'FeatureCollection', features: zones.features || [] };
    const label = entry.name || id;

    // — 5. Entrée GitHub status:"published" (chemins canoniques) —
    dest.maps[id] = {
        name: label,
        status: 'published',
        file: `${id}.geojson`,
        circuitsFile: `circuits/${id}.json`,
        zonesFile: `${id}-zones.geojson`,
        bounds: entry.bounds,
        currency: entry.currency || '',
        country: entry.country || '',
        startView: entry.startView,
    };

    // — 6. Push : données D'ABORD, destinations.json EN DERNIER —
    onProgress('Publication des lieux…');
    await uploadFileToGitHub(jsonFile(geo, `${id}.geojson`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.geojson(id), `feat(dest): publication « ${label} » — lieux`);

    onProgress('Publication des zones…');
    await uploadFileToGitHub(jsonFile(cleanZones, `${id}-zones.geojson`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.zones(id), `feat(dest): publication « ${label} » — zones`);

    onProgress('Création de l\'index des circuits…');
    await uploadFileToGitHub(jsonFile([], `${id}.json`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.circuits(id), `feat(dest): publication « ${label} » — index circuits`);

    onProgress('Mise à jour de la liste des destinations…');
    await uploadFileToGitHub(jsonFile(dest, 'destinations.json'), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.destinations(), `feat(dest): publication de « ${label} »`);

    // — 7. Succès : garder la copie locale le temps du redéploiement GitHub Pages
    // (~1-2 min) ; mergeLocalDraftDestinations la nettoiera au 1er boot où la version
    // GitHub (entrée non-custom) sera détectée live. Reflet local immédiat : la dest
    // n'est plus un brouillon (badge retiré + carte « Publier » masquée).
    await markLocalDraftPublished(id);
    if (state.destinations?.maps?.[id]) {
        state.destinations.maps[id].status = 'published';
        state.destinations.maps[id].custom = false;
    }

    return { id, name: label, pois: geo.features.length, zones: cleanZones.features.length, candidatesKept: candidates.length };
}

/**
 * Pousse le fichier {id}-zones.geojson sur GitHub (« Compléter les quartiers »).
 * « Tout publier » ne pousse JAMAIS les zones (seulement geojson/circuits/photos),
 * d'où cette fonction dédiée. On ne touche PAS destinations.json : l'entrée pointe
 * déjà vers ce fichier (zonesFile).
 *
 * @param {string} id  id de la destination (publiée)
 * @param {{type:string, features:Array}} zones  FeatureCollection des zones à pousser
 * @param {(msg:string)=>void} [onProgress]
 * @returns {Promise<{id:string, zones:number}>}
 */
export async function pushDestinationZones(id, zones, onProgress = () => {}) {
    const token = getStoredToken();
    if (!token) throw new Error('Aucun token GitHub connecté (onglet Connexion du Centre de Contrôle).');

    const cleanZones = { type: 'FeatureCollection', features: zones?.features || [] };

    onProgress('Publication des zones…');
    await uploadFileToGitHub(jsonFile(cleanZones, `${id}-zones.geojson`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.zones(id), `chore(zones): complète les quartiers « ${id} »`);

    return { id, zones: cleanZones.features.length };
}
