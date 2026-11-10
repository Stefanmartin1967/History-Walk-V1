// publish-base.js
// Garde-fou des publications du geojson : ne jamais réécrire la carte en ligne
// depuis une copie plus ancienne qu'elle.
//
// « Tout publier » (et la publication d'une destination) réécrit TOUT
// `{mapId}.geojson` à partir de `state.loadedFeatures`. Si l'app a chargé la
// carte AVANT la dernière publication (relecture en retard, autre appareil,
// onglet resté ouvert), tout ce que cette publication avait changé repart en
// arrière, en silence. Cas constatés : 05/11/2026 (nom et description d'une
// fiche de Charleroi), 10/11/2026 (« Beffroi de Charleroi » : photo effacée,
// Vérifié décoché). Cause de fond dans repo-read.js.
//
// Deux verrous :
//   1. AVANT tout envoi (photos comprises) : la version en ligne doit être
//      celle que l'app a chargée → sinon refus, rien n'est envoyé.
//   2. À l'envoi du geojson : la version attendue est imposée à GitHub, qui
//      refuse (409) si le fichier a changé entre-temps.

import { uploadFileToGitHub } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, GITHUB_PATHS } from './config.js';
import { getRepoFileSha, getLoadedGeojsonSha, setLoadedGeojsonSha } from './repo-read.js';

export const STALE_BASE_MESSAGE =
    "La carte a changé sur GitHub depuis le chargement de l'app (publication récente, autre appareil ou onglet). "
    + "Rien n'a été publié, vos modifications en attente sont conservées. "
    + "Rechargez l'app, vérifiez la fiche, puis publiez de nouveau.";

export class StaleBaseError extends Error {
    constructor(message = STALE_BASE_MESSAGE) {
        super(message);
        this.name = 'StaleBaseError';
    }
}

/**
 * Vérifie que la carte chargée dans l'app est la version en ligne.
 * Lève StaleBaseError sinon (y compris quand la version chargée est inconnue :
 * carte venue du cache ou d'un repli, on ne peut pas prouver qu'elle est à jour).
 * Une erreur réseau remonte telle quelle : pas de publication à l'aveugle.
 * @param {string} mapId
 * @returns {Promise<string|null>} SHA de la version en ligne (null : fichier absent)
 */
export async function assertGeojsonBaseCurrent(mapId) {
    const remote = await getRepoFileSha(GITHUB_PATHS.geojson(mapId));
    const loaded = getLoadedGeojsonSha(mapId);
    if (remote !== loaded) {
        console.warn(`[publish-base] carte périmée pour ${mapId} : chargée ${loaded}, en ligne ${remote}`);
        throw new StaleBaseError();
    }
    return remote;
}

/**
 * Envoie `{mapId}.geojson` en imposant la version attendue, puis retient la
 * nouvelle version comme celle de l'app (publications successives possibles
 * dans la même session).
 * @param {File} file
 * @param {string} token
 * @param {string} mapId
 * @param {string} message
 * @param {string|null} expectedSha version en ligne vérifiée juste avant
 */
export async function uploadGeojsonGuarded(file, token, mapId, message, expectedSha) {
    let result;
    try {
        result = await uploadFileToGitHub(file, token, GITHUB_OWNER, GITHUB_REPO,
            GITHUB_PATHS.geojson(mapId), message, expectedSha ? { expectedSha } : {});
    } catch (e) {
        if (e && e.status === 409) throw new StaleBaseError();
        throw e;
    }
    setLoadedGeojsonSha(mapId, result?.content?.sha || null);
    return result;
}
