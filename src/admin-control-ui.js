import { state } from './state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { getStoredToken, getStoredUsername, saveToken, validateToken, uploadFileToGitHub } from './github-sync.js';
import { showToast } from './toast.js';
import { openHwModal, closeHwModal } from './modal.js';
import { renderMaintenanceTab } from './admin-maintenance.js';
import { GITHUB_OWNER, GITHUB_REPO } from './config.js';

// Ce fichier gère l'affichage (HTML, CSS, Interactions UI) du panneau d'administration

// B2 — État du sub-router de l'onglet Modifications.
// 3 sous-vues : Lieux (POI texte/coords) / Photos (grille pending) / Circuits.
// Persistant entre les renders du même onglet, reset implicite à 'lieux' au prochain
// boot (variable module-level non sérialisée).
let _changesSubView = 'lieux';

// C2 — Track des blob URLs créées par renderPendingPhotoGrid pour pouvoir les
// revoke (URL.revokeObjectURL) lors du re-render de la grille ou de la
// fermeture du modal CC. Évite la fuite mémoire qui s'accumulait sinon à
// chaque bascule de vue ou ouverture/fermeture du CC avec des photos pending.
const _activeBlobUrls = new Set();

function _trackBlobUrl(url) {
    _activeBlobUrls.add(url);
    return url;
}

/**
 * Revoke toutes les blob URLs trackées et vide le Set.
 * Exporté pour être appelé au close modal et avant un re-render de la grille.
 */
export function revokeAllPendingBlobUrls() {
    for (const url of _activeBlobUrls) {
        try { URL.revokeObjectURL(url); }
        catch (e) { /* tolérant : URL déjà revoked ou contexte fermé */ }
    }
    _activeBlobUrls.clear();
}

/** Test-only : retourne le nombre de blob URLs trackées. */
export function _getActiveBlobUrlCountForTests() {
    return _activeBlobUrls.size;
}

export function setChangesSubView(view) {
    if (['lieux', 'photos', 'circuits'].includes(view)) {
        _changesSubView = view;
    }
}

export function getChangesSubView() {
    return _changesSubView;
}


