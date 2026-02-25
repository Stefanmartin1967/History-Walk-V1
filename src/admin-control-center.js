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
    pendingPois: {},
    pendingCircuits: {}
};

export async function initAdminControlCenter() {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
        try {
            adminDraft = JSON.parse(saved);
            updateButtonBadge();
        } catch (e) { console.error("Erreur brouillon", e); }
    }

    const style = document.createElement('style');
    style.textContent = `
        :root {
            --hw-amber: #D97706;
            --hw-cream: #FDF9F3;
            --hw-ink: #451A03;
            --hw-ink-soft: #78350F;
        }

        /* RESET & CONTAINER ECRASANT */
        .admin-cc-mode {
            padding: 0 !important;
            border-radius: 32px !important;
            overflow: hidden !important;
            border: 1px solid rgba(255,255,255,0.8) !important;
            box-shadow: 0 40px 100px -20px rgba(69, 26, 3, 0.2) !important;
            background: var(--hw-cream) !important;
            width: min(1200px, 95vw) !important;
            max-width: none !important;
            height: auto !important;
            max-height: 85vh !important;
            display: flex !important;
            flex-direction: column !important;
        }

        .admin-cc-mode .custom-modal-message {
            flex: 1 !important;
            display: flex !important;
            flex-direction: column !important;
            margin: 0 !important;
            padding: 0 !important;
            height: 100% !important;
            width: 100% !important;
            overflow: hidden !important;
        }

        .admin-cc-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            width: 100%;
            font-family: 'Inter', system-ui, sans-serif;
            color: var(--hw-ink);
        }

        /* HEADER STRUCTURE RIGIDE */
        .admin-cc-header {
            background: #FFFFFF;
            padding: 24px 40px;
            border-bottom: 1px solid #E5E7EB;
            flex-shrink: 0;
        }

        .header-top-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            margin-bottom: 24px;
        }

        .header-brand {
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: 800;
            font-size: 1.2rem;
        }

        .header-user {
            display: flex;
            align-items: center;
            gap: 15px;
            background: #F8FAFC;
            padding: 6px 16px;
            border-radius: 50px;
            border: 1px solid #F1F5F9;
        }

        .avatar-circle {
            width: 34px;
            height: 34px;
            border-radius: 50%;
            background: var(--hw-amber);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 0.8rem;
            box-shadow: 0 4px 10px rgba(217, 119, 6, 0.3);
        }

        /* TABS STYLE APPLE */
        .admin-cc-tabs {
            display: flex;
            gap: 8px;
        }

        .admin-cc-tab {
            padding: 10px 20px;
            border-radius: 12px;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
            color: #64748B;
            transition: 0.2s;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .admin-cc-tab:hover {
            background: #F1F5F9;
            color: var(--hw-ink);
        }

        .admin-cc-tab.active {
            background: var(--hw-amber);
            color: white;
            box-shadow: 0 4px 12px rgba(217, 119, 6, 0.3);
        }

        /* CONTENU */
        .admin-cc-scroll-area {
            flex: 1;
            overflow-y: auto;
            padding: 40px;
        }

        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
        }

        .stat-card {
            background: white;
            padding: 24px;
            border-radius: 24px;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .stat-icon-box {
            width: 50px;
            height: 50px;
            border-radius: 15px;
            background: #FFFBEB;
            color: var(--hw-amber);
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .stat-val { font-size: 1.8rem; font-weight: 800; line-height: 1; }
        .stat-lab { font-size: 0.8rem; font-weight: 600; color: var(--hw-ink-soft); text-transform: uppercase; }

        /* FOOTER */
        .admin-cc-footer {
            padding: 20px 40px;
            background: white;
            border-top: 1px solid #E5E7EB;
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            flex-shrink: 0; /* Important pour layout flex */
        }

        #btn-cc-publish {
            background: linear-gradient(135deg, #F59E0B, #D97706);
            color: white;
            border: none;
            padding: 14px 30px;
            border-radius: 50px;
            font-weight: 800;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 10px 20px -5px rgba(217, 119, 6, 0.4);
            transition: all 0.2s;
        }
        #btn-cc-publish:hover { transform: translateY(-2px); filter: brightness(1.1); }
        #btn-cc-publish:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }

        .custom-modal-btn.secondary {
            background: transparent;
            border: 1px solid #E5E7EB;
            color: var(--hw-ink-soft);
            padding: 12px 24px;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .custom-modal-btn.secondary:hover { background: #F8FAFC; color: var(--hw-ink); }

        /* DIFF CARDS */
        .diff-entry {
            background: white;
            border-radius: 20px;
            padding: 24px;
            margin-bottom: 20px;
            border: 1px solid #F1F5F9;
            box-shadow: 0 2px 10px rgba(0,0,0,0.02);
        }
        .diff-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            border-bottom: 1px solid #F1F5F9;
            padding-bottom: 15px;
        }
        .diff-title {
            font-weight: 700;
            color: var(--hw-ink);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .diff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 10px; }
        .box { padding: 15px; border-radius: 12px; font-size: 0.9rem; font-family: monospace; word-break: break-all; }
        .box-label { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; display: block; margin-bottom: 5px; opacity: 0.6; }
        .box.old { background: #FEF2F2; color: #991B1B; border: 1px solid rgba(153, 27, 27, 0.1); }
        .box.new { background: #F0FDF4; color: #166534; border: 1px solid rgba(22, 101, 52, 0.1); }

        .diff-actions { display: flex; gap: 10px; }
        .btn-diff-action { padding: 6px 12px; border-radius: 8px; font-size: 0.8rem; font-weight: 700; cursor: pointer; border: none; }
        .btn-diff-action.refuse { background: #F1F5F9; color: #64748B; }
        .btn-diff-action.refuse:hover { background: #FEE2E2; color: #991B1B; }
        .btn-diff-action.validate { background: #FFFBEB; color: var(--hw-amber); }
        .btn-diff-action.validate:hover { background: var(--hw-amber); color: white; }

        /* EMPTY STATE */
        .empty-state { text-align: center; padding: 60px 0; opacity: 0.6; }

        /* SETTINGS */
        .settings-input {
            width: 100%; padding: 15px; border: 1px solid #E5E7EB; border-radius: 12px;
            font-family: monospace; font-size: 1rem; margin-top: 10px;
        }
    `;
    document.head.appendChild(style);
}

