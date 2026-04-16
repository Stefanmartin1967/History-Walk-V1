import { state, setUserData, setOfficialCircuitsStatus, setHiddenPoiIds } from './state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { generateMasterGeoJSONData } from './admin.js';
import { uploadFileToGitHub, deleteFileFromGitHub, getStoredToken } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, RAW_BASE, GITHUB_PATHS } from './config.js';
import { showToast } from './toast.js';
import { showConfirm, closeModal } from './modal.js';
import { saveAppState, getAppState } from './database.js';

// Nouveaux imports suite au découpage
import { reconcileLocalChanges, prepareDiffData, diffData } from './admin-diff-engine.js';
import { openControlCenterModal, renderTab } from './admin-control-ui.js';
import { RichEditor } from './richEditor.js';

// --- STATE MANAGEMENT (Brouillon) ---
const DRAFT_IDB_KEY = 'adminDraft';
let adminDraft = {
    pendingPois: {},
    pendingCircuits: {}
};

// --- INITIALISATION (Point d'entrée principal) ---
export async function initAdminControlCenter() {
    // Lire depuis IndexedDB (nouvelle source de vérité)
    const saved = await getAppState(DRAFT_IDB_KEY);
    if (saved) {
        adminDraft = saved;
        updateButtonBadge();
    }

    // Migration : nettoyer l'ancienne clé localStorage si elle existe encore
    localStorage.removeItem('admin_draft_v1');

}

function updateButtonBadge() {
    const btn = document.getElementById('btn-admin-control-center');
    if (!btn) return;
    const total = Object.keys(adminDraft.pendingPois).length + Object.keys(adminDraft.pendingCircuits).length;
    btn.innerHTML = `<i data-lucide="layout-dashboard"></i> Centre de Contrôle ${total > 0 ? `<span class="cc-badge">${total}</span>` : ''}`;
    createIcons({ icons: appIcons, root: btn });
}

function saveDraft(newDraft) {
    adminDraft = newDraft;
    saveAppState(DRAFT_IDB_KEY, adminDraft).catch(e => console.error("Erreur sauvegarde draft", e));
}

// --- OUVERTURE DIRECTE ONGLET CONFIG (sans calcul diff) ---
export function openControlCenterSettings() {
    const callbacks = {
        uploadAdminData: uploadAdminData,
        downloadAdminData: downloadAdminData,
    };
    openControlCenterModal({ stats: { poisModified: 0, circuitsModified: 0, photosAdded: 0 }, items: [] }, callbacks);
    setTimeout(() => {
        const tab = document.querySelector('.admin-cc-tab[data-tab="settings"]');
        if (tab) tab.click();
    }, 0);
}

// --- OUVERTURE DU PANNEAU (Interface + Logique) ---
export async function openControlCenter() {
    // 1. Ouvrir la modale (UI vide/chargement) avec les callbacks vers les actions
    const callbacks = {
        publishChanges: publishChanges,
        uploadAdminData: uploadAdminData,
        downloadAdminData: downloadAdminData,
        toggleDiffDetails: toggleDiffDetails,
        updateDraftValue: updateDraftValue,
        processDecision: processDecision,
        openEditorForPoi: openEditorForPoi
    };

    openControlCenterModal(diffData, callbacks);

    // 2. Calculer les données (Diff Engine)
    reconcileLocalChanges(adminDraft, saveDraft, updateButtonBadge);
    await prepareDiffData(adminDraft);

    // 3. Rendre l'onglet actif (Dashboard) avec les données calculées
    renderTab('dashboard', diffData, callbacks);
}

// --- ACTIONS GLOBALES ---

export const toggleDiffDetails = (id) => {
    const el = document.getElementById(`diff-details-${id}`);
    if (el) {
        el.classList.toggle('open');
    }
};

export const updateDraftValue = async (id, key, value) => {
    // Met à jour directement userData (la source de vérité locale)

    const newUserData = { ...state.userData };
    if (!newUserData[id]) newUserData[id] = {};

    if (key === 'Position') {
        const parts = value.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            newUserData[id].lat = parts[0];
            newUserData[id].lng = parts[1];
        }
    } else {
        newUserData[id][key] = value;
    }

    setUserData(newUserData);
    await saveAppState('userData', state.userData); // Uses state.userData which is updated via reactivity, but just to be safe:
    showToast("Correction enregistrée localement", "info");
};

