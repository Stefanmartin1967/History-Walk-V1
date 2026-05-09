import { state, removeMyCircuit } from './state.js';
import { getStoredToken, deleteFileFromGitHub } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, RAW_BASE, GITHUB_PATHS } from './config.js';
import { deleteCircuitById, restoreCircuit } from './database.js'; // DB Functions
import { showToast } from './toast.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showConfirm } from './modal.js';

// --- STATE ---
let serverCircuits = [];
let deletedCircuits = []; // Local trash

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

/**
 * Lance l'analyse et l'affichage.
 * Détection des doublons retirée (PR B1) — désormais traitée à la source via
 * `checkCircuitDuplicate()` dans circuit-actions.js, au moment de l'enregistrement.
 */
async function runAnalysis(container) {
    container.innerHTML = `<div class="maint-loading"><i data-lucide="loader-2" class="spin"></i> Analyse du serveur en cours...</div>`;
    createIcons({ icons: appIcons, root: container });

    serverCircuits = await fetchServerCircuits();

    // Scan local deleted
    deletedCircuits = state.myCircuits.filter(c => c.isDeleted);

    renderResults(container);
}

/**
 * Affiche les résultats de l'analyse
 */
function renderResults(container) {
    const hasToken = !!getStoredToken();

    let html = `
        <div class="maint-container">
            <div class="maint-header-row">
                <h3 class="maint-title"><i data-lucide="server"></i> Fichiers sur le Serveur</h3>
                <button id="btn-refresh-maintenance" class="btn btn-secondary">
                    <i data-lucide="refresh-cw"></i> Actualiser
                </button>
            </div>

            ${!hasToken ? `
                <div class="maint-warning-banner">
                    <i data-lucide="alert-triangle"></i>
                    <div>
                        <strong>Mode Lecture Seule</strong><br>
                        Vous devez configurer votre Token GitHub dans l'onglet "Config" pour pouvoir supprimer des fichiers.
                    </div>
                </div>
            ` : ''}
    `;

    // 0. CORBEILLE LOCALE (New Section)
    if (deletedCircuits.length > 0) {
        html += `
            <div class="maint-section">
                <div class="maint-section-header">
                    <h4 class="maint-section-title">
                        <i data-lucide="trash-2"></i> Corbeille Locale (${deletedCircuits.length})
                    </h4>
                </div>
                <div class="maint-section-body">
        `;

        deletedCircuits.forEach(c => {
            html += `
                <div class="maint-item">
                    <div class="maint-item-faded">
                        <div class="maint-item-name">${c.name}</div>
                        <div class="maint-item-meta">${c.poiIds ? c.poiIds.length : 0} étapes • ${c.id}</div>
                    </div>
                    <div class="maint-item-actions">
                        <button class="btn-restore-local maint-btn-restore" data-id="${c.id}" title="Restaurer" aria-label="Restaurer">
                            <i data-lucide="rotate-ccw" width="16"></i>
                        </button>
                        <button class="btn-purge-local maint-btn-danger" data-id="${c.id}" title="Supprimer définitivement" aria-label="Supprimer définitivement">
                            <i data-lucide="x" width="16"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        html += `</div></div>`;
    }

    // 1. LISTE COMPLÈTE (Pour nettoyage manuel)
    html += `
        <div class="maint-all-section">
            <h4 class="maint-all-title">
                <i data-lucide="list"></i> Tous les fichiers (${serverCircuits.length})
            </h4>
            <div class="maint-all-body">
    `;

    // On trie par nom de fichier pour regrouper visuellement les variantes
    const sortedAll = [...serverCircuits].sort((a, b) => a.file.localeCompare(b.file));

    sortedAll.forEach(c => {
        html += renderCircuitRow(c, hasToken);
    });

    html += `</div></div></div>`;

    container.innerHTML = html;
    createIcons({ icons: appIcons, root: container });

    // Events
    const btnRefresh = container.querySelector('#btn-refresh-maintenance');
    if (btnRefresh) btnRefresh.onclick = () => runAnalysis(container);

    // Delete Buttons
    container.querySelectorAll('.btn-delete-server-file').forEach(btn => {
        btn.onclick = () => handleDeleteClick(btn.dataset.path, btn.dataset.name, container);
    });

    // Local Trash Actions
    container.querySelectorAll('.btn-restore-local').forEach(btn => {
        btn.onclick = () => handleRestoreLocal(btn.dataset.id, container);
    });
    container.querySelectorAll('.btn-purge-local').forEach(btn => {
        btn.onclick = () => handlePurgeLocal(btn.dataset.id, container);
    });
}

async function handleRestoreLocal(id, container) {
    if (!await showConfirm("Restaurer", "Voulez-vous restaurer ce circuit ?", "Restaurer", "Annuler")) return;
    try {
        await restoreCircuit(id);
        // Update local state
        const c = state.myCircuits.find(x => String(x.id) === String(id));
        if (c) c.isDeleted = false;

        showToast("Circuit restauré !", "success");
        runAnalysis(container); // Refresh UI
    } catch (e) {
        console.error(e);
        showToast("Erreur restauration", "error");
    }
}

async function handlePurgeLocal(id, container) {
    if (!await showConfirm("Suppression Définitive", "Voulez-vous vraiment effacer ce circuit de la base de données locale ?\nCette action est irréversible.", "Supprimer", "Annuler", true)) return;
    try {
        await deleteCircuitById(id);
        // Update local state
        removeMyCircuit(id);

        showToast("Circuit effacé définitivement !", "success");
        runAnalysis(container); // Refresh UI
    } catch (e) {
        console.error(e);
        showToast("Erreur purge", "error");
    }
}

function renderCircuitRow(c, hasToken) {
    const fileName = c.file.split('/').pop();
    const folder = c.file.split('/')[0];

    return `
        <div class="maint-circuit-row">
            <div class="maint-circuit-info">
                <div class="maint-circuit-name" title="${c.name}">${c.name}</div>
                <div class="maint-circuit-meta">
                    <i data-lucide="file" width="12"></i> ${folder}/<b>${fileName}</b>
                    <span class="maint-circuit-dist">| ${c.distance}</span>
                </div>
            </div>

            ${hasToken ? `
            <button class="btn-delete-server-file maint-btn-danger" data-path="public/circuits/${c.file}" data-name="${c.name}" title="Supprimer définitivement du serveur" aria-label="Supprimer définitivement du serveur">
                <i data-lucide="trash-2" width="16"></i>
            </button>
            ` : ''}
        </div>
    `;
}

async function handleDeleteClick(path, name, container) {
    if (!await showConfirm(
        "Suppression Serveur",
        `ATTENTION : Vous allez supprimer définitivement le fichier :\n\n${path}\n\nCela retirera le circuit "${name}" de l'application pour tout le monde.\nConfirmer ?`,
        "Supprimer",
        "Annuler",
        true // isDestructive
    )) return;

    const token = getStoredToken();
    if (!token) return showToast("Token manquant.", "error");

    try {
        showToast("Suppression en cours...", "info");
        await deleteFileFromGitHub(token, GITHUB_OWNER, GITHUB_REPO, path, `chore(admin): Suppression ${path}`);

        showToast("Fichier supprimé avec succès !", "success");

        // On re-lance l'analyse pour rafraîchir la liste
        runAnalysis(container);

    } catch (e) {
        console.error(e);
        showToast("Erreur : " + e.message, "error");
    }
}

/**
 * Point d'entrée principal pour l'onglet Maintenance
 */
export function renderMaintenanceTab(container) {
    container.innerHTML = `
        <div class="maint-welcome">
            <div class="maint-welcome-icon"><i data-lucide="server-cog"></i></div>
            <h3 class="maint-welcome-title">Maintenance Serveur</h3>
            <p class="maint-welcome-desc">
                Listez les fichiers présents sur le serveur GitHub pour supprimer les fichiers obsolètes ou restaurer les circuits de la corbeille locale.
                <br><br>
                <strong>Attention :</strong> Les suppressions ici sont irréversibles et affectent immédiatement l'index public.
            </p>
            <button id="btn-start-scan" class="btn btn-primary maint-start-btn">
                <i data-lucide="search"></i> Scanner les fichiers
            </button>
        </div>
    `;
    createIcons({ icons: appIcons, root: container });

    const btn = container.querySelector('#btn-start-scan');
    if (btn) btn.onclick = () => runAnalysis(container);
}