function updateButtonBadge() {
    const btn = document.getElementById('btn-admin-control-center');
    if (!btn) return;
    const total = Object.keys(adminDraft.pendingPois).length + Object.keys(adminDraft.pendingCircuits).length;
    btn.innerHTML = `<i data-lucide="layout-dashboard"></i> Centre de Contrôle ${total > 0 ? `<span style="background:var(--hw-amber);color:white;padding:2px 7px;border-radius:10px;font-size:0.7rem;margin-left:5px;">${total}</span>` : ''}`;
    createIcons({ icons, root: btn });
}

export async function openControlCenter() {
    const html = `
        <div class="admin-cc-container">
            <div class="admin-cc-header">
                <div class="header-top-row">
                    <div class="header-brand">
                        <span style="font-size:1.5rem;">🏰</span> History Walk <span style="font-weight:400; opacity:0.4; margin-left:5px;">| Admin</span>
                    </div>
                    <div class="header-user">
                        <span style="font-size:0.9rem;">Bonjour <strong>Admin</strong> 👋</span>
                        <div class="avatar-circle">AD</div>
                    </div>
                </div>
                <div class="admin-cc-tabs">
                    <div class="admin-cc-tab active" data-tab="dashboard"><i data-lucide="layout-grid" width="16"></i> Dashboard</div>
                    <div class="admin-cc-tab" data-tab="changes"><i data-lucide="list-checks" width="16"></i> Modifications</div>
                    <div class="admin-cc-tab" data-tab="settings"><i data-lucide="settings" width="16"></i> Config</div>
                </div>
            </div>

            <div class="admin-cc-scroll-area">
                <div id="admin-cc-content">
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:300px; color:var(--hw-ink-soft);">
                        <i data-lucide="loader-2" class="spin" style="width:48px; height:48px; margin-bottom:15px; color:var(--hw-amber);"></i>
                        <div style="font-weight:500;">Analyse des modifications en cours...</div>
                    </div>
                </div>
            </div>

            <div class="admin-cc-footer" id="admin-cc-footer-actions">
                <button class="custom-modal-btn secondary" onclick="document.getElementById('custom-modal-overlay').classList.remove('active')">Fermer</button>
                <button id="btn-cc-publish"><i data-lucide="rocket" width="18"></i> TOUT PUBLIER</button>
            </div>
        </div>
    `;

    showAlert("", html, null, 'admin-cc-mode');

    // Nettoyage des titres par défaut du modal
    const modal = document.querySelector('.custom-modal-box.admin-cc-mode');
    if(modal) {
        // Hide default title and actions if they exist (they should be hidden by CSS but explicit JS helps)
        const defaultTitle = document.getElementById('custom-modal-title');
        if (defaultTitle) defaultTitle.style.display = 'none';
        const defaultActions = document.getElementById('custom-modal-actions');
        if (defaultActions) defaultActions.style.display = 'none';
    }

    // Clean up when modal closes
    const overlay = document.getElementById('custom-modal-overlay');
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class' && !overlay.classList.contains('active')) {
                // Remove custom class when closed
                const modalContent = document.querySelector('.custom-modal-box');
                if (modalContent) modalContent.classList.remove('admin-cc-mode');
                const defaultTitle = document.getElementById('custom-modal-title');
                if (defaultTitle) defaultTitle.style.display = 'block';
                const defaultActions = document.getElementById('custom-modal-actions');
                if (defaultActions) defaultActions.style.display = 'flex';
                observer.disconnect();
            }
        });
    });
    observer.observe(overlay, { attributes: true });

    // Tab Logic
    const tabs = document.querySelectorAll('.admin-cc-tab');
    tabs.forEach(t => {
        t.onclick = () => {
            tabs.forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            renderTab(t.dataset.tab);
        };
    });

    const btnPublish = document.getElementById('btn-cc-publish');
    if(btnPublish) btnPublish.onclick = publishChanges;

    // Icons for initial load
    createIcons({ icons, root: document.querySelector('.admin-cc-header') });
    createIcons({ icons, root: document.querySelector('.admin-cc-footer') });

    reconcileLocalChanges();
    await prepareDiffData();
    renderTab('dashboard');
}

