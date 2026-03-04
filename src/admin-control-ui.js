import { state } from './state.js';
import { createIcons, icons } from 'lucide';
import { getStoredToken, saveToken } from './github-sync.js';
import { showToast } from './toast.js';
import { showAlert } from './modal.js';
import { renderMaintenanceTab } from './admin-maintenance.js';

// Ce fichier gère l'affichage (HTML, CSS, Interactions UI) du panneau d'administration

export function injectAdminStyles() {
    if (document.getElementById('admin-cc-styles')) return;

    const style = document.createElement('style');
    style.id = 'admin-cc-styles';
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

export function openControlCenterModal(diffData, callbacks) {
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
                <button class="custom-modal-btn secondary" data-action="close-modal">Fermer</button>
                <button id="btn-cc-publish" title="Tout publier" aria-label="Tout publier"><i data-lucide="rocket" width="18"></i> TOUT PUBLIER</button>
            </div>
        </div>
    `;

    showAlert("", html, null, 'admin-cc-mode');

    // Nettoyage des titres par défaut du modal
    const modal = document.querySelector('.custom-modal-box.admin-cc-mode');
    if(modal) {
        // Hide default title and actions if they exist
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
            renderTab(t.dataset.tab, diffData, callbacks);
        };
    });

    const btnPublish = document.getElementById('btn-cc-publish');
    if(btnPublish && callbacks.publishChanges) btnPublish.onclick = callbacks.publishChanges;

    // Event Delegation for Admin Control Center
    const container = document.getElementById('admin-cc-content');
    if (container) {
        container.addEventListener('click', (e) => {
            // Close modal
            if (e.target.closest('[data-action="close-modal"]')) {
                document.getElementById('custom-modal-overlay').classList.remove('active');
                return;
            }
            // Toggle Details
            const toggleBtn = e.target.closest('[data-action="toggle-details"]');
            if (toggleBtn) {
                const id = toggleBtn.dataset.id;
                if (callbacks.toggleDiffDetails) callbacks.toggleDiffDetails(id);
                return;
            }
            // Diff Actions (Accept/Refuse)
            const refuseBtn = e.target.closest('[data-action="refuse"]');
            if (refuseBtn) {
                const id = refuseBtn.dataset.id;
                if (callbacks.processDecision) callbacks.processDecision(id, 'refuse');
                return;
            }
            const acceptBtn = e.target.closest('[data-action="accept"]');
            if (acceptBtn) {
                const id = acceptBtn.dataset.id;
                if (callbacks.processDecision) callbacks.processDecision(id, 'accept');
                return;
            }
        });

        container.addEventListener('change', (e) => {
            // Update Draft Value
            if (e.target.matches('[data-action="update-draft"]')) {
                const id = e.target.dataset.id;
                const key = e.target.dataset.key;
                const value = e.target.value;
                if (callbacks.updateDraftValue) callbacks.updateDraftValue(id, key, value);
            }
        });
    }

    const footer = document.getElementById('admin-cc-footer-actions');
    if (footer) {
        footer.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="close-modal"]')) {
                document.getElementById('custom-modal-overlay').classList.remove('active');
            }
        });
    }

    // Icons for initial load
    createIcons({ icons, root: document.querySelector('.admin-cc-header') });
    createIcons({ icons, root: document.querySelector('.admin-cc-footer') });
}

export function renderTab(tab, diffData, callbacks) {
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
                    <div class="diff-summary-row" data-action="toggle-details" data-id="${item.id}">
                        <div class="diff-info">
                            <div class="diff-icon" style="color:${colorClass}; background:${colorClass}15;">
                                <i data-lucide="${item.isCreation ? 'plus' : (item.isDeletion ? 'trash-2' : 'edit-2')}"></i>
                            </div>
                            <div class="diff-text">
                                <h4>${item.name}</h4>
                                ${item.isCircuit ? `<div style="font-size:0.7rem; color:#94A3B8; font-family:monospace; margin-top:2px;">ID: ${item.id}</div>` : ''}
                                <p>${changeSummary}</p>
                            </div>
                        </div>
                        <button class="diff-toggle-btn" title="Voir les détails" aria-label="Voir les détails"><i data-lucide="chevron-down"></i></button>
                    </div>

                    <!-- DETAILS & EDIT (Hidden) -->
                    <div class="diff-details" id="diff-details-${item.id}">
                        ${renderDiffDetails(item)}

                        <div class="diff-actions-row">
                            <button class="btn-diff-action refuse" data-action="refuse" data-id="${item.id}">
                                <i data-lucide="x"></i> Ignorer
                            </button>
                            <button class="btn-diff-action validate" data-action="accept" data-id="${item.id}">
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
            if(btnUp && callbacks.uploadAdminData) btnUp.onclick = callbacks.uploadAdminData;

            const btnDown = document.getElementById('btn-sync-download');
            if(btnDown && callbacks.downloadAdminData) btnDown.onclick = callbacks.downloadAdminData;
        }, 0);
    } else if (tab === 'maintenance') {
        renderMaintenanceTab(container);
    }

    createIcons({ icons, root: container });
}

// --- RENDER DETAIL HELPER ---
export function renderDiffDetails(item) {
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
                   <input type="text" class="edit-input" id="${inputId}" value="${safeAttr(c.new)}" data-action="update-draft" data-id="${item.id}" data-key="Position">
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
                        <input type="text" class="edit-input" id="${inputId}" value="${safeAttr(c.new)}" data-action="update-draft" data-id="${item.id}" data-key="${logicalKey}">
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