export function openControlCenterModal(diffData, callbacks) {
    // Migration V2 : openHwModal lg avec tabs intégrés au body (option B :
    // tabs inline plutôt qu'un nouveau pattern réutilisable du système).
    // Le hack legacy (showAlert + customClass + masquage manuel + observer)
    // est remplacé par une utilisation directe et propre du système V2.

    // Tab "Config" masqué tant que le token est valide — accessible via le badge
    // token du Dashboard (clic) ou la Quick Action "Configuration".
    const settingsTabHidden = !!getStoredToken() ? ' cc-tab-hidden' : '';

    const subheader = `
        <div class="admin-cc-tabs ue-tabs">
            <button class="admin-cc-tab ue-tab is-active" type="button" data-tab="dashboard"><i data-lucide="layout-grid"></i> Dashboard</button>
            <button class="admin-cc-tab ue-tab" type="button" data-tab="changes"><i data-lucide="list-checks"></i> Modifications</button>
            <button class="admin-cc-tab ue-tab" type="button" data-tab="maintenance"><i data-lucide="server"></i> Nettoyage</button>
            <button class="admin-cc-tab ue-tab${settingsTabHidden}" type="button" data-tab="settings"><i data-lucide="settings"></i> Config</button>
        </div>
    `;

    const body = `
        <div id="admin-cc-content" class="admin-cc-scroll-area">
            <div class="cc-loading-state">
                <i data-lucide="loader-2" class="spin cc-loading-icon"></i>
                <div class="cc-loading-label">Analyse des modifications en cours…</div>
            </div>
        </div>
    `;

    const footer = `
        <button class="btn btn-ghost" data-cc-action="close">Fermer</button>
        <button class="btn btn-primary" id="btn-cc-publish" title="Tout publier" aria-label="Tout publier">
            <i data-lucide="rocket"></i> TOUT PUBLIER
        </button>
    `;

    openHwModal({
        size: 'lg',
        icon: 'shield-check',
        title: 'Control Center · Admin',
        subheader,
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

        // Bouton "Fermer" du footer (C2 : revoke les blob URLs avant fermeture
        // pour libérer la mémoire des miniatures pending).
        document.querySelector('[data-cc-action="close"]')?.addEventListener('click', () => {
            revokeAllPendingBlobUrls();
            closeHwModal();
        });

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
            // Close modal (C2 : revoke blob URLs avant fermeture)
            if (e.target.closest('[data-action="close-modal"]')) {
                revokeAllPendingBlobUrls();
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
                // B2 — `data-scope` indique si on annule un POI (texte+coords),
                // les photos pending d'un POI, ou un circuit. Default = 'poi'
                // pour rétrocompat.
                const scope = refuseBtn.dataset.scope || 'poi';
                if (callbacks.processDecision) callbacks.processDecision(id, 'refuse', scope);
                return;
            }
            // B2 — Sub-router : changement de vue dans l'onglet Modifications
            const subPill = e.target.closest('[data-action="changes-subview"]');
            if (subPill) {
                const view = subPill.dataset.view;
                setChangesSubView(view);
                renderTab('changes', diffData, callbacks);
                return;
            }
            // B3 — Suppression unitaire d'une photo pending (corbeille)
            const removePhotoBtn = e.target.closest('[data-action="remove-photo"]');
            if (removePhotoBtn) {
                const poiId = removePhotoBtn.dataset.poiId;
                const photoId = removePhotoBtn.dataset.photoId;
                if (callbacks.removeAdminPhoto) callbacks.removeAdminPhoto(poiId, photoId);
                return;
            }
            // B3 — Action en lot : tout cocher / tout décocher
            const bulkBtn = e.target.closest('[data-action="bulk-photo-skip"]');
            if (bulkBtn) {
                const poiId = bulkBtn.dataset.poiId;
                const skipPublish = bulkBtn.dataset.skip === 'true';
                if (callbacks.bulkSetPhotoSkip) callbacks.bulkSetPhotoSkip(poiId, skipPublish);
                return;
            }
            // B3 — Repli/déplie d'une section photo (à publier / gardées en local)
            const sectionHeader = e.target.closest('[data-action="toggle-photo-section"]');
            if (sectionHeader) {
                const section = sectionHeader.closest('.cc-photo-section');
                if (section) {
                    section.classList.toggle('is-collapsed');
                    const isCollapsed = section.classList.contains('is-collapsed');
                    sectionHeader.setAttribute('aria-expanded', String(!isCollapsed));
                }
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
            // Toggle skipPublish sur une photo pending. La fonction côté admin
            // déclenche un re-render complet (B3) pour déplacer la photo entre
            // les sections "À publier" et "Gardées en local". Pas de manipulation
            // DOM locale ici — un seul chemin de vérité.
            if (e.target.matches('[data-action="toggle-photo-skip"]')) {
                const poiId   = e.target.dataset.poiId;
                const photoId = e.target.dataset.photoId;
                const skipPublish = !e.target.checked;
                if (callbacks.togglePhotoSkip) callbacks.togglePhotoSkip(poiId, photoId, skipPublish);
            }
        });
    }

    // Icons rendered on the modal root (header + footer + body initial state)
    createIcons({ icons: appIcons, root: document.querySelector('.hw-modal') });
}

/**
 * Rend une grille de vignettes photo pending pour un item POI (PR B3).
 *
 * 2 sections distinctes :
 *   - "À publier"      : skipPublish=false, sera uploadée au prochain Publier.
 *   - "Gardées en local" : skipPublish=true, ne sera jamais publiée. Repliable.
 *
 * Chaque vignette a :
 *   - case à cocher (toggle skipPublish individuel — comportement Chantier 2)
 *   - bouton corbeille (suppression unitaire — B3)
 *
 * Boutons en lot en haut de la grille :
 *   - "Tout cocher"   : toutes en "à publier" (skipPublish=false)
 *   - "Tout décocher" : toutes en "local" (skipPublish=true)
 *
 * @param {Object} item - Élément diffData.pois avec `pendingPhotos` et `id`.
 * @returns {string} HTML de la grille (ou chaîne vide si pas de photos pending).
 */
