import { state, removeMyCircuit, setOfficialCircuits } from './state.js';
import { fetchWithTimeout } from './net.js';
import { getStoredToken, deleteFileFromGitHub, uploadFileToGitHub } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, RAW_BASE, GITHUB_PATHS } from './config.js';
import { deleteCircuitById, restoreCircuit } from './database.js';
import { setOfficialCircuitDeleted } from './circuit-deletion-state.js';
import { noteServerDeletedCircuit } from './admin-diff-engine.js';
import { eventBus } from './events.js';
import { showToast } from './toast.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showConfirm } from './modal.js';
import { setTopbarSubtabs } from './admin-cc-topbar.js';

// PR 6 — Refonte de l'onglet Nettoyage : sub-router 2 onglets (Corbeille locale
// / Circuits publiés) intégré au topbar du shell, items en `.cc-card.cc-card--row`
// (pattern partagé avec les autres onglets, fini la fragmentation visuelle de
// `.maint-section`).

// --- STATE ---
let serverCircuits = [];
let deletedCircuits = [];
let _maintSubView = 'trash';     // 'trash' (corbeille locale) | 'server'

/**
 * Récupère l'index officiel depuis le serveur (bypass cache)
 */
async function fetchServerCircuits() {
    const mapId = state.currentMapId || 'djerba';
    const timestamp = Date.now();
    const url = `${RAW_BASE}/${GITHUB_PATHS.circuits(mapId)}?t=${timestamp}`;

    try {
        const response = await fetchWithTimeout(url);
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
            <p class="cc-empty-sub">Lecture de l’index des circuits publiés.</p>
        </div>
    `;
    createIcons({ icons: appIcons, root: container });

    serverCircuits = await fetchServerCircuits();
    deletedCircuits = state.myCircuits.filter(c => c.isDeleted);

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
         + tab('server', 'Circuits publiés', serverCount);
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
                <h3 class="cc-empty-title">Aucun circuit publié.</h3>
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
                    <button class="cc-diff-btn cc-diff-btn--danger" data-action="delete-server" data-id="${c.id}" data-path="public/circuits/${c.file}" data-name="${c.name}" title="Supprimer ce circuit du serveur (GPX + index)" aria-label="Supprimer ce circuit du serveur">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
                ` : ''}
            </div>
        `;
    }).join('');

    return `
        <div class="cc-section-title--row">
            <h4 class="cc-section-title">Circuits publiés · ${items.length}</h4>
            <button id="btn-refresh-maintenance" class="cc-btn-ghost" type="button" title="Relire l’index sur le serveur">
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
        btn.addEventListener('click', () => handleDeleteClick(btn.dataset.id, btn.dataset.path, btn.dataset.name, container));
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

/**
 * Suppression COMPLÈTE d'un circuit publié : fichier GPX + entrée d'index.
 *
 * Historiquement (jusqu'au 04/09/2026) cet écran ne supprimait que le fichier
 * brut et comptait sur l'Action `update-circuits.yml` pour régénérer l'index.
 * Ce bot était mort depuis le 25/05/2026 (push rejeté sur branche protégée) et a
 * été retiré le 05/09/2026 : le GPX partait, l'entrée d'index restait. Conséquences observées en série :
 *   - l'item restait affiché à l'identique dans cette liste (elle est construite
 *     depuis l'index, pas depuis le contenu réel du dossier) → l'admin
 *     recliquait, en boucle, sans jamais voir le circuit disparaître ;
 *   - côté visiteur, le circuit restait listé mais son GPX renvoyait 404.
 * On fait donc les deux écritures ici, dans le même geste.
 *
 * @param {string} id ID du circuit (clé de l'entrée d'index)
 * @param {string} path Chemin du GPX dans le dépôt (`public/circuits/…`)
 * @param {string} name Nom du circuit, pour les messages
 */
async function handleDeleteClick(id, path, name, container) {
    if (!await showConfirm(
        "Supprimer ce circuit",
        `«\u00a0${name}\u00a0» sera retiré de Heripia pour tout le monde, immédiatement.\n\nSon fichier GPX et son entrée dans l'index sont supprimés du serveur. Cette action est irréversible.`,
        "Supprimer",
        "Annuler",
        true
    )) return;

    const token = getStoredToken();
    if (!token) return showToast("Token manquant.", "error");

    const mapId = state.currentMapId || 'djerba';

    try {
        showToast("Suppression en cours...", "info");

        // 1. Le fichier GPX. Un GPX déjà absent n'est PAS une erreur : c'est
        //    l'état laissé par les suppressions partielles d'avant ce correctif.
        //    On poursuit pour nettoyer l'index — c'est justement la réparation.
        let gpxMissing = false;
        try {
            await deleteFileFromGitHub(token, GITHUB_OWNER, GITHUB_REPO, path, `feat(circuit): Suppression "${name}"`);
        } catch (e) {
            gpxMissing = true;
            console.warn('[Nettoyage] GPX absent ou non supprimable, on poursuit sur l\'index :', path, e);
        }

        // 2. L'entrée d'index. Relecture FRAÎCHE du serveur plutôt que du
        //    `serverCircuits` en mémoire : entre le scan et ce clic, une
        //    publication a pu ajouter un circuit, qu'une réécriture depuis
        //    l'état local effacerait au passage.
        const index = await fetchServerCircuits();
        if (!Array.isArray(index) || index.length === 0) {
            // fetchServerCircuits() renvoie [] aussi bien sur échec réseau que
            // sur index vide. Dans les deux cas il n'y a rien à réécrire, et
            // écrire un [] après un échec de lecture viderait l'index entier.
            throw new Error("Index des circuits illisible — entrée non retirée");
        }
        const next = index.filter(c => String(c.id) !== String(id));
        if (next.length !== index.length) {
            const idxFile = new File(
                [JSON.stringify(next, null, 2)],
                `${mapId}.json`,
                { type: 'application/json' }
            );
            await uploadFileToGitHub(
                idxFile, token, GITHUB_OWNER, GITHUB_REPO,
                GITHUB_PATHS.circuits(mapId),
                `feat(circuit): MAJ index ${mapId}`
            );
        }

        // 3. Alignement de l'état local, sinon la publication suivante annule le
        //    travail : un officiel toujours présent dans state.officialCircuits
        //    ET ouvert dans la session (donc `realTrack` chargé) rebasculerait
        //    en « NOUVEAU » au prochain diff — et serait republié.
        setOfficialCircuits((state.officialCircuits || []).filter(c => String(c.id) !== String(id)));

        // 4. Une intention de suppression posée depuis le panneau Circuit (la
        //    poubelle du détail) n'a plus d'objet : elle n'est purgée que par la
        //    publication, qui ne trouvera plus l'entrée d'index — elle resterait
        //    donc en base indéfiniment.
        try { await setOfficialCircuitDeleted(id, false); }
        catch (e) { console.warn('[Nettoyage] purge intention suppression échec:', id, e); }

        if (String(state.activeCircuitId) === String(id)) eventBus.emit('circuit:clear', false);
        eventBus.emit('circuit:list-updated');

        // 5. Le diff du CC n'est calculé qu'à l'ouverture de la modale : après
        //    une écriture serveur directe comme celle-ci, il est périmé par
        //    construction. On signale la suppression au moteur de diff (pour
        //    qu'une relecture en retard ne ressuscite pas le circuit) puis on
        //    demande le recalcul. L'événement évite d'importer
        //    admin-control-center ici — ce serait un cycle
        //    (control-center → control-ui → maintenance), même patron que
        //    `admin:poi-edited`.
        noteServerDeletedCircuit(id);
        eventBus.emit('admin:circuit-server-deleted', String(id));

        showToast(
            gpxMissing
                ? `«\u00a0${name}\u00a0» retiré de l'index (GPX déjà absent)`
                : `«\u00a0${name}\u00a0» supprimé du serveur`,
            "success"
        );
        runAnalysis(container);
    } catch (e) {
        console.error(e);
        showToast("Erreur : " + e.message, "error");
    }
}

/**
 * Point d'entrée — appelé par renderTab('maintenance') depuis admin-control-ui.
 * Auto-scan à chaque affichage : pas de "welcome" intermédiaire qui ajoute un
 * clic inutile (l'admin est dans le CC pour gérer, pas pour confirmer un scan).
 *
 * Le scan est REFAIT à chaque ouverture de l'onglet. Un drapeau module-scope
 * (`_scanned`, 04/09/2026) ne se réinitialisait jamais : la liste restait figée
 * sur le premier scan de la session. Après une suppression + publication,
 * l'admin revenait sur cet écran, y revoyait le circuit, et en concluait que
 * rien n'avait marché — alors que le serveur était à jour. Un écran dont le
 * seul rôle est de montrer l'état du serveur ne doit jamais servir de cache.
 * Coût : un fetch d'un JSON de quelques Ko par clic sur l'onglet. Le changement
 * de sous-onglet passe par renderResults() et ne refetch donc rien.
 */
export function renderMaintenanceTab(container) {
    runAnalysis(container);
}
