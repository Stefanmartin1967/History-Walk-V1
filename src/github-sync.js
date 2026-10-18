// src/github-sync.js
//
// Gestion du Personal Access Token (PAT) GitHub + opérations d'upload/suppression.
//
// ─── Stockage du PAT ─────────────────────────────────────────────────────────
// Le PAT est stocké dans IndexedDB (object store 'appState', clé
// 'github_pat'), pas dans localStorage. IndexedDB reste same-origin mais est
// moins exposé aux scripts d'extension et aux snippets tiers qui scrutent
// localStorage — c'est un durcissement, pas une protection absolue (un XSS
// same-origin peut toujours lire l'IDB).
//
// API synchrone conservée (nombreux consommateurs) via un cache en mémoire :
//   - initTokenCache() : async, lit l'IDB + migre l'ancienne valeur localStorage
//     si présente. À appeler UNE FOIS au démarrage de l'app.
//   - getStoredToken() / isTokenPersisted() : sync, lisent le cache.
//   - saveToken(token) : sync vis-à-vis du cache, persiste l'IDB en arrière-plan.

import { getAppState, saveAppState } from './database.js';
import { fetchWithTimeout } from './net.js';
import { fileReadError } from './utils.js';

const STORAGE_KEY_TOKEN = 'github_pat';
const STORAGE_KEY_USERNAME = 'github_username';
const LEGACY_LS_KEY = 'github_pat';
const REQUIRED_SCOPES = ['repo', 'gist'];

let _tokenCache = null;
let _usernameCache = null;
let _cacheReady = false;

/**
 * Initialise le cache PAT depuis IndexedDB. Si le PAT existe encore dans
 * l'ancien localStorage (legacy), il est migré puis supprimé de localStorage.
 * À appeler une fois au démarrage de l'app avant toute opération GitHub.
 */
export async function initTokenCache() {
    try {
        let token = await getAppState(STORAGE_KEY_TOKEN);

        // Migration legacy : si localStorage contient encore un PAT, on le
        // transfère vers IndexedDB puis on le retire de localStorage.
        if (!token) {
            const legacy = localStorage.getItem(LEGACY_LS_KEY);
            if (legacy) {
                token = legacy.trim();
                await saveAppState(STORAGE_KEY_TOKEN, token);
                localStorage.removeItem(LEGACY_LS_KEY);
            }
        } else {
            // Si IDB a déjà le token, on s'assure que localStorage est propre
            if (localStorage.getItem(LEGACY_LS_KEY)) {
                localStorage.removeItem(LEGACY_LS_KEY);
            }
        }

        const username = await getAppState(STORAGE_KEY_USERNAME);
        _tokenCache = token || null;
        _usernameCache = (token && username) ? username : null;
    } catch (err) {
        console.warn('[github-sync] initTokenCache failed, PAT indisponible', err);
        _tokenCache = null;
        _usernameCache = null;
    } finally {
        _cacheReady = true;
    }
}

/**
 * Récupère le token depuis le cache mémoire.
 * @returns {string|null}
 */
export function getStoredToken() {
    if (!_cacheReady) {
        // Cache pas encore initialisé : on retombe sur localStorage legacy en
        // lecture seule (ne devrait pas arriver en prod, mais évite un crash).
        return localStorage.getItem(LEGACY_LS_KEY) || null;
    }
    return _tokenCache;
}

/**
 * Indique si un token est enregistré.
 * @returns {boolean}
 */
export function isTokenPersisted() {
    return !!getStoredToken();
}

/**
 * Récupère le username GitHub associé au token (validé via API à la sauvegarde).
 * Null si aucun token, ou si le token a été stocké avant l'introduction de la validation.
 * @returns {string|null}
 */
export function getStoredUsername() {
    return _usernameCache;
}

/**
 * Sauvegarde ou supprime le token. Le cache est mis à jour immédiatement
 * (lecture sync cohérente dès le retour), la persistance IDB est asynchrone
 * en arrière-plan.
 * @param {string} token
 * @param {string|null} [username] Username GitHub validé via validateToken().
 */
