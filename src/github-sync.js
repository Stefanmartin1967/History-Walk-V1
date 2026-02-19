// src/github-sync.js

// Clé de stockage local pour le token
const STORAGE_KEY_TOKEN = 'github_pat';

/**
 * Récupère le token stocké
 * @returns {string|null} Le token ou null s'il n'existe pas
 */
export function getStoredToken() {
    return localStorage.getItem(STORAGE_KEY_TOKEN);
}

/**
 * Sauvegarde le token
 * @param {string} token
 */
export function saveToken(token) {
    if (token) {
        localStorage.setItem(STORAGE_KEY_TOKEN, token.trim());
    } else {
        localStorage.removeItem(STORAGE_KEY_TOKEN);
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
