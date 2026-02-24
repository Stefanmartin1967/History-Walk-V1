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

    // Inject styles (PREMIUM DASHBOARD - WARM THEME)
    const style = document.createElement('style');
    style.textContent = `
        /* --- VARIABLES THEME PREMIUM --- */
        :root {
            --brand: #D97706;       /* Ambre chaleureux */
            --brand-light: #FDE68A;
            --brand-gradient: linear-gradient(135deg, #F59E0B, #D97706);
            --surface: #FFFFFF;
            --surface-muted: #FDF9F3; /* Crème très doux */
            --line: #E5E7EB;
            --ink: #451A03;        /* Brun profond au lieu de noir */
            --ink-soft: #78350F;
            --danger-bg: #FEE2E2;
            --danger-text: #991B1B;
            --ok-bg: #DCFCE7;
            --ok-text: #166534;
        }

        /* --- CONTAINER & MODAL --- */
        .custom-modal-box.admin-cc-mode {
            width: min(1200px, 95vw) !important;
            max-width: none !important;
            height: auto !important;
            max-height: 85vh !important;
            border-radius: 32px !important; /* Coins très ronds */
            background: var(--surface-muted) !important;
            border: 1px solid rgba(255,255,255,0.8) !important;
            box-shadow: 0 40px 100px -20px rgba(69, 26, 3, 0.15) !important;
            padding: 0 !important;
            overflow: hidden !important;
            display: flex !important;
            flex-direction: column !important;
        }

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
            background: var(--surface-muted);
        }

        /* --- HEADER PREMIUM --- */
        .admin-cc-header {
            background: var(--surface);
            padding: 24px 40px;
            border-bottom: 1px solid var(--line);
            flex-shrink: 0;
            z-index: 10;
        }

        .admin-header-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
        }

        .header-logo {
            font-weight: 800;
            font-size: 1.1rem;
            color: var(--ink);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .header-profile {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 0.9rem;
            color: var(--ink-soft);
        }

        .avatar-mini {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: var(--brand-light);
            border: 2px solid white;
            box-shadow: 0 4px 10px rgba(0,0,0,0.1);
        }

        /* --- TABS (PILLS) --- */
        .admin-cc-tabs {
            display: flex;
            gap: 12px;
            justify-content: flex-start;
        }

        .admin-cc-tab {
            padding: 8px 20px;
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 700;
            color: #94A3B8;
            transition: all 0.3s ease;
            cursor: pointer;
            background: transparent;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .admin-cc-tab:hover {
            color: var(--ink);
            background: rgba(0,0,0,0.03);
        }

        .admin-cc-tab.active {
            background: var(--brand);
            color: white;
            box-shadow: 0 4px 12px rgba(217, 119, 6, 0.3);
        }

        /* --- ZONE DE CONTENU (SCROLLABLE) --- */
        .admin-cc-scroll-area {
            flex: 1;
            overflow-y: auto;
            padding: 40px;
            background: var(--surface-muted);
        }

        .admin-cc-content-wrapper {
            max-width: 1100px; /* Keep strict layout constraint */
            margin: 0 auto;
            width: 100%;
        }

        /* --- STAT CARDS --- */
        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-top: 30px;
            margin-bottom: 40px;
        }

        .stat-card {
            background: var(--surface);
            padding: 24px;
            border-radius: 24px;
            display: flex;
            align-items: center;
            gap: 20px;
            border: 1px solid white;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.03);
            transition: transform 0.2s;
        }
        .stat-card:hover { transform: translateY(-2px); }

        .stat-icon {
            width: 56px;
            height: 56px;
            border-radius: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: color-mix(in srgb, var(--brand) 10%, transparent);
            color: var(--brand);
            font-size: 1.5rem;
            flex-shrink: 0;
        }

        .stat-content {
            display: flex;
            flex-direction: column;
        }

        .stat-value {
            font-size: 2rem;
            font-weight: 800;
            color: var(--ink);
            line-height: 1;
        }

        .stat-label {
            font-weight: 600;
            color: var(--ink-soft);
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .stat-sub {
            font-size: 0.75rem;
            color: #10B981; /* Vert positif */
            font-weight: 600;
            margin-top: 4px;
        }

        /* --- DIFF SYSTEM (AVANT/APRÈS) --- */
        .diff-container { display: flex; flex-direction: column; gap: 20px; }

        .diff-entry {
            background: var(--surface);
            border-radius: 24px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.02);
            border: 1px solid white;
        }

        .diff-comparison-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin-top: 15px;
        }

        .diff-box {
            padding: 20px;
            border-radius: 16px;
            font-family: 'Inter', sans-serif;
            border: 1px solid transparent;
        }

        .diff-box.avant {
            background: var(--danger-bg);
            color: var(--danger-text);
            border-color: rgba(153, 27, 27, 0.1);
        }
        .diff-box.apres {
            background: var(--ok-bg);
            color: var(--ok-text);
            border-color: rgba(22, 101, 52, 0.1);
        }

        .box-label {
            font-size: 0.7rem;
            font-weight: 800;
            text-transform: uppercase;
            display: block;
            margin-bottom: 8px;
            opacity: 0.6;
        }

        .box-content {
            font-family: monospace;
            word-break: break-all;
            font-size: 0.9rem;
        }

        /* --- DIFF ACTIONS --- */
        .diff-actions {
            display: flex;
            gap: 10px;
        }

        .btn-diff-action {
            padding: 8px 16px;
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid transparent;
        }

        .btn-diff-action.refuse {
            background: #F1F5F9;
            color: #64748B;
        }

        .btn-diff-action.refuse:hover {
            background: var(--danger-bg);
            color: var(--danger-text);
        }

        .btn-diff-action.validate {
            background: var(--brand-light);
            color: var(--brand);
        }

        .btn-diff-action.validate:hover {
            background: var(--brand);
            color: white; /* Contrast correction */
        }

        /* --- FOOTER FIXED --- */
        .admin-cc-footer {
            padding: 20px 40px;
            background: var(--surface);
            border-top: 1px solid var(--line);
            flex-shrink: 0;
            display: flex;
            justify-content: center; /* Centered */
        }

        #btn-cc-publish {
            background: var(--brand-gradient);
            border-radius: 30px;
            padding: 16px 40px;
            font-weight: 800;
            letter-spacing: 0.02em;
            box-shadow: 0 15px 30px -5px rgba(217, 119, 6, 0.4);
            color: white;
            border: none;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 1rem;
        }
        #btn-cc-publish:hover { transform: translateY(-2px); filter: brightness(1.1); box-shadow: 0 20px 40px -8px rgba(217, 119, 6, 0.5); }
        #btn-cc-publish:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }

        .custom-modal-btn.secondary {
            background: transparent;
            border: 1px solid var(--line);
            color: var(--ink-soft);
            padding: 12px 24px;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .custom-modal-btn.secondary:hover { background: var(--surface-muted); color: var(--ink); border-color: var(--ink-soft); }

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
            color: var(--ok-text);
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
        .settings-input:focus { border-color: var(--brand); outline: none; box-shadow: 0 0 0 4px rgba(217, 119, 6, 0.1); }

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
                <div class="admin-cc-content-wrapper">
                    <!-- Header Top (Logo + Profile) -->
                    <div class="admin-header-top">
                        <div class="header-logo">
                            <span style="font-size:1.5rem;">🏰</span> History Walk <span style="font-weight:400; opacity:0.5;">| Centre de Contrôle</span>
                        </div>
                        <div class="header-profile">
                            Bonjour <strong>Admin</strong> 👋
                            <div class="avatar-mini"></div>
                        </div>
                    </div>

                    <!-- Tabs (Pills) -->
                    <div class="admin-cc-tabs">
                        <div class="admin-cc-tab active" data-tab="dashboard">
                            <i data-lucide="layout-grid" width="16"></i> Dashboard
                        </div>
                        <div class="admin-cc-tab" data-tab="changes">
                            <i data-lucide="list-checks" width="16"></i> Modifications
                        </div>
                        <div class="admin-cc-tab" data-tab="settings">
                            <i data-lucide="settings-2" width="16"></i> Config
                        </div>
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
                <div class="admin-cc-content-wrapper" style="display:flex; justify-content:flex-end; gap:15px; align-items:center;">
                    <button class="custom-modal-btn secondary" onclick="document.getElementById('custom-modal-overlay').classList.remove('active')">Fermer</button>
                    <button id="btn-cc-publish">
                        <i data-lucide="rocket"></i> TOUT PUBLIER SUR GITHUB
                    </button>
                </div>
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
    createIcons({ icons, root: document.querySelector('.admin-header-top') });
    createIcons({ icons, root: document.querySelector('.admin-cc-tabs') });

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
                <div class="stat-icon"><i data-lucide="map-pin" width="32" height="32"></i></div>
                <div class="stat-content">
                    <div class="stat-value">${poisModified}</div>
                    <div class="stat-label">Lieux Modifiés</div>
                    ${poisModified > 0 ? `<div class="stat-sub">+${poisModified} changes</div>` : ''}
                </div>
            </div>
            <div class="stat-card">
                 <div class="stat-icon"><i data-lucide="camera" width="32" height="32"></i></div>
                 <div class="stat-content">
                    <div class="stat-value">${photosAdded}</div>
                    <div class="stat-label">Photos Ajoutées</div>
                </div>
            </div>
            <div class="stat-card">
                 <div class="stat-icon"><i data-lucide="route" width="32" height="32"></i></div>
                 <div class="stat-content">
                    <div class="stat-value">${circuitsModified}</div>
                    <div class="stat-label">Circuits Modifiés</div>
                </div>
            </div>
        </div>

        ${total > 0 ? `
            <div style="background:var(--brand-light); color:var(--ink-soft); padding:20px; border-radius:16px; border:1px solid rgba(217, 119, 6, 0.2); display:flex; align-items:center; gap:15px;">
                <i data-lucide="info" width="24" height="24" style="color:var(--brand);"></i>
                <div style="font-weight:600;">Modifications locales en attente. Vérifiez dans l'onglet "Modifications" avant de publier.</div>
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
                <div style="font-weight:600; color:var(--ink-soft);">Tout est en ordre !</div>
            </div>
        `;
        return;
    }

    let html = `<div class="diff-container">
        <h3 style="color:var(--ink); margin-bottom:20px;">Dernières modifications en attente (${diffData.pois.length})</h3>`;

    // POIs
    html += diffData.pois.map(item => {
        return `
        <div class="diff-entry" id="diff-card-${item.id}">
            <div class="admin-header-top" style="margin-bottom:15px; border-bottom:1px solid var(--line); padding-bottom:15px;">
                <div class="diff-title" style="font-weight:700; color:var(--ink); display:flex; align-items:center; gap:10px;">
                    <i data-lucide="map-pin" width="18" style="color:var(--brand);"></i>
                    MODIFICATION : Lieu "<strong>${item.name}</strong>"
                </div>
                <div class="diff-actions">
                    <button class="btn-diff-action refuse" onclick="processDecision('${item.id}', 'refuse')">Refuser</button>
                    <button class="btn-diff-action validate" onclick="processDecision('${item.id}', 'accept')">Valider</button>
                </div>
            </div>

            ${item.changes.map(c => `
                <div style="margin-top:10px;">
                    <div style="font-size:0.75rem; font-weight:800; color:var(--ink-soft); margin-bottom:5px; opacity:0.6;">
                        PROPRIÉTÉ : ${c.key ? c.key.toUpperCase() : 'INCONNU'}
                    </div>
                    <div class="diff-comparison-grid">
                        <div class="diff-box avant">
                            <span class="box-label">AVANT</span>
                            <div class="box-content">${c.old !== undefined ? c.old : '-'}</div>
                        </div>
                        <div class="diff-box apres">
                            <span class="box-label">APRÈS</span>
                            <div class="box-content">${c.new !== undefined ? c.new : '-'}</div>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `}).join('');

    html += `</div>`;
    container.innerHTML = html;
}

// Logic for Diff Actions
window.processDecision = async (id, decision) => {
    if (decision === 'refuse') {
        // 1. Supprimer du brouillon admin
        if (adminDraft.pendingPois[id]) delete adminDraft.pendingPois[id];

        // 2. Annuler les changements locaux dans state.userData
        if (state.userData[id]) {
            // Check if it was a creation (new POI) - tough to delete entirely if we just added it to userData
            // but for now, we just clear userData override.
            delete state.userData[id];
            await saveAppState('userData', state.userData);
        }

        showToast("Modification refusée et annulée", "info");
    } else {
        // Pour "Valider", on garde simplement dans le brouillon
        // pour le bouton final "TOUT PUBLIER"
        showToast("Modification validée pour publication", "success");
        const card = document.getElementById(`diff-card-${id}`);
        if (card) {
            card.style.opacity = "0.5"; // Feedback visuel
            card.style.pointerEvents = "none";
        }
        return; // Don't reload everything, just feedback
    }

    // Mise à jour de l'interface (Full reload needed for Refuse)
    saveDraft();
    await prepareDiffData();
    renderTab('changes');
    updateButtonBadge();
};

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
