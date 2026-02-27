import { state } from './state.js';
import { getPoiId, getPoiName } from './data.js';
import { showAlert } from './modal.js';
import { createIcons, icons } from 'lucide';
import { generateMasterGeoJSONData } from './admin.js';
import { generateGPXString } from './gpx.js';
import { uploadFileToGitHub, getStoredToken, saveToken } from './github-sync.js';
import { showToast } from './toast.js';
import { saveAppState } from './database.js';
import { renderMaintenanceTab } from './admin-maintenance.js';

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
            height: 90vh !important;
            max-height: 900px !important;
            display: flex !important;
            flex-direction: column !important;
            position: relative !important;
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
            overflow: hidden; /* Force le scroll interne */
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
            padding: 20px 40px;
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

        /* DIFF LIST (Fusion Style) */
        .diff-list-container {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .diff-group-title {
            font-size: 1rem;
            font-weight: 800;
            margin-top: 30px;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--hw-ink);
        }

        .diff-list-item {
            background: white;
            border: 1px solid #E5E7EB;
            border-radius: 16px;
            padding: 16px 20px;
            display: flex;
            flex-direction: column;
            gap: 15px;
            transition: all 0.2s;
        }
        .diff-list-item:hover { border-color: var(--hw-amber); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }

        /* HEADER ROW (Toujours visible) */
        .diff-summary-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
        }

        .diff-info { display: flex; align-items: center; gap: 15px; }
        .diff-icon {
            width: 40px; height: 40px;
            border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            background: #F1F5F9; color: #64748B;
        }
        .diff-text h4 { margin: 0; font-size: 1rem; font-weight: 700; color: var(--hw-ink); }
        .diff-text p { margin: 4px 0 0 0; font-size: 0.85rem; color: var(--hw-ink-soft); opacity: 0.7; }

        .diff-toggle-btn {
            background: transparent; border: none; cursor: pointer; color: #94A3B8; transition: 0.2s;
        }
        .diff-toggle-btn:hover { color: var(--hw-ink); }

        /* DETAIL SECTION (Masqué par défaut) */
        .diff-details {
            display: none; /* JS toggle */
            padding-top: 15px;
            border-top: 1px solid #F1F5F9;
            margin-top: 5px;
        }
        .diff-details.open { display: block; animation: slideDown 0.2s ease-out; }

        @keyframes slideDown { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }

        .diff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 10px; }
        .box { padding: 12px; border-radius: 8px; font-size: 0.85rem; font-family: monospace; word-break: break-all; position: relative; }
        .box-label { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; display: block; margin-bottom: 5px; opacity: 0.6; }

        .box.old { background: #FEF2F2; color: #991B1B; border: 1px solid rgba(153, 27, 27, 0.1); }
        .box.new { background: #F0FDF4; color: #166534; border: 1px solid rgba(22, 101, 52, 0.1); }

        /* ÉDITION RAPIDE */
        .edit-row { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }
        .edit-input {
            flex: 1; padding: 8px 12px; border: 1px solid #CBD5E1; border-radius: 8px; font-size: 0.9rem;
        }
        .edit-input:focus { outline: 2px solid var(--hw-amber); border-color: transparent; }

        .diff-actions-row {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 20px;
        }
        .btn-diff-action { padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 700; cursor: pointer; border: none; display: flex; align-items: center; gap: 6px; }
        .btn-diff-action.refuse { background: white; border: 1px solid #E2E8F0; color: #64748B; }
        .btn-diff-action.refuse:hover { background: #FEF2F2; color: #991B1B; border-color: #FECACA; }
        .btn-diff-action.validate { background: var(--hw-amber); color: white; }
        .btn-diff-action.validate:hover { filter: brightness(1.1); transform: translateY(-1px); }

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
                    <div class="admin-cc-tab" data-tab="maintenance"><i data-lucide="server" width="16"></i> Nettoyage</div>
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
            const ignoredKeys = ['visited', 'hidden', 'notes', 'planifie', 'planifieCounter'];
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

let diffData = { pois: [], circuits: [], stats: { poisModified: 0, photosAdded: 0, circuitsModified: 0 } };

async function prepareDiffData() {
    let originalFeatures = [];
    let remoteCircuits = [];
    const timestamp = Date.now();
    const mapId = state.currentMapId || 'djerba';

    // 1. Fetch Remote Data (POIs + Circuits)
    try {
        const [respGeo, respCirc] = await Promise.all([
            fetch(`https://raw.githubusercontent.com/Stefanmartin1967/History-Walk-V1/main/public/${mapId}.geojson?t=${timestamp}`),
            fetch(`https://raw.githubusercontent.com/Stefanmartin1967/History-Walk-V1/main/public/circuits/${mapId}.json?t=${timestamp}`)
        ]);

        if (respGeo.ok) {
            const json = await respGeo.json();
            originalFeatures = json.features;
        }
        if (respCirc.ok) {
            remoteCircuits = await respCirc.json();
        }
    } catch (e) {
        console.error("Erreur fetch original data", e);
    }

    diffData.pois = [];
    diffData.circuits = [];
    diffData.stats = { poisModified: 0, photosAdded: 0, circuitsModified: 0 };

    // --- A. ANALYSE DES POIS (Via adminDraft + Comparaison directe) ---
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

        const userData = current.properties.userData || {};
        const changes = [];

        // Geometry Check
        // On vérifie toujours la position, même si c'est un POI "existant" mais sans correspondance directe "original"
        // (cas rare, mais possible si ID migré ou autre)
        // Mais surtout on doit vérifier state.userData.lat/lng
        const userLat = userData.lat;
        const userLng = userData.lng;

        if (userLat !== undefined && userLng !== undefined) {
             // Il y a une surcharge explicite de position
             const oldPos = original ? `${original.geometry.coordinates[1].toFixed(5)}, ${original.geometry.coordinates[0].toFixed(5)}` : 'Inconnu';
             changes.push({
                key: 'Position',
                old: oldPos,
                new: `${parseFloat(userLat).toFixed(5)}, ${parseFloat(userLng).toFixed(5)}`
             });
        } else if (original) {
            // Fallback: check geometry object difference
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
        const allKeys = new Set([...Object.keys(current.properties), ...Object.keys(userData)]);

        allKeys.forEach(key => {
            if (['lat', 'lng', 'userData', 'visited', 'hidden', 'planifieCounter'].includes(key)) return;

            let oldVal = original ? original.properties[key] : undefined;
            let newVal = userData[key] !== undefined ? userData[key] : current.properties[key];

            // --- USER FRIENDLY LABELS ---
            let displayKey = key;
            if (key === 'timeH') displayKey = 'Heures (Durée)';
            if (key === 'timeM') displayKey = 'Minutes (Durée)';
            if (key === 'price') displayKey = 'Prix (TND)';
            if (key === 'description') displayKey = 'Description';

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
                    key: displayKey, // Use friendly name
                    rawKey: key,     // Keep raw key for editing logic
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

    // --- B. ANALYSE DES CIRCUITS (Comparaison State vs Remote) ---
    // On combine les Officiels et les Personnels (qui sont des candidats potentiels à l'officialisation)
    const localCircuits = [...(state.officialCircuits || []), ...(state.myCircuits || [])];

    // 1. Nouveaux & Modifiés
    localCircuits.forEach(local => {
        // On normalise l'ID (parfois string vs number)
        const remote = remoteCircuits.find(r => String(r.id) === String(local.id));

        if (!remote) {
            // Cas : Nouveau Circuit
            diffData.circuits.push({
                id: local.id,
                name: local.name,
                changes: [{ key: 'STATUT', old: 'Inexistant', new: 'NOUVEAU' }],
                isCreation: true
            });
        } else {
            // Cas : Modification potentielle
            const changes = [];

            // Comparaison simple des champs clés
            if (local.name !== remote.name) changes.push({ key: 'Nom', old: remote.name, new: local.name });
            if ((local.description || '') !== (remote.description || '')) {
                // On ignore les diffs vides vs null/undefined
                if(local.description || remote.description) {
                     changes.push({ key: 'Description', old: '...', new: '...' }); // Simplifié pour l'affichage
                }
            }

            // Comparaison des étapes (Ordre et Contenu)
            const localIds = (local.poiIds || []).join(',');
            const remoteIds = (remote.poiIds || []).join(',');

            if (localIds !== remoteIds) {
                changes.push({
                    key: 'Étapes',
                    old: `${(remote.poiIds || []).length} étapes`,
                    new: `${(local.poiIds || []).length} étapes`
                });
            }

            if (changes.length > 0) {
                diffData.circuits.push({
                    id: local.id,
                    name: local.name,
                    changes: changes
                });
            }
        }
    });

    // 2. Supprimés
    remoteCircuits.forEach(remote => {
        if (!localCircuits.find(l => String(l.id) === String(remote.id))) {
            diffData.circuits.push({
                id: remote.id,
                name: remote.name,
                changes: [{ key: 'STATUT', old: 'Actif', new: 'SUPPRESSION' }],
                isDeletion: true
            });
        }
    });

    diffData.stats.circuitsModified = diffData.circuits.length;
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
        if (diffData.pois.length === 0 && diffData.circuits.length === 0) {
             container.innerHTML = `<div class="empty-state"><i data-lucide="check" width="48"></i><p>Aucune modification en attente.</p></div>`;
             createIcons({ icons, root: container });
             return;
        }

        // --- GROUPAGE DES MODIFICATIONS ---
        const groups = {
            new: diffData.pois.filter(p => p.isCreation),
            mod: diffData.pois.filter(p => !p.isCreation && !p.isDeletion && !p.isMigration),
            del: diffData.pois.filter(p => p.isDeletion),
            mig: diffData.pois.filter(p => p.isMigration),

            // Circuits
            cNew: diffData.circuits.filter(c => c.isCreation),
            cMod: diffData.circuits.filter(c => !c.isCreation && !c.isDeletion),
            cDel: diffData.circuits.filter(c => c.isDeletion)
        };

        // Marquage des items circuits pour le renderer
        [groups.cNew, groups.cMod, groups.cDel].forEach(arr => arr.forEach(i => i.isCircuit = true));

        let html = `<div class="diff-list-container">`;

        // Helper Render Function
        const renderGroup = (title, items, icon, colorClass) => {
            if (items.length === 0) return '';

            let groupHtml = `<div class="diff-group-title"><i data-lucide="${icon}" style="color:${colorClass}"></i> ${title} <span style="background:#F1F5F9; padding:2px 8px; border-radius:10px; font-size:0.8rem;">${items.length}</span></div>`;

            groupHtml += items.map(item => {
                const changeCount = item.changes.length;
                const changeSummary = item.isCreation ? (item.isCircuit ? "Circuit créé" : "Lieu créé") :
                                      (item.isDeletion ? "Suppression demandée" :
                                      `${changeCount} modification${changeCount > 1 ? 's' : ''} (${item.changes.map(c => c.key).join(', ')})`);

                return `
                <div class="diff-list-item" id="diff-card-${item.id}">
                    <!-- HEADER SUMMARY -->
                    <div class="diff-summary-row" onclick="toggleDiffDetails('${item.id}')">
                        <div class="diff-info">
                            <div class="diff-icon" style="color:${colorClass}; background:${colorClass}15;">
                                <i data-lucide="${item.isCreation ? 'plus' : (item.isDeletion ? 'trash-2' : 'edit-2')}"></i>
                            </div>
                            <div class="diff-text">
                                <h4>${item.name}</h4>
                                <p>${changeSummary}</p>
                            </div>
                        </div>
                        <button class="diff-toggle-btn"><i data-lucide="chevron-down"></i></button>
                    </div>

                    <!-- DETAILS & EDIT (Hidden) -->
                    <div class="diff-details" id="diff-details-${item.id}">
                        ${renderDiffDetails(item)}

                        <div class="diff-actions-row">
                            <button class="btn-diff-action refuse" onclick="processDecision('${item.id}', 'refuse')">
                                <i data-lucide="x"></i> Ignorer
                            </button>
                            <button class="btn-diff-action validate" onclick="processDecision('${item.id}', 'accept')">
                                <i data-lucide="check"></i> Valider
                            </button>
                        </div>
                    </div>
                </div>
                `;
            }).join('');
            return groupHtml;
        };

        html += renderGroup("Nouveaux Lieux", groups.new, "plus-circle", "#16A34A"); // Green
        html += renderGroup("Modifications Lieux", groups.mod, "pencil", "#D97706"); // Amber
        html += renderGroup("Suppressions Lieux", groups.del, "trash-2", "#DC2626"); // Red
        html += renderGroup("Migrations Techniques", groups.mig, "refresh-cw", "#0284C7"); // Blue

        // Circuits
        if (groups.cNew.length > 0 || groups.cMod.length > 0 || groups.cDel.length > 0) {
            html += `<div style="margin: 30px 0 10px 0; padding-bottom:10px; border-bottom:1px solid #E2E8F0; font-weight:800; color:#64748B; text-transform:uppercase; letter-spacing:1px; font-size:0.8rem;">Circuits</div>`;
            html += renderGroup("Nouveaux Circuits", groups.cNew, "map", "#16A34A");
            html += renderGroup("Circuits Modifiés", groups.cMod, "route", "#D97706");
            html += renderGroup("Circuits Supprimés", groups.cDel, "trash-2", "#DC2626");
        }

        html += `</div>`;
        container.innerHTML = html;

    } else if (tab === 'settings') {
        const token = getStoredToken() || '';
        container.innerHTML = `
            <div style="max-width:600px; margin:0 auto; display:flex; flex-direction:column; gap:20px;">
                <!-- GITHUB TOKEN -->
                <div style="background:white; padding:30px; border-radius:20px; border:1px solid #E5E7EB;">
                    <h3 style="margin-top:0;">Configuration GitHub</h3>
                    <p style="color:var(--hw-ink-soft); font-size:0.9rem; margin-bottom:15px;">Personal Access Token (PAT) pour l'upload.</p>
                    <input type="password" id="cc-token-input" value="${token}" class="settings-input" placeholder="ghp_...">
                    <button id="btn-save-token" style="margin-top:15px; width:100%; padding:12px; background:var(--hw-ink); color:white; border:none; border-radius:10px; cursor:pointer; font-weight:600;">Sauvegarder Token</button>
                </div>

                <!-- SYNC PERSO -->
                <div style="background:white; padding:30px; border-radius:20px; border:1px solid #E5E7EB;">
                    <h3 style="margin-top:0; display:flex; align-items:center; gap:10px;">
                        <i data-lucide="cloud-cog" style="color:var(--hw-amber);"></i> Synchronisation Personnelle
                    </h3>
                    <p style="color:var(--hw-ink-soft); font-size:0.9rem; margin-bottom:20px;">
                        Sauvegardez votre avancement (Circuits Faits, Lieux visités) sur le repo GitHub pour le retrouver sur vos autres appareils Admin.
                    </p>

                    <div style="display:flex; gap:10px; margin-bottom:15px;">
                        <button id="btn-sync-upload" style="flex:1; padding:12px; background:#F0FDF4; border:1px solid #86EFAC; color:#166534; border-radius:10px; cursor:pointer; font-weight:600; display:flex; align-items:center; justify-content:center; gap:8px;">
                            <i data-lucide="upload-cloud"></i> Sauvegarder (Upload)
                        </button>
                        <button id="btn-sync-download" style="flex:1; padding:12px; background:#EFF6FF; border:1px solid #93C5FD; color:#1E40AF; border-radius:10px; cursor:pointer; font-weight:600; display:flex; align-items:center; justify-content:center; gap:8px;">
                            <i data-lucide="download-cloud"></i> Récupérer (Download)
                        </button>
                    </div>

                    <div id="sync-last-update" style="font-size:0.8rem; color:#94A3B8; text-align:center;">
                        Fichier cible : public/admin/personal_data.json
                    </div>
                </div>
            </div>
        `;

        setTimeout(() => {
            const btnSave = document.getElementById('btn-save-token');
            if(btnSave) btnSave.onclick = () => {
                const val = document.getElementById('cc-token-input').value.trim();
                saveToken(val);
                showToast("Token sauvegardé !", "success");
            };

            const btnUp = document.getElementById('btn-sync-upload');
            if(btnUp) btnUp.onclick = uploadAdminData;

            const btnDown = document.getElementById('btn-sync-download');
            if(btnDown) btnDown.onclick = downloadAdminData;
        }, 0);
    } else if (tab === 'maintenance') {
        renderMaintenanceTab(container);
    }

    createIcons({ icons, root: container });
}

async function uploadAdminData() {
    const token = getStoredToken();
    if (!token) {
        showToast("Token manquant. Configurez-le d'abord.", "error");
        return;
    }

    const btn = document.getElementById('btn-sync-upload');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Envoi...`;
        createIcons({ icons, root: btn });
    }

    try {
        const data = {
            lastUpdated: new Date().toISOString(),
            officialCircuitsStatus: state.officialCircuitsStatus || {},
            userData: state.userData || {},
            hiddenPoiIds: state.hiddenPoiIds || []
        };

        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const file = new File([blob], 'personal_data.json', { type: 'application/json' });

        await uploadFileToGitHub(
            file,
            token,
            'Stefanmartin1967',
            'History-Walk-V1',
            'public/admin/personal_data.json',
            'Update Admin Personal Data'
        );

        showToast("Données sauvegardées sur le serveur !", "success");
        // Update UI timestamp
        const timeEl = document.getElementById('sync-last-update');
        if (timeEl) timeEl.textContent = `Dernier envoi : À l'instant`;

    } catch (e) {
        console.error(e);
        showToast("Erreur lors de l'envoi : " + e.message, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="upload-cloud"></i> Sauvegarder (Upload)`;
            createIcons({ icons, root: btn });
        }
    }
}

async function downloadAdminData() {
    const btn = document.getElementById('btn-sync-download');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Récupération...`;
        createIcons({ icons, root: btn });
    }

    try {
        const timestamp = Date.now();
        // Use raw.githubusercontent.com to avoid caching issues
        const url = `https://raw.githubusercontent.com/Stefanmartin1967/History-Walk-V1/main/public/admin/personal_data.json?t=${timestamp}`;

        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) throw new Error("Aucune sauvegarde trouvée sur le serveur.");
            throw new Error("Erreur réseau : " + response.status);
        }

        const data = await response.json();

        // MERGE STRATEGY: Server Wins for status, Merge for objects
        if (data.officialCircuitsStatus) {
            state.officialCircuitsStatus = { ...state.officialCircuitsStatus, ...data.officialCircuitsStatus };
            await saveAppState(`official_circuits_status_${state.currentMapId || 'djerba'}`, state.officialCircuitsStatus);
        }

        if (data.userData) {
            state.userData = { ...state.userData, ...data.userData };
            await saveAppState('userData', state.userData);
        }

        if (data.hiddenPoiIds) {
             const newHidden = new Set([...(state.hiddenPoiIds || []), ...data.hiddenPoiIds]);
             state.hiddenPoiIds = Array.from(newHidden);
             await saveAppState(`hiddenPois_${state.currentMapId || 'djerba'}`, state.hiddenPoiIds);
        }

        showToast("Données récupérées et fusionnées !", "success");
        setTimeout(() => window.location.reload(), 1500);

    } catch (e) {
        console.error(e);
        showToast("Erreur : " + e.message, "error");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="download-cloud"></i> Récupérer (Download)`;
            createIcons({ icons, root: btn });
        }
    }
}

// --- RENDER DETAIL HELPER ---
function renderDiffDetails(item) {
    // Si c'est une suppression, on n'a pas besoin d'édition
    if (item.isDeletion) {
        return `<div style="padding:15px; background:#FEF2F2; color:#991B1B; border-radius:8px; font-size:0.9rem;">
            ⚠️ Ce lieu sera définitivement supprimé de la carte officielle.
        </div>`;
    }

    // Helper to escape HTML attributes safely
    const safeAttr = (str) => {
        if (typeof str !== 'string') return str;
        return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    return item.changes.map(c => {
        const isPos = (c.key === 'Position');
        const isPhoto = (c.key === 'Photos');
        // Use rawKey if available (for logic), fallback to display key (for display)
        const logicalKey = c.rawKey || c.key;
        const inputId = `edit-${item.id}-${logicalKey}`;

        // Contenu éditable ou lecture seule
        let editorHtml = '';

        if (isPos) {
            // Pour la position, on affiche un lien Google Maps et un input manuel
            // c.new format attendu : "lat, lng" (string)
            const coords = c.new.split(',').map(s => s.trim());
            const mapsLink = `https://www.google.com/maps/search/?api=1&query=${coords[0]},${coords[1]}`;

            editorHtml = `
                <div class="edit-row">
                    <a href="${mapsLink}" target="_blank" style="color:#2563EB; font-weight:600; font-size:0.85rem; display:flex; align-items:center; gap:5px; text-decoration:none;">
                        <i data-lucide="map"></i> Voir sur G.Maps
                    </a>
                </div>
                <div class="edit-row">
                   <span style="font-size:0.8rem; font-weight:bold; width:60px;">Lat,Lng</span>
                   <input type="text" class="edit-input" id="${inputId}" value="${safeAttr(c.new)}" onchange="updateDraftValue('${item.id}', 'Position', this.value)">
                </div>
            `;
        } else if (!isPhoto) {
            // --- PROTECTION HW_ID (READ-ONLY) ---
            if (item.isCircuit) {
                // Circuits : Read Only (car pas de userData pour stocker les modifs admin)
                editorHtml = `
                    <div class="edit-row">
                        <span style="font-size:0.85rem; color:#64748B; font-style:italic;">Modification via l'éditeur de circuit</span>
                    </div>
                `;
            } else if (logicalKey === 'HW_ID') {
                editorHtml = `
                    <div class="edit-row">
                         <input type="text" class="edit-input" value="${safeAttr(c.new)}" disabled style="background:#F1F5F9; color:#64748B; cursor:not-allowed;">
                    </div>
                    <div style="font-size:0.75rem; color:#EF4444; margin-top:-5px; margin-bottom:10px;">
                        <i data-lucide="lock" width="12" style="display:inline; vertical-align:middle;"></i>
                        Identifiant système (Non modifiable)
                    </div>
                `;
            } else {
                // Champ texte standard (Nom, Description, etc.)
                editorHtml = `
                    <div class="edit-row">
                        <input type="text" class="edit-input" id="${inputId}" value="${safeAttr(c.new)}" onchange="updateDraftValue('${item.id}', '${logicalKey}', this.value)">
                    </div>
                `;
            }
        }

        return `
            <div style="margin-top:15px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <div style="font-size:0.75rem; font-weight:800; color:var(--hw-ink-soft); opacity:0.6;">
                        ${c.key ? c.key.toUpperCase() : 'PROPRIÉTÉ'}
                    </div>
                </div>

                <div class="diff-grid" style="margin-bottom:10px;">
                    <div class="box old">
                        <span class="box-label">AVANT</span>
                        ${c.old !== undefined ? c.old : '-'}
                    </div>
                    ${!isPos && isPhoto ? `
                    <div class="box new">
                        <span class="box-label">APRÈS</span>
                        ${c.new}
                    </div>` : ''}
                </div>

                ${editorHtml}
            </div>
        `;
    }).join('');
}

// --- GLOBAL ACTIONS ---

window.toggleDiffDetails = (id) => {
    const el = document.getElementById(`diff-details-${id}`);
    if (el) {
        const isOpen = el.classList.contains('open');
        el.classList.toggle('open');
        // Rotate chevron (optional polish)
    }
};

window.updateDraftValue = async (id, key, value) => {
    // Cette fonction met à jour directement userData (la source de vérité locale)
    // Cela permet de "corriger" la modification avant validation
    console.log(`[Admin] Correction user: ${id} [${key}] = ${value}`);

    if (!state.userData[id]) state.userData[id] = {};

    if (key === 'Position') {
        const parts = value.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            state.userData[id].lat = parts[0];
            state.userData[id].lng = parts[1];
        }
    } else {
        state.userData[id][key] = value;
    }

    await saveAppState('userData', state.userData);
    showToast("Correction enregistrée localement", "info");

    // On ne re-render pas tout de suite pour ne pas perdre le focus,
    // mais la prochaine validation prendra cette valeur.
};

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
        // Visuel : griser la ligne
        const card = document.getElementById(`diff-card-${id}`);
        if (card) {
            card.style.opacity = "0.5";
            card.style.pointerEvents = "none";
            // Checkmark icon update
            const icon = card.querySelector('.diff-icon');
            if(icon) {
                icon.innerHTML = `<i data-lucide="check-circle-2"></i>`;
                icon.style.background = "#DCFCE7";
                icon.style.color = "#16A34A";
                createIcons({ icons, root: icon });
            }
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
        // On vérifie s'il y a des changements détectés (via Diff) OU des changements pistés (via Draft)
        const hasCircuitChanges = (diffData.circuits && diffData.circuits.length > 0) || (Object.keys(adminDraft.pendingCircuits).length > 0);

        // On combine pour inclure aussi les circuits locaux nouvellement créés
        const allCircuits = [...(state.officialCircuits || []), ...(state.myCircuits || [])];

        if (hasCircuitChanges && allCircuits.length > 0) {
            console.log(`[Admin] Publication de l'index des circuits (Changements détectés)...`);
            const circuitsFilename = state.destinations.maps[state.currentMapId]?.circuitsFile || `${state.currentMapId || 'djerba'}.json`;
            const circuitsPath = `public/circuits/${circuitsFilename}`;

            // On nettoie un peu les objets pour l'export (enlever les props circulaires ou UI)
            const circuitsData = allCircuits.map(c => {
                const { ...cleanCircuit } = c;
                delete cleanCircuit.isLoaded;
                delete cleanCircuit.isOfficial; // On nettoie le flag "isOfficial" local
                // On s'assure que 'isCompleted' est aussi nettoyé si besoin, ou on le garde ?
                // Généralement on publie le modèle, pas l'état utilisateur.
                delete cleanCircuit.isCompleted;
                delete cleanCircuit.isDeleted;
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

export function getAdminDraft() {
    return adminDraft;
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
