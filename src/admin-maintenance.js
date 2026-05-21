import { state, removeMyCircuit } from './state.js';
import { getStoredToken, deleteFileFromGitHub } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, RAW_BASE, GITHUB_PATHS } from './config.js';
import { deleteCircuitById, restoreCircuit } from './database.js';
import { showToast } from './toast.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showConfirm } from './modal.js';
import { setTopbarSubtabs } from './admin-cc-topbar.js';

// PR 6 — Refonte de l'onglet Nettoyage : sub-router 2 onglets (Corbeille locale
// / Fichiers serveur) intégré au topbar du shell, items en `.cc-card.cc-card--row`
// (pattern partagé avec les autres onglets, fini la fragmentation visuelle de
// `.maint-section`).

// --- STATE ---
let serverCircuits = [];
let deletedCircuits = [];
let _scanned = false;            // true après la première analyse
let _maintSubView = 'trash';     // 'trash' (corbeille locale) | 'server'

/**
 * Récupère l'index officiel depuis le serveur (bypass cache)
 */
async function fetchServerCircuits() {
    const mapId = state.currentMapId || 'djerba';
    const timestamp = Date.now();
    const url = `${RAW_BASE}/${GITHUB_PATHS.circuits(mapId)}?t=${timestamp}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Impossible de charger circuits.json");
        return await response.json();
    } catch (e) {
        console.error("Erreur fetch circuits:", e);
        showToast("Erreur lors du chargement de la liste serveur.", "error");
        return [];
    }
}

async function runAnalysis(container) {
    container.innerHTML = `
        <div class="cc-empty">
            <div class="cc-empty-mark"><i data-lucide="loader-2" class="spin"></i></div>
            <h3 class="cc-empty-title">Analyse en cours…</h3>
            <p class="cc-empty-sub">Lecture des fichiers du serveur GitHub.</p>
        </div>
    `;
    createIcons({ icons: appIcons, root: container });

    serverCircuits = await fetchServerCircuits();
    deletedCircuits = state.myCircuits.filter(c => c.isDeleted);
    _scanned = true;

    renderResults(container);
}

/**
 * Render principal — sub-tabs dans le topbar + contenu de la sous-vue active.
 */
function renderResults(container) {
    const hasToken = !!getStoredToken();

    // — Sub-tabs dans le topbar (Corbeille locale / Fichiers serveur) —
    const subtabsHtml = renderMaintSubtabs(_maintSubView, deletedCircuits.length, serverCircuits.length);
    setTopbarSubtabs(subtabsHtml, (view) => {
        _maintSubView = view;
        renderResults(container);
    });

    // — Bandeau si pas de token (lecture seule) —
    const tokenBanner = !hasToken ? `
        <div class="cc-banner cc-banner--warn">
            <i data-lucide="alert-triangle"></i>
            <div>
                <strong>Mode lecture seule</strong> — Le token GitHub est requis pour supprimer des fichiers.
            </div>
        </div>
    ` : '';

    // — Contenu de la sous-vue active —
    let bodyHtml = '';
    if (_maintSubView === 'trash') {
        bodyHtml = renderTrashView(deletedCircuits);
    } else {
        bodyHtml = renderServerView(serverCircuits, hasToken);
    }

    container.innerHTML = tokenBanner + bodyHtml;
    createIcons({ icons: appIcons, root: container });

    bindEvents(container);
}

function renderMaintSubtabs(activeView, trashCount, serverCount) {
    const tab = (view, label, count) => `
        <button class="cc-subtab${activeView === view ? ' is-active' : ''}"
                type="button" role="tab"
                aria-selected="${activeView === view}"
                data-sub="${view}">
            ${label}<span class="cc-subtab-count">${count}</span>
        </button>
    `;
    return tab('trash',  'Corbeille locale', trashCount)
         + tab('server', 'Fichiers serveur', serverCount);
}

/**
 * Sous-vue Corbeille locale : circuits marqués `isDeleted` dans IndexedDB.
 * Item titre en line-through pour signaler l'état "supprimé localement".
 * Actions : Restaurer (revenir dans la liste active) / Supprimer définitivement.
 */
function renderTrashView(items) {
    if (items.length === 0) {
        return `
            <div class="cc-empty">
                <div class="cc-empty-mark"><i data-lucide="trash-2"></i></div>
                <h3 class="cc-empty-title">Corbeille vide.</h3>
                <p class="cc-empty-sub">Aucun circuit supprimé localement à restaurer ou purger.</p>
            </div>
        `;
    }

    const itemsHtml = items.map(c => `
        <div class="cc-card cc-card--row cc-card--trash">
            <div class="cc-card-ico"><i data-lucide="archive"></i></div>
            <div class="cc-card-text">
                <div class="cc-card-title cc-card-title--struck">${c.name}</div>
                <div class="cc-card-sub">${c.poiIds ? c.poiIds.length : 0} étape${c.poiIds && c.poiIds.length > 1 ? 's' : ''} · ${c.id}</div>
            </div>
            <div class="cc-card-meta">
                <button class="cc-diff-btn" data-action="restore-local" data-id="${c.id}" title="Restaurer ce circuit" aria-label="Restaurer">
                    <i data-lucide="rotate-ccw"></i> Restaurer
                </button>
                <button class="cc-diff-btn cc-diff-btn--danger" data-action="purge-local" data-id="${c.id}" title="Supprimer définitivement" aria-label="Supprimer définitivement">
                    <i data-lucide="x"></i>
                </button>
            </div>
        </div>
    `).join('');

    return `
        <h4 class="cc-section-title">Circuits archivés · ${items.length}</h4>
        ${itemsHtml}
    `;
}

/**
 * Sous-vue Fichiers serveur : liste de tous les circuits publiés sur GitHub.
 * Trie par nom de fichier pour regrouper les variantes.
 */
function renderServerView(items, hasToken) {
    if (items.length === 0) {
        return `
            <div class="cc-empty">
                <div class="cc-empty-mark"><i data-lucide="server"></i></div>
                <h3 class="cc-empty-title">Aucun fichier sur le serveur.</h3>
                <p class="cc-empty-sub">L'index officiel est vide.</p>
            </div>
        `;
    }

    const sorted = [...items].sort((a, b) => a.file.localeCompare(b.file));

    const itemsHtml = sorted.map(c => {
        const fileName = c.file.split('/').pop();
        const folder = c.file.split('/')[0];
        return `
            <div class="cc-card cc-card--row">
                <div class="cc-card-ico"><i data-lucide="file"></i></div>
                <div class="cc-card-text">
                    <div class="cc-card-title">${c.name}</div>
                    <div class="cc-card-sub"><code>${folder}/${fileName}</code> · ${c.distance || ''}</div>
                </div>
                ${hasToken ? `
                <div class="cc-card-meta">
                    <button class="cc-diff-btn cc-diff-btn--danger" data-action="delete-server" data-path="public/circuits/${c.file}" data-name="${c.name}" title="Supprimer définitivement du serveur" aria-label="Supprimer du serveur">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
                ` : ''}
            </div>
        `;
    }).join('');

    return `
        <div class="cc-section-title--row">
            <h4 class="cc-section-title">Fichiers publiés · ${items.length}</h4>
            <button id="btn-refresh-maintenance" class="cc-btn-ghost" type="button" title="Re-scanner le serveur">
                <i data-lucide="refresh-cw"></i> Actualiser
            </button>
        </div>
        ${itemsHtml}
    `;
}

function bindEvents(container) {
    // Refresh
    container.querySelector('#btn-refresh-maintenance')?.addEventListener('click', () => runAnalysis(container));

    // Local trash actions
    container.querySelectorAll('[data-action="restore-local"]').forEach(btn => {
        btn.addEventListener('click', () => handleRestoreLocal(btn.dataset.id, container));
    });
    container.querySelectorAll('[data-action="purge-local"]').forEach(btn => {
        btn.addEventListener('click', () => handlePurgeLocal(btn.dataset.id, container));
    });

    // Server delete
    container.querySelectorAll('[data-action="delete-server"]').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteClick(btn.dataset.path, btn.dataset.name, container));
    });
}

async function handleRestoreLocal(id, container) {
    if (!await showConfirm("Restaurer", "Voulez-vous restaurer ce circuit ?", "Restaurer", "Annuler")) return;
    try {
        await restoreCircuit(id);
        const c = state.myCircuits.find(x => String(x.id) === String(id));
        if (c) c.isDeleted = false;

        showToast("Circuit restauré !", "success");
        runAnalysis(container);
    } catch (e) {
        console.error(e);
        showToast("Erreur restauration", "error");
    }
}

async function handlePurgeLocal(id, container) {
    if (!await showConfirm("Suppression Définitive", "Voulez-vous vraiment effacer ce circuit de la base de données locale ?\nCette action est irréversible.", "Supprimer", "Annuler", true)) return;
    try {
        await deleteCircuitById(id);
        removeMyCircuit(id);

        showToast("Circuit effacé définitivement !", "success");
        runAnalysis(container);
    } catch (e) {
        console.error(e);
        showToast("Erreur purge", "error");
    }
}

async function handleDeleteClick(path, name, container) {
    if (!await showConfirm(
        "Suppression Serveur",
        `ATTENTION : Vous allez supprimer définitivement le fichier :\n\n${path}\n\nCela retirera le circuit "${name}" de l'application pour tout le monde.\nConfirmer ?`,
        "Supprimer",
        "Annuler",
        true
    )) return;

    const token = getStoredToken();
    if (!token) return showToast("Token manquant.", "error");

    try {
        showToast("Suppression en cours...", "info");
        await deleteFileFromGitHub(token, GITHUB_OWNER, GITHUB_REPO, path, `chore(admin): Suppression ${path}`);
        showToast("Fichier supprimé avec succès !", "success");
        runAnalysis(container);
    } catch (e) {
        console.error(e);
        showToast("Erreur : " + e.message, "error");
    }
}

/**
 * Point d'entrée — appelé par renderTab('maintenance') depuis admin-control-ui.
 * Auto-scan au premier affichage : pas de "welcome" intermédiaire qui ajoute un
 * clic inutile (l'admin est dans le CC pour gérer, pas pour confirmer un scan).
 */
export function renderMaintenanceTab(container) {
    if (!_scanned) {
        runAnalysis(container);
    } else {
        renderResults(container);
    }
}
