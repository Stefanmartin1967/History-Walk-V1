// github-sync.js
// Publier le GeoJSON modifié sur GitHub depuis le Data Manager.

import { hwConfirm } from '../../src/modal.js';

//
// ─── Stockage du PAT ─────────────────────────────────────────────────────────
// Le token est stocké dans IndexedDB (DB 'HistoryWalkDB', store 'appState',
// clé 'github_pat'), aligné sur HW. HW supprime activement la clé localStorage
// legacy au boot (durcissement sécurité), donc le DM doit lire/écrire au même
// endroit qu'HW pour partager le token entre les deux apps.
// Migration legacy : si IDB est vide mais localStorage contient encore la clé,
// on transfère puis on supprime la clé localStorage.

const TOKEN_KEY = 'github_pat';
const LEGACY_LS_KEY = 'github_pat';
const IDB_NAME = 'HistoryWalkDB';
const IDB_STORE = 'appState';
const OWNER = 'Stefanmartin1967';
const REPO = 'History-Walk-V1';

// ─── Mini-couche IDB autonome ───────────────────────────────────────────────
// On ouvre la DB sans imposer de version : si HW l'a déjà créée, on prend la
// version courante ; sinon on la crée et on ajoute juste le store qu'on
// utilise. HW au prochain démarrage déclenchera son propre onupgradeneeded
// pour ajouter ses autres stores — sans toucher à `appState`.

function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE, { keyPath: 'key' });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function idbPut(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const req = tx.objectStore(IDB_STORE).put({ key, value });
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

// ─── API token ───────────────────────────────────────────────────────────────

/**
 * Récupère le token GitHub depuis IndexedDB.
 * Fallback : si IDB est vide mais localStorage contient encore la clé legacy,
 * on migre vers IDB et on supprime la clé localStorage.
 * @returns {Promise<string|null>}
 */
export async function getStoredToken() {
    try {
        let token = await idbGet(TOKEN_KEY);
        if (!token) {
            const legacy = localStorage.getItem(LEGACY_LS_KEY);
            if (legacy) {
                token = legacy.trim();
                await idbPut(TOKEN_KEY, token);
                localStorage.removeItem(LEGACY_LS_KEY);
            }
        }
        return token || null;
    } catch (err) {
        console.warn('[DM github-sync] getStoredToken IDB failed', err);
        return localStorage.getItem(LEGACY_LS_KEY) || null;
    }
}

/**
 * Persiste le token GitHub dans IndexedDB.
 * @param {string|null} token
 */
export async function saveToken(token) {
    const clean = token ? token.trim() : null;
    try {
        await idbPut(TOKEN_KEY, clean);
        localStorage.removeItem(LEGACY_LS_KEY);
    } catch (err) {
        console.warn('[DM github-sync] saveToken IDB failed', err);
    }
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
 * @param {string} fileName Nom du fichier dans public/ (ex: 'djerba.geojson', 'hammamet.geojson')
 * @param {function} onStatus Callback (type: 'loading'|'success'|'error', msg: string)
 */
export async function publishToGitHub(geojson, fileName, onStatus) {
    const pat = await getStoredToken();
    if (!pat) {
        onStatus('error', "Token manquant — publication annulée.");
        return;
    }
    if (!fileName) {
        onStatus('error', "Destination indéterminée — publication annulée.");
        return;
    }

    // Garde-fou cross-app (UX-4) : alerter si HW a un brouillon admin non
    // publié. Publier le DM maintenant écraserait le geojson distant et HW
    // verrait au prochain refresh une version sans ses modifs en attente.
    if (localStorage.getItem('hw_has_unpublished_changes') === '1') {
        const ok = await hwConfirm({
            title: '⚠️ Brouillon admin non publié',
            body: 'History Walk a un brouillon admin non publié.<br><br>'
                + 'Si tu publies depuis le DM maintenant, les modifs HW en attente '
                + 'pourraient être écrasées au prochain refresh côté HW.<br><br>'
                + 'Veux-tu vraiment continuer ?',
            confirmLabel: 'Publier quand même',
            danger: true,
        });
        if (!ok) {
            onStatus('error', "Publication annulée par sécurité.");
            return;
        }
    }

    const filePath = `public/${fileName}`;
    const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${filePath}`;

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
            message: `Data Manager: mise à jour ${fileName} (${now})`,
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

        // Clear le flag cross-app — le brouillon DM est maintenant publié.
        localStorage.removeItem('dm_has_unpublished_changes');

        onStatus('success', `Publié sur GitHub (${geojson.features.length} lieux).`);

    } catch (e) {
        onStatus('error', `Erreur GitHub : ${e.message}`);
    }
}
