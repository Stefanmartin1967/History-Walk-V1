import { state } from './state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { getStoredToken, saveToken, uploadFileToGitHub } from './github-sync.js';
import { showToast } from './toast.js';
import { openHwModal, closeHwModal } from './modal.js';
import { renderMaintenanceTab } from './admin-maintenance.js';
import { GITHUB_OWNER, GITHUB_REPO } from './config.js';

// Ce fichier gère l'affichage (HTML, CSS, Interactions UI) du panneau d'administration


export function openControlCenterModal(diffData, callbacks) {
    // Migration V2 : openHwModal lg avec tabs intégrés au body (option B :
    // tabs inline plutôt qu'un nouveau pattern réutilisable du système).
    // Le hack legacy (showAlert + customClass + masquage manuel + observer)
    // est remplacé par une utilisation directe et propre du système V2.

    const body = `
        <div class="admin-cc-tabs ue-tabs">
            <button class="admin-cc-tab ue-tab is-active" type="button" data-tab="dashboard"><i data-lucide="layout-grid"></i> Dashboard</button>
            <button class="admin-cc-tab ue-tab" type="button" data-tab="changes"><i data-lucide="list-checks"></i> Modifications</button>
            <button class="admin-cc-tab ue-tab" type="button" data-tab="maintenance"><i data-lucide="server"></i> Nettoyage</button>
            <button class="admin-cc-tab ue-tab" type="button" data-tab="settings"><i data-lucide="settings"></i> Config</button>
        </div>

        <div id="admin-cc-content" class="admin-cc-scroll-area">
            <div class="cc-loading-state">
                <i data-lucide="loader-2" class="spin cc-loading-icon"></i>
                <div class="cc-loading-label">Analyse des modifications en cours…</div>
            </div>
        </div>
    `;

    const footer = `
        <button class="hw-btn hw-btn-ghost" data-cc-action="close">Fermer</button>
        <button class="hw-btn hw-btn-primary" id="btn-cc-publish" title="Tout publier" aria-label="Tout publier">
            <i data-lucide="rocket"></i> TOUT PUBLIER
        </button>
    `;

    openHwModal({
        size: 'lg',
        icon: 'shield-check',
        title: 'Control Center · Admin',
        body,
        footer,
        // CC est complexe (4 tabs, tableaux, formulaires) : pas de fermeture
        // au clic backdrop pour éviter les pertes accidentelles.
        closeOnBackdrop: false,
    });

    // Bind après ouverture (DOM prêt)
    setTimeout(() => {
        // Tabs
        const tabs = document.querySelectorAll('.hw-modal .admin-cc-tab');
        tabs.forEach(t => {
            t.addEventListener('click', () => {
                tabs.forEach(x => x.classList.remove('is-active'));
                t.classList.add('is-active');
                renderTab(t.dataset.tab, diffData, callbacks);
            });
        });

        // Bouton "TOUT PUBLIER"
        const btnPublish = document.getElementById('btn-cc-publish');
        if (btnPublish && callbacks.publishChanges) btnPublish.onclick = callbacks.publishChanges;

        // Bouton "Fermer" du footer
        document.querySelector('[data-cc-action="close"]')?.addEventListener('click', () => closeHwModal());

        bindCCEventDelegation(diffData, callbacks);

        // Render initial tab
        renderTab('dashboard', diffData, callbacks);
    }, 30);
}

function bindCCEventDelegation(diffData, callbacks) {
    // Event Delegation for Admin Control Center
    const container = document.getElementById('admin-cc-content');
    if (container) {
        container.addEventListener('click', (e) => {
            // Close modal
            if (e.target.closest('[data-action="close-modal"]')) {
                closeHwModal();
                return;
            }
            // Toggle Details
            const toggleBtn = e.target.closest('[data-action="toggle-details"]');
            if (toggleBtn) {
                const id = toggleBtn.dataset.id;
                if (callbacks.toggleDiffDetails) callbacks.toggleDiffDetails(id);
                return;
            }
            // Diff Actions
            const refuseBtn = e.target.closest('[data-action="refuse"]');
            if (refuseBtn) {
                const id = refuseBtn.dataset.id;
                if (callbacks.processDecision) callbacks.processDecision(id, 'refuse');
                return;
            }
            const editorBtn = e.target.closest('[data-action="open-editor"]');
            if (editorBtn) {
                const id = editorBtn.dataset.id;
                if (callbacks.openEditorForPoi) callbacks.openEditorForPoi(id);
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
                return;
            }
            // Toggle skipPublish sur une photo pending (Chantier 2)
            if (e.target.matches('[data-action="toggle-photo-skip"]')) {
                const poiId   = e.target.dataset.poiId;
                const photoId = e.target.dataset.photoId;
                // Décoché → skipPublish=true (photo gardée locale, pas publiée)
                const skipPublish = !e.target.checked;
                // Bascule visuelle immédiate sur la cellule (badge 🔒 local)
                const cell = e.target.closest('.cc-photo-cell');
                if (cell) cell.classList.toggle('is-local', skipPublish);
                // MAJ du compteur affiché dans l'en-tête de grille
                const grid = e.target.closest('.cc-photo-grid');
                if (grid) {
                    const total = grid.querySelectorAll('.cc-photo-checkbox').length;
                    const publishable = grid.querySelectorAll('.cc-photo-checkbox:checked').length;
                    const header = grid.querySelector('.cc-photo-grid-count');
                    if (header) header.textContent = `${publishable}/${total}`;
                }
                if (callbacks.togglePhotoSkip) callbacks.togglePhotoSkip(poiId, photoId, skipPublish);
            }
        });
    }

    // Icons rendered on the modal root (header + footer + body initial state)
    createIcons({ icons: appIcons, root: document.querySelector('.hw-modal') });
}