function reconcileLocalChanges() {
    let changed = false;

    // 1. Réconciliation des CRÉATIONS (Lieux ajoutés manuellement)
    if (state.customFeatures && state.customFeatures.length > 0) {
        state.customFeatures.forEach(f => {
            const id = getPoiId(f);
            if (!adminDraft.pendingPois[id]) {
                console.log(`[Admin] Réconciliation: Ajout non pisté détecté (Création) -> ${id}`);
                adminDraft.pendingPois[id] = { type: 'creation', timestamp: Date.now() };
                changed = true;
            }
        });
    }

    // 2. Réconciliation des MODIFICATIONS (via userData)
    if (state.userData) {
        Object.keys(state.userData).forEach(id => {
            const data = state.userData[id];

            // Si déjà pisté, on passe
            if (adminDraft.pendingPois[id]) return;

            // On filtre pour ne pas pister les simples visites/favoris
            // On cherche des modifications structurelles (lat, lng, _deleted, ou propriétés de contenu)
            const ignoredKeys = ['visited', 'hidden', 'notes', 'planifie'];
            const meaningfulKeys = Object.keys(data).filter(k => !ignoredKeys.includes(k));

            if (meaningfulKeys.length > 0) {
                 // Est-ce une création déjà gérée ?
                 const isCreation = state.customFeatures && state.customFeatures.some(f => getPoiId(f) === id);

                 if (!isCreation) {
                      const type = data._deleted ? 'delete' : 'update';
                      console.log(`[Admin] Réconciliation: Modif non pistée détectée (${type}) -> ${id}`);
                      adminDraft.pendingPois[id] = { type: type, timestamp: Date.now() };
                      changed = true;
                 }
            }
        });
    }

    if (changed) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(adminDraft));
        updateButtonBadge();
        showToast("Brouillon reconstruit depuis les données locales.", "info");
    }
}

