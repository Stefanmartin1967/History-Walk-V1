// src/publish-destination.js
// C2b — Publier un BROUILLON LOCAL de destination sur GitHub en status:"draft".
//
// Pivot 10/06/2026 : on ne publie PAS directement en "published" (ça, c'est
// « Officialiser » — étape séparée et plus tardive), mais en BROUILLON GitHub —
// exactement comme Hammamet — pour pouvoir travailler la destination depuis
// PLUSIEURS appareils. Le brouillon local (C2a) était coincé sur une seule
// machine ; une destination se construit sur la durée.
//
// Pousse 4 fichiers via uploadFileToGitHub (github-sync.js, Contents API, 1 PUT par
// fichier, gère le SHA create/update), DANS CET ORDRE — données D'ABORD,
// destinations.json EN DERNIER : si un push casse en route, destinations.json
// n'est pas touché → aucune entrée ne pointe vers un fichier manquant.
//
// SOURCE DU GEOJSON (fix 11/06/2026, audit R1) : on publie CE QUE L'ADMIN VOIT
// (state.loadedFeatures via generateMasterGeoJSONData — le même générateur que
// « Tout publier » du CC et l'Export Master), PAS le snapshot draftGeoJSON_{id}.
// Ce snapshot n'est écrit qu'À LA CRÉATION du brouillon ; tout le travail
// ultérieur vit dans 3 canaux qu'il ignore : captures (customPois_{id}),
// curation rename/recat (overlay userData, convention #608) et suppressions
// (userData._deleted). Publier le snapshot = brouillon amputé et non curé sur
// l'autre appareil. generateMasterGeoJSONData fusionne/aplatit tout ça et purge
// déjà PERSONAL_KEYS, photos base64 et accessPoint invalides.
//
// Les candidats (candidate:true) sont CONSERVÉS : un brouillon admin-only les
// garde sans souci ; leur curation se fera à l'« Officialiser » (draft→published).
import { state, setCustomFeatures } from './state.js';
import { fetchWithTimeout } from './net.js';
import { getDraftDestinations, getDraftGeoJSON, getDraftZones, markLocalDraftPublished } from './local-destinations.js';
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
 * Publie un brouillon LOCAL sur GitHub en status:"draft" (multi-appareils).
 * Lève une Error explicite si un pré-requis manque ou si un push échoue ; le
 * brouillon local n'est retiré QU'EN CAS de succès complet (sinon : on retente).
 * @param {string} id  id du brouillon local
 * @param {(msg:string)=>void} [onProgress]  callback d'avancement (pour l'UI)
 * @returns {Promise<{id:string, name:string, pois:number, zones:number}>}
 */