function renderPendingPhotoGrid(item) {
    if (!item.hasPendingPhotos || !Array.isArray(item.pendingPhotos) || item.pendingPhotos.length === 0) {
        return '';
    }

    const total = item.pendingPhotos.length;
    const toPublish = item.pendingPhotos.filter(p => !p.skipPublish);
    const keptLocal = item.pendingPhotos.filter(p => p.skipPublish);

    const renderCell = (photo) => {
        // Blob URL pour la miniature. Trackée via _trackBlobUrl pour revoke
        // explicite (PR C2) au close modal ou au re-render de la grille.
        // Évite la fuite qui s'accumulait à chaque bascule de vue.
        const url = _trackBlobUrl(URL.createObjectURL(photo.blob));
        const checked = !photo.skipPublish;
        const localClass = photo.skipPublish ? ' is-local' : '';
        const cellTitle = checked
            ? 'Décocher pour garder cette photo uniquement en local (ne pas publier)'
            : 'Cocher pour publier cette photo sur GitHub';
        return `
            <div class="cc-photo-cell-wrap">
                <label class="cc-photo-cell${localClass}" title="${cellTitle}">
                    <input type="checkbox"
                           class="cc-photo-checkbox"
                           data-action="toggle-photo-skip"
                           data-poi-id="${item.id}"
                           data-photo-id="${photo.id}"
                           ${checked ? 'checked' : ''}>
                    <img src="${url}" alt="" loading="lazy">
                    <span class="cc-photo-badge-local" aria-hidden="true">🔒 local</span>
                </label>
                <button class="cc-photo-remove-btn"
                        type="button"
                        data-action="remove-photo"
                        data-poi-id="${item.id}"
                        data-photo-id="${photo.id}"
                        title="Supprimer cette photo du brouillon"
                        aria-label="Supprimer cette photo">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
    };

    const renderSection = (label, items, sectionType, collapsed = false) => {
        if (items.length === 0) return '';
        const cells = items.map(renderCell).join('');
        const stateClass = collapsed ? ' is-collapsed' : '';
        return `
            <div class="cc-photo-section${stateClass}" data-section="${sectionType}">
                <button class="cc-photo-section-header"
                        type="button"
                        data-action="toggle-photo-section"
                        data-section="${sectionType}"
                        aria-expanded="${!collapsed}">
                    <i data-lucide="chevron-down" class="cc-photo-section-chevron"></i>
                    <span class="cc-photo-section-label">${label}</span>
                    <span class="cc-photo-section-count">${items.length}</span>
                </button>
                <div class="cc-photo-section-cells">${cells}</div>
            </div>
        `;
    };

    return `
        <div class="cc-photo-grid">
            <div class="cc-photo-grid-header">
                <div class="cc-photo-grid-title">
                    <i data-lucide="camera"></i>
                    <span>Photos</span>
                    <span class="cc-photo-grid-count">${toPublish.length}/${total} à publier</span>
                </div>
                <div class="cc-photo-grid-actions">
                    <button class="cc-photo-bulk-btn"
                            type="button"
                            data-action="bulk-photo-skip"
                            data-poi-id="${item.id}"
                            data-skip="false"
                            title="Marquer toutes les photos comme à publier">
                        <i data-lucide="check-square"></i> Tout cocher
                    </button>
                    <button class="cc-photo-bulk-btn"
                            type="button"
                            data-action="bulk-photo-skip"
                            data-poi-id="${item.id}"
                            data-skip="true"
                            title="Marquer toutes les photos comme gardées en local">
                        <i data-lucide="square"></i> Tout décocher
                    </button>
                </div>
            </div>
            ${renderSection('À publier',        toPublish, 'to-publish', false)}
            ${renderSection('Gardées en local', keptLocal, 'kept-local', true)}
        </div>
    `;
}

export function renderTab(tab, diffData, callbacks) {
    const container = document.getElementById('admin-cc-content');
    if (!container) return;

    // C2 — Révoque les blob URLs des anciennes miniatures avant chaque rendu.
    // Évite l'accumulation lors des bascules entre sous-vues / onglets.
    revokeAllPendingBlobUrls();

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

            ${localStorage.getItem('dm_has_unpublished_changes') === '1' ? `
                <div class="cc-cross-app-warn">
                    <i data-lucide="alert-triangle"></i>
                    <span>Le Data Manager a un brouillon non publié. Publie-le d'abord pour éviter d'écraser tes modifs.</span>
                    <button class="cc-inline-link" id="btn-goto-dm">Ouvrir le DM</button>
                </div>
            ` : ''}

            <div class="dashboard-grid">
                <div class="stat-card" data-action="goto-changes" data-target-subview="lieux" title="Voir les lieux modifiés">
                    <div class="stat-icon-box"><i data-lucide="map-pin"></i></div>
                    <div class="stat-val">${poisModified}</div>
                    <div class="stat-lab">Lieux Modifiés</div>
                </div>
                <div class="stat-card" data-action="goto-changes" data-target-subview="photos" title="Photos locales en attente d'upload au prochain Publier">
                    <div class="stat-icon-box"><i data-lucide="camera"></i></div>
                    <div class="stat-val">${pendingPhotoCount}</div>
                    <div class="stat-lab">Photos à publier</div>
                </div>
                <div class="stat-card" data-action="goto-changes" data-target-subview="circuits" title="Voir les circuits modifiés">
                    <div class="stat-icon-box"><i data-lucide="route"></i></div>
                    <div class="stat-val">${circuitsModified}</div>
                    <div class="stat-lab">Circuits Modifiés</div>
                </div>
            </div>

            <div class="cc-info-strip">
                <a class="cc-info-strip-repo" href="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}" target="_blank">
                    <i data-lucide="github"></i> ${GITHUB_OWNER}/${GITHUB_REPO}
                </a>
                <span class="cc-info-strip-dot">·</span>
                ${hasToken
                    ? `<button id="btn-cc-token-badge" class="cc-info-strip-token cc-token-ok cc-token-clickable" type="button" title="Modifier le token GitHub">
                        <i data-lucide="shield-check"></i>
                        ${getStoredUsername() ? `Connecté @${getStoredUsername()}` : 'Token configuré'}
                       </button>`
                    : `<span class="cc-info-strip-token cc-token-missing">
                        <i data-lucide="shield-x"></i>
                        Token manquant — <button class="cc-inline-link" id="btn-cc-goto-config3">Configurer</button>
                       </span>`}
            </div>
        `;

        setTimeout(() => {
            const btnUpload = document.getElementById('btn-cc-upload-circuit');
            if (btnUpload) btnUpload.onclick = () => renderUploadCircuitPanel(diffData, callbacks);

            const btnMaint = document.getElementById('btn-cc-goto-maintenance');
            if (btnMaint) btnMaint.onclick = () => {
                document.querySelector('.admin-cc-tab[data-tab="maintenance"]')?.click();
            };

            const goChanges = (targetSubview) => {
                if (targetSubview) setChangesSubView(targetSubview);
                document.querySelector('.admin-cc-tab[data-tab="changes"]')?.click();
            };
            document.querySelectorAll('[data-action="goto-changes"]').forEach(el => {
                el.onclick = () => goChanges(el.dataset.targetSubview);
            });

            const goSettings = () => {
                // Le tab Config est caché tant que le token est valide ; révéler
                // avant de cliquer dessus (l'utilisateur a cliqué un point d'accès).
                const settingsTabBtn = document.querySelector('.admin-cc-tab[data-tab="settings"]');
                if (settingsTabBtn) {
                    settingsTabBtn.classList.remove('cc-tab-hidden');
                    settingsTabBtn.click();
                }
            };
            const btnConf = document.getElementById('btn-cc-goto-config');
            if (btnConf) btnConf.onclick = goSettings;
            const btnConf2 = document.getElementById('btn-cc-goto-config2');
            if (btnConf2) btnConf2.onclick = goSettings;
            const btnConf3 = document.getElementById('btn-cc-goto-config3');
            if (btnConf3) btnConf3.onclick = goSettings;
            const btnTokenBadge = document.getElementById('btn-cc-token-badge');
            if (btnTokenBadge) btnTokenBadge.onclick = goSettings;

            const btnGotoDm = document.getElementById('btn-goto-dm');
            if (btnGotoDm) btnGotoDm.onclick = () => {
                const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
                const url = isDev ? 'http://localhost:5175/' : '/History-Walk-V1/history_walk_datamanager/';
                window.open(url, '_blank');
            };
        }, 0);
    } else if (tab === 'changes') {
        // B2 — Sub-router : 3 sous-vues thématiques au lieu d'un seul long flux.
        const subviewItems = computeChangesSubviewItems(diffData);
        const totalCount = subviewItems.lieux.length + subviewItems.photos.length + subviewItems.circuits.length;

        if (totalCount === 0) {
            container.innerHTML = `<div class="empty-state"><i data-lucide="check" width="48"></i><p>Aucune modification en attente.</p></div>`;
            createIcons({ icons: appIcons, root: container });
            return;
        }

        // Pas d'auto-redirect : on respecte la sous-vue demandée par
        // l'utilisateur (via stat-card du Dashboard ou clic sur pill) même
        // si elle est vide. L'empty-state interne à chaque vue ("Aucun lieu
        // modifié" / "Aucune photo en attente" / "Aucun circuit modifié")
        // donne un retour visuel cohérent et explicite.

        const pillsHtml = renderChangesSubnav(subviewItems, _changesSubView);
        let bodyHtml = '';
        if (_changesSubView === 'lieux') {
            bodyHtml = renderLieuxView(subviewItems.lieux);
        } else if (_changesSubView === 'photos') {
            bodyHtml = renderPhotosView(subviewItems.photos);
        } else if (_changesSubView === 'circuits') {
            bodyHtml = renderCircuitsView(subviewItems.circuits);
        }
        container.innerHTML = pillsHtml + bodyHtml;

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
            </div>
        `;

        setTimeout(() => {
            const btnSave = document.getElementById('btn-save-token');
            if (btnSave) btnSave.onclick = async () => {
                const val = document.getElementById('cc-token-input').value.trim();
                if (!val) {
                    saveToken('');
                    showToast('Token supprimé', 'info');
                    return;
                }
                btnSave.disabled = true;
                const originalHTML = btnSave.innerHTML;
                btnSave.textContent = 'Vérification…';
                try {
                    const result = await validateToken(val);
                    if (!result.ok) {
                        showToast(`Token rejeté : ${result.error}`, 'error', 5000);
                        return;
                    }
                    saveToken(val, result.username);
                    if (result.missingScopes && result.missingScopes.length > 0) {
                        showToast(
                            `Connecté @${result.username} — scopes manquants : ${result.missingScopes.join(', ')}`,
                            'warning',
                            6000
                        );
                    } else {
                        showToast(`Connecté @${result.username}`, 'success');
                    }
                } finally {
                    btnSave.disabled = false;
                    btnSave.innerHTML = originalHTML;
                    createIcons({ icons: appIcons, root: btnSave });
                }
            };
        }, 0);
    } else if (tab === 'maintenance') {
        renderMaintenanceTab(container);
    }

    createIcons({ icons: appIcons, root: container });
}

// ============================================================================
// B2 — Sub-router de l'onglet Modifications : Lieux / Photos / Circuits
// ============================================================================

/**
 * Sépare le contenu de `diffData` en 3 ensembles correspondant aux 3 sous-vues.
 * Pure function — pas d'effet de bord, testable sans DOM.
 *
 * @param {Object} diffData - Sortie du diff engine
 * @returns {{ lieux: Array, photos: Array, circuits: Array }}
 */
export function computeChangesSubviewItems(diffData) {
    const pois = diffData.pois || [];
    const circuits = diffData.circuits || [];

    // Lieux : POI avec changements meaningful (texte/coords) OU statut spécial.
    // Exclut les POI qui ont uniquement des photos pending (changes vide,
    // pas creation/deletion/migration).
    const lieux = pois.filter(p =>
        (Array.isArray(p.changes) && p.changes.length > 0) ||
        p.isCreation || p.isDeletion || p.isMigration
    );

    // Photos : POI avec photos en attente (qu'ils aient ou non des changes texte).
    const photos = pois.filter(p => p.hasPendingPhotos);

    return { lieux, photos, circuits };
}

function renderChangesSubnav(subviewItems, activeView) {
    const pill = (view, icon, label, count) => `
        <button class="cc-changes-pill ${activeView === view ? 'is-active' : ''}"
                type="button"
                data-action="changes-subview" data-view="${view}">
            <i data-lucide="${icon}"></i>
            <span class="cc-changes-pill-label">${label}</span>
            <span class="cc-changes-pill-count">${count}</span>
        </button>
    `;
    return `
        <div class="cc-changes-subnav" role="tablist">
            ${pill('lieux',    'map-pin', 'Lieux',    subviewItems.lieux.length)}
            ${pill('photos',   'camera',  'Photos',   subviewItems.photos.length)}
            ${pill('circuits', 'route',   'Circuits', subviewItems.circuits.length)}
        </div>
    `;
}

function renderLieuxView(items) {
    if (items.length === 0) {
        return `<div class="empty-state"><i data-lucide="check" width="32"></i><p>Aucun lieu modifié.</p></div>`;
    }
    const groups = {
        new: items.filter(p => p.isCreation),
        mod: items.filter(p => !p.isCreation && !p.isDeletion && !p.isMigration),
        del: items.filter(p => p.isDeletion),
        mig: items.filter(p => p.isMigration),
    };
    let html = `<div class="cc-diff-container">`;
    html += renderItemGroup('Nouveaux Lieux',  groups.new, 'cc-badge-new', 'plus-circle', { showEdit: true,  showPhotoGrid: false, scope: 'poi' });
    html += renderItemGroup('Modifications',   groups.mod, 'cc-badge-mod', 'pencil',      { showEdit: true,  showPhotoGrid: false, scope: 'poi' });
    html += renderItemGroup('Suppressions',    groups.del, 'cc-badge-del', 'trash-2',     { showEdit: false, showPhotoGrid: false, scope: 'poi' });
    html += renderItemGroup('Migrations',      groups.mig, 'cc-badge-mig', 'refresh-cw',  { showEdit: false, showPhotoGrid: false, scope: 'poi' });
    html += `</div>`;
    return html;
}

function renderPhotosView(items) {
    if (items.length === 0) {
        return `<div class="empty-state"><i data-lucide="check" width="32"></i><p>Aucune photo en attente.</p></div>`;
    }
    let html = `<div class="cc-diff-container">`;
    html += renderItemGroup('Photos à publier', items, 'cc-badge-mod', 'camera', { showEdit: false, showPhotoGrid: true, scope: 'photos' });
    html += `</div>`;
    return html;
}

function renderCircuitsView(items) {
    if (items.length === 0) {
        return `<div class="empty-state"><i data-lucide="check" width="32"></i><p>Aucun circuit modifié.</p></div>`;
    }
    const groups = {
        new: items.filter(c => c.isCreation),
        mod: items.filter(c => !c.isCreation && !c.isDeletion),
        del: items.filter(c => c.isDeletion),
    };
    let html = `<div class="cc-diff-container">`;
    html += renderItemGroup('Nouveaux Circuits',  groups.new, 'cc-badge-new', 'map',     { showEdit: false, showPhotoGrid: false, scope: 'circuit' });
    html += renderItemGroup('Circuits Modifiés',  groups.mod, 'cc-badge-mod', 'route',   { showEdit: false, showPhotoGrid: false, scope: 'circuit' });
    html += renderItemGroup('Circuits Supprimés', groups.del, 'cc-badge-del', 'trash-2', { showEdit: false, showPhotoGrid: false, scope: 'circuit' });
    html += `</div>`;
    return html;
}

function renderItemGroup(title, items, badgeClass, icon, opts) {
    if (items.length === 0) return '';
    let html = `<div class="cc-diff-group-title">
        <i data-lucide="${icon}"></i> ${title}
        <span class="cc-diff-badge ${badgeClass}">${items.length}</span>
    </div>`;

    html += items.map(item => {
        const diffRows = item.isDeletion
            ? `<div class="cc-change-detail cc-del-warning"><i data-lucide="alert-triangle"></i> Sera supprimé de la carte officielle</div>`
            : item.isCreation && item.changes && item.changes.length === 0
                ? `<div class="cc-change-detail cc-new-hint"><i data-lucide="sparkles"></i> Nouveau lieu — aucun champ antérieur</div>`
                : (item.changes || []).map(c => `
                    <div class="cc-change-detail">
                        <span class="cc-change-key">${c.key}</span>
                        <span class="cc-old-val">${c.old !== undefined ? c.old : '—'}</span>
                        <span class="cc-change-arrow">➜</span>
                        <span class="cc-new-val">${c.new}</span>
                    </div>`).join('');

        const photoGrid = opts.showPhotoGrid ? renderPendingPhotoGrid(item) : '';
        const showEdit = opts.showEdit && !item.isDeletion && !item.isMigration;

        // Libellé du bouton "Annuler" : adapté au scope pour clarté UX.
        const refuseTitle = item.isDeletion
            ? 'Restaurer ce lieu'
            : (opts.scope === 'photos' ? 'Retirer les photos pending de ce lieu' : 'Effacer cette modification locale');
        const refuseLabel = item.isDeletion ? 'Restaurer' : 'Annuler';
        const refuseIcon = item.isDeletion ? 'rotate-ccw' : 'x';

        return `
        <div class="cc-change-item" id="cc-diff-item-${item.id}">
            <div class="cc-change-item-header">
                <span class="cc-change-name">${item.name}</span>
                ${showEdit ? `<button class="cc-btn-edit" data-action="open-editor" data-id="${item.id}" title="Ouvrir l'éditeur pour vérifier avant publication">
                    <i data-lucide="edit-3"></i> Éditer
                </button>` : ''}
                <button class="cc-btn-ignore" data-action="refuse" data-id="${item.id}" data-scope="${opts.scope}" title="${refuseTitle}">
                    <i data-lucide="${refuseIcon}"></i>
                    <span>${refuseLabel}</span>
                </button>
            </div>
            ${diffRows ? `<div class="cc-change-diffs">${diffRows}</div>` : ''}
            ${photoGrid}
        </div>`;
    }).join('');

    return html;
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
            <button class="btn btn-secondary" id="btn-upload-cancel">Annuler</button>
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
