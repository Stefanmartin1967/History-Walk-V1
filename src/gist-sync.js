// gist-sync.js
// Synchronisation du userData personnel via GitHub Gist.
// Chaque utilisateur stocke son propre Gist ID dans localStorage.
// Le token PAT (scope "gist") est partagé avec github-sync.js.

import { state, setOfficialCircuitStatus, setHiddenPoiIds, setHiddenCircuitIds } from './state.js';
import { getStoredToken } from './github-sync.js';
import { getPoiId } from './utils.js';
import { showToast } from './toast.js';
import { savePoiData, batchSavePoiData, saveAppState } from './database.js';
import { eventBus } from './events.js';

const GIST_ID_KEY    = 'hw_gist_id';
const GIST_FILE_NAME = 'history_walk_userdata.json';

// Délai de debounce pour le push automatique (ms)
const PUSH_DEBOUNCE_MS = 3000;

let _pushTimer = null;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getGistId()   { return localStorage.getItem(GIST_ID_KEY) || null; }
function setGistId(id) { localStorage.setItem(GIST_ID_KEY, id); }

function getHeaders(token) {
    return {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
    };
}

// ─── SÉRIALISATION ────────────────────────────────────────────────────────────

export function buildPayload() {
    // On ne sync que les champs utiles (pas les blobs photos).
    // 'planifie' retiré 14/05/2026 (refonte Mon Espace V2) : valeur calculée à
    // la volée via computePlanifieCounter, plus stockée dans userData depuis
    // 03/05/2026 — clé legacy qui n'envoyait que des `undefined` filtrés.
    const SYNC_KEYS = ['vu', 'vuManual', 'visitedByCircuits', 'notes', 'incontournable'];
    const filtered = {};
    for (const [poiId, data] of Object.entries(state.userData || {})) {
        const slim = {};
        SYNC_KEYS.forEach(k => { if (data[k] !== undefined) slim[k] = data[k]; });
        if (Object.keys(slim).length > 0) filtered[poiId] = slim;
    }
    return {
        mapId: state.currentMapId,
        userData: filtered,
        circuitsStatus: state.officialCircuitsStatus || {},
        // testedCircuits (« vérifié ») RETIRÉ du Gist (07/06/2026) : statut
        // AUTORITAIRE publié par l'admin sur GitHub (tested_<map>.json), pas une
        // préférence par-appareil. Le Gist (par-user, à la traîne) ne doit pas en
        // être une 2ᵉ source, sinon un Gist périmé ré-écrase l'autorité serveur.
        // Ajout 03/05/2026 : sync admin des POIs masqués entre appareils.
        // Stratégie merge : UNION (cf. mergeRemoteIntoLocal).
        // Cf. mémoire project_admin_sync_history.md.
        hiddenPoiIds: state.hiddenPoiIds || [],
        // Ajout 15/05/2026 (refonte Mon Espace V2 PR4) : sync user des circuits
        // cachés via le bouton "Cacher ce circuit". Stratégie merge : UNION
        // (cohérent avec hiddenPoiIds, validé Stefan).
        hiddenCircuitIds: state.hiddenCircuitIds || [],
        lastSync: new Date().toISOString(),
        appVersion: '1.0'
    };
}

// ─── MERGE ────────────────────────────────────────────────────────────────────

