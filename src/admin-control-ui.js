import { state } from './state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { getStoredToken, getStoredUsername, saveToken, validateToken, uploadFileToGitHub } from './github-sync.js';
import { showToast } from './toast.js';
// PR 3 — shell custom (admin-cc-overlay), plus de dépendance à openHwModal/closeHwModal.
// Les imports legacy sont retirés volontairement ; tout passe par openControlCenterModal/closeCCModal.
import { renderMaintenanceTab } from './admin-maintenance.js';
import { setTopbarSubtabs } from './admin-cc-topbar.js';
import { GITHUB_OWNER, GITHUB_REPO, GITHUB_PATHS } from './config.js';
import { escapeXml } from './utils.js';
// NB : exportMasterGeoJSON (admin.js) est importé dynamiquement dans son
// handler de bouton (cf. carte OUTILS plus bas) pour casser le cycle
// admin-control-center → admin-control-ui → admin → admin-control-center.

// Ce fichier gère l'affichage (HTML, CSS, Interactions UI) du panneau d'administration

// Compteur de publication (source UNIQUE) — somme des 4 deltas du diff : POI modifiés
// + circuits modifiés + photos admin en attente + circuits « Fait » non publiés. Pilote
// le badge nav ET l'état actif/inactif du bouton « Tout publier ». Factorisé pour éviter
// la dérive badge↔bouton (formule auparavant copiée à 3 endroits).
function computePublishCount(stats = {}) {
    return (stats.poisModified || 0)
         + (stats.circuitsModified || 0)
         + (stats.pendingPhotoCount || 0)
         + (stats.testedChanged || 0);
}

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

// — Shell PR 3 — référence à l'overlay actuellement ouvert.
// Permet à closeCCModal d'identifier l'overlay même si plusieurs modales
// s'ouvrent en cascade (ex: confirm imbriqué → still need to close root CC).
let _ccModalOverlay = null;
let _ccEscHandler = null;

const TAB_LABELS = {
    dashboard:   { title: 'Tableau de bord', sub: "vue d'ensemble" },
    changes:     { title: 'Modifications',   sub: '' },
    maintenance: { title: 'Nettoyage',       sub: 'archive et serveur' },
    settings:    { title: 'Configuration',   sub: '' },
};

function updateTopbarTitle(tab, opts = {}) {
    const titleEl = _ccModalOverlay?.querySelector('.cc-topbar-title');
    if (!titleEl) return;
    const { title, sub } = TAB_LABELS[tab] || { title: 'Centre de Contrôle', sub: '' };
    const subText = opts.subOverride !== undefined ? opts.subOverride : sub;
    titleEl.innerHTML = subText
        ? `${title} <small>· ${subText}</small>`
        : title;
}

function syncFooterAndNavCount(diffData) {
    const overlay = _ccModalOverlay;
    if (!overlay) return;

    // testedChanged = CIRCUITS officiels que l'admin a coché "Fait" mais dont
    // le statut local diverge de tested.json côté serveur (publié pour les users
    // publics). Avec l'auto-publish (`tested-sync.js`), ce delta est normalement
    // à 0 — il ne réapparaît que si le push auto a échoué (network, rate limit).
    // Inclus dans le total et affiché en sub-text de la carte CIRCUITS.
    const stats = (diffData && diffData.stats) || {};
    const totalCount = computePublishCount(stats);

    const btn = overlay.querySelector('#btn-cc-publish');
    if (btn) {
        btn.disabled = (totalCount === 0);
        let countSpan = btn.querySelector('.cc-cta-count');
        if (totalCount > 0) {
            if (countSpan) countSpan.textContent = String(totalCount);
            else btn.insertAdjacentHTML('beforeend', ` <span class="cc-cta-count">${totalCount}</span>`);
        } else if (countSpan) {
            countSpan.remove();
        }
    }

    const info = overlay.querySelector('.cc-footer-info');
    if (info) {
        info.textContent = totalCount > 0
            ? 'Brouillon local · sauvegardé automatiquement'
            : 'Aucune modification locale';
    }

    const navChanges = overlay.querySelector('.cc-nav-item[data-tab="changes"]');
    if (navChanges) {
        let navCount = navChanges.querySelector('.cc-nav-count');
        if (totalCount > 0) {
            if (navCount) navCount.textContent = String(totalCount);
            else navChanges.insertAdjacentHTML('beforeend', `<span class="cc-nav-count">${totalCount}</span>`);
        } else if (navCount) {
            navCount.remove();
        }
    }
}

/**
 * Ferme le shell CC custom (PR 3+). Révoque les blob URLs des photos pending
 * avant suppression du DOM pour éviter les fuites mémoire.
 */