/**
 * Rend une grille de vignettes photo pending (Chantier 2) pour un item POI
 * dans l'onglet Modifications. Chaque vignette a une case à cocher :
 *   — cochée (par défaut) : la photo sera uploadée sur GitHub au prochain
 *     Publier, puis retirée de `pendingAdminPhotos`.
 *   — décochée : la photo est persistée avec `skipPublish: true`. Elle reste
 *     visible dans l'app (via `addPhotosToPoi` → `poiPhotos`) mais n'est JAMAIS
 *     poussée sur GitHub, même lors des Publier suivants.
 *
 * Usage : photo personnelle de l'admin qu'il veut voir dans son app mais pas
 * publier (ex: photo romantique devant un POI).
 *
 * @param {Object} item - Élément diffData.pois avec `pendingPhotos` et `id`.
 * @returns {string} HTML de la grille (ou chaîne vide si pas de photos pending).
 */
function renderPendingPhotoGrid(item) {
    if (!item.hasPendingPhotos || !Array.isArray(item.pendingPhotos) || item.pendingPhotos.length === 0) {
        return '';
    }

    const total = item.pendingPhotos.length;
    const publishable = item.pendingPhotos.filter(p => !p.skipPublish).length;

    const cells = item.pendingPhotos.map(photo => {
        // Blob URL pour la miniature. Pas de revoke explicite : le modal CC reste
        // ouvert pendant toute la session de publication, et les blobs sont
        // relâchés quand la page est rechargée ou navigation suivante.
        const url = URL.createObjectURL(photo.blob);
        const checked = !photo.skipPublish;
        const localClass = photo.skipPublish ? ' is-local' : '';
        return `
            <label class="cc-photo-cell${localClass}" title="${checked ? 'Décocher pour garder cette photo uniquement en local (ne pas publier)' : 'Cocher pour publier cette photo sur GitHub'}">
                <input type="checkbox"
                       class="cc-photo-checkbox"
                       data-action="toggle-photo-skip"
                       data-poi-id="${item.id}"
                       data-photo-id="${photo.id}"
                       ${checked ? 'checked' : ''}>
                <img src="${url}" alt="" loading="lazy">
                <span class="cc-photo-badge-local" aria-hidden="true">🔒 local</span>
            </label>
        `;
    }).join('');

    return `
        <div class="cc-photo-grid">
            <div class="cc-photo-grid-title">
                <i data-lucide="camera"></i>
                Photos à publier
                <span class="cc-photo-grid-count">${publishable}/${total}</span>
                <span class="cc-photo-grid-hint">Décocher une vignette pour la garder uniquement en local</span>
            </div>
            <div class="cc-photo-grid-cells">${cells}</div>
        </div>
    `;
}