export function saveToken(token, username = null) {
    const clean = token ? token.trim() : null;
    const cleanUsername = clean ? (username || null) : null;
    _tokenCache = clean || null;
    _usernameCache = cleanUsername;
    _cacheReady = true;

    // Persiste en arrière-plan (fire-and-forget avec log en cas d'erreur)
    saveAppState(STORAGE_KEY_TOKEN, clean).catch(err => {
        console.warn('[github-sync] saveToken: IDB persist failed', err);
    });
    saveAppState(STORAGE_KEY_USERNAME, cleanUsername).catch(err => {
        console.warn('[github-sync] saveToken username persist failed', err);
    });
}

/**
 * Valide un token GitHub via l'API `GET /user`.
 * Vérifie aussi les scopes (header X-OAuth-Scopes) pour les PAT classiques.
 * Les fine-grained PAT n'exposent pas ce header — on ne signale alors aucun scope manquant.
 *
 * @param {string} token
 * @returns {Promise<{ok: boolean, username?: string, scopes?: string[], missingScopes?: string[], error?: string}>}
 */
export async function validateToken(token) {
    const clean = token ? token.trim() : '';
    if (!clean) {
        return { ok: false, error: 'Token vide' };
    }
    let response;
    try {
        response = await fetchWithTimeout('https://api.github.com/user', {
            headers: {
                'Authorization': `token ${clean}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
    } catch (err) {
        return { ok: false, error: `Erreur réseau : ${err.message}` };
    }
    if (response.status === 401) {
        return { ok: false, error: 'Token invalide ou expiré' };
    }
    if (!response.ok) {
        return { ok: false, error: `Erreur API GitHub (HTTP ${response.status})` };
    }
    let data;
    try {
        data = await response.json();
    } catch (err) {
        return { ok: false, error: 'Réponse GitHub invalide' };
    }
    const scopesHeader = response.headers.get('X-OAuth-Scopes');
    let scopes = [];
    let missingScopes = [];
    if (scopesHeader !== null) {
        scopes = scopesHeader.split(',').map(s => s.trim()).filter(Boolean);
        // Si le header est présent (PAT classique), on vérifie les scopes requis.
        // Si absent (PAT fine-grained), on ne peut pas vérifier — on accepte sans warn.
        if (scopes.length > 0) {
            missingScopes = REQUIRED_SCOPES.filter(s => !scopes.includes(s));
        }
    }
    return {
        ok: true,
        username: data.login,
        scopes,
        missingScopes
    };
}

// ─── Erreurs de l'API GitHub ─────────────────────────────────────────────────
// Une réponse en erreur peut arriver avec un corps VIDE (500, 502, 504) : la lire
// en JSON levait « Unexpected end of JSON input », qui masquait le vrai code —
// note de test 20 (07/10/2026), où un HTTP 500 de GitHub passait pour un bug de
// l'app.

const fileLabel = (path) => String(path).split('/').pop();

/**
 * Erreur lisible pour une réponse GitHub en échec : ce qui était tenté, le code
 * HTTP, et le message de GitHub s'il y en a un. Le code est gardé dans
 * `err.status` pour les appelants qui doivent distinguer un cas (404).
 * @param {Response} response
 * @param {string} action  ce qui était tenté, ex. « Envoi de djerba.geojson »
 * @returns {Promise<Error>}
 */
export async function githubHttpError(response, action) {
    const status = response.status;
    let detail = '';
    try {
        const body = await response.text();
        if (body) detail = JSON.parse(body).message || '';
    } catch { /* corps vide ou pas en JSON : le code suffit */ }

    let reason;
    if (status >= 500) reason = `GitHub indisponible (HTTP ${status}) — réessayez dans quelques minutes.`;
    else if (status === 401) reason = 'jeton GitHub refusé (HTTP 401) — vérifiez-le dans le Centre de Contrôle.';
    else reason = `HTTP ${status}${detail ? ` — ${detail}` : ''}`;

    const err = new Error(`${action} : ${reason}`);
    err.status = status;
    return err;
}

/**
 * Lit un fichier comme une chaîne Base64 (nécessaire pour l'API GitHub)
 * @param {File} file
 * @returns {Promise<string>} Le contenu encodé en Base64 (sans l'en-tête data:...)
 */
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // Le résultat est sous la forme "data:application/json;base64,....."
            // On ne veut que la partie après la virgule
            const base64String = reader.result.split(',')[1];
            resolve(base64String);
        };
        // On rejette l'ERREUR (reader.error), pas l'ÉVÉNEMENT — le paramètre du
        // handler s'appelle « error » mais c'est un ProgressEvent, d'où l'ancien
        // « [object ProgressEvent] » remonté jusqu'à l'utilisateur.
        reader.onerror = () => reject(fileReadError(file, reader));
        reader.readAsDataURL(file);
    });
}

/**
 * Upload un fichier sur GitHub via l'API
 * @param {File} file Le fichier à uploader
 * @param {string} token Le Personal Access Token
 * @param {string} owner Le propriétaire du repo (ex: Stefanmartin1967)
 * @param {string} repo Le nom du repo (ex: History-Walk-V1)
 * @param {string} path Le chemin cible dans le repo (ex: public/circuits/moncircuit.json)
 * @param {string} message Le message de commit
 */
export async function uploadFileToGitHub(file, token, owner, repo, path, message) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const action = `Envoi de ${fileLabel(path)}`;

    // 1. Lire le fichier en base64
    const content = await readFileAsBase64(file);

    // 2. SHA du fichier s'il existe déjà (obligatoire pour le remplacer). 404 =
    //    fichier nouveau. Tout autre échec arrête l'envoi avec son vrai code :
    //    l'ignorer faisait partir une « création » que GitHub refusait avec un
    //    message trompeur (« sha wasn't supplied »).
    let sha = null;
    const checkResponse = await fetchWithTimeout(apiUrl, {
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    if (checkResponse.ok) {
        const data = await checkResponse.json();
        sha = data.sha;
    } else if (checkResponse.status !== 404) {
        throw await githubHttpError(checkResponse, action);
    }

    // 3. Préparer le payload
    const payload = {
        message: message || `Add/Update ${file.name} via App Admin`,
        content: content
        // branch: 'main' // On laisse par défaut pour utiliser la branche par défaut du repo
    };

    if (sha) {
        payload.sha = sha;
    }

    // 4. Envoyer la requête PUT
    const response = await fetchWithTimeout(apiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw await githubHttpError(response, action);
    }

    return await response.json();
}

/**
 * Supprime un fichier sur GitHub via l'API
 * @param {string} token Le Personal Access Token
 * @param {string} owner Le propriétaire du repo
 * @param {string} repo Le nom du repo
 * @param {string} path Le chemin du fichier à supprimer
 * @param {string} message Le message de commit
 */
export async function deleteFileFromGitHub(token, owner, repo, path, message) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const action = `Suppression de ${fileLabel(path)}`;

    // 1. Récupérer le SHA du fichier (obligatoire pour DELETE). « Introuvable »
    //    pour un vrai 404 seulement : un 500 annoncé « introuvable » passait pour
    //    « rien à supprimer » (note privée laissée sur le dépôt sans signal).
    const checkResponse = await fetchWithTimeout(apiUrl, {
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    if (checkResponse.status === 404) {
        const err = new Error(`${action} : fichier introuvable sur le serveur.`);
        err.status = 404;
        throw err;
    }
    if (!checkResponse.ok) {
        throw await githubHttpError(checkResponse, action);
    }
    const sha = (await checkResponse.json()).sha;

    // 2. Envoyer la requête DELETE
    const payload = {
        message: message || `Delete ${path} via Admin`,
        sha: sha
    };

    const response = await fetchWithTimeout(apiUrl, {
        method: 'DELETE',
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw await githubHttpError(response, action);
    }

    return await response.json();
}
