
import { state } from './state.js';
import { getPoiId, getPoiName } from './data.js';
import { showAlert, showConfirm } from './modal.js';
import { createIcons, icons } from 'lucide';
import { generateMasterGeoJSONData } from './admin.js';
import { uploadFileToGitHub, getStoredToken, saveToken } from './github-sync.js';
import { showToast } from './toast.js';
import { saveAppState, getAppState } from './database.js';

// --- STATE MANAGEMENT ---

const DRAFT_KEY = 'admin_draft_v1';
let adminDraft = {
    pendingPois: {}, // Map<poiId, { timestamp, changes: Set<key> }>
    pendingCircuits: {} // Map<circuitId, { type, timestamp }>
};

// Charge le brouillon au démarrage
export async function initAdminControlCenter() {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // Convert arrays back to Sets if needed, or just use arrays
            adminDraft = parsed;
            updateButtonBadge(); // Initialize badge on load
        } catch (e) {
            console.error("Erreur lecture brouillon admin", e);
        }
    }

    // Inject styles
    const style = document.createElement('style');
    style.textContent = `
        /* Layout & Typography */
        .admin-cc-container { font-family: 'Inter', sans-serif; color: var(--ink); }

        /* Tabs */
        .admin-cc-tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 25px;
            background: var(--surface-muted);
            padding: 5px;
            border-radius: 12px;
        }
        .admin-cc-tab {
            flex: 1;
            padding: 10px 15px;
            cursor: pointer;
            text-align: center;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.9em;
            color: var(--ink-soft);
            transition: all 0.2s ease;
        }
        .admin-cc-tab:hover { background: rgba(0,0,0,0.05); color: var(--ink); }
        .admin-cc-tab.active {
            background: var(--surface);
            color: var(--brand);
            box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }

        /* Content Area */
        .admin-cc-content {
            min-height: 350px;
            max-height: 65vh;
            overflow-y: auto;
            padding-right: 5px; /* Space for scrollbar */
        }

        /* Dashboard Grid */
        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            margin-bottom: 25px;
        }
        .stat-card {
            background: var(--surface);
            border: 1px solid var(--line);
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.02);
            transition: transform 0.2s;
        }
        .stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .stat-icon { color: var(--brand); margin-bottom: 10px; }
        .stat-value { font-size: 2.5em; font-weight: 800; color: var(--ink); line-height: 1; margin-bottom: 5px; }
        .stat-label { color: var(--ink-soft); font-size: 0.8em; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
        .stat-subtext { font-size: 0.75em; color: var(--ink-light); margin-top: 5px; }

        /* Changes List */
        .diff-item {
            background: var(--surface);
            border: 1px solid var(--line);
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.02);
        }
        .diff-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            border-bottom: 1px solid var(--line-light);
            padding-bottom: 8px;
        }
        .diff-title { font-weight: 700; font-size: 1.05em; color: var(--ink); display: flex; align-items: center; gap: 8px; }
        .diff-id { font-family: monospace; font-size: 0.75em; color: var(--ink-light); background: var(--surface-muted); padding: 2px 6px; border-radius: 4px; }

        .diff-row {
            display: grid;
            grid-template-columns: 100px 1fr 24px 1fr;
            gap: 12px;
            font-size: 0.9em;
            align-items: center;
            padding: 6px 0;
            border-bottom: 1px dashed var(--line-light);
        }
        .diff-row:last-child { border-bottom: none; }
        .diff-label { color: var(--ink-soft); font-weight: 600; font-size: 0.85em; text-transform: uppercase; }
        .diff-old { color: var(--danger); text-decoration: line-through; opacity: 0.6; word-break: break-all; font-size: 0.9em; }
        .diff-arrow { color: var(--ink-light); text-align: center; font-size: 0.8em; }
        .diff-new { color: var(--ok); font-weight: 600; word-break: break-all; font-size: 0.95em; }

        /* Settings */
        .settings-panel { padding: 10px; }
        .settings-input {
            width: 100%;
            padding: 12px;
            border: 1px solid var(--line);
            border-radius: 8px;
            margin-bottom: 15px;
            font-family: monospace;
            background: var(--surface-muted);
            color: var(--ink);
        }
        .settings-input:focus { border-color: var(--brand); outline: none; background: var(--surface); }

        /* Scrollbar */
        .admin-cc-content::-webkit-scrollbar { width: 6px; }
        .admin-cc-content::-webkit-scrollbar-track { background: transparent; }
        .admin-cc-content::-webkit-scrollbar-thumb { background-color: var(--line); border-radius: 3px; }
        .admin-cc-content::-webkit-scrollbar-thumb:hover { background-color: var(--ink-light); }
    `;
    document.head.appendChild(style);
}

