
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

    // Inject styles (PC FIRST REDESIGN - WARM THEME)
    const style = document.createElement('style');
    style.textContent = `
        /* --- RESET & OVERRIDES --- */
        .custom-modal-box.admin-cc-mode {
            /* Largeur fluide : Max 1400px mais jamais plus de 95% de l'écran */
            width: min(1400px, 95vw) !important;
            max-width: none !important;
            height: 85vh !important;
            padding: 0 !important;
            background: var(--surface) !important; /* Respect du thème */
            border-radius: 28px !important;
            overflow: hidden !important;
            display: flex !important;
            flex-direction: column !important;
            box-shadow: 0 30px 60px -12px rgba(0, 0, 0, 0.3) !important;
            border: 1px solid var(--line) !important;
        }

        /* Force le message interne à prendre tout l'espace */
        .custom-modal-box.admin-cc-mode .custom-modal-message {
            flex: 1 !important;
            display: flex !important;
            flex-direction: column !important;
            margin: 0 !important;
            padding: 0 !important;
            height: 100% !important;
            width: 100% !important;
            overflow: hidden !important;
        }

        /* --- CONTAINER PRINCIPAL --- */
        .admin-cc-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            width: 100%;
            font-family: 'Inter', system-ui, sans-serif;
            color: var(--ink);
            background: var(--surface);
        }

        /* --- HEADER STICKY --- */
        .admin-cc-header {
            background: var(--surface);
            padding: 30px 50px;
            border-bottom: 1px solid var(--line);
            flex-shrink: 0;
            z-index: 10;
        }

        .admin-cc-title {
            font-size: 1.8rem;
            font-weight: 800;
            color: var(--brand);
            letter-spacing: -0.02em;
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
        }

        /* --- TABS (Styled to match Warm Theme) --- */
        .admin-cc-tabs {
            display: inline-flex;
            gap: 8px;
            background: var(--surface-muted);
            padding: 5px;
            border-radius: 14px;
            width: fit-content;
        }

        .admin-cc-tab {
            padding: 10px 24px;
            cursor: pointer;
            border-radius: 10px;
            font-weight: 600;
            font-size: 0.9rem;
            color: var(--ink-soft);
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex;
            align-items: center;
            gap: 8px;
            user-select: none;
        }

        .admin-cc-tab:hover {
            color: var(--ink);
            background: rgba(0,0,0,0.03);
        }

        .admin-cc-tab.active {
            background: var(--surface);
            color: var(--brand);
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }

        /* --- ZONE DE CONTENU (SCROLLABLE) --- */
        .admin-cc-scroll-area {
            flex: 1;
            overflow-y: auto;
            padding: 40px;
            background: color-mix(in srgb, var(--surface), var(--ink) 2%); /* Teinte très légère pour le fond */
        }

        .admin-cc-content-wrapper {
            max-width: 1000px; /* On contient le contenu pour qu'il ne s'éparpille pas */
            margin: 0 auto;
            width: 100%;
        }

        /* --- DASHBOARD GRID --- */
        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); /* Adaptatif PC portable/UW */
            gap: 25px;
            margin-bottom: 40px;
            width: 100%;
        }

        .stat-card {
            background: var(--surface);
            border: 1px solid var(--line);
            border-radius: 22px;
            padding: 35px;
            text-align: center;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(0,0,0,0.05);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }

        .stat-card:hover {
            transform: translateY(-4px);
            border-color: var(--brand);
            box-shadow: 0 12px 25px rgba(0,0,0,0.1);
        }

        .stat-value {
            font-size: 3.5rem;
            font-weight: 900;
            color: var(--brand);
            line-height: 1;
            margin-bottom: 10px;
        }

        .stat-label {
            color: var(--ink-soft);
            font-weight: 600;
            text-transform: uppercase;
            font-size: 0.8rem;
            letter-spacing: 0.05em;
        }

        /* --- SYNC BANNER --- */
        .sync-banner {
            background: var(--brand);
            color: white;
            padding: 25px 35px;
            border-radius: 20px;
            display: flex;
            align-items: center;
            gap: 20px;
            box-shadow: 0 10px 25px -5px rgba(59, 130, 246, 0.4); /* Brand shadow hint */
            margin-top: 20px;
        }
        .sync-banner i { flex-shrink: 0; }

        /* --- DIFF VIEW (Side-by-Side) --- */
        .diff-container { display: flex; flex-direction: column; gap: 20px; }

        .diff-card {
            background: var(--surface);
            border-radius: 16px;
            border: 1px solid var(--line);
            overflow: hidden;
            box-shadow: 0 2px 5px rgba(0,0,0,0.02);
        }

        .diff-card-header {
            padding: 15px 25px;
            background: var(--surface-muted);
            border-bottom: 1px solid var(--line);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .diff-title { font-weight: 700; color: var(--ink); display: flex; align-items: center; gap: 10px; }

        .diff-id {
            font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
            font-size: 0.8em;
            color: var(--ink-soft);
            background: rgba(0,0,0,0.05);
            padding: 4px 8px;
            border-radius: 4px;
        }

        .diff-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
        }

        .diff-table th {
            text-align: left;
            padding: 12px 25px;
            background: rgba(0,0,0,0.02);
            color: var(--ink-soft);
            font-weight: 600;
            font-size: 0.75em;
            text-transform: uppercase;
            border-bottom: 1px solid var(--line);
        }

        .diff-table td {
            padding: 15px 25px;
            border-bottom: 1px solid var(--line);
            vertical-align: middle;
            font-size: 0.9em;
            color: var(--ink);
        }

        .diff-table tr:last-child td { border-bottom: none; }

        .diff-key {
            width: 140px;
            font-weight: 700;
            color: var(--ink-soft);
            font-size: 0.85rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .diff-old {
            color: var(--danger);
            background: color-mix(in srgb, var(--danger) 8%, transparent);
            padding: 8px 12px;
            border-radius: 6px;
            font-family: monospace;
            word-break: break-all;
        }

        .diff-new {
            color: var(--ok);
            background: color-mix(in srgb, var(--ok) 8%, transparent);
            padding: 8px 12px;
            border-radius: 6px;
            font-weight: 600;
            font-family: monospace;
            word-break: break-all;
        }

        .diff-arrow {
            width: 40px;
            text-align: center;
            color: var(--line);
        }

        /* --- FOOTER FIXED --- */
        .admin-cc-footer {
            padding: 20px 50px;
            background: var(--surface);
            border-top: 1px solid var(--line);
            display: flex;
            justify-content: flex-end;
            align-items: center;
            gap: 15px;
            flex-shrink: 0;
            border-radius: 0 0 24px 24px;
        }

        #btn-cc-publish {
            background: var(--brand);
            color: white;
            padding: 12px 35px;
            border-radius: 12px;
            font-weight: 700;
            border: none;
            cursor: pointer;
            box-shadow: 0 8px 20px -6px rgba(59, 130, 246, 0.5); /* Brand shadow hint */
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 1rem;
        }
        #btn-cc-publish:hover { transform: translateY(-2px); filter: brightness(1.1); box-shadow: 0 12px 24px -8px rgba(59, 130, 246, 0.6); }
        #btn-cc-publish:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }

        .custom-modal-btn.secondary {
            background: var(--surface);
            border: 1px solid var(--line);
            color: var(--ink-soft);
            padding: 12px 24px;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .custom-modal-btn.secondary:hover { background: var(--surface-muted); color: var(--ink); border-color: var(--line); }

        /* --- EMPTY STATE --- */
        .empty-state-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 80px 0;
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

        /* --- SETTINGS --- */
        .settings-input {
            width: 100%;
            padding: 15px;
            border: 1px solid var(--line);
            border-radius: 12px;
            font-family: monospace;
            font-size: 1rem;
            background: var(--surface);
            color: var(--ink);
            transition: border 0.2s;
        }
        .settings-input:focus { border-color: var(--brand); outline: none; box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1); }

        /* Scrollbar Polish */
        .admin-cc-scroll-area::-webkit-scrollbar { width: 8px; }
        .admin-cc-scroll-area::-webkit-scrollbar-track { background: transparent; }
        .admin-cc-scroll-area::-webkit-scrollbar-thumb { background-color: var(--line); border-radius: 4px; }
        .admin-cc-scroll-area::-webkit-scrollbar-thumb:hover { background-color: var(--ink-soft); }
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

let diffData = {
    pois: [],
    stats: {
        poisModified: 0,
        photosAdded: 0,
        circuitsModified: 0
    }
};

export async function openControlCenter() {
    // 1. Structure HTML (Header Sticky + Scrollable Body + Fixed Footer)
    const html = `
        <div class="admin-cc-container">
            <div class="admin-cc-header">
                <div class="admin-cc-title">
                    <i data-lucide="shield-check" style="color:var(--brand);"></i> Centre de Contrôle Admin
                </div>
                <div class="admin-cc-tabs">
                    <div class="admin-cc-tab active" data-tab="dashboard">
                        <i data-lucide="layout-grid" width="18"></i> Dashboard
                    </div>
                    <div class="admin-cc-tab" data-tab="changes">
                        <i data-lucide="list-checks" width="18"></i> Modifications
                    </div>
                    <div class="admin-cc-tab" data-tab="settings">
                        <i data-lucide="settings-2" width="18"></i> Config
                    </div>
                </div>
            </div>

            <div class="admin-cc-scroll-area">
                <div id="admin-cc-content" class="admin-cc-content-wrapper">
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:300px; color:var(--ink-soft);">
                        <i data-lucide="loader-2" class="spin" style="width:48px; height:48px; margin-bottom:15px; color:var(--brand);"></i>
                        <div style="font-weight:500;">Analyse des modifications en cours...</div>
                    </div>
                </div>
            </div>

            <div class="admin-cc-footer" id="admin-cc-footer-actions">
                <button class="custom-modal-btn secondary" onclick="document.getElementById('custom-modal-overlay').classList.remove('active')">Fermer</button>
                <button id="btn-cc-publish">
                    <i data-lucide="rocket"></i> TOUT PUBLIER SUR GITHUB
                </button>
            </div>
        </div>
    `;

    // 2. Open Modal
    showAlert("", html, null, 'admin-cc-mode');

    // Hide default modal title
    const defaultTitle = document.getElementById('custom-modal-title');
    if (defaultTitle) defaultTitle.style.display = 'none';

    // Hide default modal actions (we have our own fixed footer)
    const defaultActions = document.getElementById('custom-modal-actions');
    if (defaultActions) defaultActions.style.display = 'none';

    // 3. Setup Tabs
    const tabs = document.querySelectorAll('.admin-cc-tab');
    tabs.forEach(t => {
        t.onclick = () => {
            tabs.forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            renderTab(t.dataset.tab);
        };
    });

    // 4. Setup Publish Button
    const btnPublish = document.getElementById('btn-cc-publish');
    if (btnPublish) btnPublish.onclick = publishChanges;
    createIcons({ icons, root: document.getElementById('admin-cc-footer-actions') });

    // Clean up when modal closes
    const overlay = document.getElementById('custom-modal-overlay');
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class' && !overlay.classList.contains('active')) {
                // Remove custom class when closed
                const modalContent = document.querySelector('.custom-modal-box');
                if (modalContent) modalContent.classList.remove('admin-cc-mode');
                if (defaultTitle) defaultTitle.style.display = 'block';
                if (defaultActions) defaultActions.style.display = 'flex'; // Restore default actions
                observer.disconnect();
            }
        });
    });
    observer.observe(overlay, { attributes: true });

    // 5. Load Data & Render
    await prepareDiffData();
    renderTab('dashboard');
}

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
                <div class="stat-value">${poisModified}</div>
                <div class="stat-label">Lieux Modifiés</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${photosAdded}</div>
                <div class="stat-label">Photos Ajoutées</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${circuitsModified}</div>
                <div class="stat-label">Circuits Modifiés</div>
            </div>
        </div>

        ${total > 0 ? `
            <div class="sync-banner">
                <i data-lucide="info" width="32" height="32"></i>
                <div>
                    <div style="font-weight:800; font-size:1.2rem; margin-bottom:4px;">Modifications locales en attente</div>
                    <div style="opacity:0.9;">Cliquez sur publier pour mettre à jour la carte officielle.</div>
                </div>
            </div>
        ` : `
            <div class="empty-state-container">
                <i data-lucide="check-circle-2" class="empty-state-icon"></i>
                <div style="font-weight:600; font-size:1.1rem; color:var(--ink-soft);">Votre carte est parfaitement synchronisée.</div>
            </div>
        `}
    `;
}