export function openEditorForPoi(id) {
    // On n'ouvre PAS le RichEditor sur la map — on le laisse s'ouvrir par-dessus le CC
    // Le CC reste ouvert en dessous (z-index CC=3000, RichEditor=4000)
    RichEditor.openForEdit(id);

    // Quand l'éditeur se ferme, on rafraîchit l'onglet Modifications
    window.addEventListener('richEditor:closed', async () => {
        await prepareDiffData(adminDraft);
        const callbacks = {
            publishChanges,
            uploadAdminData,
            downloadAdminData,
            toggleDiffDetails,
            updateDraftValue,
            processDecision,
            openEditorForPoi
        };
        renderTab('changes', diffData, callbacks);
    }, { once: true });
}

export const processDecision = async (id, decision) => {
    if (decision === 'refuse') {
        if (adminDraft.pendingPois[id]) delete adminDraft.pendingPois[id];

        if (state.userData[id]) {
            const newUserData = { ...state.userData };
            delete newUserData[id];
            setUserData(newUserData);
            await saveAppState('userData', state.userData);
        }

        showToast("Modification refusée et annulée", "info");
    } else {
        showToast("Modification validée pour publication", "success");
        // Visuel : griser la ligne
        const card = document.getElementById(`cc-diff-item-${id}`);
        if (card) {
            card.style.opacity = "0.5";
            card.style.pointerEvents = "none";
        }
        return;
    }

    saveDraft(adminDraft);
    updateButtonBadge();
    await prepareDiffData(adminDraft);
    renderTab('changes', diffData, { publishChanges, uploadAdminData, downloadAdminData });
};


// --- PUBLICATION RAPIDE (sans ouvrir la CC modale) ---

export async function quickPublish() {
    reconcileLocalChanges(adminDraft, saveDraft, updateButtonBadge);
    await prepareDiffData(adminDraft);
    await publishChanges();
}

// --- GESTION DE LA PUBLICATION ET SYNCHRONISATION ---

async function publishChanges() {
    const token = getStoredToken();
    if (!token) {
        showToast("Token manquant. Vérifiez la configuration.", "error");
        return;
    }

    const ok = await showConfirm(
        "Publication GitHub",
        "Publier toutes les modifications sur GitHub ?\n\nCette action rendra visibles toutes vos modifications pour tous les utilisateurs.",
        "Publier",
        "Annuler"
    );
    if (!ok) return;

    const btn = document.getElementById('btn-cc-publish');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Envoi...`;
        createIcons({ icons: appIcons, root: btn });
    }

    try {
        // Collect IDs to delete
        const idsToDelete = Object.keys(adminDraft.pendingPois).filter(id => adminDraft.pendingPois[id].type === 'delete');

        const geojson = generateMasterGeoJSONData(idsToDelete);
        if (!geojson) throw new Error("Erreur données GeoJSON");

        const mapId = state.currentMapId || 'djerba';
        const filename = `${mapId}.geojson`;
        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
        const file = new File([blob], filename, { type: 'application/geo+json' });

        // Build a descriptive commit message from the diff stats
        const stats = diffData.stats || {};
        const msgParts = [`feat(map): Publication ${mapId}`];
        if (stats.poisModified > 0) msgParts.push(`${stats.poisModified} POI(s)`);
        if (stats.photosAdded  > 0) msgParts.push(`${stats.photosAdded} photo(s)`);
        const commitMessage = msgParts.join(' — ');

        await uploadFileToGitHub(file, token, GITHUB_OWNER, GITHUB_REPO, GITHUB_PATHS.geojson(mapId), commitMessage);

        // Gestion des suppressions de fichiers circuits
        const circuitsToDelete = diffData.circuits.filter(c => c.status === 'SUPPRESSION' || (c.changes && c.changes.some(ch => ch.key === 'STATUT' && ch.new === 'SUPPRESSION')));

        if (circuitsToDelete.length > 0) {
            for (const c of circuitsToDelete) {
                try {
                    const indexUrl = `${RAW_BASE}/${GITHUB_PATHS.circuits(state.currentMapId || 'djerba')}`;
                    const remoteIndex = await fetch(indexUrl).then(r => r.json());
                    const target = remoteIndex.find(r => String(r.id) === String(c.id));

                    if (target && target.file) {
                        const path = `public/circuits/${target.file}`;
                        await deleteFileFromGitHub(token, GITHUB_OWNER, GITHUB_REPO, path, `feat(circuit): Suppression "${c.name}"`);
                    }
                } catch (err) {
                    console.warn(`[Admin] Impossible de supprimer le fichier pour ${c.name}:`, err);
                }
            }
        }

        showToast("Publication réussie !", "success");
        adminDraft = { pendingPois: {}, pendingCircuits: {} };
        saveDraft(adminDraft);
        updateButtonBadge();

        // Clean local userData for published POIs
        const newUserData = { ...state.userData };
        diffData.pois.forEach(p => {
             if (newUserData[p.id]) delete newUserData[p.id];
        });
        setUserData(newUserData);
        await saveAppState('userData', state.userData);

        closeModal();

    } catch (e) {
        console.error(e);
        showToast("Erreur: " + e.message, "error");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="rocket"></i> TOUT PUBLIER`;
            createIcons({ icons: appIcons, root: btn });
        }
    }
}