function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(adminDraft));
    updateButtonBadge();
}

function updateButtonBadge() {
    const btn = document.getElementById('btn-admin-control-center');
    if (!btn) return;

    const poiCount = Object.keys(adminDraft.pendingPois).length;
    const circuitCount = Object.keys(adminDraft.pendingCircuits).length;
    const total = poiCount + circuitCount;

    if (total > 0) {
        btn.innerHTML = `<i data-lucide="layout-dashboard"></i> Centre de Contrôle <span class="badge" style="background:var(--brand); color:white; padding:2px 6px; border-radius:10px; font-size:0.8em; margin-left:5px;">${total}</span>`;
    } else {
        btn.innerHTML = `<i data-lucide="layout-dashboard"></i> Centre de Contrôle`;
    }
    createIcons({ icons, root: btn });
}

// --- API ---

export function addToDraft(type, id, details) {
    if (!state.isAdmin) return;

    const timestamp = Date.now();

    if (type === 'poi') {
        if (!adminDraft.pendingPois[id]) {
            adminDraft.pendingPois[id] = { changes: [], timestamp };
        }
        // details = { key: 'price', value: 10 } or { type: 'coords' }
        if (details.key && !adminDraft.pendingPois[id].changes.includes(details.key)) {
            adminDraft.pendingPois[id].changes.push(details.key);
        } else if (details.type === 'coords' && !adminDraft.pendingPois[id].changes.includes('geometry')) {
            adminDraft.pendingPois[id].changes.push('geometry');
        }
    } else if (type === 'circuit') {
        // id is typically the filename or circuit name
        adminDraft.pendingCircuits[id] = {
            type: details.type || 'update',
            timestamp
        };
    }

    saveDraft();
}

// --- UI ---

export async function openControlCenter() {
    // 1. Structure de la modale
    const html = `
        <div class="admin-cc-container">
            <div class="admin-cc-tabs">
                <div class="admin-cc-tab active" data-tab="dashboard">
                    <i data-lucide="layout-dashboard" style="width:16px; vertical-align:middle; margin-right:5px;"></i> Tableau de Bord
                </div>
                <div class="admin-cc-tab" data-tab="changes">
                    <i data-lucide="list-checks" style="width:16px; vertical-align:middle; margin-right:5px;"></i> Détail
                </div>
                <div class="admin-cc-tab" data-tab="settings">
                    <i data-lucide="settings" style="width:16px; vertical-align:middle; margin-right:5px;"></i> Config
                </div>
            </div>
            <div id="admin-cc-content" class="admin-cc-content">
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:300px; color:var(--ink-soft);">
                    <i data-lucide="loader-2" class="spin" style="width:48px; height:48px; margin-bottom:15px; color:var(--brand);"></i>
                    <div style="font-weight:500;">Analyse des modifications en cours...</div>
                </div>
            </div>
        </div>
    `;

    // 2. Ouverture Modale
    // On n'attend PAS la fermeture (await), sinon le code suivant ne s'exécuterait qu'à la fermeture !
    showAlert("Centre de Contrôle Admin", html, null);

    // Refresh icons immediately for the initial loader
    const content = document.getElementById('admin-cc-content');
    if (content) createIcons({ icons, root: content.parentElement });

    // 3. Setup Tabs
    const tabs = document.querySelectorAll('.admin-cc-tab');
    tabs.forEach(t => {
        t.onclick = () => {
            tabs.forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            renderTab(t.dataset.tab);
        };
    });

    // 4. Custom Footer Actions
    const actions = document.getElementById('custom-modal-actions');
    if (actions) {
        actions.innerHTML = `
            <button class="custom-modal-btn secondary" onclick="document.getElementById('custom-modal-overlay').classList.remove('active')">Fermer</button>
            <button class="custom-modal-btn primary" id="btn-cc-publish">
                <i data-lucide="upload-cloud"></i> Tout Publier
            </button>
        `;
        createIcons({ icons, root: actions });

        document.getElementById('btn-cc-publish').onclick = publishChanges;
    }

    // 5. Load Data & Render Default Tab
    await prepareDiffData();
    renderTab('dashboard');
}

