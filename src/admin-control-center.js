
import { state } from './state.js';
import { getPoiId, getPoiName } from './data.js';
import { showAlert } from './modal.js';
import { createIcons, icons } from 'lucide';
import { generateMasterGeoJSONData } from './admin.js';
import { uploadFileToGitHub, getStoredToken, saveToken } from './github-sync.js';
import { showToast } from './toast.js';
import { saveAppState } from './database.js';

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
            adminDraft = parsed;
            updateButtonBadge(); // Initialize badge on load
        } catch (e) {
            console.error("Erreur lecture brouillon admin", e);
        }
    }

    // Inject styles (PC FIRST REDESIGN)
    const style = document.createElement('style');
    style.textContent = `
        /* --- GLOBAL & LAYOUT (Ultra-Wide Optimization) --- */
        :root {
            --line-light: rgba(0,0,0,0.05); /* Defined locally as requested */
        }

        .admin-cc-container {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: var(--ink);
            display: flex;
            flex-direction: column;
            height: 85vh; /* Hauteur fixe pour éviter l'étirement */
            background: var(--surface);
        }

        /* Override du container de la modale pour forcer la largeur */
        .custom-modal-content.admin-cc-mode {
            max-width: 950px !important;
            width: 90vw !important;
            height: 85vh !important;
            padding: 0 !important;
            border-radius: 20px;
            overflow: hidden;
            border: 1px solid rgba(0,0,0,0.1);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            display: flex;
            flex-direction: column;
        }

        /* --- HEADER & TABS (Segmented Control Style) --- */
        .admin-cc-header {
            padding: 25px 30px 15px 30px;
            background: var(--surface);
            border-bottom: 1px solid var(--line-light);
            z-index: 10;
            flex-shrink: 0;
        }

        .admin-cc-title {
            font-size: 1.4rem;
            font-weight: 800;
            margin-bottom: 20px;
            color: var(--ink);
            letter-spacing: -0.5px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .admin-cc-tabs {
            display: inline-flex;
            gap: 4px;
            background: var(--surface-muted);
            padding: 5px;
            border-radius: 12px;
            border: 1px solid var(--line-light);
        }

        .admin-cc-tab {
            padding: 8px 20px;
            cursor: pointer;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.85rem;
            color: var(--ink-soft);
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .admin-cc-tab:hover {
            color: var(--ink);
            background: rgba(0,0,0,0.03);
        }

        .admin-cc-tab.active {
            background: white;
            color: var(--brand);
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
        }

        /* --- CONTENT AREA (Scrollable) --- */
        .admin-cc-scroll-area {
            flex: 1;
            overflow-y: auto;
            padding: 30px;
            background: #f8fafc; /* Fond très léger pour faire ressortir les cartes */
        }

        /* --- DASHBOARD (3-Column Grid) --- */
        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr); /* Force l'alignement horizontal */
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: white;
            border: 1px solid var(--line-light);
            border-radius: 16px;
            padding: 25px;
            display: flex;
            flex-direction: column;
            align-items: center;
            transition: transform 0.2s ease;
            position: relative;
            overflow: hidden;
        }

        .stat-card:hover { transform: translateY(-3px); border-color: var(--brand); }

        /* Background Icon Effect */
        .stat-card::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(2.5);
            width: 40px;
            height: 40px;
            background: var(--brand);
            mask-size: contain;
            mask-repeat: no-repeat;
            opacity: 0.03;
            pointer-events: none;
            z-index: 0;
        }

        /* Specific icon masks would be complex, simpler approach: just large absolute icon */
        .stat-bg-icon {
            position: absolute;
            right: -10px;
            bottom: -10px;
            width: 80px;
            height: 80px;
            color: var(--brand);
            opacity: 0.05;
            transform: rotate(-15deg);
            pointer-events: none;
        }

        .stat-value {
            font-size: 3.5rem;
            font-weight: 800;
            color: var(--brand);
            margin: 10px 0;
            line-height: 1;
            position: relative;
            z-index: 2;
        }

        .stat-label {
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-weight: 700;
            color: var(--ink-soft);
            position: relative;
            z-index: 2;
        }

        /* --- SYNC BANNER --- */
        .sync-banner {
            background: linear-gradient(to right, #e3f2fd, #bbdefb);
            border-left: 5px solid #2196f3;
            color: #0d47a1;
            padding: 20px;
            border-radius: 8px;
            display: flex;
            align-items: flex-start;
            gap: 15px;
            box-shadow: 0 2px 10px rgba(33, 150, 243, 0.1);
            margin-top: 20px;
        }
        .sync-banner i { flex-shrink: 0; margin-top: 3px; }

        /* --- DIFF TABLE (Side-by-Side) --- */
        .diff-container {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .diff-card {
            background: white;
            border: 1px solid var(--line-light);
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 5px rgba(0,0,0,0.02);
        }

        .diff-card-header {
            background: var(--surface-muted);
            padding: 12px 20px;
            border-bottom: 1px solid var(--line-light);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .diff-title { font-weight: 700; color: var(--ink); display: flex; align-items: center; gap: 10px; }
        .diff-id {
            font-family: 'SF Mono', 'Fira Code', Consolas, monospace; /* Monospace ID */
            font-size: 0.8em;
            color: var(--ink-light);
            background: rgba(0,0,0,0.05);
            padding: 4px 8px;
            border-radius: 4px;
        }

        .diff-table {
            width: 100%;
            border-spacing: 0;
            border-collapse: collapse;
            table-layout: fixed; /* Force le respect des largeurs */
        }

        .diff-table th {
            text-align: left;
            padding: 10px 15px;
            background: rgba(0,0,0,0.02);
            color: var(--ink-soft);
            font-weight: 600;
            font-size: 0.75em;
            text-transform: uppercase;
        }

        .diff-table td {
            padding: 12px 15px;
            border-bottom: 1px solid var(--line-light);
            vertical-align: middle;
            font-size: 0.9em;
        }
        .diff-table tr:last-child td { border-bottom: none; }

        .diff-key {
            width: 100%;
            font-weight: 700;
            color: var(--ink-soft);
            font-size: 0.8rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .diff-old {
            width: 100%;
            color: var(--danger);
            /* Dynamic background using color-mix for theming compatibility */
            background-color: color-mix(in srgb, var(--danger) 10%, transparent);
            border-radius: 4px;
            padding: 6px 10px;
            font-family: monospace;
            word-break: break-all;
        }

        .diff-new {
            width: 100%;
            color: var(--ok);
            /* Dynamic background using color-mix for theming compatibility */
            background-color: color-mix(in srgb, var(--ok) 10%, transparent);
            border-radius: 4px;
            padding: 6px 10px;
            font-weight: 600;
            font-family: monospace;
            word-break: break-all;
        }

        .diff-arrow {
            width: 40px;
            text-align: center;
            color: var(--ink-light);
        }

        /* --- EMPTY STATE (Giant Checkmark) --- */
        .empty-state-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px 0;
            text-align: center;
        }

        .empty-state-icon {
            width: 80px;
            height: 80px;
            color: var(--ok);
            opacity: 0.2;
            margin-bottom: 20px;
            transform: scale(1.1);
        }

        .empty-state-text {
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--ink-soft);
        }

        /* --- FOOTER ACTIONS --- */
        #custom-modal-actions {
            padding: 20px 30px;
            background: white;
            border-top: 1px solid var(--line-light);
            display: flex;
            justify-content: flex-end;
            gap: 15px;
            flex-shrink: 0;
        }

        #btn-cc-publish {
            background: var(--brand);
            color: white;
            font-weight: 700;
            padding: 12px 28px;
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); /* Ombre portée légère */
            border-radius: 12px;
            border: none;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 1rem;
            cursor: pointer;
            transition: transform 0.1s, box-shadow 0.2s;
        }

        #btn-cc-publish:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
        }

        #btn-cc-publish:disabled {
            background: var(--ink-soft);
            box-shadow: none;
            cursor: not-allowed;
            transform: none;
        }

        /* --- SETTINGS --- */
        .settings-input {
            width: 100%;
            padding: 15px;
            border: 1px solid var(--line-light);
            border-radius: 8px;
            font-family: monospace;
            font-size: 1rem;
            background: var(--surface);
            color: var(--ink);
            transition: border 0.2s;
        }
        .settings-input:focus { border-color: var(--brand); outline: none; box-shadow: 0 0 0 3px var(--brand-soft); }

        /* Scrollbar Polish */
        .admin-cc-scroll-area::-webkit-scrollbar { width: 8px; }
        .admin-cc-scroll-area::-webkit-scrollbar-track { background: transparent; }
        .admin-cc-scroll-area::-webkit-scrollbar-thumb { background-color: rgba(0,0,0,0.1); border-radius: 4px; }
        .admin-cc-scroll-area::-webkit-scrollbar-thumb:hover { background-color: rgba(0,0,0,0.2); }
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
        if (details.key && !adminDraft.pendingPois[id].changes.includes(details.key)) {
            adminDraft.pendingPois[id].changes.push(details.key);
        } else if (details.type === 'coords' && !adminDraft.pendingPois[id].changes.includes('geometry')) {
            adminDraft.pendingPois[id].changes.push('geometry');
        }
    } else if (type === 'circuit') {
        adminDraft.pendingCircuits[id] = {
            type: details.type || 'update',
            timestamp
        };
    }

    saveDraft();
}

// --- UI ---

export async function openControlCenter() {
    // Force specific class on modal content for overrides
    const modalContent = document.getElementById('custom-modal-message').parentElement; // .custom-modal-content
    if (modalContent) {
        modalContent.classList.add('admin-cc-mode');
    }

    // 1. Structure HTML (Header Sticky + Scrollable Body)
    const html = `
        <div class="admin-cc-container">
            <div class="admin-cc-header">
                <div class="admin-cc-title">
                    <i data-lucide="shield-check" style="color:var(--brand);"></i> Centre de Contrôle
                </div>
                <div class="admin-cc-tabs">
                    <div class="admin-cc-tab active" data-tab="dashboard">
                        <i data-lucide="layout-grid" width="18"></i> Tableau de Bord
                    </div>
                    <div class="admin-cc-tab" data-tab="changes">
                        <i data-lucide="list-checks" width="18"></i> Détail des Modifications
                    </div>
                    <div class="admin-cc-tab" data-tab="settings">
                        <i data-lucide="settings-2" width="18"></i> Configuration
                    </div>
                </div>
            </div>

            <div id="admin-cc-content" class="admin-cc-scroll-area">
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:300px; color:var(--ink-soft);">
                    <i data-lucide="loader-2" class="spin" style="width:48px; height:48px; margin-bottom:15px; color:var(--brand);"></i>
                    <div style="font-weight:500;">Analyse des modifications en cours...</div>
                </div>
            </div>
        </div>
    `;

    // 2. Open Modal
    // We pass 'null' for title because we handle the header inside the custom HTML for layout control
    showAlert("", html, null);

    // Hide default modal title if possible or just ignore it
    const defaultTitle = document.getElementById('custom-modal-title');
    if (defaultTitle) defaultTitle.style.display = 'none';

    // 3. Setup Tabs
    const tabs = document.querySelectorAll('.admin-cc-tab');
    tabs.forEach(t => {
        t.onclick = () => {
            tabs.forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            renderTab(t.dataset.tab);
        };
    });

    // 4. Custom Footer Actions (Sticky Bottom)
    const actions = document.getElementById('custom-modal-actions');
    if (actions) {
        actions.innerHTML = `
            <button class="custom-modal-btn secondary" onclick="document.getElementById('custom-modal-overlay').classList.remove('active')">Fermer</button>
            <button id="btn-cc-publish">
                <i data-lucide="rocket"></i> TOUT PUBLIER
            </button>
        `;
        createIcons({ icons, root: actions });
        document.getElementById('btn-cc-publish').onclick = publishChanges;
    }

    // Clean up when modal closes
    const overlay = document.getElementById('custom-modal-overlay');
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class' && !overlay.classList.contains('active')) {
                // Remove custom class when closed
                if (modalContent) modalContent.classList.remove('admin-cc-mode');
                if (defaultTitle) defaultTitle.style.display = 'block';
                observer.disconnect();
            }
        });
    });
    observer.observe(overlay, { attributes: true });


    // 5. Load Data & Render
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
    let originalFeatures = [];
    try {
        const timestamp = Date.now();
        const mapId = state.currentMapId || 'djerba';
        const url = `https://raw.githubusercontent.com/Stefanmartin1967/History-Walk-V1/main/public/${mapId}.geojson?t=${timestamp}`;
        const response = await fetch(url);
        if (response.ok) {
            const json = await response.json();
            originalFeatures = json.features;
        }
    } catch (e) {
        console.error("Erreur fetch original", e);
    }

    diffData.pois = [];
    diffData.stats = { poisModified: 0, photosAdded: 0, circuitsModified: 0 };

    const pendingIds = Object.keys(adminDraft.pendingPois);

    pendingIds.forEach(id => {
        const current = state.loadedFeatures.find(f => getPoiId(f) === id);
        const original = originalFeatures.find(f => getPoiId(f) === id);

        if (!current) return;

        const changes = [];

        // Geometry
        if (original) {
            const [oLng, oLat] = original.geometry.coordinates;
            const [cLng, cLat] = current.geometry.coordinates;
            if (oLng.toFixed(5) !== cLng.toFixed(5) || oLat.toFixed(5) !== cLat.toFixed(5)) {
                changes.push({
                    key: 'Position',
                    old: `${oLat.toFixed(5)}, ${oLng.toFixed(5)}`,
                    new: `${cLat.toFixed(5)}, ${cLng.toFixed(5)}`
                });
            }
        }

        // Properties
        const trackedKeys = adminDraft.pendingPois[id].changes;
        const userData = current.properties.userData || {};
        const allKeysToCheck = new Set([...trackedKeys, ...Object.keys(userData)]);

        allKeysToCheck.forEach(key => {
            if (key === 'lat' || key === 'lng') return;

            let oldVal = original ? original.properties[key] : undefined;
            let newVal = userData[key] !== undefined ? userData[key] : current.properties[key];

            if (key === 'photos') {
                const oldLen = (oldVal || []).length;
                const newLen = (newVal || []).length;
                if (oldLen !== newLen) {
                    changes.push({
                        key: 'Photos',
                        old: `${oldLen} photo(s)`,
                        new: `${newLen} photo(s)`,
                    });
                    if (newLen > oldLen) diffData.stats.photosAdded += (newLen - oldLen);
                }
                return;
            }

            if (String(oldVal) !== String(newVal)) {
                changes.push({
                    key: key,
                    old: oldVal !== undefined ? oldVal : '—',
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

    createIcons({ icons, root: container });
}

function renderDashboard(container) {
    const { poisModified, photosAdded, circuitsModified } = diffData.stats;
    const total = poisModified + circuitsModified;

    container.innerHTML = `
        <div class="dashboard-grid">
            <div class="stat-card">
                <i data-lucide="map-pin" class="stat-bg-icon"></i>
                <div class="stat-value">${poisModified}</div>
                <div class="stat-label">Lieux Modifiés</div>
            </div>
            <div class="stat-card">
                <i data-lucide="camera" class="stat-bg-icon"></i>
                <div class="stat-value">${photosAdded}</div>
                <div class="stat-label">Photos Ajoutées</div>
            </div>
            <div class="stat-card">
                <i data-lucide="route" class="stat-bg-icon"></i>
                <div class="stat-value">${circuitsModified}</div>
                <div class="stat-label">Circuits Mis à jour</div>
            </div>
        </div>

        ${total > 0 ? `
            <div class="sync-banner">
                <i data-lucide="info" width="24" height="24"></i>
                <div>
                    <h3 style="margin:0 0 5px 0; font-size:1.1rem;">Synchronisation Requise</h3>
                    <p style="margin:0; opacity:0.9;">
                        Vous avez <strong>${total} modifications</strong> en attente.
                        Ces données sont stockées localement sur votre navigateur.
                        Pour les rendre publiques, cliquez sur "Tout Publier".
                    </p>
                </div>
            </div>
        ` : `
            <div class="empty-state-container">
                <i data-lucide="check-circle-2" class="empty-state-icon"></i>
                <div class="empty-state-text">Tout est à jour. Aucune modification locale détectée.</div>
            </div>
        `}
    `;
}

function renderChanges(container) {
    if (diffData.pois.length === 0 && diffData.stats.circuitsModified === 0) {
        container.innerHTML = `
            <div class="empty-state-container">
                <i data-lucide="check-circle-2" class="empty-state-icon"></i>
                <div class="empty-state-text">Aucune modification à afficher.</div>
            </div>
        `;
        return;
    }

    let html = `<div class="diff-container">`;

    // POIs
    if (diffData.pois.length > 0) {
        html += diffData.pois.map(item => `
            <div class="diff-card">
                <div class="diff-card-header">
                    <div class="diff-title">
                        <i data-lucide="map-pin" width="18" style="color:var(--brand);"></i> ${item.name}
                    </div>
                    <div class="diff-id">${item.id}</div>
                </div>
                <table class="diff-table">
                    <thead>
                        <tr>
                            <th style="width: 140px;">Propriété</th>
                            <th style="width: 40%;">Ancienne Valeur</th>
                            <th style="width: 40px;"></th>
                            <th style="width: 40%;">Nouvelle Valeur</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${item.changes.map(c => `
                            <tr>
                                <td><div class="diff-key">${c.key}</div></td>
                                <td><div class="diff-old">${c.old}</div></td>
                                <td><div class="diff-arrow">➜</div></td>
                                <td><div class="diff-new">${c.new}</div></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `).join('');
    }

    html += `</div>`;
    container.innerHTML = html;
}

function renderSettings(container) {
    const token = getStoredToken() || '';
    container.innerHTML = `
        <div style="max-width:600px; margin:0 auto;">
            <div style="background:var(--surface); padding:30px; border-radius:16px; border:1px solid var(--line-light); box-shadow:0 4px 15px rgba(0,0,0,0.02);">
                <h3 style="margin-top:0;">Configuration GitHub</h3>
                <p style="color:var(--ink-soft); margin-bottom:20px;">
                    Le Token d'accès personnel (PAT) permet à l'application d'écrire sur le dépôt GitHub.
                </p>

                <label style="display:block; margin-bottom: 8px; font-weight: 600;">Personal Access Token</label>
                <input type="password" id="cc-token-input" value="${token}" class="settings-input" placeholder="ghp_...">

                <button class="custom-modal-btn primary" id="btn-save-token" style="width:100%; margin-top:20px; padding:12px;">
                    <i data-lucide="save"></i> Sauvegarder Token
                </button>
            </div>
        </div>
    `;

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
        showToast("Token manquant. Vérifiez la configuration.", "error");
        return;
    }

    if (!confirm("Publier toutes les modifications sur GitHub ?")) return;

    const btn = document.getElementById('btn-cc-publish');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Envoi...`;
        createIcons({ icons, root: btn });
    }

    try {
        const geojson = generateMasterGeoJSONData();
        if (!geojson) throw new Error("Erreur données GeoJSON");

        const mapId = state.currentMapId || 'djerba';
        const filename = `${mapId}.geojson`;
        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
        const file = new File([blob], filename, { type: 'application/geo+json' });

        await uploadFileToGitHub(file, token, 'Stefanmartin1967', 'History-Walk-V1', `public/${filename}`, `Update via Admin Center`);

        showToast("Publication réussie !", "success");
        adminDraft = { pendingPois: {}, pendingCircuits: {} };
        saveDraft();
        updateButtonBadge();

        // Clean local userData for published POIs
        diffData.pois.forEach(p => {
             if (state.userData[p.id]) delete state.userData[p.id];
        });
        await saveAppState('userData', state.userData);

        alert("Mise à jour effectuée avec succès !");
        document.getElementById('custom-modal-overlay').classList.remove('active');

    } catch (e) {
        console.error(e);
        showToast("Erreur: " + e.message, "error");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="rocket"></i> Réessayer`;
            createIcons({ icons, root: btn });
        }
    }
}
