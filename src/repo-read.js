// repo-read.js
// Lecture FRAÎCHE des fichiers du dépôt principal, et version de la carte chargée.
//
// Pourquoi (10/11/2026, « Beffroi de Charleroi ») : raw.githubusercontent.com
// garde chaque fichier jusqu'à 5 minutes en cache (Cache-Control: max-age=300)
// et IGNORE la chaîne de requête : le `?t=Date.now()` des lecteurs ne forçait
// rien (constaté : `X-Cache: HIT` pour des `?t=` tous différents). Une relecture
// dans les 5 minutes qui suivent une publication rendait donc la version
// d'AVANT, et « Tout publier », qui réécrit tout le geojson depuis l'état en
// mémoire, republiait ce périmé par-dessus la publication précédente (photo
// effacée et Vérifié décoché sur le Beffroi, nom revenu en arrière le 05/11).
//
// Avec un jeton (admin), on lit par l'API Contents (`Accept: …raw`) : elle sert
// toujours l'état de la branche, et son ETag est l'identifiant git (SHA du blob)
// du fichier, exposé en CORS. Sans jeton (visiteur), RAW comme avant.

import { fetchWithTimeout } from './net.js';
import { getStoredToken } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, RAW_BASE } from './config.js';

/** Réponse lue par l'API → SHA du blob (ETag). */
const apiShas = new WeakMap();

function apiUrl(path) {
    return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`;
}

function shaFromEtag(resp) {
    const etag = resp.headers?.get?.('etag') || '';
    const m = etag.match(/"([0-9a-f]{40})"/);
    return m ? m[1] : null;
}

/**
 * Lit un fichier du dépôt par l'API GitHub, version à jour garantie.
 * Retourne null sans jeton, ou si l'API ne répond pas correctement (réseau,
 * 401, 5xx, quota) : à l'appelant de choisir son repli. Un 404 est rendu tel
 * quel (fichier absent, information utile).
 * @param {string} path chemin dans le dépôt (segments déjà encodés si besoin)
 * @returns {Promise<Response|null>}
 */
export async function fetchRepoFileFresh(path) {
    let token = null;
    try { token = getStoredToken(); } catch { /* pas de stockage (environnement réduit) */ }
    if (!token) return null;
    try {
        const resp = await fetchWithTimeout(apiUrl(path), {
            cache: 'no-store', // l'API annonce max-age=60 : pas de copie navigateur
            headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.raw' },
        });
        if (resp.ok) {
            apiShas.set(resp, shaFromEtag(resp));
            return resp;
        }
        if (resp.status === 404) return resp;
        console.warn(`[repo-read] API GitHub HTTP ${resp.status} pour ${path} — repli`);
    } catch (e) {
        console.warn(`[repo-read] API GitHub injoignable pour ${path} — repli`, e);
    }
    return null;
}

/**
 * Lit un fichier du dépôt : par l'API (fraîche) avec un jeton, sinon par RAW
 * (cache de 5 minutes au plus). Remplace les `fetchWithTimeout(RAW_BASE/…?t=…)`.
 * @param {string} path
 * @returns {Promise<Response>}
 */
export async function fetchRepoFile(path) {
    const fresh = await fetchRepoFileFresh(path);
    if (fresh) return fresh;
    return fetchWithTimeout(`${RAW_BASE}/${path}?t=${Date.now()}`);
}

/** SHA git du fichier si la réponse vient de l'API, sinon null. */
export function repoFileSha(resp) {
    return (resp && apiShas.get(resp)) || null;
}

/**
 * SHA git ACTUEL d'un fichier du dépôt (requête HEAD, sans télécharger).
 * null si le fichier n'existe pas. Lève une erreur si GitHub ne répond pas :
 * l'appelant ne doit pas conclure « à jour » sans réponse.
 * @param {string} path
 * @returns {Promise<string|null>}
 */
export async function getRepoFileSha(path) {
    const token = getStoredToken();
    if (!token) throw new Error('Jeton GitHub manquant');
    const resp = await fetchWithTimeout(apiUrl(path), {
        method: 'HEAD',
        cache: 'no-store',
        headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.raw' },
    });
    if (resp.status === 404) return null;
    if (!resp.ok) {
        const err = new Error(`GitHub indisponible (HTTP ${resp.status})`);
        err.status = resp.status;
        throw err;
    }
    const sha = shaFromEtag(resp);
    if (!sha) throw new Error('Version du fichier illisible (ETag absent)');
    return sha;
}

// ─── Version de la carte chargée dans l'app ──────────────────────────────────
// SHA git du `{mapId}.geojson` sur lequel repose `state.loadedFeatures` : posé
// au démarrage (null si la carte ne vient pas de l'API : repli RAW/Pages ou
// hors-ligne), puis après chaque envoi réussi du geojson par l'app.

const loadedGeojsonSha = new Map();

export function setLoadedGeojsonSha(mapId, sha) {
    loadedGeojsonSha.set(mapId, sha || null);
}

export function getLoadedGeojsonSha(mapId) {
    return loadedGeojsonSha.get(mapId) || null;
}