let diffData = {
    pois: [],
    stats: {
        poisModified: 0,
        photosAdded: 0,
        circuitsModified: 0
    }
};

async function prepareDiffData() {
    // A. Fetch Original from GitHub (Cache Busting)
    let originalFeatures = [];
    try {
        const timestamp = Date.now();
        const mapId = state.currentMapId || 'djerba';
        const url = `https://raw.githubusercontent.com/Stefanmartin1967/History-Walk-V1/main/public/${mapId}.geojson?t=${timestamp}`;
        const response = await fetch(url);
        if (response.ok) {
            const json = await response.json();
            originalFeatures = json.features;
        } else {
            console.warn("Impossible de charger l'original GitHub. Comparaison locale uniquement.");
        }
    } catch (e) {
        console.error("Erreur fetch original", e);
    }

    // B. Reset Data
    diffData.pois = [];
    diffData.stats = { poisModified: 0, photosAdded: 0, circuitsModified: 0 };

    // C. Process POIs
    const pendingIds = Object.keys(adminDraft.pendingPois);

    pendingIds.forEach(id => {
        const current = state.loadedFeatures.find(f => getPoiId(f) === id);
        const original = originalFeatures.find(f => getPoiId(f) === id);

        if (!current) return; // Should not happen unless deleted

        const changes = [];
        let hasPhotoChange = false;

        // 1. Geometry
        if (original) {
            const [oLng, oLat] = original.geometry.coordinates;
            const [cLng, cLat] = current.geometry.coordinates;
            // Round to 5 decimals to avoid float noise
            if (oLng.toFixed(5) !== cLng.toFixed(5) || oLat.toFixed(5) !== cLat.toFixed(5)) {
                changes.push({
                    key: 'Position',
                    old: `${oLat.toFixed(5)}, ${oLng.toFixed(5)}`,
                    new: `${cLat.toFixed(5)}, ${cLng.toFixed(5)}`
                });
            }
        }

        // 2. Properties (userData merged)
        const trackedKeys = adminDraft.pendingPois[id].changes;
        // On check aussi toutes les clés userData présentes
        const userData = current.properties.userData || {};

        // Merge tracked keys and actual userData keys
        const allKeysToCheck = new Set([...trackedKeys, ...Object.keys(userData)]);

        allKeysToCheck.forEach(key => {
            if (key === 'lat' || key === 'lng') return; // Handled by geometry

            let oldVal = original ? original.properties[key] : undefined;
            let newVal = userData[key] !== undefined ? userData[key] : current.properties[key];

            // Special handling for Photos (Array)
            if (key === 'photos') {
                const oldLen = (oldVal || []).length;
                const newLen = (newVal || []).length;
                if (oldLen !== newLen) {
                    changes.push({
                        key: 'Photos',
                        old: `${oldLen} photo(s)`,
                        new: `${newLen} photo(s)`,
                        isPhoto: true
                    });
                    hasPhotoChange = true;
                    // Approximate new photos count (simple diff)
                    if (newLen > oldLen) {
                        diffData.stats.photosAdded += (newLen - oldLen);
                    }
                }
                return;
            }

            // Standard comparison
            if (String(oldVal) !== String(newVal)) {
                changes.push({
                    key: key,
                    old: oldVal !== undefined ? oldVal : '(vide)',
                    new: newVal
                });
            }
        });

        if (changes.length > 0) {
            diffData.pois.push({
                id: id,
                name: getPoiName(current),
                changes: changes
            });
            diffData.stats.poisModified++;
        }
    });

    // D. Process Circuits
    diffData.stats.circuitsModified = Object.keys(adminDraft.pendingCircuits).length;
}

