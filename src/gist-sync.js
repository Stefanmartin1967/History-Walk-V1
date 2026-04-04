// gist-sync.js
// Synchronisation du userData personnel via GitHub Gist.
// Chaque utilisateur stocke son propre Gist ID dans localStorage.
// Le token PAT (scope "gist") est partagé avec github-sync.js.

import { state } from './state.js';
import { getStoredToken } from './github-sync.js';
import { getPoiId, applyFilters } from './data.js';
import { showToast } from './toast.js';
import { savePoiData, batchSavePoiData, saveAppState } from './database.js';
import { eventBus } from './events.js';

const GIST_ID_KEY    = 'hw_gist_id';
const GIST_FILE_NAME = 'history_walk_userdata.json';

// Délai de debounce pour le push automatique (ms)
const PUSH_DEBOUNCE_MS = 3000;

let _pushTimer = null;
let _syncStatus = 'idle'; // 'idle' | 'pushing' | 'pulling' | 'error'

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

function setStatus(status) {
    _syncStatus = status;
    const el = document.getElementById('gist-sync-indicator');
    if (!el) return;
    const icons = { idle: '☁', pushing: '↑', pulling: '↓', error: '⚠' };
    const titles = { idle: 'Sync Gist OK', pushing: 'Envoi...', pulling: 'Réception...', error: 'Erreur sync Gist' };
    el.textContent = icons[status] || '☁';
    el.title = titles[status] || '';
    el.className = `gist-sync-indicator gist-sync-${status}`;
}

// ─── SÉRIALISATION ────────────────────────────────────────────────────────────

function buildPayload() {
    // On ne sync que les champs utiles (pas les blobs photos)
    const SYNC_KEYS = ['vu', 'notes', 'incontournable', 'planifie'];
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
        lastSync: new Date().toISOString(),
        appVersion: '1.0'
    };
}

// ─── MERGE ────────────────────────────────────────────────────────────────────

function mergeRemoteIntoLocal(remote) {
    if (!remote || !remote.userData) return { updates: [] };
    const updates = [];

    for (const [poiId, remoteData] of Object.entries(remote.userData)) {
        const local = state.userData[poiId] || {};
        let changed = false;
        const merged = { ...local };

        // vu : true gagne toujours
        if (remoteData.vu === true && !local.vu) {
            merged.vu = true;
            changed = true;
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
            state.officialCircuitsStatus[cId] = true;
            circuitsChanged = true;
        }
    }

    return { updates, circuitsChanged };
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
    const gistId = getGistId();
    if (!token || !gistId) return; // Pas configuré → silencieux

    try {
        setStatus('pulling');
        const remote = await fetchGist(token, gistId);

        // Guard : ne pas merger une carte différente
        if (remote.mapId && remote.mapId !== state.currentMapId) {
            setStatus('idle');
            return;
        }

        const { updates, circuitsChanged } = mergeRemoteIntoLocal(remote);

        if (updates.length > 0) {
            await batchSavePoiData(state.currentMapId, updates);
        }
        if (circuitsChanged) {
            await saveAppState(`official_circuits_status_${state.currentMapId}`, state.officialCircuitsStatus);
        }
        if (updates.length > 0 || circuitsChanged) {
            // Rafraîchir l'UI : marqueurs + liste circuits
            applyFilters();
            eventBus.emit('circuit:list-updated');
            showToast(`Sync Gist : ${updates.length} lieu(x)${circuitsChanged ? ' + circuits' : ''} mis à jour.`, 'info', 3000);
        }

        setStatus('idle');
    } catch (e) {
        console.warn('[GistSync] Pull failed:', e.message);
        setStatus('error');
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
        setStatus('pushing');
        const payload = buildPayload();
        let gistId = getGistId();

        if (!gistId) {
            gistId = await createGist(token, payload);
            setGistId(gistId);
            showToast('Gist créé ! Sync activée.', 'success', 4000);
        } else {
            await updateGist(token, gistId, payload);
        }

        setStatus('idle');
    } catch (e) {
        console.warn('[GistSync] Push failed:', e.message);
        setStatus('error');
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

/**
 * Injecte l'indicateur de sync dans l'UI (à appeler une seule fois au démarrage).
 * L'indicateur se place dans la barre admin existante.
 */
export function injectSyncIndicator() {
    if (document.getElementById('gist-sync-indicator')) return;
    const el = document.createElement('span');
    el.id = 'gist-sync-indicator';
    el.className = 'gist-sync-indicator gist-sync-idle';
    el.textContent = '☁';
    el.title = 'Sync Gist';
    el.style.cursor = 'pointer';
    el.addEventListener('click', async () => {
        const token = getStoredToken();
        if (!token) {
            showToast('Configurez votre token GitHub dans les paramètres.', 'warning');
            return;
        }
        await pushToGist();
        showToast('Sync manuelle envoyée.', 'info', 2000);
    });

    // Insérer dans la barre admin si elle existe, sinon dans le header
    const adminBar = document.querySelector('.admin-topbar, .app-header .actions, header');
    if (adminBar) adminBar.appendChild(el);
}
