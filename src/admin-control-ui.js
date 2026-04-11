import { state } from './state.js';
import { createIcons, icons } from 'lucide';
import { getStoredToken, saveToken, uploadFileToGitHub } from './github-sync.js';
import { pullFromGist, injectSyncIndicator } from './gist-sync.js';
import { showToast } from './toast.js';
import { showAlert } from './modal.js';
import { renderMaintenanceTab } from './admin-maintenance.js';

const GITHUB_OWNER = 'Stefanmartin1967';
const GITHUB_REPO  = 'History-Walk-V1';

// Ce fichier gère l'affichage (HTML, CSS, Interactions UI) du panneau d'administration

export function injectAdminStyles() {
    // Styles moved to style.css
}

export function openControlCenterModal(diffData, callbacks) {
    const html = `
        <div class="admin-cc-container">
            <div class="admin-cc-header">
                <div class="header-top-row">
                    <div class="header-brand">
                        <span class="brand-castle">🏰</span> History Walk <span class="brand-subtitle">| Admin</span>
                    </div>
                    <div class="header-user">
                        <span class="header-greeting">Bonjour <strong>Admin</strong> 👋</span>
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
                    <div class="cc-loading-state">
                        <i data-lucide="loader-2" class="spin cc-loading-icon"></i>
                        <div class="cc-loading-label">Analyse des modifications en cours...</div>
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

        const isSynced = (poisModified + circuitsModified) === 0;
        container.innerHTML = `
            <div class="cc-quick-actions">
                <div class="cc-quick-actions-title"><i data-lucide="zap"></i> Actions Rapides</div>
                <div class="cc-quick-actions-grid">
                    <button class="cc-quick-btn" id="btn-cc-upload-circuit">
                        <i data-lucide="upload-cloud"></i>
                        <span>Ajouter un circuit</span>
                        <small>Upload GPX / JSON</small>
                    </button>
                    <button class="cc-quick-btn" id="btn-cc-goto-maintenance">
                        <i data-lucide="server-cog"></i>
                        <span>Nettoyage serveur</span>
                        <small>Doublons et suppressions</small>
                    </button>
                    <button class="cc-quick-btn" id="btn-cc-goto-config">
                        <i data-lucide="key-round"></i>
                        <span>Configuration</span>
                        <small>Token GitHub · Gist</small>
                    </button>
                </div>
            </div>

            <div class="cc-status-row">
                ${isSynced
                    ? `<div class="cc-status-badge synced"><i data-lucide="check-circle-2"></i> Tout est synchronisé</div>`
                    : `<div class="cc-status-badge pending"><i data-lucide="clock"></i> Modifications en attente</div>`
                }
                ${!hasToken ? `<div class="cc-status-badge no-token"><i data-lucide="alert-triangle"></i> Token manquant — <button class="cc-inline-link" id="btn-cc-goto-config2">Config</button></div>` : ''}
            </div>

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

            <div class="cc-sysinfo">
                <div class="cc-sysinfo-title"><i data-lucide="info"></i> Informations</div>
                <div class="cc-sysinfo-grid">
                    <div class="cc-sysinfo-item">
                        <span class="cc-sysinfo-label">Dépôt GitHub</span>
                        <a class="cc-sysinfo-val cc-repo-link" href="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}" target="_blank">
                            <i data-lucide="github"></i> ${GITHUB_OWNER}/${GITHUB_REPO}
                        </a>
                    </div>
                    <div class="cc-sysinfo-item">
                        <span class="cc-sysinfo-label">Token</span>
                        <span class="cc-sysinfo-val ${hasToken ? 'cc-token-ok' : 'cc-token-missing'}">
                            <i data-lucide="${hasToken ? 'shield-check' : 'shield-x'}"></i>
                            ${hasToken ? 'Configuré' : 'Non configuré'}
                        </span>
                    </div>
                    <div class="cc-sysinfo-item">
                        <span class="cc-sysinfo-label">Source de vérité</span>
                        <span class="cc-sysinfo-val">public/djerba.geojson</span>
                    </div>
                    <div class="cc-sysinfo-item">
                        <span class="cc-sysinfo-label">Dernière session</span>
                        <span class="cc-sysinfo-val">${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                    </div>
                </div>
            </div>
        `;

        setTimeout(() => {
            const btnUpload = document.getElementById('btn-cc-upload-circuit');
            if (btnUpload) btnUpload.onclick = () => renderUploadCircuitPanel(diffData, callbacks);

            const btnMaint = document.getElementById('btn-cc-goto-maintenance');
            if (btnMaint) btnMaint.onclick = () => {
                document.querySelector('.admin-cc-tab[data-tab="maintenance"]')?.click();
            };

            const goSettings = () => document.querySelector('.admin-cc-tab[data-tab="settings"]')?.click();
            const btnConf = document.getElementById('btn-cc-goto-config');
            if (btnConf) btnConf.onclick = goSettings;
            const btnConf2 = document.getElementById('btn-cc-goto-config2');
            if (btnConf2) btnConf2.onclick = goSettings;
        }, 0);
    } else if (tab === 'changes') {
        if (diffData.pois.length === 0 && diffData.circuits.length === 0) {
            container.innerHTML = `<div class="empty-state"><i data-lucide="check" width="48"></i><p>Aucune modification en attente.</p></div>`;
            createIcons({ icons, root: container });
            return;
        }

        const groups = {
            new: diffData.pois.filter(p => p.isCreation),
            mod: diffData.pois.filter(p => !p.isCreation && !p.isDeletion && !p.isMigration),
            del: diffData.pois.filter(p => p.isDeletion),
            mig: diffData.pois.filter(p => p.isMigration),
            cNew: diffData.circuits.filter(c => c.isCreation),
            cMod: diffData.circuits.filter(c => !c.isCreation && !c.isDeletion),
            cDel: diffData.circuits.filter(c => c.isDeletion)
        };

        const renderGroup = (title, items, badgeClass, icon) => {
            if (items.length === 0) return '';

            let html = `<div class="cc-diff-group-title">
                <i data-lucide="${icon}"></i> ${title}
                <span class="cc-diff-badge ${badgeClass}">${items.length}</span>
            </div>`;

            html += items.map(item => {
                const diffRows = item.isDeletion
                    ? `<div class="cc-change-detail cc-del-warning"><i data-lucide="alert-triangle"></i> Sera supprimé de la carte officielle</div>`
                    : item.isCreation && item.changes.length === 0
                        ? `<div class="cc-change-detail cc-new-hint"><i data-lucide="sparkles"></i> Nouveau lieu — aucun champ antérieur</div>`
                        : item.changes.map(c => `
                            <div class="cc-change-detail">
                                <span class="cc-change-key">${c.key}</span>
                                <span class="cc-old-val">${c.old !== undefined ? c.old : '—'}</span>
                                <span class="cc-change-arrow">➜</span>
                                <span class="cc-new-val">${c.new}</span>
                            </div>`).join('');

                return `
                <div class="cc-change-item" id="cc-diff-item-${item.id}">
                    <div class="cc-change-item-header">
                        <label class="cc-change-check" title="Inclure dans la prochaine publication">
                            <input type="checkbox" checked data-id="${item.id}">
                        </label>
                        <span class="cc-change-name">${item.name}</span>
                        <button class="cc-btn-ignore" data-action="refuse" data-id="${item.id}" title="Ignorer — effacer cette modification locale">
                            <i data-lucide="${item.isDeletion ? 'rotate-ccw' : 'x'}"></i>
                            <span>${item.isDeletion ? 'Restaurer' : 'Ignorer'}</span>
                        </button>
                    </div>
                    <div class="cc-change-diffs">${diffRows}</div>
                </div>`;
            }).join('');

            return html;
        };

        let html = `<div class="cc-diff-container">`;
        html += renderGroup('Nouveaux Lieux', groups.new, 'cc-badge-new', 'plus-circle');
        html += renderGroup('Modifications', groups.mod, 'cc-badge-mod', 'pencil');
        html += renderGroup('Suppressions', groups.del, 'cc-badge-del', 'trash-2');
        html += renderGroup('Migrations', groups.mig, 'cc-badge-mig', 'refresh-cw');

        if (groups.cNew.length || groups.cMod.length || groups.cDel.length) {
            html += `<div class="cc-diff-section-sep">Circuits</div>`;
            html += renderGroup('Nouveaux Circuits', groups.cNew, 'cc-badge-new', 'map');
            html += renderGroup('Circuits Modifiés', groups.cMod, 'cc-badge-mod', 'route');
            html += renderGroup('Circuits Supprimés', groups.cDel, 'cc-badge-del', 'trash-2');
        }

        html += `</div>`;
        container.innerHTML = html;

    } else if (tab === 'settings') {
        const token = getStoredToken() || '';
        container.innerHTML = `
            <div class="cc-settings-layout">
                <!-- GITHUB TOKEN -->
                <div class="cc-card">
                    <h3>Configuration GitHub</h3>
                    <p style="color:var(--hw-ink-soft); font-size:0.9rem; margin-bottom:15px;">Personal Access Token (PAT) pour l'upload. Stocké en localStorage.</p>
                    <input type="password" id="cc-token-input" value="${token}" class="settings-input" placeholder="ghp_...">
                    <p style="color:var(--hw-ink-soft); font-size:0.9rem; margin:15px 0 8px;">Gist ID <small>(sync données personnelles — laisser vide si non utilisé)</small></p>
                    <input type="text" id="cc-gist-id-input" value="${localStorage.getItem('hw_gist_id') || ''}" class="settings-input" placeholder="ex: 21f82c6a621a6acf09adeb228154bb04" style="font-family:monospace;font-size:0.85rem;">
                    <button id="btn-save-token" class="cc-save-btn">Sauvegarder</button>
                </div>

                <!-- SYNC PERSO -->
                <div class="cc-card">
                    <h3 class="cc-card-title-flex">
                        <i data-lucide="cloud-cog" class="icon-amber"></i> Synchronisation Personnelle
                    </h3>
                    <p style="color:var(--hw-ink-soft); font-size:0.9rem; margin-bottom:20px;">
                        Sauvegardez votre avancement (Circuits Faits, Lieux visités) sur le repo GitHub pour le retrouver sur vos autres appareils Admin.
                    </p>

                    <div class="cc-sync-btns-row">
                        <button id="btn-sync-upload" class="btn-cc-sync-upload">
                            <i data-lucide="upload-cloud"></i> Sauvegarder (Upload)
                        </button>
                        <button id="btn-sync-download" class="btn-cc-sync-download">
                            <i data-lucide="download-cloud"></i> Récupérer (Download)
                        </button>
                    </div>

                    <div id="sync-last-update" class="cc-sync-update-label">
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
                const gistId = document.getElementById('cc-gist-id-input')?.value.trim();
                if (gistId) {
                    localStorage.setItem('hw_gist_id', gistId);
                } else {
                    localStorage.removeItem('hw_gist_id');
                }
                showToast("Configuration sauvegardée !", "success");
                injectSyncIndicator();
                pullFromGist();
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

// --- UPLOAD CIRCUIT PANEL ---
function renderUploadCircuitPanel(diffData, callbacks) {
    const container = document.getElementById('admin-cc-content');
    if (!container) return;

    container.innerHTML = `
        <div class="cc-subpanel-header">
            <button class="cc-back-btn" id="btn-upload-back">
                <i data-lucide="arrow-left"></i> Dashboard
            </button>
            <span class="cc-subpanel-title">Ajouter un circuit</span>
        </div>

        <div class="cc-card">
            <div class="cc-upload-intro">
                <i data-lucide="upload-cloud" class="icon-amber" style="width:32px;height:32px;flex-shrink:0;"></i>
                <p>Envoyez un fichier de circuit directement sur GitHub.<br>
                <small style="color:var(--hw-ink-soft);">Le serveur mettra à jour l'index automatiquement.</small></p>
            </div>

            <label class="cc-upload-field-label">Nom du circuit <small>(optionnel — extrait du fichier si absent)</small></label>
            <input type="text" id="cc-circuit-name" class="settings-input" placeholder="Ex : Circuit du Patrimoine">

            <label class="cc-upload-field-label" style="margin-top:14px;">
                Fichier <span class="cc-format-badge">GPX</span> <span class="cc-format-badge">JSON</span>
            </label>
            <div class="cc-file-drop" id="cc-file-drop">
                <i data-lucide="file-plus"></i>
                <span>Cliquer pour choisir un fichier</span>
                <small>GPX ou JSON uniquement</small>
            </div>
            <input type="file" id="cc-file-input" accept=".json,.gpx" style="display:none;">
            <div id="cc-file-pill" class="cc-file-pill" style="display:none;"></div>

            <div id="cc-upload-status" class="cc-upload-status" style="display:none;"></div>
        </div>

        <div class="cc-subpanel-footer">
            <button class="custom-modal-btn secondary" id="btn-upload-cancel">Annuler</button>
            <button class="cc-save-btn" id="btn-upload-submit" disabled>
                <i data-lucide="send"></i> Envoyer sur GitHub
            </button>
        </div>
    `;

    createIcons({ icons, root: container });

    const backFn = () => { renderTab('dashboard', diffData, callbacks); };
    document.getElementById('btn-upload-back')?.addEventListener('click', backFn);
    document.getElementById('btn-upload-cancel')?.addEventListener('click', backFn);

    const fileInput  = document.getElementById('cc-file-input');
    const filePill   = document.getElementById('cc-file-pill');
    const submitBtn  = document.getElementById('btn-upload-submit');
    const statusDiv  = document.getElementById('cc-upload-status');

    document.getElementById('cc-file-drop')?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        filePill.innerHTML = `<i data-lucide="paperclip"></i> <strong>${file.name}</strong> <small>(${(file.size / 1024).toFixed(1)} Ko)</small>`;
        filePill.style.display = 'flex';
        submitBtn.disabled = false;
        createIcons({ icons, root: filePill });
    });

    document.getElementById('btn-upload-submit')?.addEventListener('click', async () => {
        const file = fileInput?.files[0];
        if (!file) return;

        const token = getStoredToken();
        if (!token) {
            statusDiv.style.display = 'flex';
            statusDiv.className = 'cc-upload-status error';
            statusDiv.innerHTML = `<i data-lucide="alert-triangle"></i> Token manquant — configurez-le dans <strong>Config</strong>`;
            createIcons({ icons, root: statusDiv });
            return;
        }

        const circuitName = document.getElementById('cc-circuit-name')?.value.trim();
        const commitMsg = circuitName
            ? `feat(circuit): Ajout "${circuitName}"`
            : `feat(circuit): Ajout "${file.name}"`;
        const path = `public/circuits/djerba/${file.name}`;

        submitBtn.disabled = true;
        statusDiv.style.display = 'flex';
        statusDiv.className = 'cc-upload-status info';
        statusDiv.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Envoi en cours…`;
        createIcons({ icons, root: statusDiv });

        try {
            await uploadFileToGitHub(file, token, GITHUB_OWNER, GITHUB_REPO, path, commitMsg);
            statusDiv.className = 'cc-upload-status success';
            statusDiv.innerHTML = `<i data-lucide="check-circle-2"></i> Circuit envoyé avec succès !`;
            createIcons({ icons, root: statusDiv });
            showToast('Circuit envoyé sur GitHub !', 'success');
            setTimeout(backFn, 2500);
        } catch (err) {
            statusDiv.className = 'cc-upload-status error';
            statusDiv.innerHTML = `<i data-lucide="x-circle"></i> Erreur : ${err.message}`;
            createIcons({ icons, root: statusDiv });
            submitBtn.disabled = false;
        }
    });
}

// --- RENDER DETAIL HELPER ---
export function renderDiffDetails(item) {
    // Si c'est une suppression, on n'a pas besoin d'édition
    if (item.isDeletion) {
        return `<div class="cc-deletion-warning">⚠️ Ce lieu sera définitivement supprimé de la carte officielle.</div>`;
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
                    <a href="${mapsLink}" target="_blank" class="cc-maps-link">
                        <i data-lucide="map"></i> Voir sur G.Maps
                    </a>
                </div>
                <div class="edit-row">
                   <span class="cc-coord-label">Lat,Lng</span>
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
                         <input type="text" class="edit-input" value="${safeAttr(c.new)}" disabled>
                    </div>
                    <div class="cc-lock-note">
                        <i data-lucide="lock" width="12"></i>
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
            <div class="diff-change-block">
                <div class="diff-change-header">
                    <div class="diff-change-key">
                        ${c.key ? c.key.toUpperCase() : 'PROPRIÉTÉ'}
                    </div>
                </div>

                <div class="diff-grid">
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