function renderTab(tabName) {
    const container = document.getElementById('admin-cc-content');
    if (!container) return;
    container.innerHTML = '';

    if (tabName === 'dashboard') {
        renderDashboard(container);
    } else if (tabName === 'changes') {
        renderChanges(container);
    } else if (tabName === 'settings') {
        renderSettings(container);
    }

    // Re-run icons for new content
    createIcons({ icons, root: container });
}

function renderDashboard(container) {
    const { poisModified, photosAdded, circuitsModified } = diffData.stats;

    container.innerHTML = `
        <div class="dashboard-grid">
            <div class="stat-card">
                <div class="stat-icon"><i data-lucide="map-pin" width="32" height="32"></i></div>
                <div class="stat-value">${poisModified}</div>
                <div class="stat-label">Lieux</div>
                <div class="stat-subtext">Modifiés ou Créés</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i data-lucide="camera" width="32" height="32"></i></div>
                <div class="stat-value">${photosAdded}</div>
                <div class="stat-label">Photos</div>
                <div class="stat-subtext">Ajoutées au total</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon"><i data-lucide="route" width="32" height="32"></i></div>
                <div class="stat-value">${circuitsModified}</div>
                <div class="stat-label">Circuits</div>
                <div class="stat-subtext">Mis à jour</div>
            </div>
        </div>

        <div style="background:var(--surface-muted); padding:20px; border-radius:12px; border:1px solid var(--line);">
            <h3 style="margin-top:0; display:flex; align-items:center; gap:10px;">
                <i data-lucide="info" style="color:var(--brand);"></i> État de la Synchronisation
            </h3>
            <p style="line-height:1.6;">
                Vous avez <strong>${poisModified + circuitsModified} éléments modifiés</strong> en attente de publication.
                Ces changements sont actuellement sauvegardés <em>localement</em> dans votre navigateur.
            </p>
            <p style="font-size:0.9em; color:var(--ink-soft); margin-top:10px;">
                Cliquez sur le bouton <strong>"Tout Publier"</strong> ci-dessous pour envoyer ces modifications sur GitHub
                et mettre à jour la carte officielle pour tous les utilisateurs.
            </p>
        </div>
    `;
}

