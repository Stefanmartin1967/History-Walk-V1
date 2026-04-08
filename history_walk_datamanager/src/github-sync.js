// github-sync.js
// Publier le GeoJSON modifié sur GitHub depuis le Data Manager.
// Lit le token depuis localStorage (même clé que l'app HW principale).

const TOKEN_KEY = 'github_pat';
const OWNER = 'Stefanmartin1967';
const REPO = 'History-Walk-V1';
const FILE_PATH = 'public/djerba.geojson';

function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || null;
}

/**
 * Encode une chaîne UTF-8 en Base64 (compatible avec l'API GitHub).
 */
function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
}

/**
 * Publie le GeoJSON sur GitHub.
 * @param {object} geojson L'objet GeoJSON à publier.
 * @param {function} onStatus Callback (type: 'loading'|'success'|'error', msg: string)
 */
export async function publishToGitHub(geojson, onStatus) {
    const token = getToken();
    if (!token) {
        const entered = prompt("Token GitHub (PAT) :");
        if (!entered) { onStatus('error', "Publication annulée : pas de token."); return; }
        sessionStorage.setItem(TOKEN_KEY, entered.trim());
    }

    const pat = getToken();
    const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;

    onStatus('loading', "Publication en cours...");

    try {
        // 1. Récupérer le SHA actuel (requis pour la mise à jour)
        let sha = null;
        const checkRes = await fetch(apiUrl, {
            headers: { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (checkRes.ok) {
            const data = await checkRes.json();
            sha = data.sha;
        }

        // 2. Encoder le contenu
        const content = toBase64(JSON.stringify(geojson, null, 2));

        // 3. Construire le payload
        const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const payload = {
            message: `Data Manager: mise à jour djerba.geojson (${now})`,
            content,
            ...(sha ? { sha } : {})
        };

        // 4. PUT
        const putRes = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${pat}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!putRes.ok) {
            const err = await putRes.json();
            throw new Error(err.message || `HTTP ${putRes.status}`);
        }

        onStatus('success', `Publié sur GitHub (${geojson.features.length} lieux).`);

    } catch (e) {
        onStatus('error', `Erreur GitHub : ${e.message}`);
    }
}