export async function publishDraftToGitHub(id, onProgress = () => {}) {
    // — 1. Pré-vol (validation locale) —
    const token = getStoredToken();
    if (!token) throw new Error('Aucun token GitHub connecté (onglet Connexion du Centre de Contrôle).');

    const drafts = await getDraftDestinations();
    const entry = drafts[id];
    if (!entry) throw new Error('Ce brouillon est introuvable en local.');

    // generateMasterGeoJSONData lit state.loadedFeatures = la destination ACTIVE.
    // L'UI ne propose la publication que sur celle-ci ; ce garde protège tout
    // appel programmatique futur (« Officialiser »…) d'une publication croisée.
    if (id !== state.currentMapId) {
        throw new Error('Ce brouillon n\'est pas la destination active — basculez dessus avant de publier.');
    }

    // Brouillon GitHub (status:draft, admin-only) : on GARDE les candidats Scout
    // non curés — ils voyagent exprès pour être curés sur l'autre appareil.
    const geo = generateMasterGeoJSONData([], { keepCandidates: true });
    if (!geo || !geo.features || geo.features.length === 0) {
        throw new Error('Ce brouillon ne contient aucun lieu — rien à publier.');
    }
    const zones = await getDraftZones(id);

    // — 2. Lecture (fraîche) de destinations.json sur GitHub —
    onProgress('Lecture de la liste des destinations…');
    const dest = await fetchDestinationsJson(token);
    if (!dest.maps) dest.maps = {};
    if (dest.maps[id] && dest.maps[id].status !== 'draft') {
        throw new Error(`Une destination « ${id} » est déjà publiée sur GitHub — publication annulée.`);
    }

    // — 3. Entrée GitHub (status:"draft", chemins canoniques) —
    dest.maps[id] = {
        name: entry.name || id,
        status: 'draft',
        file: `${id}.geojson`,
        circuitsFile: `circuits/${id}.json`,
        zonesFile: `${id}-zones.geojson`,
        bounds: entry.bounds,
        currency: entry.currency || '',
        startView: entry.startView,
    };

    const cleanZones = { type: 'FeatureCollection', features: zones.features || [] };
    const label = entry.name || id;

    // — 4. Push : données D'ABORD, destinations.json EN DERNIER —
    onProgress('Publication des lieux…');
    await uploadFileToGitHub(jsonFile(geo, `${id}.geojson`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.geojson(id), `feat(dest): brouillon « ${label} » — lieux`);

    onProgress('Publication des zones…');
    await uploadFileToGitHub(jsonFile(cleanZones, `${id}-zones.geojson`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.zones(id), `feat(dest): brouillon « ${label} » — zones`);

    onProgress('Création de l\'index des circuits…');
    await uploadFileToGitHub(jsonFile([], `${id}.json`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.circuits(id), `feat(dest): brouillon « ${label} » — index circuits`);

    onProgress('Mise à jour de la liste des destinations…');
    await uploadFileToGitHub(jsonFile(dest, 'destinations.json'), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.destinations(), `feat(dest): ajout du brouillon « ${label} »`);

    // — 5. Succès → la destination vit sur GitHub (status:"draft"). On NE supprime
    // PAS la copie locale tout de suite : tant que GitHub Pages n'a pas redéployé
    // (~1-2 min), elle permet de continuer à voir la destination sur cet appareil
    // (reload compris). On la marque seulement « publiée » ; mergeLocalDraftDestinations
    // la nettoiera au 1er boot où la version GitHub sera détectée live.
    await markLocalDraftPublished(id);

    return { id, name: label, pois: geo.features.length, zones: cleanZones.features.length };
}

/**
 * ENREGISTRE un brouillon de destination sur GitHub DÈS SA CRÉATION (auto-register,
 * garde-fou flux destination 15/06/2026). Contrairement à publishDraftToGitHub, cette
 * fonction est PUREMENT id-keyée : elle ne lit PAS state.loadedFeatures et n'exige NI
 * que la destination soit active (state.currentMapId), NI qu'elle contienne des lieux.
 * Une destination fraîchement créée a un geojson VIDE — c'est volontaire : on l'enregistre
 * vide, puis on la remplit par Scout + « Tout publier ».
 *
 * But : TUER l'état « brouillon LOCAL seul » (source des geojson orphelins / curation
 * perdue). Appelée à la fin de createDestinationDraft (scout.js), AVANT le reload.
 * Pousse, DANS CET ORDRE (données d'abord, destinations.json EN DERNIER — même invariant
 * que publishDraftToGitHub) : {id}.geojson (vide), {id}-zones.geojson, circuits/{id}.json
 * (index vide), puis destinations.json (entrée status:"draft").
 *
 * @param {string} id  id du brouillon local (déjà écrit en IndexedDB par createLocalDraftDestination)
 * @param {object} entry  l'entrée destination (name, bounds, startView, currency)
 * @param {(msg:string)=>void} [onProgress]
 * @returns {Promise<{id:string, name:string}>}
 */
export async function registerDraftDestinationOnGitHub(id, entry, onProgress = () => {}) {
    const token = getStoredToken();
    if (!token) throw new Error('Aucun token GitHub connecté (onglet Connexion du Centre de Contrôle).');

    // Snapshot id-keyé depuis l'IndexedDB (PAS state.loadedFeatures). À la création le
    // geojson est vide ; getDraftGeoJSON/getDraftZones renvoient une FeatureCollection
    // vide par défaut → aucun garde « 0 lieu » ici (contrairement à publishDraftToGitHub).
    const geo = await getDraftGeoJSON(id);
    const zones = await getDraftZones(id);

    onProgress('Lecture de la liste des destinations…');
    const dest = await fetchDestinationsJson(token);
    if (!dest.maps) dest.maps = {};
    if (dest.maps[id] && dest.maps[id].status !== 'draft') {
        throw new Error(`Une destination « ${id} » est déjà publiée sur GitHub — enregistrement annulé.`);
    }

    const label = entry.name || id;
    dest.maps[id] = {
        name: label,
        status: 'draft',
        file: `${id}.geojson`,
        circuitsFile: `circuits/${id}.json`,
        zonesFile: `${id}-zones.geojson`,
        bounds: entry.bounds,
        currency: entry.currency || '',
        startView: entry.startView,
    };

    const cleanGeo = { type: 'FeatureCollection', features: geo?.features || [] };
    const cleanZones = { type: 'FeatureCollection', features: zones?.features || [] };

    onProgress('Enregistrement des lieux…');
    await uploadFileToGitHub(jsonFile(cleanGeo, `${id}.geojson`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.geojson(id), `feat(dest): création du brouillon « ${label} » — lieux`);

    onProgress('Enregistrement des zones…');
    await uploadFileToGitHub(jsonFile(cleanZones, `${id}-zones.geojson`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.zones(id), `feat(dest): brouillon « ${label} » — zones`);

    onProgress('Création de l\'index des circuits…');
    await uploadFileToGitHub(jsonFile([], `${id}.json`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.circuits(id), `feat(dest): brouillon « ${label} » — index circuits`);

    onProgress('Mise à jour de la liste des destinations…');
    await uploadFileToGitHub(jsonFile(dest, 'destinations.json'), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.destinations(), `feat(dest): enregistrement du brouillon « ${label} »`);

    // Comme publishDraftToGitHub : on GARDE la copie locale (latence GitHub Pages ~1-2 min)
    // et on la marque publiée → mergeLocalDraftDestinations la nettoiera au 1er boot où la
    // version GitHub (entrée non-custom) sera détectée live.
    await markLocalDraftPublished(id);

    return { id, name: label };
}

/**
 * « Officialiser » une destination : passe son entrée destinations.json de
 * status:"draft" à "published" (visible par TOUS) sur GitHub. Étape SÉPARÉE et
 * plus tardive que C2b (« Publier en brouillon GitHub ») : ici la destination
 * existe DÉJÀ sur GitHub en brouillon (Hammamet, ou une dest scoutée déjà
 * poussée) et on la rend publique.
 *
 * GARDE-FOU CANDIDAT (option C, validée 12/06) : un candidat Scout NON curé ne
 * doit jamais devenir public. On :
 *   1. PRÉSERVE les candidats restants en local (customPois_{id}) → après
 *      l'officialisation ils réapparaissent au boot comme customFeatures
 *      candidate:true sur la dest publiée (état C1a « Repasse »), curables à
 *      loisir ; une fois curés, « Tout publier » les publie (et #816 garde les
 *      non-curés hors du public).
 *   2. Pousse le geojson public SANS les candidats (generateMasterGeoJSONData,
 *      keepCandidates:false par défaut → isCandidate exclut les non-curés).
 *
 * On re-pousse TOUJOURS le geojson (pas seulement s'il reste des candidats) :
 * une curation locale pas encore « Tout publiée » laisserait sinon des
 * candidate:true sur GitHub au moment du flip. C'est donc l'état de CET appareil
 * qui devient la vérité publiée → officialise depuis l'appareil à jour.
 *
 * destinations.json est lu FRAIS via Contents API (jamais Pages, cf. C2b) ;
 * geojson D'ABORD, destinations.json EN DERNIER (pas de dest publiée pointant un
 * geojson non poussé si le 1er échoue).
 *
 * @param {string} id  id de la destination active (brouillon GitHub)
 * @param {(msg:string)=>void} [onProgress]
 * @returns {Promise<{id:string, name:string, pois:number, candidatesKept:number}>}
 */
export async function officializeDestination(id, onProgress = () => {}) {
    const token = getStoredToken();
    if (!token) throw new Error('Aucun token GitHub connecté (onglet Connexion du Centre de Contrôle).');

    // generateMasterGeoJSONData lit la destination ACTIVE (state.loadedFeatures).
    if (id !== state.currentMapId) {
        throw new Error('Cette destination n\'est pas active — basculez dessus avant de l\'officialiser.');
    }

    // — 1. Lecture fraîche de destinations.json sur GitHub —
    onProgress('Lecture de la liste des destinations…');
    const dest = await fetchDestinationsJson(token);
    const entry = dest.maps && dest.maps[id];
    if (!entry) {
        throw new Error('Cette destination n\'existe pas encore sur GitHub — publie-la d\'abord en brouillon.');
    }
    if (entry.status === 'published') {
        throw new Error('Cette destination est déjà officialisée.');
    }

    // — 2. Garde-fou candidat : préserver en local AVANT de pousser le geojson épuré —
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

    // — 3. Geojson public SANS candidats (keepCandidates:false par défaut) —
    onProgress('Publication des lieux…');
    const geo = generateMasterGeoJSONData();
    if (!geo || !geo.features) throw new Error('Erreur données GeoJSON.');
    const label = entry.name || id;
    await uploadFileToGitHub(jsonFile(geo, `${id}.geojson`), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.geojson(id), `feat(dest): officialisation « ${label} » — lieux`);

    // — 4. Flip status → published + push destinations.json (EN DERNIER) —
    onProgress('Officialisation…');
    entry.status = 'published';
    await uploadFileToGitHub(jsonFile(dest, 'destinations.json'), token, GITHUB_OWNER, GITHUB_REPO,
        GITHUB_PATHS.destinations(), `feat(dest): officialisation « ${label} »`);

    // — 5. Reflet local immédiat : la dest active devient « publiée » côté UI
    // (badge « Brouillon » retiré). Les AUTRES appareils la verront après le
    // redéploiement GitHub Pages (~1-2 min).
    if (state.destinations?.maps?.[id]) {
        state.destinations.maps[id].status = 'published';
    }

    return { id, name: label, pois: geo.features.length, candidatesKept: candidates.length };
}