function renderChanges(container) {
    if (diffData.pois.length === 0 && diffData.stats.circuitsModified === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:60px 20px; color:var(--ink-soft);">
                <i data-lucide="check-circle-2" style="width:48px; height:48px; opacity:0.5; margin-bottom:15px;"></i>
                <div style="font-size:1.1em; font-weight:500;">Tout est à jour !</div>
                <div style="font-size:0.9em; opacity:0.7; margin-top:5px;">Aucune modification en attente.</div>
            </div>
        `;
        return;
    }

    let html = '';

    // POIs Section
    if (diffData.pois.length > 0) {
        html += `<h4 style="margin:10px 0 15px 0; color:var(--ink-soft); text-transform:uppercase; font-size:0.85em; letter-spacing:1px;">Lieux (${diffData.pois.length})</h4>`;
        html += diffData.pois.map(item => `
            <div class="diff-item">
                <div class="diff-header">
                    <div class="diff-title">
                        <i data-lucide="map-pin" width="16" style="color:var(--brand);"></i> ${item.name}
                    </div>
                    <div class="diff-id">${item.id}</div>
                </div>
                ${item.changes.map(c => `
                    <div class="diff-row">
                        <div class="diff-label">${c.key}</div>
                        <div class="diff-old">${c.old}</div>
                        <div class="diff-arrow">➜</div>
                        <div class="diff-new">${c.new}</div>
                    </div>
                `).join('')}
            </div>
        `).join('');
    }

    // Circuits Section
    const circuitIds = Object.keys(adminDraft.pendingCircuits);
    if (circuitIds.length > 0) {
        html += `<h4 style="margin:25px 0 15px 0; color:var(--ink-soft); text-transform:uppercase; font-size:0.85em; letter-spacing:1px;">Circuits (${circuitIds.length})</h4>`;
        html += circuitIds.map(cid => {
            const c = adminDraft.pendingCircuits[cid];
            return `
            <div class="diff-item">
                <div class="diff-header">
                    <div class="diff-title">
                        <i data-lucide="route" width="16" style="color:var(--brand);"></i> ${cid}
                    </div>
                    <div class="diff-id">${c.type.toUpperCase()}</div>
                </div>
                <div style="font-size:0.9em; color:var(--ink-soft);">
                    Modifié le ${new Date(c.timestamp).toLocaleString()}
                </div>
            </div>
        `}).join('');
    }

    container.innerHTML = html;
}

function renderSettings(container) {
    const token = getStoredToken() || '';
    container.innerHTML = `
        <div class="settings-panel">
            <label style="display:block; margin-bottom: 8px; font-weight: 600;">GitHub Personal Access Token (PAT)</label>
            <input type="password" id="cc-token-input" value="${token}" class="settings-input" placeholder="ghp_...">

            <div style="background:var(--surface-muted); padding:15px; border-radius:8px; margin-bottom:20px; font-size:0.85em; color:var(--ink-soft);">
                <i data-lucide="lock" width="14" style="vertical-align:middle; margin-right:5px;"></i>
                Ce token est stocké de manière sécurisée dans le stockage local de votre navigateur.
                Il est nécessaire pour publier les mises à jour sur le dépôt GitHub.
            </div>

            <button class="custom-modal-btn primary" id="btn-save-token" style="width:100%;">
                <i data-lucide="save"></i> Sauvegarder Token
            </button>
        </div>
    `;

    // Wait for DOM
    setTimeout(() => {
        const btn = document.getElementById('btn-save-token');
        if (btn) {
            btn.onclick = () => {
                const val = document.getElementById('cc-token-input').value.trim();
                saveToken(val);
                showToast("Token sauvegardé !", "success");
            };
        }
    }, 0);
}

// --- ACTION : PUBLISH ---

async function publishChanges() {
    const token = getStoredToken();
    if (!token) {
        showToast("Token manquant. Allez dans l'onglet Configuration.", "error");
        renderTab('settings');
        // Activate settings tab UI
        document.querySelectorAll('.admin-cc-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === 'settings');
        });
        return;
    }

    if (!confirm("Êtes-vous sûr de vouloir publier ces changements sur GitHub ?\nCette action est définitive.")) {
        return;
    }

    const btn = document.getElementById('btn-cc-publish');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Publication...`;
        createIcons({ icons, root: btn });
    }

    try {
        // 1. Generate Master GeoJSON
        const geojson = generateMasterGeoJSONData();
        if (!geojson) throw new Error("Erreur génération GeoJSON");

        const mapId = state.currentMapId || 'djerba';
        const filename = `${mapId}.geojson`;
        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
        const file = new File([blob], filename, { type: 'application/geo+json' });

        // 2. Upload
        const repoOwner = 'Stefanmartin1967'; // Should come from config/state really
        const repoName = 'History-Walk-V1';
        const path = `public/${filename}`;

        await uploadFileToGitHub(file, token, repoOwner, repoName, path, `Admin Update via Control Center (${diffData.pois.length} POIs)`);

        // 3. Success & Cleanup
        showToast("Publication réussie !", "success");

        // Reset Draft
        adminDraft = { pendingPois: {}, pendingCircuits: {} };
        saveDraft();
        updateButtonBadge();

        // Optional: Clear merged userData from local storage to keep it clean?
        // Let's clear the tracked IDs from userData to be clean.
        diffData.pois.forEach(p => {
             if (state.userData[p.id]) {
                 delete state.userData[p.id];
             }
        });
        // Save the cleaned userData once
        await saveAppState('userData', state.userData);


        alert("La carte a été mise à jour avec succès !\nLes changements seront visibles dans quelques minutes.");
        document.getElementById('custom-modal-overlay').classList.remove('active');

    } catch (e) {
        console.error(e);
        showToast("Erreur publication: " + e.message, "error");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="upload-cloud"></i> Réessayer`;
            createIcons({ icons, root: btn });
        }
    }
}