function renderChanges(container) {
    if (diffData.pois.length === 0 && diffData.stats.circuitsModified === 0) {
        container.innerHTML = `
            <div class="empty-state-container">
                <i data-lucide="check-circle-2" class="empty-state-icon"></i>
                <div style="font-weight:600; color:var(--ink-soft);">Aucune modification à afficher.</div>
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
            <div style="background:var(--surface); padding:40px; border-radius:24px; border:1px solid var(--line); box-shadow:0 4px 6px -1px rgba(0,0,0,0.02);">
                <h3 style="margin-top:0; font-size:1.2rem; color:var(--ink);">Configuration GitHub</h3>
                <p style="color:var(--ink-soft); margin-bottom:25px; line-height:1.5;">
                    Le Token d'accès personnel (PAT) permet à l'application d'écrire sur le dépôt GitHub.
                </p>

                <label style="display:block; margin-bottom: 8px; font-weight: 600; color:var(--ink);">Personal Access Token</label>
                <input type="password" id="cc-token-input" value="${token}" class="settings-input" placeholder="ghp_...">

                <button class="custom-modal-btn primary" id="btn-save-token" style="width:100%; margin-top:25px; padding:14px; background:var(--brand); color:white; border-radius:12px; font-weight:700; border:none; cursor:pointer;">
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