export function closeCCModal() {
    if (!_ccModalOverlay) return;
    revokeAllPendingBlobUrls();
    _ccModalOverlay.classList.remove('is-active');
    if (_ccEscHandler) {
        document.removeEventListener('keydown', _ccEscHandler);
        _ccEscHandler = null;
    }
    const overlay = _ccModalOverlay;
    _ccModalOverlay = null;
    setTimeout(() => {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 250);
}

export function openControlCenterModal(diffData, callbacks) {
    // PR 3 — Custom shell (sidebar 220px + main avec topbar 56px + panel
    // scrollable + footer 64px). Dimensions stables 1100×min(90vh,880px),
    // indépendantes du contenu de l'onglet actif. Plein écran sous 768px.

    // Onglet Configuration masqué tant que le token est valide — accessible
    // via le bouton tokenchip dans le footer de la sidebar.
    const settingsTabHidden = !!getStoredToken() ? ' cc-tab-hidden' : '';
    const tokenOk = !!getStoredToken();
    const username = getStoredUsername();

    const stats = diffData.stats || {};
    const totalCount = computePublishCount(stats);
    const changesCountHtml = totalCount > 0
        ? `<span class="cc-nav-count">${totalCount}</span>`
        : '';

    const overlay = document.createElement('div');
    overlay.className = 'admin-cc-overlay';
    overlay.innerHTML = `
        <div class="admin-cc-modal" role="dialog" aria-modal="true" aria-label="Centre de contrôle Admin">
            <aside class="cc-sidebar">
                <div class="cc-brand">
                    <div class="cc-brand-mark">HW</div>
                    <div class="cc-brand-text">Control Center<small>Admin</small></div>
                </div>
                <nav class="cc-nav" role="tablist">
                    <button class="cc-nav-item is-active" type="button" role="tab" data-tab="dashboard">
                        <i data-lucide="layout-grid"></i> Tableau de bord
                    </button>
                    <button class="cc-nav-item" type="button" role="tab" data-tab="changes">
                        <i data-lucide="list-checks"></i> Modifications
                        ${changesCountHtml}
                    </button>
                    <button class="cc-nav-item" type="button" role="tab" data-tab="maintenance">
                        <i data-lucide="server"></i> Nettoyage
                    </button>
                    <button class="cc-nav-item${settingsTabHidden}" type="button" role="tab" data-tab="settings">
                        <i data-lucide="settings"></i> Configuration
                        ${!tokenOk ? '<span class="cc-nav-warn-dot" aria-label="Token manquant"></span>' : ''}
                    </button>
                </nav>
                <footer class="cc-sidebar-foot">
                    ${tokenOk
                        ? `<button class="cc-tokenchip is-ok" type="button" id="btn-cc-token-chip" title="${username ? `Connecté @${username}` : 'Token configuré'} — modifier">
                            <span class="dot"></span>${username ? `@${username}` : 'Token ok'}
                          </button>`
                        : `<button class="cc-tokenchip is-missing" type="button" id="btn-cc-token-chip" title="Token GitHub manquant — configurer">
                            <span class="dot"></span>Token manquant
                          </button>`
                    }
                    <a class="cc-repo-link" href="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}" target="_blank" rel="noopener" title="Ouvrir le dépôt sur GitHub">
                        <i data-lucide="github"></i>${GITHUB_OWNER}/${GITHUB_REPO}
                    </a>
                </footer>
            </aside>
            <main class="cc-main">
                <header class="cc-topbar" id="cc-topbar">
                    <div class="cc-topbar-row">
                        <h2 class="cc-topbar-title">Tableau de bord <small>· vue d'ensemble</small></h2>
                        <button class="cc-close" type="button" id="btn-cc-close" aria-label="Fermer">
                            <i data-lucide="x"></i>
                        </button>
                    </div>
                    <div class="cc-subtabs" id="cc-topbar-subtabs" role="tablist"></div>
                </header>
                <section class="cc-panel" id="admin-cc-content" role="tabpanel">
                    <div class="cc-loading-state">
                        <i data-lucide="loader-2" class="spin cc-loading-icon"></i>
                        <div class="cc-loading-label">Analyse des modifications en cours…</div>
                    </div>
                </section>
                <footer class="cc-footer">
                    <span class="cc-footer-info">${totalCount > 0 ? 'Brouillon local · sauvegardé automatiquement' : 'Aucune modification locale'}</span>
                    <div class="cc-footer-actions">
                        <button class="cc-btn-ghost" type="button" id="btn-cc-close-foot">Fermer</button>
                        <button class="cc-btn-cta" type="button" id="btn-cc-publish" ${totalCount === 0 ? 'disabled' : ''} title="Publier toutes les modifications">
                            <i data-lucide="upload-cloud"></i>
                            Tout publier${totalCount > 0 ? ` <span class="cc-cta-count">${totalCount}</span>` : ''}
                        </button>
                    </div>
                </footer>
            </main>
        </div>
    `;

    document.body.appendChild(overlay);
    _ccModalOverlay = overlay;

    // Trigger CSS transition (paint avant ajout de la classe is-active)
    requestAnimationFrame(() => overlay.classList.add('is-active'));

    // Bind events après mise en DOM (un tick pour laisser les éléments
    // enfants être référençables par getElementById)
    setTimeout(() => {
        // — Sidebar nav (switch tab) —
        const navItems = overlay.querySelectorAll('.cc-nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                navItems.forEach(x => x.classList.remove('is-active'));
                item.classList.add('is-active');
                const tab = item.dataset.tab;
                updateTopbarTitle(tab);
                renderTab(tab, diffData, callbacks);
            });
        });

        // — Close handlers (topbar X + footer Fermer) —
        document.getElementById('btn-cc-close')?.addEventListener('click', closeCCModal);
        document.getElementById('btn-cc-close-foot')?.addEventListener('click', closeCCModal);

        // — Escape key ferme la modale (bonus a11y) —
        _ccEscHandler = (e) => {
            if (e.key === 'Escape') closeCCModal();
        };
        document.addEventListener('keydown', _ccEscHandler);

        // — Tokenchip → ouvre l'onglet Configuration (révèle s'il était
        //   masqué via cc-tab-hidden quand le token était valide) —
        document.getElementById('btn-cc-token-chip')?.addEventListener('click', () => {
            const settingsTabBtn = overlay.querySelector('.cc-nav-item[data-tab="settings"]');
            if (settingsTabBtn) {
                settingsTabBtn.classList.remove('cc-tab-hidden');
                settingsTabBtn.click();
            }
        });

        // — Bouton Publier (footer) —
        const btnPublish = document.getElementById('btn-cc-publish');
        if (btnPublish && callbacks.publishChanges) btnPublish.onclick = callbacks.publishChanges;

        // — Event delegation interne (clicks/changes dans #admin-cc-content) —
        bindCCEventDelegation(diffData, callbacks);

        // — Render initial tab —
        renderTab('dashboard', diffData, callbacks);

        // — Lucide icons (toute la modale, sidebar + topbar + footer compris) —
        createIcons({ icons: appIcons, root: overlay });
    }, 30);

    return overlay;
}