export function mergeRemoteIntoLocal(remote) {
    if (!remote || !remote.userData) return { updates: [] };
    const updates = [];

    for (const [poiId, remoteData] of Object.entries(remote.userData)) {
        const local = state.userData[poiId] || {};
        let changed = false;
        const merged = { ...local };

        // vuManual : true gagne toujours (action explicite de l'utilisateur)
        if (remoteData.vuManual === true && local.vuManual !== true) {
            merged.vuManual = true;
            changed = true;
        }
        // visitedByCircuits : union (chaque appareil peut avoir coché "Fait" des circuits différents)
        if (Array.isArray(remoteData.visitedByCircuits) && remoteData.visitedByCircuits.length > 0) {
            const localList = Array.isArray(local.visitedByCircuits) ? local.visitedByCircuits : [];
            const union = Array.from(new Set([...localList, ...remoteData.visitedByCircuits]));
            if (union.length !== localList.length) {
                merged.visitedByCircuits = union;
                changed = true;
            }
        }
        // vu : rétro-compat — si le remote n'a pas encore migré, on traite son `vu=true`
        // comme un vuManual=true (meilleur fallback possible côté lecture).
        if (remoteData.vu === true && local.vu !== true && remoteData.vuManual === undefined && !Array.isArray(remoteData.visitedByCircuits)) {
            merged.vuManual = true;
            changed = true;
        }
        // Recompute vu après tout merge lié au visité
        if (changed) {
            const manual = merged.vuManual === true;
            const byCircuits = Array.isArray(merged.visitedByCircuits) && merged.visitedByCircuits.length > 0;
            merged.vu = manual || byCircuits;
        }
        // notes : le plus récent gagne (on utilise lastSync du payload)
        if (remoteData.notes && !local.notes) {
            merged.notes = remoteData.notes;
            changed = true;
        }
        // incontournable : true gagne
        if (remoteData.incontournable === true && !local.incontournable) {
            merged.incontournable = true;
            changed = true;
        }

        if (changed) {
            // Mise à jour mémoire
            state.userData[poiId] = merged;
            const feature = state.loadedFeatures?.find(f => getPoiId(f) === poiId);
            if (feature) feature.properties.userData = merged;
            updates.push({ poiId, data: merged });
        }
    }

    // circuitsStatus : true gagne
    let circuitsChanged = false;
    const remoteStatus = remote.circuitsStatus || {};
    for (const [cId, val] of Object.entries(remoteStatus)) {
        if (val === true && !state.officialCircuitsStatus[cId]) {
            setOfficialCircuitStatus(cId, true);
            circuitsChanged = true;
        }
    }

    // testedCircuits (« vérifié ») n'est PLUS synchronisé via le Gist : autorité
    // serveur (tested_<map>.json), appliquée au boot (app-startup.js). Le retirer
    // ici évite qu'un Gist périmé ré-injecte un vérifié retiré côté serveur.

    // hiddenPoiIds : UNION (admin peut masquer différents POIs sur PC vs mobile).
    // Cf. mémoire project_admin_sync_history.md — décision Stefan 03/05/2026
    // d'inclure hiddenPoiIds au Gist sync (revient sur la décision du 02/05).
    let hiddenChanged = false;
    if (Array.isArray(remote.hiddenPoiIds) && remote.hiddenPoiIds.length > 0) {
        const localList = Array.isArray(state.hiddenPoiIds) ? state.hiddenPoiIds : [];
        const union = Array.from(new Set([...localList, ...remote.hiddenPoiIds]));
        if (union.length !== localList.length) {
            setHiddenPoiIds(union);
            hiddenChanged = true;
        }
    }

    // hiddenCircuitIds : UNION (user peut cacher différents circuits sur PC
    // vs mobile). Refonte Mon Espace V2 PR4 (15/05/2026) — même stratégie que
    // hiddenPoiIds, validée par Stefan.
    if (Array.isArray(remote.hiddenCircuitIds) && remote.hiddenCircuitIds.length > 0) {
        const localList = Array.isArray(state.hiddenCircuitIds) ? state.hiddenCircuitIds : [];
        const union = Array.from(new Set([...localList, ...remote.hiddenCircuitIds]));
        if (union.length !== localList.length) {
            setHiddenCircuitIds(union);
            hiddenChanged = true;
        }
    }

    return { updates, circuitsChanged, hiddenChanged };
}

// ─── API GIST ─────────────────────────────────────────────────────────────────

async function fetchGist(token, gistId) {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: getHeaders(token)
    });
    if (!res.ok) throw new Error(`Gist fetch failed: ${res.status}`);
    const data = await res.json();
    const content = data.files?.[GIST_FILE_NAME]?.content;
    if (!content) throw new Error('Fichier introuvable dans le Gist');
    return JSON.parse(content);
}

/**
 * Découverte automatique du gistId au boot.
 * Si gistId absent en localStorage mais token présent (cas nouvel appareil),
 * parcourt les Gists du user via API GitHub pour trouver celui qui contient
 * GIST_FILE_NAME. Prend le plus récemment modifié (utile si plusieurs Gists
 * fantômes ont été créés sur différents appareils).
 *
 * @param {string} token - PAT GitHub avec scope gist
 * @returns {Promise<string|null>} - gistId trouvé, ou null si rien
 */
async function discoverGistId(token) {
    try {
        const res = await fetch('https://api.github.com/gists?per_page=100', {
            headers: getHeaders(token)
        });
        if (!res.ok) {
            console.warn('[GistSync] Discovery failed:', res.status);
            return null;
        }
        const gists = await res.json();
        const matching = gists.filter(g => g.files && g.files[GIST_FILE_NAME]);
        if (matching.length === 0) return null;
        // Plus récemment modifié en premier (utile en cas de Gists fantômes)
        matching.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        return matching[0].id;
    } catch (e) {
        console.warn('[GistSync] Discovery exception:', e.message);
        return null;
    }
}

