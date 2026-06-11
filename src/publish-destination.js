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
import { state } from './state.js';
import { fetchWithTimeout } from './net.js';
import { getDraftDestinations, getDraftZones, markLocalDraftPublished } from './local-destinations.js';
import { generateMasterGeoJSONData } from './admin-geojson.js';
import { getStoredToken, uploadFileToGitHub } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, GITHUB_PATHS } from './config.js';

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

    const geo = generateMasterGeoJSONData();
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
