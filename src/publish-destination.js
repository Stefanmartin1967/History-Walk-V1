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
import { getStoredToken, uploadFileToGitHub, deleteFileFromGitHub } from './github-sync.js';
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
export async function fetchDestinationsJson(token) {
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
 * @deprecated MODÈLE C (PR-4) : remplacé par registerDraftDestinationOnGitHub
 * (création) + « Tout publier » (curation) + setDestinationPublished (« Rendre
 * publique »). Conservé dormant en PR-4a (filet + tests) ; RETIRÉ en PR-4b avec le
 * reste du sous-système brouillon-local. Ne plus câbler de nouvel appelant.
 *
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

// ── MODÈLE C (bascule PR-4) ──────────────────────────────────────────────────
// Une destination est TOUJOURS une entrée GitHub ; `status:'draft'` la masque des
// non-admins (gardes de boot + sélecteur). Le brouillon n'a plus de vie locale.
//   - registerDraftDestinationOnGitHub : création (push immédiat, status:'draft') ;
//   - setDestinationPublished : « Rendre publique » = bascule draft → published.
// La CURATION passe par « Tout publier » (admin-control-center), pas par ici.

/**
 * Crée une destination BROUILLON directement sur GitHub (modèle C) — l'entrée
 * status:'draft', un geojson VIDE, les zones et un index circuits vide. La data
 * d'abord, `destinations.json` EN DERNIER : si un push casse en route, aucune
 * entrée ne pointe vers un fichier manquant (anti-orphelin). Lecture fraîche de
 * destinations.json (Contents API) → l'unicité de l'id est garantie par le réseau
 * (makeUniqueDestId n'est qu'un suggérateur, basé sur la vue Pages possiblement
 * périmée). Token requis (création = écriture distante).
 *
 * @param {string} id  id unique de la destination
 * @param {{name?:string, bounds:any, startView:any, currency?:string, country?:string}} entry
 * @param {{type?:string, features?:Array}} [zones]  zones OSM moissonnées à la création
 * @param {(msg:string)=>void} [onProgress]
 * @returns {Promise<{id:string, name:string, entry:object}>}
 */
export async function registerDraftDestinationOnGitHub(id, entry, zones, onProgress = () => {}) {
    const token = getStoredToken();
    if (!token) throw new Error('Aucun token GitHub connecté (onglet Connexion du Centre de Contrôle).');

    onProgress('Lecture de la liste des destinations…');
    const dest = await fetchDestinationsJson(token);
    if (!dest.maps) dest.maps = {};
    if (dest.maps[id]) throw new Error(`Une destination « ${id} » existe déjà sur GitHub.`);

    const label = entry.name || id;
    const cleanZones = { type: 'FeatureCollection', features: zones?.features || [] };

    // Entrée status:'draft' — schéma identique à une dest publiée, chemins canoniques.
    const newEntry = {
        name: label,
        status: 'draft',
        file: `${id}.geojson`,
        circuitsFile: `circuits/${id}.json`,
        zonesFile: `${id}-zones.geojson`,
        bounds: entry.bounds,
        currency: entry.currency || '',
        country: entry.country || '',
        startView: entry.startView,
    };
    dest.maps[id] = newEntry;

    // INVARIANT anti-orphelin : données D'ABORD, destinations.json EN DERNIER.
    onProgress('Création de la carte (lieux vides)…');
    await uploadFileToGitHub(jsonFile({ type: 'FeatureCollection', features: [] }, `${id}.geojson`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.geojson(id), `feat(dest): brouillon « ${label} » — lieux (vide)`);

    onProgress('Création des quartiers…');
    await uploadFileToGitHub(jsonFile(cleanZones, `${id}-zones.geojson`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.zones(id), `feat(dest): brouillon « ${label} » — zones`);

    onProgress('Création de l\'index des circuits…');
    await uploadFileToGitHub(jsonFile([], `${id}.json`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.circuits(id), `feat(dest): brouillon « ${label} » — index circuits`);

    onProgress('Mise à jour de la liste des destinations…');
    await uploadFileToGitHub(jsonFile(dest, 'destinations.json'), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.destinations(), `feat(dest): nouveau brouillon « ${label} »`);

    return { id, name: label, entry: newEntry };
}

/**
 * « Rendre publique » (modèle C, D2) — fait passer une destination de status:'draft'
 * à status:'published'. Ce N'EST PAS un simple flip de status : « Tout publier » sur
 * un brouillon GARDE les candidats Scout non curés dans le geojson distant (admin-
 * only, voulu). Les rendre publics serait une FUITE. Donc « Rendre publique » REPUSHE
 * un geojson ÉPURÉ (keepCandidates:false, candidats mis de côté en local) PUIS bascule
 * le status — le geojson EN PREMIER, destinations.json (la visibilité) EN DERNIER.
 * Refuse s'il n'y a aucun lieu CURÉ à publier (évite une dest publique à 0 lieu).
 *
 * Doit être la destination ACTIVE (le geojson est régénéré depuis l'état affiché,
 * generateMasterGeoJSONData lit state.loadedFeatures). Circuits/photos restent du
 * ressort de « Tout publier » (à faire pendant la curation).
 *
 * @param {string} id
 * @param {(msg:string)=>void} [onProgress]
 * @returns {Promise<{id:string, name:string, pois:number, candidatesKept:number}>}
 */
export async function setDestinationPublished(id, onProgress = () => {}) {
    const token = getStoredToken();
    if (!token) throw new Error('Aucun token GitHub connecté (onglet Connexion du Centre de Contrôle).');
    // generateMasterGeoJSONData lit la dest ACTIVE → on exige qu'elle le soit.
    if (id !== state.currentMapId) {
        throw new Error('Cette destination n\'est pas active — basculez dessus avant de la rendre publique.');
    }

    onProgress('Lecture de la liste des destinations…');
    const dest = await fetchDestinationsJson(token);
    const entry = dest.maps?.[id];
    if (!entry) throw new Error('Cette destination est introuvable sur GitHub.');
    if (entry.status === 'published') throw new Error(`« ${entry.name || id} » est déjà publiée.`);

    // Garde-fou candidat : mettre de côté les candidats non curés en local AVANT de
    // pousser le geojson public épuré (ils restent curables ensuite). Identique au
    // garde-fou de publishDestination.
    const candidates = (state.loadedFeatures || []).filter(isCandidate);
    if (candidates.length > 0) {
        onProgress('Mise de côté des lieux encore à curer…');
        const byId = new Map((state.customFeatures || []).map((f) => [getPoiId(f), f]));
        candidates.forEach((f) => byId.set(getPoiId(f), f));
        const mergedCustom = [...byId.values()];
        setCustomFeatures(mergedCustom);
        await saveAppState(`customPois_${id}`, mergedCustom);
    }

    // Geojson PUBLIC sans candidats. Refus si 0 lieu curé (pas de dest publique vide).
    const geo = generateMasterGeoJSONData([], { keepCandidates: false });
    if (!geo || !geo.features || geo.features.length === 0) {
        throw new Error('Aucun lieu curé à publier — valide au moins un lieu (« Valider ») avant de rendre la destination publique.');
    }

    entry.status = 'published';
    const label = entry.name || id;

    // Push : geojson épuré D'ABORD, destinations.json (la visibilité) EN DERNIER.
    onProgress('Publication des lieux…');
    await uploadFileToGitHub(jsonFile(geo, `${id}.geojson`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.geojson(id), `feat(dest): publication « ${label} » — lieux`);
    onProgress('Mise à jour de la liste des destinations…');
    await uploadFileToGitHub(jsonFile(dest, 'destinations.json'), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.destinations(), `feat(dest): publication de « ${label} »`);

    if (state.destinations?.maps?.[id]) {
        state.destinations.maps[id].status = 'published';
        state.destinations.maps[id].custom = false;
    }
    return { id, name: label, pois: geo.features.length, candidatesKept: candidates.length };
}

/**
 * Supprime un BROUILLON de destination de GitHub (modèle C, PR-4b-1). Réservé aux
 * brouillons (status:'draft') — une dest PUBLIÉE n'est jamais supprimée ici
 * (décision D1). ORDRE ANTI-ORPHELIN INVERSE de la création : on retire l'entrée
 * `destinations.json` EN PREMIER (plus aucun client ne pointe vers les fichiers),
 * PUIS on supprime {id}.geojson / {id}-zones.geojson / circuits/{id}.json (best-
 * effort : un fichier déjà absent ne bloque pas). La purge des données LOCALES
 * (customPois, userData, photos, zones, scan box) est faite par l'appelant via
 * deleteLocalDraftDestination. No-op GitHub si l'id n'est pas (ou plus) sur GitHub
 * (résidu purement local) → l'appelant fait quand même la purge locale.
 *
 * @param {string} id
 * @param {(msg:string)=>void} [onProgress]
 * @returns {Promise<{id:string, name?:string, removedFromGitHub:boolean}>}
 */
export async function deleteDraftFromGitHub(id, onProgress = () => {}) {
    const token = getStoredToken();
    if (!token) throw new Error('Aucun token GitHub connecté (onglet Connexion du Centre de Contrôle).');

    onProgress('Lecture de la liste des destinations…');
    const dest = await fetchDestinationsJson(token);
    const entry = dest.maps?.[id];
    if (!entry) return { id, removedFromGitHub: false }; // pas sur GitHub (résidu local)
    if (entry.status === 'published') {
        throw new Error('Une destination publiée ne peut pas être supprimée ici.');
    }

    const label = entry.name || id;
    // 1. Entrée EN PREMIER (dès qu'elle disparaît, plus rien ne pointe vers les fichiers).
    delete dest.maps[id];
    onProgress('Retrait de la liste des destinations…');
    await uploadFileToGitHub(jsonFile(dest, 'destinations.json'), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.destinations(), `chore(dest): suppression du brouillon « ${label} »`);

    // 2. Fichiers de la carte (best-effort : 404 « déjà absent » = normal, on ignore).
    //    On inclut tested_{id}.json : un brouillon a pu le pousser si un circuit a été
    //    marqué « Fait » pendant la phase brouillon (tested-sync n'a pas de garde
    //    published). DETTE 4b-2 : les GPX par-circuit (circuits/{id}/*.gpx) et les
    //    photos à plat (public/photos/poi_*.jpg, non namespacées par mapId) ne sont PAS
    //    supprimés ici — ils deviennent des orphelins INERTES (aucun pointeur après
    //    retrait de l'entrée + index, boot sûr). Nettoyage repo complet prévu en 4b-2.
    onProgress('Suppression des fichiers de la destination…');
    for (const path of [GITHUB_PATHS.geojson(id), GITHUB_PATHS.zones(id), GITHUB_PATHS.circuits(id), GITHUB_PATHS.tested(id)]) {
        try {
            await deleteFileFromGitHub(token, GITHUB_OWNER, GITHUB_REPO, path, `chore(dest): suppression « ${label} » — ${path}`);
        } catch (e) {
            console.warn(`[deleteDraft] suppression ${path} échouée (peut-être déjà absent) :`, e);
        }
    }

    if (state.destinations?.maps?.[id]) delete state.destinations.maps[id];
    return { id, name: label, removedFromGitHub: true };
}
