import { state } from './state.js';
import { getStoredToken, deleteFileFromGitHub } from './github-sync.js';
import { showToast } from './toast.js';
import { createIcons, icons } from 'lucide';
import { showConfirm } from './modal.js';

// --- STATE ---
let serverCircuits = [];
let duplicateGroups = [];

/**
 * Récupère l'index officiel depuis le serveur (bypass cache)
 */
async function fetchServerCircuits() {
    const mapId = state.currentMapId || 'djerba';
    const timestamp = Date.now();
    const url = `https://raw.githubusercontent.com/Stefanmartin1967/History-Walk-V1/main/public/circuits/${mapId}.json?t=${timestamp}`;

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
 * Analyse les circuits pour trouver les doublons potentiels
 * Critères : Séquence identique de POIs + Distance identique
 */
function findDuplicates(circuits) {
    const groups = {};
    const potentialDupes = [];

    circuits.forEach(c => {
        // Signature unique basée sur le contenu technique
        const poiSig = (c.poiIds || []).join('|');
        // On arrondit la distance pour éviter les écarts minimes de string
        const distSig = c.distance || '0';

        // Si pas de POIs, on ignore pour éviter les faux positifs sur les traces brutes vides
        if (!c.poiIds || c.poiIds.length === 0) return;

        const signature = `${poiSig}::${distSig}`;

        if (!groups[signature]) {
            groups[signature] = [];
        }
        groups[signature].push(c);
    });

    // Filtrer pour ne garder que les groupes > 1 élément
    Object.values(groups).forEach(group => {
        if (group.length > 1) {
            potentialDupes.push(group);
        }
    });

    return potentialDupes;
}

/**
 * Lance l'analyse et l'affichage
 */
async function runAnalysis(container) {
    container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--hw-ink-soft);"><i data-lucide="loader-2" class="spin"></i> Analyse du serveur en cours...</div>`;
    createIcons({ icons, root: container });

    serverCircuits = await fetchServerCircuits();
    duplicateGroups = findDuplicates(serverCircuits);

    renderResults(container);
}

/**
 * Affiche les résultats de l'analyse
 */
function renderResults(container) {
    const hasToken = !!getStoredToken();

    let html = `
        <div style="padding:20px; max-width:800px; margin:0 auto;">
            <div style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0;"><i data-lucide="server"></i> Fichiers sur le Serveur</h3>
                <button id="btn-refresh-maintenance" class="custom-modal-btn secondary" style="padding:8px 16px;">
                    <i data-lucide="refresh-cw"></i> Actualiser
                </button>
            </div>

            ${!hasToken ? `
                <div style="background:#FEF2F2; border:1px solid #FCA5A5; color:#991B1B; padding:15px; border-radius:12px; margin-bottom:20px; display:flex; align-items:center; gap:15px;">
                    <i data-lucide="alert-triangle"></i>
                    <div>
                        <strong>Mode Lecture Seule</strong><br>
                        Vous devez configurer votre Token GitHub dans l'onglet "Config" pour pouvoir supprimer des fichiers.
                    </div>
                </div>
            ` : ''}
    `;

    // 1. DOUBLONS DÉTECTÉS
    if (duplicateGroups.length > 0) {
        html += `
            <div style="margin-bottom:30px;">
                <h4 style="color:#DC2626; display:flex; align-items:center; gap:8px;">
                    <i data-lucide="copy"></i> Doublons Détectés (${duplicateGroups.length} groupes)
                </h4>
                <p style="font-size:0.9rem; color:var(--hw-ink-soft); margin-bottom:15px;">
                    Ces circuits ont exactement le même tracé (mêmes étapes, même distance).
                    Le fichier avec un suffixe comme <code>(1).gpx</code> est souvent la copie à supprimer.
                </p>
                <div style="display:flex; flex-direction:column; gap:15px;">
        `;

        duplicateGroups.forEach((group, idx) => {
            html += `<div style="border:1px solid #FECACA; background:#FEF2F2; border-radius:12px; overflow:hidden;">
                <div style="padding:10px 15px; background:#FEE2E2; color:#991B1B; font-weight:bold; font-size:0.85rem;">
                    Groupe #${idx + 1}
                </div>
                <div style="display:flex; flex-direction:column;">`;

            group.forEach(c => {
                // Détection visuelle du fichier "suspect" (contient (1), (2) ou copy)
                const isSuspect = c.file.match(/\(\d+\)\.gpx$/) || c.file.includes('copy');
                const highlightStyle = isSuspect ? 'background:rgba(255,255,255,0.8);' : '';

                html += renderCircuitRow(c, hasToken, highlightStyle);
            });

            html += `</div></div>`;
        });

        html += `</div></div>`;
    } else if (serverCircuits.length > 0) {
         html += `
            <div style="margin-bottom:30px; padding:20px; background:#F0FDF4; border:1px solid #86EFAC; border-radius:12px; color:#166534; display:flex; align-items:center; gap:10px;">
                <i data-lucide="check-circle-2"></i> Aucun doublon strict détecté.
            </div>
        `;
    }

    // 2. LISTE COMPLÈTE (Pour nettoyage manuel)
    html += `
        <div style="margin-top:30px; border-top:1px solid #E5E7EB; padding-top:20px;">
            <h4 style="margin-bottom:15px; display:flex; align-items:center; gap:8px;">
                <i data-lucide="list"></i> Tous les fichiers (${serverCircuits.length})
            </h4>
            <div style="background:white; border:1px solid #E5E7EB; border-radius:12px; max-height:400px; overflow-y:auto;">
    `;

    // On trie par nom de fichier pour regrouper visuellement les variantes
    const sortedAll = [...serverCircuits].sort((a, b) => a.file.localeCompare(b.file));

    sortedAll.forEach(c => {
        html += renderCircuitRow(c, hasToken);
    });

    html += `</div></div></div>`;

    container.innerHTML = html;
    createIcons({ icons, root: container });

    // Events
    const btnRefresh = container.querySelector('#btn-refresh-maintenance');
    if (btnRefresh) btnRefresh.onclick = () => runAnalysis(container);

    // Delete Buttons
    container.querySelectorAll('.btn-delete-server-file').forEach(btn => {
        btn.onclick = () => handleDeleteClick(btn.dataset.path, btn.dataset.name, container);
    });
}