let diffData = { pois: [], stats: { poisModified: 0, photosAdded: 0, circuitsModified: 0 } };

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

        // Cas spécial : Suppression
        if (adminDraft.pendingPois[id].type === 'delete') {
            diffData.pois.push({
                id: id,
                name: current ? getPoiName(current) : (original ? getPoiName(original) : 'Inconnu'),
                changes: [{ key: 'STATUT', old: 'Actif', new: 'SUPPRESSION' }],
                isDeletion: true
            });
            diffData.stats.poisModified++;
            return;
        }

        // Cas spécial : Création (Nouveau POI)
        if (!original && current && adminDraft.pendingPois[id].type === 'creation') {
             diffData.pois.push({
                id: id,
                name: getPoiName(current),
                changes: [{ key: 'STATUT', old: 'Inexistant', new: 'NOUVEAU' }],
                isCreation: true
            });
            diffData.stats.poisModified++;
            return;
        }

        // Cas spécial : Migration d'ID
        if (adminDraft.pendingPois[id].type === 'migration') {
            const oldId = adminDraft.pendingPois[id].oldId;
            diffData.pois.push({
                id: id,
                name: current ? getPoiName(current) : 'Lieu migré',
                changes: [{ key: 'IDENTIFIANT', old: oldId || 'Legacy', new: id }],
                isMigration: true
            });
            diffData.stats.poisModified++;
            return;
        }

        if (!current) return;

        const changes = [];

        // Geometry Check
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

        // Property Checks (Check ALL relevant keys since we don't track specifically anymore)
        // We prioritize userData if it exists
        const userData = current.properties.userData || {};
        const allKeys = new Set([...Object.keys(current.properties), ...Object.keys(userData)]);

        allKeys.forEach(key => {
            if (['lat', 'lng', 'userData', 'visited', 'hidden'].includes(key)) return;

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

            // Simple equality check
            if (String(oldVal) !== String(newVal) && !(oldVal === undefined && newVal === "")) {
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


function renderTab(tab) {
    const container = document.getElementById('admin-cc-content');
    if (!container) return;

    if (tab === 'dashboard') {
        const { poisModified, circuitsModified, photosAdded } = diffData.stats;
        const hasToken = !!getStoredToken();

        container.innerHTML = `
            <div class="dashboard-grid">
                <div class="stat-card">
                    <div class="stat-icon-box"><i data-lucide="map-pin"></i></div>
                    <div><div class="stat-val">${poisModified}</div><div class="stat-lab">Lieux Modifiés</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon-box"><i data-lucide="camera"></i></div>
                    <div><div class="stat-val">${photosAdded}</div><div class="stat-lab">Photos Ajoutées</div></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon-box"><i data-lucide="route"></i></div>
                    <div><div class="stat-val">${circuitsModified}</div><div class="stat-lab">Circuits Modifiés</div></div>
                </div>
            </div>

            ${!hasToken ? `
                <div style="background:#FEF2F2; border:1px solid #FCA5A5; color:#991B1B; padding:15px; border-radius:12px; margin-top:20px; display:flex; align-items:center; gap:15px;">
                    <i data-lucide="alert-triangle" style="flex-shrink:0;"></i>
                    <div>
                        <strong>Token GitHub manquant</strong>
                        <div style="font-size:0.85rem; opacity:0.8; margin-top:2px;">
                            L'envoi vers le serveur est impossible. Configurez votre clé d'accès dans l'onglet <strong>Config</strong>.
                        </div>
                    </div>
                </div>
            ` : ''}

            ${(poisModified + circuitsModified) === 0 ? `
                <div class="empty-state">
                    <i data-lucide="check-circle-2" width="64" height="64" style="color:#10B981; margin-bottom:15px;"></i>
                    <div style="font-weight:600;">Tout est synchronisé !</div>
                </div>
            ` : ''}
        `;
    } else if (tab === 'changes') {
        if (diffData.pois.length === 0) {
             container.innerHTML = `<div class="empty-state"><i data-lucide="check" width="48"></i><p>Aucune modification en attente.</p></div>`;
             createIcons({ icons, root: container });
             return;
        }

        const html = diffData.pois.map(item => {
            const isMigr = item.isMigration;
            const isDel = item.isDeletion;
            const isCre = item.isCreation;

            const rowStyle = isDel ? 'border:1px solid #FCA5A5; background:#FEF2F2;' :
                           (isCre ? 'border:1px solid #86EFAC; background:#F0FDF4;' :
                           (isMigr ? 'border:1px solid #BAE6FD; background:#F0F9FF;' : ''));

            const titleStyle = isDel ? 'color:#991B1B;' :
                             (isCre ? 'color:#166534;' :
                             (isMigr ? 'color:#0369A1;' : ''));

            const iconName = isDel ? 'trash-2' :
                           (isCre ? 'plus-circle' :
                           (isMigr ? 'refresh-cw' : 'map-pin'));

            const iconColor = isDel ? '#DC2626' :
                            (isCre ? '#16A34A' :
                            (isMigr ? '#0284C7' : 'var(--hw-amber)'));

            const statusLabel = isDel ? '(SUPPRESSION)' :
                              (isCre ? '(NOUVEAU)' :
                              (isMigr ? '(MIGRATION ID)' : ''));

            return `
                <div class="diff-entry" id="diff-card-${item.id}" style="${rowStyle}">
                    <div class="diff-header">
                        <div class="diff-title" style="${titleStyle}">
                            <i data-lucide="${iconName}" width="18" style="color:${iconColor};"></i>
                            ${item.name} ${statusLabel}
                        </div>
                        <div class="diff-actions">
                            <button class="btn-diff-action refuse" onclick="processDecision('${item.id}', 'refuse')">Refuser</button>
                            <button class="btn-diff-action validate" onclick="processDecision('${item.id}', 'accept')">Valider</button>
                        </div>
                    </div>
                    ${item.changes.map(c => `
                        <div style="margin-top:10px;">
                            <div style="font-size:0.75rem; font-weight:800; color:var(--hw-ink-soft); margin-bottom:5px; opacity:0.6;">
                                ${c.key ? c.key.toUpperCase() : 'PROPRIÉTÉ'}
                            </div>
                            <div class="diff-grid">
                                <div class="box old">
                                    <span class="box-label">AVANT</span>
                                    ${c.old !== undefined ? c.old : '-'}
                                </div>
                                <div class="box new">
                                    <span class="box-label">APRÈS</span>
                                    ${c.new !== undefined ? c.new : '-'}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }).join('');
        container.innerHTML = html;

    } else if (tab === 'settings') {
        const token = getStoredToken() || '';
        container.innerHTML = `
            <div style="max-width:600px; margin:0 auto; background:white; padding:30px; border-radius:20px; border:1px solid #E5E7EB;">
                <h3>Configuration GitHub</h3>
                <p style="color:var(--hw-ink-soft); font-size:0.9rem; margin-bottom:15px;">Personal Access Token (PAT) pour l'upload.</p>
                <input type="password" id="cc-token-input" value="${token}" class="settings-input" placeholder="ghp_...">
                <button id="btn-save-token" style="margin-top:15px; width:100%; padding:12px; background:var(--hw-ink); color:white; border:none; border-radius:10px; cursor:pointer;">Sauvegarder</button>
            </div>
        `;
        setTimeout(() => {
            const btn = document.getElementById('btn-save-token');
            if(btn) btn.onclick = () => {
                const val = document.getElementById('cc-token-input').value.trim();
                saveToken(val);
                showToast("Token sauvegardé !", "success");
            };
        }, 0);
    }

    createIcons({ icons, root: container });
}

// Logic for Diff Actions
window.processDecision = async (id, decision) => {
    if (decision === 'refuse') {
        if (adminDraft.pendingPois[id]) delete adminDraft.pendingPois[id];

        if (state.userData[id]) {
            delete state.userData[id];
            await saveAppState('userData', state.userData);
        }

        showToast("Modification refusée et annulée", "info");
    } else {
        showToast("Modification validée pour publication", "success");
        const card = document.getElementById(`diff-card-${id}`);
        if (card) {
            card.style.opacity = "0.5";
            card.style.pointerEvents = "none";
        }
        return;
    }

    localStorage.setItem(DRAFT_KEY, JSON.stringify(adminDraft));
    updateButtonBadge();
    await prepareDiffData();
    renderTab('changes');
};

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
        // Collect IDs to delete
        const idsToDelete = Object.keys(adminDraft.pendingPois).filter(id => adminDraft.pendingPois[id].type === 'delete');

        const geojson = generateMasterGeoJSONData(idsToDelete);
        if (!geojson) throw new Error("Erreur données GeoJSON");

        const mapId = state.currentMapId || 'djerba';
        const filename = `${mapId}.geojson`;
        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
        const file = new File([blob], filename, { type: 'application/geo+json' });

        await uploadFileToGitHub(file, token, 'Stefanmartin1967', 'History-Walk-V1', `public/${filename}`, `Update via Admin Center`);

        // --- NOUVEAU : Publication des Circuits si nécessaire ---
        const pendingCircuitsCount = Object.keys(adminDraft.pendingCircuits).length;
        if (pendingCircuitsCount > 0 && state.officialCircuits) {
            console.log(`[Admin] Publication de l'index des circuits (${pendingCircuitsCount} modifiés)...`);
            const circuitsFilename = state.destinations.maps[state.currentMapId]?.circuitsFile || `${state.currentMapId || 'djerba'}.json`;
            const circuitsPath = `public/circuits/${circuitsFilename}`;

            // On nettoie un peu les objets pour l'export (enlever les props circulaires ou UI)
            const circuitsData = state.officialCircuits.map(c => {
                const { ...cleanCircuit } = c;
                delete cleanCircuit.isLoaded;
                return cleanCircuit;
            });

            const circuitsBlob = new Blob([JSON.stringify(circuitsData, null, 2)], { type: 'application/json' });
            const circuitsFile = new File([circuitsBlob], circuitsFilename, { type: 'application/json' });

            await uploadFileToGitHub(circuitsFile, token, 'Stefanmartin1967', 'History-Walk-V1', circuitsPath, `Update circuits index via Admin Center`);
        }

        showToast("Publication réussie !", "success");
        adminDraft = { pendingPois: {}, pendingCircuits: {} };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(adminDraft));
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
            btn.innerHTML = `<i data-lucide="rocket"></i> TOUT PUBLIER`;
            createIcons({ icons, root: btn });
        }
    }
}

export function addToDraft(type, id, details) {
    if (type === 'poi') {
        adminDraft.pendingPois[id] = {
            ...(adminDraft.pendingPois[id] || {}),
            timestamp: Date.now(),
            ...details
        };
    }
    if (type === 'circuit') adminDraft.pendingCircuits[id] = { timestamp: Date.now() };

    localStorage.setItem(DRAFT_KEY, JSON.stringify(adminDraft));
    updateButtonBadge();
}

/**
 * Cherche si une migration est déjà enregistrée pour un ancien ID
 */
export function getMigrationId(oldId) {
    if (!oldId) return null;
    const entries = Object.entries(adminDraft.pendingPois);
    const found = entries.find(([newId, data]) => data.type === 'migration' && data.oldId === oldId);
    return found ? found[0] : null;
}