async function createGist(token, payload) {
    const res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
            description: 'History Walk – User Data Sync',
            public: false,
            files: { [GIST_FILE_NAME]: { content: JSON.stringify(payload, null, 2) } }
        })
    });
    if (!res.ok) throw new Error(`Gist create failed: ${res.status}`);
    const data = await res.json();
    return data.id;
}

async function updateGist(token, gistId, payload) {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: getHeaders(token),
        body: JSON.stringify({
            files: { [GIST_FILE_NAME]: { content: JSON.stringify(payload, null, 2) } }
        })
    });
    if (!res.ok) throw new Error(`Gist update failed: ${res.status}`);
}

// ─── API PUBLIQUE ─────────────────────────────────────────────────────────────

/**
 * Pull depuis le Gist → merge dans le state local → sauvegarde IndexedDB.
 * Appelé au démarrage de l'app.
 */
export async function pullFromGist() {
    const token = getStoredToken();
    let gistId = getGistId();
    if (!token) return; // Pas de token → silencieux

    // Auto-discovery si gistId absent (cas typique : nouvel appareil avec
    // token configuré mais sans gistId en localStorage). Cf. mémoire
    // project_gist_for_future_users.md (anomalie #8 trou d'onboarding).
    if (!gistId) {
        gistId = await discoverGistId(token);
        if (!gistId) return; // Aucun Gist trouvé → silencieux
        setGistId(gistId);
        showToast('Gist détecté, sync activée.', 'info', 3000);
    }

    try {
        const remote = await fetchGist(token, gistId);

        // Guard : ne pas merger une carte différente
        if (remote.mapId && remote.mapId !== state.currentMapId) {
            return;
        }

        const { updates, circuitsChanged, hiddenChanged } = mergeRemoteIntoLocal(remote);

        if (updates.length > 0) {
            await batchSavePoiData(state.currentMapId, updates);
        }
        if (circuitsChanged) {
            await saveAppState(`official_circuits_status_${state.currentMapId}`, state.officialCircuitsStatus);
        }
        if (hiddenChanged) {
            // Persistance même clé que data.js et admin-control-center.js
            await saveAppState(`hiddenPois_${state.currentMapId}`, state.hiddenPoiIds);
        }
        if (updates.length > 0 || circuitsChanged || hiddenChanged) {
            // Rafraîchir l'UI : marqueurs + liste circuits
            eventBus.emit('data:apply-filters');
            eventBus.emit('circuit:list-updated');
            const parts = [];
            if (updates.length > 0) parts.push(`${updates.length} lieu(x)`);
            if (circuitsChanged) parts.push('circuits');
            if (hiddenChanged) parts.push('masquages');
            showToast(`Sync Gist : ${parts.join(' + ')} mis à jour.`, 'info', 3000);
        }

    } catch (e) {
        console.warn('[GistSync] Pull failed:', e.message);
    }
}

/**
 * Push le state courant vers le Gist.
 * Crée le Gist s'il n'existe pas encore.
 */
export async function pushToGist() {
    const token = getStoredToken();
    if (!token) return;

    try {
        const payload = buildPayload();
        let gistId = getGistId();

        if (!gistId) {
            gistId = await createGist(token, payload);
            setGistId(gistId);
            showToast('Gist créé ! Sync activée.', 'success', 4000);
        } else {
            try {
                await updateGist(token, gistId, payload);
            } catch (updateErr) {
                // Auto-recovery 404 : si le Gist stocké a été supprimé manuellement
                // sur github.com (ou n'a jamais existé proprement), on reset le local
                // et on retry en mode création. Sinon `updateGist` échoue silencieusement
                // sur chaque clic et la sync est cassée jusqu'à intervention manuelle.
                if (/\b404\b/.test(updateErr.message)) {
                    console.warn('[GistSync] Gist 404 — recreating with new ID');
                    localStorage.removeItem(GIST_ID_KEY);
                    const newId = await createGist(token, payload);
                    setGistId(newId);
                    showToast('Gist re-créé après suppression côté GitHub.', 'info', 4000);
                } else {
                    throw updateErr;
                }
            }
        }

    } catch (e) {
        console.warn('[GistSync] Push failed:', e.message);
    }
}

/**
 * Push différé (debounced) — appelé après chaque modification utilisateur.
 */
export function schedulePush() {
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
        pushToGist();
        _pushTimer = null;
    }, PUSH_DEBOUNCE_MS);
}