function bindCCEventDelegation(diffData, callbacks) {
    // Event Delegation for Admin Control Center
    const container = document.getElementById('admin-cc-content');
    if (container) {
        container.addEventListener('click', (e) => {
            // Close modal (PR 3 : custom shell, closeCCModal gère revoke + transition)
            if (e.target.closest('[data-action="close-modal"]')) {
                closeCCModal();
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

    // Icons rendered on the modal root (sidebar + topbar + footer + initial body)
    // PR 3 — `.hw-modal` n'existe plus (shell custom), on cible `.admin-cc-modal`.
    const modalRoot = document.querySelector('.admin-cc-modal');
    if (modalRoot) createIcons({ icons: appIcons, root: modalRoot });
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

    // PR 5 — Reset des sub-tabs du topbar à chaque switch d'onglet. Les onglets
    // qui en ont besoin (changes, maintenance) les re-définiront eux-mêmes.
    setTopbarSubtabs('');

    // Sync footer + nav count avec le diffData courant. Sans ça, le bouton
    // "Tout publier" reste grisé après que prepareDiffData ait résolu (le
    // footer n'est construit qu'une fois à l'ouverture, avec diffData vide).
    syncFooterAndNavCount(diffData);

    if (tab === 'dashboard') {
        // PR 4 — Refonte Dashboard : hero (pending/synced/no-token) + 4 stats
        // cliquables + outils. La hiérarchie répond d'abord à "qu'est-ce qui
        // m'attend ?" (hero) avant "que puis-je faire ?" (outils).
        const stats = diffData.stats || {};
        const poisModified      = stats.poisModified      || 0;
        const circuitsModified  = stats.circuitsModified  || 0;
        const pendingPhotoCount = stats.pendingPhotoCount || 0;
        const testedChanged     = stats.testedChanged     || 0;
        // testedChanged compte les CIRCUITS officiels coché "Fait" en attente
        // de publication serveur. Avec l'auto-publish (tested-sync.js), normalement
        // toujours 0 — n'apparaît que si le push auto a échoué (filet de sécurité).
        // Inclus dans le total ; sub-text affiché dans la carte CIRCUITS (pas Lieux).
        const totalCount = computePublishCount(stats);
        const hasToken = !!getStoredToken();
        const mapId = state.currentMapId || 'djerba';
        const mapLabel = mapId.charAt(0).toUpperCase() + mapId.slice(1);

        // — Hero variant —
        let heroHtml = '';
        if (!hasToken) {
            heroHtml = `
                <div class="cc-hero cc-hero--no-token">
                    <div class="cc-hero-mark"><i data-lucide="shield-x"></i></div>
                    <div class="cc-hero-text">
                        <div class="cc-hero-eyebrow">Configuration requise</div>
                        <h3 class="cc-hero-title">Token GitHub manquant</h3>
                        <p class="cc-hero-sub">Connecte ton Personal Access Token pour activer la publication.</p>
                    </div>
                    <button class="cc-btn-cta cc-btn-cta--inline" id="btn-cc-hero-config" type="button">
                        <i data-lucide="key-round"></i> Configurer
                    </button>
                </div>
            `;
        } else if (totalCount === 0) {
            // Empty state : hero apaisé (« tout synchronisé »), pas de stats
            // (toutes à 0, redondant avec le message), MAIS les outils restent
            // visibles via le flux principal — l'admin doit pouvoir accéder à
            // DM / Scout / Export / Import même quand le brouillon est vide.
            // Bug signalé 20/05/2026 : avant, return early ici masquait OUTILS.
            // Le bouton « Publier un circuit » du hero a été retiré : doublon
            // avec la card OUTILS « Publier un circuit » désormais visible.
            heroHtml = `
                <div class="cc-empty">
                    <div class="cc-empty-mark"><i data-lucide="check-circle-2"></i></div>
                    <h3 class="cc-empty-title">Tout est synchronisé.</h3>
                    <p class="cc-empty-sub">Aucune modification locale à publier sur ${mapLabel}. Continue sur le terrain — les nouvelles modifications apparaîtront ici.</p>
                </div>
            `;
        } else {
            // Pending state hero
            const breakdown = [];
            if (poisModified > 0)      breakdown.push(`${poisModified} lieu${poisModified > 1 ? 'x' : ''} modifié${poisModified > 1 ? 's' : ''}`);
            if (pendingPhotoCount > 0) breakdown.push(`${pendingPhotoCount} photo${pendingPhotoCount > 1 ? 's' : ''}`);
            if (circuitsModified > 0)  breakdown.push(`${circuitsModified} circuit${circuitsModified > 1 ? 's' : ''}`);
            if (testedChanged > 0)     breakdown.push(`${testedChanged} statut${testedChanged > 1 ? 's' : ''} testé${testedChanged > 1 ? 's' : ''}`);
            const subText = breakdown.join(' · ') || 'Modifications locales';
            // Pas de CTA inline dans le hero pending : doublon avec le bouton
            // "Tout publier" du footer (canonique, visible sur les 3 écrans).
            // Décision validée Stefan suite au feedback test PR #502.
            heroHtml = `
                <div class="cc-hero cc-hero--pending">
                    <div class="cc-hero-mark"><i data-lucide="upload-cloud"></i></div>
                    <div class="cc-hero-text">
                        <div class="cc-hero-eyebrow">À publier</div>
                        <h3 class="cc-hero-title">${totalCount} changement${totalCount > 1 ? 's' : ''} en attente sur ${mapLabel}</h3>
                        <p class="cc-hero-sub">${subText}</p>
                    </div>
                </div>
            `;
        }

        // — Stats grid (4 colonnes) —
        const statsHtml = `
            <div class="cc-stats">
                <button class="cc-stat${poisModified > 0 ? ' is-warn' : ''}" type="button" data-action="goto-changes" data-target-subview="lieux" title="Voir les lieux modifiés">
                    <span class="cc-stat-head"><i data-lucide="map-pin"></i> Lieux</span>
                    <span class="cc-stat-val">${poisModified}</span>
                    <span class="cc-stat-trend">${poisModified > 0 ? `${poisModified} en attente` : 'Aucun changement'}</span>
                </button>
                <button class="cc-stat${pendingPhotoCount > 0 ? ' is-warn' : ''}" type="button" data-action="goto-changes" data-target-subview="photos" title="Photos locales en attente d'upload">
                    <span class="cc-stat-head"><i data-lucide="camera"></i> Photos</span>
                    <span class="cc-stat-val">${pendingPhotoCount}</span>
                    <span class="cc-stat-trend">${pendingPhotoCount > 0 ? 'à publier' : 'Aucune photo'}</span>
                </button>
                <button class="cc-stat${(circuitsModified + testedChanged) > 0 ? ' is-warn' : ''}" type="button" data-action="goto-changes" data-target-subview="circuits" title="Voir les circuits modifiés">
                    <span class="cc-stat-head"><i data-lucide="route"></i> Circuits</span>
                    <span class="cc-stat-val">${circuitsModified}</span>
                    <span class="cc-stat-trend">${
                        circuitsModified > 0 && testedChanged > 0
                            ? `${circuitsModified} modifié${circuitsModified > 1 ? 's' : ''} · ${testedChanged} testé${testedChanged > 1 ? 's' : ''}`
                            : circuitsModified > 0
                                ? `${circuitsModified} en attente`
                                : testedChanged > 0
                                    ? `${testedChanged} statut${testedChanged > 1 ? 's' : ''} testé${testedChanged > 1 ? 's' : ''}`
                                    : 'Aucun changement'
                    }</span>
                </button>
            </div>
        `;

        // — Outils (cards, secondaires) —
        // Refactor 15/05/2026 : section élargie pour centraliser les outils admin
        // dans le CC admin (remplace le menu admin God Mode qui devient minimal).
        // MODÈLE C — cartes d'une destination NON publiée (brouillon GitHub) :
        // « Rendre publique » (bascule status:draft → published) et « Supprimer »
        // (deleteDraftGhCardHtml, plus bas). Plus de carte legacy « brouillon local »
        // (Option A retirée). Un brouillon modèle C a status:'draft' et pas de flag custom.
        const activeDest = state.destinations?.maps?.[state.currentMapId];
        const isDraftDest = !!activeDest && activeDest.status !== 'published';
        const makePublicCardHtml = isDraftDest ? `
            <div class="cc-card cc-card--row" role="button" tabindex="0" id="btn-cc-tool-publish-public" aria-label="Rendre cette destination publique (visible de tous)">
                <div class="cc-card-ico"><i data-lucide="globe"></i></div>
                <div class="cc-card-text">
                    <div class="cc-card-title">Rendre publique</div>
                    <div class="cc-card-sub">Brouillon → visible de tous</div>
                </div>
                <div class="cc-card-meta"><i data-lucide="chevron-right"></i></div>
            </div>` : '';

        // MODÈLE C (PR-4b-1) — suppression d'un brouillon GitHub : visible sur un
        // brouillon modèle C (status≠published && !custom, exclusion mutuelle avec la
        // carte legacy ci-dessus). Supprime sur GitHub (deleteDraftFromGitHub : entrée
        // retirée EN PREMIER) PUIS purge locale (deleteLocalDraftDestination). Réservé
        // aux brouillons — une dest publiée n'est pas supprimable (D1). Style danger, en dernier.
        const deleteDraftGhCardHtml = isDraftDest ? `
            <div class="cc-card cc-card--row" role="button" tabindex="0" id="btn-cc-tool-delete-dest-gh" aria-label="Supprimer ce brouillon de destination (définitif, GitHub + local)">
                <div class="cc-card-ico cc-card-ico--danger"><i data-lucide="trash-2"></i></div>
                <div class="cc-card-text">
                    <div class="cc-card-title">Supprimer cette destination</div>
                    <div class="cc-card-sub">Brouillon — suppression définitive (GitHub + cet appareil)</div>
                </div>
                <div class="cc-card-meta"><i data-lucide="chevron-right"></i></div>
            </div>` : '';

        const toolsHtml = `
            <h4 class="cc-section-title">Outils</h4>
            ${makePublicCardHtml}
            <div class="cc-card cc-card--row" role="button" tabindex="0" id="btn-cc-upload-circuit-card" aria-label="Publier un circuit depuis un fichier GPX">
                <div class="cc-card-ico"><i data-lucide="upload-cloud"></i></div>
                <div class="cc-card-text">
                    <div class="cc-card-title">Publier un circuit</div>
                    <div class="cc-card-sub">Depuis un fichier GPX</div>
                </div>
                <div class="cc-card-meta"><i data-lucide="chevron-right"></i></div>
            </div>
            <div class="cc-card cc-card--row" role="button" tabindex="0" id="btn-cc-tool-scout" aria-label="Scout — capturer une zone OSM sur la vraie carte">
                <div class="cc-card-ico"><i data-lucide="scan-eye"></i></div>
                <div class="cc-card-text">
                    <div class="cc-card-title">Scout (Overpass)</div>
                    <div class="cc-card-sub">Capturer une zone sur la carte (OpenStreetMap)</div>
                </div>
                <div class="cc-card-meta"><i data-lucide="chevron-right"></i></div>
            </div>
            <div class="cc-card cc-card--row" role="button" tabindex="0" id="btn-cc-tool-recalc-zones" aria-label="Compléter les quartiers (zones) de cette destination">
                <div class="cc-card-ico"><i data-lucide="layers"></i></div>
                <div class="cc-card-text">
                    <div class="cc-card-title">Compléter les quartiers</div>
                    <div class="cc-card-sub">Récupérer + pousser les quartiers OSM (re-zonage auto des lieux)</div>
                </div>
                <div class="cc-card-meta"><i data-lucide="chevron-right"></i></div>
            </div>
            <div class="cc-card cc-card--row" role="button" tabindex="0" id="btn-cc-tool-rejected-trash" aria-label="Corbeille des rejets de curation Scout de cette destination">
                <div class="cc-card-ico"><i data-lucide="trash-2"></i></div>
                <div class="cc-card-text">
                    <div class="cc-card-title">Corbeille des rejets</div>
                    <div class="cc-card-sub">Restaurer un candidat rejeté, ou tout vider (re-proposés au scan)</div>
                </div>
                <div class="cc-card-meta"><i data-lucide="chevron-right"></i></div>
            </div>
            <div class="cc-card cc-card--row" role="button" tabindex="0" id="btn-cc-tool-export-master" aria-label="Télécharger le Master GeoJSON">
                <div class="cc-card-ico"><i data-lucide="download"></i></div>
                <div class="cc-card-text">
                    <div class="cc-card-title">Exporter Master GeoJSON</div>
                    <div class="cc-card-sub">Sauvegarde complète du jeu de données</div>
                </div>
                <div class="cc-card-meta"><i data-lucide="chevron-right"></i></div>
            </div>
            <div class="cc-card cc-card--row" role="button" tabindex="0" id="btn-cc-tool-import-geojson" aria-label="Importer une carte GeoJSON locale">
                <div class="cc-card-ico"><i data-lucide="folder-open"></i></div>
                <div class="cc-card-text">
                    <div class="cc-card-title">Importer une carte (GeoJSON)</div>
                    <div class="cc-card-sub">Charger une carte locale (.geojson / .json)</div>
                </div>
                <div class="cc-card-meta"><i data-lucide="chevron-right"></i></div>
            </div>
            <div class="cc-card cc-card--row" role="button" tabindex="0" id="btn-cc-tool-osm-pass" aria-label="Passe drapeaux OSM — revue des POI off-route">
                <div class="cc-card-ico"><i data-lucide="flag"></i></div>
                <div class="cc-card-text">
                    <div class="cc-card-title">Passe drapeaux OSM</div>
                    <div class="cc-card-sub">Revue des POI off-route + pré-pose Overpass</div>
                </div>
                <div class="cc-card-meta"><i data-lucide="chevron-right"></i></div>
            </div>
            <div class="cc-card cc-card--row" role="button" tabindex="0" id="btn-cc-tool-mode-donnees" aria-label="Mode Données — éditer les lieux sur la vraie carte">
                <div class="cc-card-ico"><i data-lucide="sliders-horizontal"></i></div>
                <div class="cc-card-text">
                    <div class="cc-card-title">Mode Données</div>
                    <div class="cc-card-sub">Éditer les lieux sur la vraie carte (liste + carte)</div>
                </div>
                <div class="cc-card-meta"><i data-lucide="chevron-right"></i></div>
            </div>
            ${deleteDraftGhCardHtml}
        `;

        // Stats omises en empty state (totalCount=0) : 4 compteurs à 0 sont
        // redondants avec le hero « tout synchronisé ». OUTILS toujours rendus.
        container.innerHTML = heroHtml + (totalCount > 0 ? statsHtml : '') + toolsHtml;

        setTimeout(() => {
            // Hero CTA — uniquement no-token (variant pending n'a plus de bouton
            // inline, le footer "Tout publier" sert de CTA canonique).
            document.getElementById('btn-cc-hero-config')?.addEventListener('click', () => {
                const settingsTabBtn = document.querySelector('.cc-nav-item[data-tab="settings"]');
                if (settingsTabBtn) {
                    settingsTabBtn.classList.remove('cc-tab-hidden');
                    settingsTabBtn.click();
                }
            });

            // Outils — Publier un circuit
            const triggerUploadPanel = () => renderUploadCircuitPanel(diffData, callbacks);
            const uploadCard = document.getElementById('btn-cc-upload-circuit-card');
            if (uploadCard) {
                uploadCard.addEventListener('click', triggerUploadPanel);
                uploadCard.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        triggerUploadPanel();
                    }
                });
            }

            // Outils — Helper générique pour rendre une card cliquable au clavier
            const bindCardAction = (id, handler) => {
                const card = document.getElementById(id);
                if (!card) return;
                card.addEventListener('click', handler);
                card.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handler();
                    }
                });
            };

            // Outils — Scout (réunif Lot B) : mode plein-écran in-app (boîte bbox
            // sur la vraie carte + moisson Overpass). Remplace l'ancien onglet
            // séparé tools/scout.html (supprimé en Lot C).
            bindCardAction('btn-cc-tool-scout', async () => {
                closeCCModal();
                const { startScout } = await import('./scout.js');
                startScout();
            });

            // Outils — Compléter les quartiers (dégel de Zone). Récupère les quartiers
            // OSM sur l'étendue RÉELLE des POIs et complète le fichier {id}-zones.geojson
            // (brouillon LOCAL → IndexedDB ; dest GitHub / publiée → push GitHub). Ne
            // touche AUCUN POI : la Zone se dérive désormais à la volée de ce fichier
            // (getDerivedZone), donc compléter+pousser le fichier re-zone tout le monde
            // automatiquement au prochain chargement, sans « Tout publier ».
            bindCardAction('btn-cc-tool-recalc-zones', async () => {
                const mapId = state.currentMapId;
                const dest = state.destinations?.maps?.[mapId];
                if (!dest) {
                    showToast('Aucune destination active.', 'warning', 3500);
                    return;
                }
                if (!(state.loadedFeatures || []).length) {
                    showToast('Cette destination ne contient aucun lieu.', 'warning', 3500);
                    return;
                }
                const isLocalDraft = dest.custom === true;
                // Dest GitHub / publiée → push du fichier de zones → token requis. Un
                // brouillon local persiste ses zones en IndexedDB → pas de token.
                if (!isLocalDraft && !getStoredToken()) {
                    showToast('Connecte ton token GitHub (onglet Connexion) pour pousser les quartiers.', 'warning', 4500);
                    return;
                }
                const { hwConfirm, hwAlert } = await import('./modal.js');
                closeCCModal();
                const pushNote = isLocalDraft
                    ? '<p>Les quartiers seront enregistrés sur cet appareil (brouillon local).</p>'
                    : '<p>Le fichier des quartiers sera poussé sur GitHub. Au prochain chargement, les lieux retrouveront leur quartier <strong>automatiquement</strong> (plus besoin de « Tout publier »).</p>';
                const ok = await hwConfirm({
                    title: 'Compléter les quartiers',
                    body: `<p>Compléter les quartiers de <strong>${escapeXml(dest.name || mapId)}</strong> ?</p>`
                        + '<p>Heripia récupère les quartiers OpenStreetMap sur l\'étendue réelle des lieux et complète ceux qui manquaient. La zone de chaque lieu se recalcule alors toute seule.</p>'
                        + pushNote,
                    confirmLabel: 'Compléter',
                    cancelLabel: 'Annuler',
                });
                if (!ok) return;
                try {
                    showToast('Récupération des quartiers OpenStreetMap…', 'info', 4000);
                    const { completeDestinationZones } = await import('./recalc-zones.js');
                    const res = await completeDestinationZones();

                    // Push du fichier de zones UNIQUEMENT si le jeu a changé (zonesAdded > 0) :
                    // re-compléter une dest déjà complète ne doit pas créer un commit identique.
                    // Un brouillon LOCAL a déjà persisté ses zones dans completeDestinationZones.
                    let pushedNote = '';
                    if (res.isLocalDraft) {
                        pushedNote = '<p>Quartiers enregistrés sur cet appareil ✓</p>';
                    } else if (res.zonesAdded > 0) {
                        const { pushDestinationZones } = await import('./publish-destination.js');
                        await pushDestinationZones(res.mapId, res.zones, (msg) => showToast(msg, 'info', 2500));
                        pushedNote = '<p>Fichier des quartiers poussé sur GitHub ✓</p>';
                    } else {
                        pushedNote = '<p>Aucun nouveau quartier à ajouter (jeu déjà complet).</p>';
                    }

                    const finalNote = res.isLocalDraft
                        ? ''
                        : (res.zonesAdded > 0
                            ? '<p>Recharge l\'app après le déploiement GitHub Pages (~1-2 min) pour voir le re-zonage.</p>'
                            : '');
                    await hwAlert({
                        title: 'Quartiers complétés ✓',
                        body: `<p><strong>${res.zonesAdded}</strong> quartier(s) ajouté(s) (${res.zonesTotal} au total).</p>`
                            + '<p>La zone des lieux est recalculée à la volée — carte et filtre sont déjà à jour ici.</p>'
                            + pushedNote
                            + finalNote,
                    });
                } catch (e) {
                    await hwAlert({
                        title: 'Échec',
                        body: `<p>La récupération des quartiers n'a pas abouti :</p><p><em>${escapeXml(e.message)}</em></p>`
                            + '<p>Rien n\'a été publié — tu peux réessayer.</p>',
                    });
                }
            });

            // Outils — « Corbeille des rejets » (chantier rejets, PR-2) : ouvre la modale
            // qui liste les tombstones de curation Scout ({dest}-rejected.json), avec
            // RESTAURATION par item (re-crée le candidat depuis l'instantané, sans
            // re-scan) + « Tout vider » (bulk, ex-soupape PR-1, désormais dans la modale).
            bindCardAction('btn-cc-tool-rejected-trash', async () => {
                const dest = state.destinations?.maps?.[state.currentMapId];
                if (!dest) {
                    showToast('Aucune destination active.', 'warning', 3500);
                    return;
                }
                closeCCModal();
                const { openRejectedTrash } = await import('./rejected-trash-ui.js');
                openRejectedTrash();
            });

            // Outils — « Rendre publique » (MODÈLE C) : bascule status:draft → published
            // (setDestinationPublished, un micro-push de destinations.json). Visible sur
            // toute destination non publiée. La curation a déjà été poussée par « Tout
            // publier » ; ici on ne fait que la rendre visible de tous.
            bindCardAction('btn-cc-tool-publish-public', async () => {
                const mapId = state.currentMapId;
                const dest = state.destinations?.maps?.[mapId];
                if (!dest || dest.status === 'published') {
                    showToast('Cette destination est déjà publique.', 'warning', 3500);
                    return;
                }
                // Même générateur que le push : le compte affiché = le compte publié.
                // keepCandidates:false → seuls les lieux CURÉS comptent (candidats écartés).
                const { generateMasterGeoJSONData } = await import('./admin-geojson.js');
                const { isCandidate, getPoiId } = await import('./utils.js');
                const n = generateMasterGeoJSONData([], { keepCandidates: false })?.features?.length || 0;
                // Garde hiddenPoiIds (comme le filtre, data.js:435) : un candidat SUPPRIMÉ
                // (masqué via hiddenPoiIds par deletePoi sans être retiré de loadedFeatures)
                // ne doit PAS compter dans « lieux à curer ».
                const candCount = (state.loadedFeatures || []).filter(
                    (f) => isCandidate(f) && !(state.hiddenPoiIds || []).includes(getPoiId(f))
                ).length;
                if (n === 0) {
                    showToast('Aucun lieu curé à publier — valide au moins un lieu (« Valider ») d\'abord.', 'warning', 4500);
                    return;
                }
                const { hwConfirm, hwAlert } = await import('./modal.js');
                closeCCModal(); // fermer le CC avant les modales (évite l'empilement)
                const candNote = candCount > 0
                    ? `<p><strong>${candCount} lieu(x) encore à curer</strong> resteront privés (gardés en local pour les curer plus tard).</p>`
                    : '';
                const ok = await hwConfirm({
                    title: 'Rendre publique',
                    body: `<p>Rendre <strong>${escapeXml(dest.name || mapId)}</strong> <em>visible de tous</em> ?</p>`
                        + `<p>${n} lieu(x) curé(s) seront publiés.</p>`
                        + candNote
                        + `<p>Astuce : fais « Tout publier » avant si tu veux aussi publier circuits et photos.</p>`,
                    confirmLabel: 'Rendre publique',
                    cancelLabel: 'Annuler',
                });
                if (!ok) return;
                try {
                    const { setDestinationPublished } = await import('./publish-destination.js');
                    const res = await setDestinationPublished(mapId, (msg) => showToast(msg, 'info', 2500));
                    const keptNote = res.candidatesKept > 0
                        ? `<p>${res.candidatesKept} lieu(x) à curer gardé(s) en local (non publics).</p>`
                        : '';
                    await hwAlert({
                        title: 'Destination publiée ✓',
                        body: `<p><strong>${escapeXml(res.name)}</strong> est désormais publique (${res.pois} lieu(x)).</p>`
                            + keptNote
                            + `<p>Visible de tous d'ici 1 à 2 min (déploiement GitHub Pages).</p>`,
                    });
                } catch (e) {
                    await hwAlert({
                        title: 'Échec de la publication',
                        body: `<p>La publication n'a pas abouti :</p><p><em>${escapeXml(e.message)}</em></p>`
                            + `<p>Rien n'a changé — tu peux réessayer.</p>`,
                    });
                }
            });

            // Outils — « Supprimer cette destination » (MODÈLE C, PR-4b-1) : brouillon
            // GitHub. Supprime sur GitHub (deleteDraftFromGitHub : entrée EN PREMIER, puis
            // fichiers) PUIS purge les données LOCALES (deleteLocalDraftDestination), puis
            // bascule sur la dest publiée par défaut + reload. Réservé aux brouillons (D1).
            bindCardAction('btn-cc-tool-delete-dest-gh', async () => {
                const mapId = state.currentMapId;
                const dest = state.destinations?.maps?.[mapId];
                if (!dest || dest.status === 'published') {
                    showToast('Une destination publiée ne peut pas être supprimée ici.', 'warning', 3500);
                    return;
                }
                const name = dest.name || mapId;
                const fallback = state.destinations?.activeMapId || 'djerba';
                const { hwConfirm, hwAlert } = await import('./modal.js');
                closeCCModal();
                const ok = await hwConfirm({
                    title: 'Supprimer la destination',
                    body: `<p>Supprimer définitivement le brouillon <strong>${escapeXml(name)}</strong> ?</p>`
                        + `<p>La destination sera <strong>retirée de GitHub</strong> (elle disparaît pour tous) et <strong>toutes ses données locales</strong> (lieux scoutés/curés, circuits, photos, zones) seront effacées. <strong>Action irréversible.</strong></p>`
                        + `<p>Astuce : fais d'abord une <em>Sauvegarde</em> si tu veux pouvoir le restaurer.</p>`,
                    confirmLabel: 'Supprimer',
                    cancelLabel: 'Annuler',
                });
                if (!ok) return;
                try {
                    const { deleteDraftFromGitHub } = await import('./publish-destination.js');
                    await deleteDraftFromGitHub(mapId, (msg) => showToast(msg, 'info', 2500));
                    // Purge locale (customPois, userData, circuits, photos, zones, scan box).
                    const { deleteLocalDraftDestination } = await import('./local-destinations.js');
                    await deleteLocalDraftDestination(mapId);
                    try { localStorage.setItem('hw_active_dest', fallback); } catch (_) {}
                    showToast(`Brouillon « ${name} » supprimé.`, 'success', 2500);
                    setTimeout(() => { location.href = `${location.pathname}?map=${encodeURIComponent(fallback)}`; }, 700);
                } catch (e) {
                    await hwAlert({
                        title: 'Échec de la suppression',
                        body: `<p>La suppression n'a pas abouti :</p><p><em>${escapeXml(e.message)}</em></p>`
                            + `<p>Rien (ou peu) n'a été supprimé — tu peux réessayer.</p>`,
                    });
                }
            });

            // Outils — Exporter Master GeoJSON : action directe (téléchargement).
            // Import dynamique de admin.js (au lieu d'un import statique en tête)
            // pour casser le cycle admin-control-center → admin-control-ui →
            // admin → admin-control-center. admin.js est déjà chargé à ce stade,
            // l'import est résolu instantanément (cache module).
            bindCardAction('btn-cc-tool-export-master', async () => {
                const { exportMasterGeoJSON } = await import('./admin.js');
                exportMasterGeoJSON();
            });

            // Outils — Importer une carte (GeoJSON) : déclenche le file picker
            // caché qui appelle handleFileLoad (fileManager.js) au change.
            bindCardAction('btn-cc-tool-import-geojson', () => {
                const loader = document.getElementById('geojson-loader');
                if (loader) loader.click();
            });

            // Outils — Passe drapeaux OSM (PR 3/5 chantier point d'accès v2)
            // Ferme le CC puis lance le mode plein-écran (panneau gauche + carte
            // + barre d'action). La sidebar HW V2 est masquée le temps de la
            // session via body.osm-pass-active.
            bindCardAction('btn-cc-tool-osm-pass', async () => {
                closeCCModal();
                const { startOsmPass } = await import('./osm-pass.js');
                startOsmPass();
            });

            // Outils — Mode Données (réunif A3a) : mode plein-écran admin (liste +
            // vraie carte ; RichEditor en tiroir = A3b, filtres/destination = A3c).
            bindCardAction('btn-cc-tool-mode-donnees', async () => {
                closeCCModal();
                const { startModeDonnees } = await import('./mode-donnees.js');
                startModeDonnees();
            });

            // Stat-cards → goto changes sub-view
            const goChanges = (targetSubview) => {
                if (targetSubview) setChangesSubView(targetSubview);
                document.querySelector('.cc-nav-item[data-tab="changes"]')?.click();
            };
            document.querySelectorAll('[data-action="goto-changes"]').forEach(el => {
                el.onclick = () => goChanges(el.dataset.targetSubview);
            });

        }, 0);
    } else if (tab === 'changes') {
        // PR 5 — Sub-router intégré au topbar (.cc-subtabs), groupes typés
        // par couleur sémantique, diff cards sans clipping (multi-ligne).
        const subviewItems = computeChangesSubviewItems(diffData);
        const totalCount = subviewItems.lieux.length + subviewItems.photos.length + subviewItems.circuits.length;

        // Topbar title : indique le total à publier
        updateTopbarTitle('changes', { subOverride: totalCount > 0 ? `${totalCount} en attente` : '' });

        if (totalCount === 0) {
            container.innerHTML = `
                <div class="cc-empty">
                    <div class="cc-empty-mark"><i data-lucide="check-circle-2"></i></div>
                    <h3 class="cc-empty-title">Aucune modification en attente.</h3>
                    <p class="cc-empty-sub">Toutes les modifications locales ont été publiées ou annulées.</p>
                </div>
            `;
            createIcons({ icons: appIcons, root: container });
            return;
        }

        // — Sub-tabs dans le topbar (Lieux / Photos / Circuits) —
        // Intégrés à la barre du panneau plutôt que sous forme de pills internes
        // (un seul paradigme de nav plutôt que deux comme avant).
        const subtabsHtml = renderChangesSubtabs(subviewItems, _changesSubView);
        setTopbarSubtabs(subtabsHtml, (view) => {
            setChangesSubView(view);
            renderTab('changes', diffData, callbacks);
        });

        // — Body : la sous-vue active uniquement —
        let bodyHtml = '';
        if (_changesSubView === 'lieux') {
            bodyHtml = renderLieuxView(subviewItems.lieux);
        } else if (_changesSubView === 'photos') {
            bodyHtml = renderPhotosView(subviewItems.photos);
        } else if (_changesSubView === 'circuits') {
            bodyHtml = renderCircuitsView(subviewItems.circuits);
        }
        container.innerHTML = bodyHtml;

    } else if (tab === 'settings') {
        // PR 7 — Refonte Config : carte connexion GitHub (avatar + scopes badges
        // si token connecté), input PAT avec aide contextuelle, carte dépôt.
        // Layout centré max-width 680px pour la lisibilité.
        const token = getStoredToken() || '';
        const username = getStoredUsername();
        const tokenOk = !!token;

        // — Section Connexion GitHub —
        let connectionHtml = '';
        if (tokenOk) {
            const avatarUrl = username
                ? `https://github.com/${encodeURIComponent(username)}.png?size=96`
                : '';
            connectionHtml = `
                <h4 class="cc-section-title">Connexion GitHub</h4>
                <div class="cc-card cc-card--row cc-card--config">
                    ${avatarUrl ? `<img class="cc-config-avatar" src="${avatarUrl}" alt="" loading="lazy">` : '<div class="cc-card-ico"><i data-lucide="github"></i></div>'}
                    <div class="cc-card-text">
                        <div class="cc-card-title">${username ? `@${username}` : 'Token configuré'}</div>
                        <div class="cc-config-badges">
                            <span class="status-badge sb-ok"><span class="dot"></span>repo</span>
                            <span class="status-badge sb-ok"><span class="dot"></span>gist</span>
                        </div>
                    </div>
                    <div class="cc-card-meta">
                        <button class="cc-diff-btn cc-diff-btn--danger" type="button" id="btn-cc-disconnect" title="Supprimer le token">
                            <i data-lucide="log-out"></i> Déconnecter
                        </button>
                    </div>
                </div>
            `;
        } else {
            connectionHtml = `
                <h4 class="cc-section-title">Connexion GitHub</h4>
                <div class="cc-card cc-card--row cc-card--config">
                    <div class="cc-card-ico cc-card-ico--danger">
                        <i data-lucide="github"></i>
                    </div>
                    <div class="cc-card-text">
                        <div class="cc-card-title">Aucun token configuré</div>
                        <div class="cc-card-sub">Connecte ton compte GitHub pour publier les modifications.</div>
                    </div>
                </div>
            `;
        }

        // — Section Personal Access Token (input) —
        const patHtml = `
            <h4 class="cc-section-title">Personal Access Token</h4>
            <div class="cc-card cc-card--padded cc-card--block">
                <div class="cc-config-pat-header">
                    <p class="cc-card-hint">
                        Token stocké localement sur cet appareil.
                    </p>
                    <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener" class="cc-config-help" id="link-cc-pat-help">
                        <i data-lucide="external-link"></i> Comment créer un PAT&nbsp;?
                    </a>
                </div>
                <input type="password" id="cc-token-input" value="${token}" class="cc-config-input" placeholder="ghp_••••••••••••••••••••••••" autocomplete="off" spellcheck="false">
                <button id="btn-save-token" class="cc-btn-cta cc-btn-cta--full">
                    <i data-lucide="save"></i> Sauvegarder
                </button>
                <div class="cc-config-scopes-note">
                    <strong>Scopes requis :</strong>
                    <code>repo</code> (publier les modifications)
                    · <code>gist</code> (sync inter-devices admin)
                </div>
            </div>
        `;

        // — Section Dépôt GitHub —
        const repoHtml = `
            <h4 class="cc-section-title">Dépôt GitHub</h4>
            <div class="cc-card cc-card--row">
                <div class="cc-card-ico"><i data-lucide="github"></i></div>
                <div class="cc-card-text">
                    <div class="cc-card-title">${GITHUB_OWNER} / ${GITHUB_REPO}</div>
                    <div class="cc-card-sub">Branche <code>main</code> · destination de publication</div>
                </div>
                <div class="cc-card-meta">
                    <a class="cc-diff-btn" href="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}" target="_blank" rel="noopener" title="Ouvrir le dépôt sur GitHub">
                        <i data-lucide="external-link"></i> Ouvrir
                    </a>
                </div>
            </div>
        `;

        container.innerHTML = `
            <div class="cc-config-layout">
                ${connectionHtml}
                ${patHtml}
                ${repoHtml}
            </div>
        `;

        setTimeout(() => {
            const btnSave = document.getElementById('btn-save-token');
            if (btnSave) btnSave.onclick = async () => {
                const val = document.getElementById('cc-token-input').value.trim();
                if (!val) {
                    saveToken('');
                    showToast('Token supprimé', 'info');
                    renderTab('settings', diffData, callbacks);
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
                    renderTab('settings', diffData, callbacks);
                } finally {
                    btnSave.disabled = false;
                    btnSave.innerHTML = originalHTML;
                    createIcons({ icons: appIcons, root: btnSave });
                }
            };

            // — Déconnecter —
            document.getElementById('btn-cc-disconnect')?.addEventListener('click', () => {
                saveToken('');
                showToast('Déconnecté de GitHub', 'info');
                renderTab('settings', diffData, callbacks);
            });
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

/**
 * PR 5 — Subtabs format pour le topbar (sub-router intégré).
 * Remplace l'ancien `renderChangesSubnav` (pills internes au panneau).
 */
function renderChangesSubtabs(subviewItems, activeView) {
    const tab = (view, label, count) => `
        <button class="cc-subtab${activeView === view ? ' is-active' : ''}"
                type="button" role="tab"
                aria-selected="${activeView === view}"
                data-sub="${view}">
            ${label}<span class="cc-subtab-count">${count}</span>
        </button>
    `;
    return tab('lieux',    'Lieux',    subviewItems.lieux.length)
         + tab('photos',   'Photos',   subviewItems.photos.length)
         + tab('circuits', 'Circuits', subviewItems.circuits.length);
}

function renderLieuxView(items) {
    if (items.length === 0) {
        return `<div class="cc-empty"><div class="cc-empty-mark"><i data-lucide="check-circle-2"></i></div><h3 class="cc-empty-title">Aucun lieu modifié.</h3></div>`;
    }
    const groups = {
        new: items.filter(p => p.isCreation),
        mod: items.filter(p => !p.isCreation && !p.isDeletion && !p.isMigration),
        del: items.filter(p => p.isDeletion),
        mig: items.filter(p => p.isMigration),
    };
    let html = '';
    html += renderItemGroup('Nouveau',   groups.new, 'new', { showEdit: true,  showPhotoGrid: false, scope: 'poi' });
    html += renderItemGroup('Modifié',   groups.mod, 'mod', { showEdit: true,  showPhotoGrid: false, scope: 'poi' });
    html += renderItemGroup('Supprimé',  groups.del, 'del', { showEdit: false, showPhotoGrid: false, scope: 'poi' });
    html += renderItemGroup('Migré',     groups.mig, 'mig', { showEdit: false, showPhotoGrid: false, scope: 'poi' });
    return html;
}

function renderPhotosView(items) {
    if (items.length === 0) {
        return `<div class="cc-empty"><div class="cc-empty-mark"><i data-lucide="check-circle-2"></i></div><h3 class="cc-empty-title">Aucune photo en attente.</h3></div>`;
    }
    return renderItemGroup('Photos à publier', items, 'photos', { showEdit: false, showPhotoGrid: true, scope: 'photos' });
}

function renderCircuitsView(items) {
    if (items.length === 0) {
        return `<div class="cc-empty"><div class="cc-empty-mark"><i data-lucide="check-circle-2"></i></div><h3 class="cc-empty-title">Aucun circuit modifié.</h3></div>`;
    }
    const groups = {
        new: items.filter(c => c.isCreation),
        mod: items.filter(c => !c.isCreation && !c.isDeletion),
        del: items.filter(c => c.isDeletion),
    };
    let html = '';
    html += renderItemGroup('Nouveau',  groups.new, 'new', { showEdit: false, showPhotoGrid: false, scope: 'circuit' });
    html += renderItemGroup('Modifié',  groups.mod, 'mod', { showEdit: false, showPhotoGrid: false, scope: 'circuit' });
    html += renderItemGroup('Supprimé', groups.del, 'del', { showEdit: false, showPhotoGrid: false, scope: 'circuit' });
    return html;
}

/**
 * PR 5 — Refonte du rendu d'un groupe d'items (Nouveau/Modifié/Supprimé/Migré/Photos).
 *
 * Format : titre groupé avec couleur sémantique + glyph ▸ + compteur, puis liste
 * de `.cc-diff` cards. Chaque card a un header (tag, name, actions) et un body
 * grid 2 colonnes (key/value) sans clipping (multi-ligne libre).
 *
 * @param {string} title — libellé du groupe ("Nouveau", "Modifié", etc.)
 * @param {Array} items — éléments diffData à afficher
 * @param {string} kind — 'new' | 'mod' | 'del' | 'mig' | 'photos' (couleur sémantique)
 * @param {Object} opts — { showEdit, showPhotoGrid, scope }
 */
function renderItemGroup(title, items, kind, opts) {
    if (items.length === 0) return '';

    const tagLabels = {
        new: 'Nouveau', mod: 'Modifié', del: 'Supprimé', mig: 'Migré', photos: 'Photos',
    };
    const tagClass = `tag-${kind === 'photos' ? 'mod' : kind}`;

    let html = `<div class="cc-diff-group cc-diff-group--${kind}">
        <h4 class="cc-diff-group-typed-title">
            ${title}<span class="cc-diff-group-count">· ${items.length}</span>
        </h4>`;

    html += items.map(item => {
        const refuseTitle = item.isDeletion
            ? 'Restaurer ce lieu'
            : (opts.scope === 'photos' ? 'Retirer les photos pending de ce lieu' : 'Effacer cette modification locale');
        const refuseLabel = item.isDeletion ? 'Restaurer' : 'Annuler';
        const refuseIcon  = item.isDeletion ? 'rotate-ccw' : 'x';
        const showEdit    = opts.showEdit && !item.isDeletion && !item.isMigration;

        // Header : tag sémantique + nom + actions
        const headerHtml = `
            <div class="cc-diff-head">
                <span class="cc-diff-tag ${tagClass}">${tagLabels[kind] || tagLabels.mod}</span>
                <div class="cc-diff-name">${escapeXml(item.name)}</div>
                <div class="cc-diff-actions">
                    ${showEdit ? `<button class="cc-diff-btn cc-diff-btn--primary" data-action="open-editor" data-id="${item.id}" title="Ouvrir l'éditeur pour vérifier avant publication">
                        <i data-lucide="edit-3"></i> Réviser
                    </button>` : ''}
                    <button class="cc-diff-btn cc-diff-btn--danger" data-action="refuse" data-id="${item.id}" data-scope="${opts.scope}" title="${refuseTitle}">
                        <i data-lucide="${refuseIcon}"></i> ${refuseLabel}
                    </button>
                </div>
            </div>
        `;

        // Body : grid key/value 2 colonnes, multi-ligne, sans clipping
        let bodyHtml = '';
        if (item.isDeletion) {
            bodyHtml = `<div class="cc-diff-body">
                <div class="cc-diff-note cc-diff-note--del">
                    <i data-lucide="alert-triangle"></i> Sera supprimé de la carte officielle
                </div>
            </div>`;
        } else if (item.isCreation && (!item.changes || item.changes.length === 0)) {
            bodyHtml = `<div class="cc-diff-body">
                <div class="cc-diff-note cc-diff-note--new">
                    <i data-lucide="sparkles"></i> Nouveau lieu — aucun champ antérieur
                </div>
            </div>`;
        } else if (item.changes && item.changes.length > 0) {
            const rows = item.changes.map(c => `
                <div class="cc-diff-key">${escapeXml(c.key)}</div>
                <div class="cc-diff-val">
                    ${c.old !== undefined && c.old !== null && c.old !== ''
                        ? `<div class="cc-diff-old">${escapeXml(c.old)}</div>` : ''}
                    <div class="cc-diff-new">${c.new !== undefined ? escapeXml(c.new) : '—'}</div>
                </div>
            `).join('');
            bodyHtml = `<div class="cc-diff-body">${rows}</div>`;
        }

        const photoGrid = opts.showPhotoGrid ? renderPendingPhotoGrid(item) : '';

        return `
        <div class="cc-diff" id="cc-diff-item-${item.id}">
            ${headerHtml}
            ${bodyHtml}
            ${photoGrid}
        </div>`;
    }).join('');

    html += `</div>`;
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
            <span class="cc-subpanel-title">Publier un circuit</span>
        </div>

        <div class="cc-card cc-card--padded cc-card--block">
            <div class="cc-upload-intro">
                <i data-lucide="upload-cloud" class="icon-amber cc-upload-icon"></i>
                <p>Publiez un fichier GPX directement sur GitHub.<br>
                <small class="cc-upload-intro-note">Le serveur mettra à jour l'index automatiquement.</small></p>
            </div>

            <label class="cc-upload-field-label">Nom du circuit <small>(optionnel — extrait du fichier si absent)</small></label>
            <input type="text" id="cc-circuit-name" class="settings-input" placeholder="Ex : Circuit du Patrimoine">

            <label class="cc-upload-field-label cc-upload-field-label--spaced">
                Fichier <span class="cc-format-badge">GPX</span>
            </label>
            <div class="cc-file-drop" id="cc-file-drop">
                <i data-lucide="file-plus"></i>
                <span>Cliquer pour choisir un fichier</span>
                <small>GPX uniquement</small>
            </div>
            <input type="file" id="cc-file-input" accept=".gpx" class="is-hidden">
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
        const mapId = state.currentMapId || 'djerba';
        const path = GITHUB_PATHS.circuitFile(mapId, file.name);

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

// renderDiffDetails — fonction LEGACY supprimée (cleanup post-refonte design).
// Le rendu des diffs passe désormais par `renderItemGroup` (PR 5) qui produit
// directement les `.cc-diff-body` (grid key/value sans clipping). Plus besoin
// d'un rendu de "détails" séparé — la structure neuve est plate.
