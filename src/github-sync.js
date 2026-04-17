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

const STORAGE_KEY_TOKEN = 'github_pat';
const LEGACY_LS_KEY = 'github_pat';

let _tokenCache = null;
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

        _tokenCache = token || null;
    } catch (err) {
        console.warn('[github-sync] initTokenCache failed, PAT indisponible', err);
        _tokenCache = null;
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
 * Sauvegarde ou supprime le token. Le cache est mis à jour immédiatement
 * (lecture sync cohérente dès le retour), la persistance IDB est asynchrone
 * en arrière-plan.
 * @param {string} token
 */
export function saveToken(token) {
    const clean = token ? token.trim() : null;
    _tokenCache = clean || null;
    _cacheReady = true;

    // Persiste en arrière-plan (fire-and-forget avec log en cas d'erreur)
    if (clean) {
        saveAppState(STORAGE_KEY_TOKEN, clean).catch(err => {
            console.warn('[github-sync] saveToken: IDB persist failed', err);
        });
    } else {
        saveAppState(STORAGE_KEY_TOKEN, null).catch(err => {
            console.warn('[github-sync] saveToken clear: IDB persist failed', err);
        });
    }
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
        reader.onerror = error => reject(error);
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

    // 1. Lire le fichier en base64
    const content = await readFileAsBase64(file);

    // 2. Vérifier si le fichier existe déjà pour récupérer son SHA (nécessaire pour update)
    let sha = null;
    try {
        const checkResponse = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        if (checkResponse.ok) {
            const data = await checkResponse.json();
            sha = data.sha;
        }
    } catch (e) {
        // Ignorer si le fichier n'existe pas, c'est une création
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
    const response = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Erreur lors de l'upload GitHub");
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

    // 1. Récupérer le SHA du fichier (obligatoire pour DELETE)
    let sha = null;
    try {
        const checkResponse = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        if (checkResponse.ok) {
            const data = await checkResponse.json();
            sha = data.sha;
        } else {
            throw new Error(`Fichier introuvable sur le serveur: ${path}`);
        }
    } catch (e) {
        throw new Error(`Erreur lors de la récupération du fichier à supprimer: ${e.message}`);
    }

    // 2. Envoyer la requête DELETE
    const payload = {
        message: message || `Delete ${path} via Admin`,
        sha: sha
    };

    const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Erreur lors de la suppression GitHub");
    }

    return await response.json();
}
