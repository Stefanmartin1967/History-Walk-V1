import { state } from './state.js';
import { createIcons, icons } from 'lucide';
import { getStoredToken, saveToken, isTokenPersisted } from './github-sync.js';
import { showToast } from './toast.js';
import { showAlert } from './modal.js';
import { renderMaintenanceTab } from './admin-maintenance.js';

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
                <div class="cc-warning-banner">
                    <i data-lucide="alert-triangle"></i>
                    <div>
                        <strong>Token GitHub manquant</strong>
                        <div class="cc-warning-detail">
                            L'envoi vers le serveur est impossible. Configurez votre clé d'accès dans l'onglet <strong>Config</strong>.
                        </div>
                    </div>
                </div>
            ` : ''}

            ${(poisModified + circuitsModified) === 0 ? `
                <div class="empty-state">
                    <i data-lucide="check-circle-2" width="64" height="64" class="icon-success-lg"></i>
                    <div class="cc-sync-label">Tout est synchronisé !</div>
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

            let groupHtml = `<div class="diff-group-title"><i data-lucide="${icon}" style="color:${colorClass}"></i> ${title} <span class="diff-count-badge">${items.length}</span></div>`;

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
                                ${item.isCircuit ? `<div class="diff-circuit-id">ID: ${item.id}</div>` : ''}
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
            html += `<div class="diff-section-sep">Circuits</div>`;
            html += renderGroup("Nouveaux Circuits", groups.cNew, "map", "#16A34A");
            html += renderGroup("Circuits Modifiés", groups.cMod, "route", "#D97706");
            html += renderGroup("Circuits Supprimés", groups.cDel, "trash-2", "#DC2626");
        }

        html += `</div>`;
        container.innerHTML = html;

    } else if (tab === 'settings') {
        const token = getStoredToken() || '';
        const persisted = isTokenPersisted();
        container.innerHTML = `
            <div class="cc-settings-layout">
                <!-- GITHUB TOKEN -->
                <div class="cc-card">
                    <h3>Configuration GitHub</h3>
                    <p style="color:var(--hw-ink-soft); font-size:0.9rem; margin-bottom:15px;">Personal Access Token (PAT) pour l'upload.</p>
                    <input type="password" id="cc-token-input" value="${token}" class="settings-input" placeholder="ghp_...">
                    <label class="cc-token-persist-label">
                        <input type="checkbox" id="cc-token-persist" ${persisted ? 'checked' : ''}>
                        Se souvenir sur cet appareil
                        <span class="cc-token-persist-hint">(PC personnel uniquement)</span>
                    </label>
                    <button id="btn-save-token" class="cc-save-btn">Sauvegarder Token</button>
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
                const persistent = document.getElementById('cc-token-persist')?.checked ?? false;
                saveToken(val, persistent);
                showToast(persistent ? "Token sauvegardé (persistant)" : "Token sauvegardé (session)", "success");
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