function renderCircuitRow(c, hasToken, extraStyle = '') {
    const fileName = c.file.split('/').pop();
    const folder = c.file.split('/')[0];

    return `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 15px; border-bottom:1px solid #F1F5F9; ${extraStyle}">
            <div style="display:flex; flex-direction:column; gap:2px; overflow:hidden;">
                <div style="font-weight:600; color:var(--hw-ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${c.name}">
                    ${c.name}
                </div>
                <div style="font-size:0.75rem; color:var(--hw-ink-soft); font-family:monospace; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="file" width="12"></i> ${folder}/<b>${fileName}</b>
                    <span style="opacity:0.5;">| ${c.distance}</span>
                </div>
            </div>

            ${hasToken ? `
            <button class="btn-delete-server-file" data-path="public/circuits/${c.file}" data-name="${c.name}" title="Supprimer définitivement du serveur"
                    style="background:#FEF2F2; color:#DC2626; border:1px solid #FECACA; padding:6px; border-radius:6px; cursor:pointer; flex-shrink:0;">
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
        await deleteFileFromGitHub(token, 'Stefanmartin1967', 'History-Walk-V1', path, `Delete ${path} via Admin Maintenance`);

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
        <div style="padding:40px; text-align:center;">
            <div style="margin-bottom:20px; font-size:3rem; color:var(--hw-ink-soft); opacity:0.2;">
                <i data-lucide="server-cog"></i>
            </div>
            <h3 style="margin-bottom:10px;">Maintenance Serveur</h3>
            <p style="color:var(--hw-ink-soft); max-width:500px; margin:0 auto 30px auto;">
                Analysez les fichiers présents sur le serveur GitHub pour détecter les doublons et supprimer les fichiers obsolètes.
                <br><br>
                <strong>Attention :</strong> Les suppressions ici sont irréversibles et affectent immédiatement l'index public.
            </p>

            <button id="btn-start-scan" class="custom-modal-btn primary" style="padding:12px 24px; font-size:1rem;">
                <i data-lucide="search"></i> Scanner les fichiers
            </button>
        </div>
    `;
    createIcons({ icons, root: container });

    const btn = container.querySelector('#btn-start-scan');
    if (btn) btn.onclick = () => runAnalysis(container);
}
