// src/github-sync.js

// Clé de stockage en session pour le token
const STORAGE_KEY_TOKEN = 'github_pat';

// Nettoyage de sécurité: on supprime activement l'ancien token stocké en clair dans le localStorage
if (localStorage.getItem(STORAGE_KEY_TOKEN)) {
    console.warn("[Sécurité] Ancien token GitHub trouvé dans localStorage. Suppression immédiate.");
    localStorage.removeItem(STORAGE_KEY_TOKEN);
}

/**
 * Récupère le token stocké en session
 * @returns {string|null} Le token ou null s'il n'existe pas
 */
export function getStoredToken() {
    return sessionStorage.getItem(STORAGE_KEY_TOKEN);
}

/**
 * Sauvegarde le token en session
 * @param {string} token
 */
export function saveToken(token) {
    if (token) {
        sessionStorage.setItem(STORAGE_KEY_TOKEN, token.trim());
    } else {
        sessionStorage.removeItem(STORAGE_KEY_TOKEN);
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
            console.log("[GitHub] Fichier existant trouvé, SHA:", sha);
        }
    } catch (e) {
        // Ignorer si le fichier n'existe pas, c'est une création
        console.log("[GitHub] Fichier nouveau ou erreur de vérification (normal si nouveau).");
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
            console.log("[GitHub Delete] Fichier trouvé, SHA:", sha);
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