async function uploadAdminData() {
    const token = getStoredToken();
    if (!token) {
        showToast("Token manquant. Configurez-le d'abord.", "error");
        return;
    }

    const btn = document.getElementById('btn-sync-upload');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Envoi...`;
        createIcons({ icons: appIcons, root: btn });
    }

    try {
        const data = {
            lastUpdated: new Date().toISOString(),
            officialCircuitsStatus: state.officialCircuitsStatus || {},
            userData: state.userData || {},
            hiddenPoiIds: state.hiddenPoiIds || []
        };

        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const file = new File([blob], 'personal_data.json', { type: 'application/json' });

        await uploadFileToGitHub(
            file,
            token,
            GITHUB_OWNER,
            GITHUB_REPO,
            GITHUB_PATHS.adminData,
            'chore(sync): Sauvegarde données admin'
        );

        showToast("Données sauvegardées sur le serveur !", "success");
        const timeEl = document.getElementById('sync-last-update');
        if (timeEl) timeEl.textContent = `Dernier envoi : À l'instant`;

    } catch (e) {
        console.error(e);
        showToast("Erreur lors de l'envoi : " + e.message, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="upload-cloud"></i> Sauvegarder (Upload)`;
            createIcons({ icons: appIcons, root: btn });
        }
    }
}

async function downloadAdminData() {
    const btn = document.getElementById('btn-sync-download');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Récupération...`;
        createIcons({ icons: appIcons, root: btn });
    }

    try {
        const timestamp = Date.now();
        const url = `${RAW_BASE}/${GITHUB_PATHS.adminData}?t=${timestamp}`;

        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) throw new Error("Aucune sauvegarde trouvée sur le serveur.");
            throw new Error("Erreur réseau : " + response.status);
        }

        const data = await response.json();

        // MERGE STRATEGY
        if (data.officialCircuitsStatus) {
            setOfficialCircuitsStatus({ ...state.officialCircuitsStatus, ...data.officialCircuitsStatus });
            await saveAppState(`official_circuits_status_${state.currentMapId || 'djerba'}`, state.officialCircuitsStatus);
        }

        if (data.userData) {
            setUserData({ ...state.userData, ...data.userData });
            await saveAppState('userData', state.userData);
        }

        if (data.hiddenPoiIds) {
             const newHidden = new Set([...(state.hiddenPoiIds || []), ...data.hiddenPoiIds]);
             setHiddenPoiIds(Array.from(newHidden));
             await saveAppState(`hiddenPois_${state.currentMapId || 'djerba'}`, state.hiddenPoiIds);
        }

        showToast("Données récupérées et fusionnées !", "success");
        setTimeout(() => window.location.reload(), 1500);

    } catch (e) {
        console.error(e);
        showToast("Erreur : " + e.message, "error");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="download-cloud"></i> Récupérer (Download)`;
            createIcons({ icons: appIcons, root: btn });
        }
    }
}


// --- EXPORTS POUR COMPATIBILITÉ ET TESTS ---

export function getAdminDraft() {
    return adminDraft;
}

export function addToDraft(type, id, details) {
    if (type === 'poi') {
        adminDraft.pendingPois[id] = {
            ...(adminDraft.pendingPois[id] || {}),
            timestamp: Date.now(),
            ...details
        };
    }
    if (type === 'circuit') adminDraft.pendingCircuits[id] = { timestamp: Date.now() };

    saveDraft(adminDraft);
    updateButtonBadge();
}

/**
 * Cherche si une migration est déjà enregistrée pour un ancien ID
 */
export function getMigrationId(oldId) {
    if (!oldId) return null;
    const entries = Object.entries(adminDraft.pendingPois);
    const found = entries.find(([newId, data]) => data.type === 'migration' && data.oldId === oldId);
    return found ? found[0] : null;
}