export function renderTab(tab, diffData, callbacks) {
    const container = document.getElementById('admin-cc-content');
    if (!container) return;

    if (tab === 'dashboard') {
        const { poisModified, circuitsModified, testedChanged = 0, pendingPhotoCount = 0 } = diffData.stats;
        const hasToken = !!getStoredToken();

        const isSynced = (poisModified + circuitsModified + testedChanged + pendingPhotoCount) === 0;
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
                <div class="stat-card" data-action="goto-changes" title="Voir les modifications">
                    <div class="stat-icon-box"><i data-lucide="map-pin"></i></div>
                    <div class="stat-val">${poisModified}</div>
                    <div class="stat-lab">Lieux Modifiés</div>
                </div>
                <div class="stat-card" data-action="goto-changes" title="Photos locales en attente d'upload au prochain Publier">
                    <div class="stat-icon-box"><i data-lucide="camera"></i></div>
                    <div class="stat-val">${pendingPhotoCount}</div>
                    <div class="stat-lab">Photos à publier</div>
                </div>
                <div class="stat-card" data-action="goto-changes" title="Voir les modifications">
                    <div class="stat-icon-box"><i data-lucide="route"></i></div>
                    <div class="stat-val">${circuitsModified}</div>
                    <div class="stat-lab">Circuits Modifiés</div>
                </div>
                <div class="stat-card" title="Publication du statut 'vérifié' au prochain push">
                    <div class="stat-icon-box"><i data-lucide="shield-check"></i></div>
                    <div class="stat-val">${testedChanged}</div>
                    <div class="stat-lab">Vérifiés à publier</div>
                </div>
            </div>

            <div class="cc-info-strip">
                <a class="cc-info-strip-repo" href="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}" target="_blank">
                    <i data-lucide="github"></i> ${GITHUB_OWNER}/${GITHUB_REPO}
                </a>
                <span class="cc-info-strip-dot">·</span>
                <span class="cc-info-strip-token ${hasToken ? 'cc-token-ok' : 'cc-token-missing'}">
                    <i data-lucide="${hasToken ? 'shield-check' : 'shield-x'}"></i>
                    ${hasToken ? 'Token configuré' : 'Token manquant'}
                    ${!hasToken ? `— <button class="cc-inline-link" id="btn-cc-goto-config3">Configurer</button>` : ''}
                </span>
            </div>
        `;

        setTimeout(() => {
            const btnUpload = document.getElementById('btn-cc-upload-circuit');
            if (btnUpload) btnUpload.onclick = () => renderUploadCircuitPanel(diffData, callbacks);

            const btnMaint = document.getElementById('btn-cc-goto-maintenance');
            if (btnMaint) btnMaint.onclick = () => {
                document.querySelector('.admin-cc-tab[data-tab="maintenance"]')?.click();
            };

            const goChanges = () => document.querySelector('.admin-cc-tab[data-tab="changes"]')?.click();
            document.querySelectorAll('[data-action="goto-changes"]').forEach(el => {
                el.onclick = goChanges;
            });

            const goSettings = () => document.querySelector('.admin-cc-tab[data-tab="settings"]')?.click();
            const btnConf = document.getElementById('btn-cc-goto-config');
            if (btnConf) btnConf.onclick = goSettings;
            const btnConf2 = document.getElementById('btn-cc-goto-config2');
            if (btnConf2) btnConf2.onclick = goSettings;
            const btnConf3 = document.getElementById('btn-cc-goto-config3');
            if (btnConf3) btnConf3.onclick = goSettings;
        }, 0);
    } else if (tab === 'changes') {
        if (diffData.pois.length === 0 && diffData.circuits.length === 0) {
            container.innerHTML = `<div class="empty-state"><i data-lucide="check" width="48"></i><p>Aucune modification en attente.</p></div>`;
            createIcons({ icons: appIcons, root: container });
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

                const photoGrid = renderPendingPhotoGrid(item);

                const canEdit = !item.isDeletion && !item.isMigration;
                return `
                <div class="cc-change-item" id="cc-diff-item-${item.id}">
                    <div class="cc-change-item-header">
                        <span class="cc-change-name">${item.name}</span>
                        ${canEdit ? `<button class="cc-btn-edit" data-action="open-editor" data-id="${item.id}" title="Ouvrir l'éditeur pour vérifier avant publication">
                            <i data-lucide="edit-3"></i> Éditer
                        </button>` : ''}
                        <button class="cc-btn-ignore" data-action="refuse" data-id="${item.id}" title="${item.isDeletion ? 'Restaurer ce lieu' : 'Effacer cette modification locale'}">
                            <i data-lucide="${item.isDeletion ? 'rotate-ccw' : 'x'}"></i>
                            <span>${item.isDeletion ? 'Restaurer' : 'Ignorer'}</span>
                        </button>
                    </div>
                    ${diffRows ? `<div class="cc-change-diffs">${diffRows}</div>` : ''}
                    ${photoGrid}
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
                    <h3 class="cc-card-title-flex">
                        <i data-lucide="key-round" class="icon-amber"></i> Token GitHub
                    </h3>
                    <p class="cc-card-hint">
                        Personal Access Token (PAT) nécessaire pour publier les modifications sur GitHub.
                        Stocké localement sur cet appareil.
                    </p>
                    <input type="password" id="cc-token-input" value="${token}" class="settings-input" placeholder="ghp_...">
                    <button id="btn-save-token" class="cc-save-btn">
                        <i data-lucide="save"></i> Sauvegarder
                    </button>
                </div>

                <!-- SYNC ADMIN MULTI-APPAREILS -->
                <div class="cc-card">
                    <h3 class="cc-card-title-flex">
                        <i data-lucide="smartphone" class="icon-amber"></i> Sync Admin multi-appareils
                    </h3>
                    <p class="cc-card-hint cc-card-hint--wide">
                        Sauvegardez votre état admin (modifications en attente, circuits, données locales)
                        sur GitHub pour le retrouver depuis un autre appareil — utile en déplacement.
                    </p>

                    <div class="cc-sync-btns-row">
                        <button id="btn-sync-upload" class="btn-cc-sync-upload">
                            <i data-lucide="upload-cloud"></i> Sauvegarder
                        </button>
                        <button id="btn-sync-download" class="btn-cc-sync-download">
                            <i data-lucide="download-cloud"></i> Récupérer
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
            if (btnSave) btnSave.onclick = () => {
                const val = document.getElementById('cc-token-input').value.trim();
                saveToken(val);
                showToast("Token sauvegardé !", "success");
            };

            const btnUp = document.getElementById('btn-sync-upload');
            if (btnUp && callbacks.uploadAdminData) btnUp.onclick = callbacks.uploadAdminData;

            const btnDown = document.getElementById('btn-sync-download');
            if (btnDown && callbacks.downloadAdminData) btnDown.onclick = callbacks.downloadAdminData;
        }, 0);
    } else if (tab === 'maintenance') {
        renderMaintenanceTab(container);
    }

    createIcons({ icons: appIcons, root: container });
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
                <i data-lucide="upload-cloud" class="icon-amber cc-upload-icon"></i>
                <p>Envoyez un fichier de circuit directement sur GitHub.<br>
                <small class="cc-upload-intro-note">Le serveur mettra à jour l'index automatiquement.</small></p>
            </div>

            <label class="cc-upload-field-label">Nom du circuit <small>(optionnel — extrait du fichier si absent)</small></label>
            <input type="text" id="cc-circuit-name" class="settings-input" placeholder="Ex : Circuit du Patrimoine">

            <label class="cc-upload-field-label cc-upload-field-label--spaced">
                Fichier <span class="cc-format-badge">GPX</span> <span class="cc-format-badge">JSON</span>
            </label>
            <div class="cc-file-drop" id="cc-file-drop">
                <i data-lucide="file-plus"></i>
                <span>Cliquer pour choisir un fichier</span>
                <small>GPX ou JSON uniquement</small>
            </div>
            <input type="file" id="cc-file-input" accept=".json,.gpx" class="is-hidden">
            <div id="cc-file-pill" class="cc-file-pill is-hidden"></div>

            <div id="cc-upload-status" class="cc-upload-status is-hidden"></div>
        </div>

        <div class="cc-subpanel-footer">
            <button class="custom-modal-btn secondary" id="btn-upload-cancel">Annuler</button>
            <button class="cc-save-btn" id="btn-upload-submit" disabled>
                <i data-lucide="send"></i> Envoyer sur GitHub
            </button>
        </div>
    `;

    createIcons({ icons: appIcons, root: container });

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
        filePill.classList.remove('is-hidden');
        submitBtn.disabled = false;
        createIcons({ icons: appIcons, root: filePill });
    });

    document.getElementById('btn-upload-submit')?.addEventListener('click', async () => {
        const file = fileInput?.files[0];
        if (!file) return;

        const token = getStoredToken();
        if (!token) {
            statusDiv.style.display = 'flex';
            statusDiv.className = 'cc-upload-status error';
            statusDiv.innerHTML = `<i data-lucide="alert-triangle"></i> Token manquant — configurez-le dans <strong>Config</strong>`;
            createIcons({ icons: appIcons, root: statusDiv });
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
        createIcons({ icons: appIcons, root: statusDiv });

        try {
            await uploadFileToGitHub(file, token, GITHUB_OWNER, GITHUB_REPO, path, commitMsg);
            statusDiv.className = 'cc-upload-status success';
            statusDiv.innerHTML = `<i data-lucide="check-circle-2"></i> Circuit envoyé avec succès !`;
            createIcons({ icons: appIcons, root: statusDiv });
            showToast('Circuit envoyé sur GitHub !', 'success');
            setTimeout(backFn, 2500);
        } catch (err) {
            statusDiv.className = 'cc-upload-status error';
            statusDiv.innerHTML = `<i data-lucide="x-circle"></i> Erreur : ${err.message}`;
            createIcons({ icons: appIcons, root: statusDiv });
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
                        <span class="cc-readonly-hint">Modification via l'éditeur de circuit</span>
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
