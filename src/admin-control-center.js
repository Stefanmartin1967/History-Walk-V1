import { state, setUserData, setOfficialCircuitsStatus, setHiddenPoiIds } from './state.js';
import { createIcons, icons } from 'lucide';
import { generateMasterGeoJSONData } from './admin.js';
import { uploadFileToGitHub, deleteFileFromGitHub, getStoredToken } from './github-sync.js';
import { showToast } from './toast.js';
import { saveAppState } from './database.js';

// Nouveaux imports suite au découpage
import { reconcileLocalChanges, prepareDiffData, diffData } from './admin-diff-engine.js';
import { injectAdminStyles, openControlCenterModal, renderTab } from './admin-control-ui.js';

// --- STATE MANAGEMENT (Brouillon) ---
const DRAFT_KEY = 'admin_draft_v1';
let adminDraft = {
    pendingPois: {},
    pendingCircuits: {}
};

// --- INITIALISATION (Point d'entrée principal) ---
export async function initAdminControlCenter() {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
        try {
            adminDraft = JSON.parse(saved);
            updateButtonBadge();
        } catch (e) { console.error("Erreur brouillon", e); }
    }

    // Injection des styles via le nouveau module UI
    injectAdminStyles();
}

function updateButtonBadge() {
    const btn = document.getElementById('btn-admin-control-center');
    if (!btn) return;
    const total = Object.keys(adminDraft.pendingPois).length + Object.keys(adminDraft.pendingCircuits).length;
    btn.innerHTML = `<i data-lucide="layout-dashboard"></i> Centre de Contrôle ${total > 0 ? `<span class="cc-badge">${total}</span>` : ''}`;
    createIcons({ icons, root: btn });
}

function saveDraft(newDraft) {
    adminDraft = newDraft;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(adminDraft));
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
        processDecision: processDecision
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
    console.log(`[Admin] Correction user: ${id} [${key}] = ${value}`);

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
        const card = document.getElementById(`diff-card-${id}`);
        if (card) {
            card.style.opacity = "0.5";
            card.style.pointerEvents = "none";
            const icon = card.querySelector('.diff-icon');
            if(icon) {
                icon.innerHTML = `<i data-lucide="check-circle-2"></i>`;
                icon.style.background = "#DCFCE7";
                icon.style.color = "#16A34A";
                createIcons({ icons, root: icon });
            }
        }
        return;
    }

    saveDraft(adminDraft);
    updateButtonBadge();
    await prepareDiffData(adminDraft);
    renderTab('changes', diffData, { publishChanges, uploadAdminData, downloadAdminData });
};


// --- GESTION DE LA PUBLICATION ET SYNCHRONISATION ---

async function publishChanges() {
    const token = getStoredToken();
    if (!token) {
        showToast("Token manquant. Vérifiez la configuration.", "error");
        return;
    }

    if (!confirm("Publier toutes les modifications sur GitHub ?")) return;

    const btn = document.getElementById('btn-cc-publish');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Envoi...`;
        createIcons({ icons, root: btn });
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

        await uploadFileToGitHub(file, token, 'Stefanmartin1967', 'History-Walk-V1', `public/${filename}`, `Update via Admin Center`);

        // Gestion des suppressions de fichiers circuits
        const circuitsToDelete = diffData.circuits.filter(c => c.status === 'SUPPRESSION' || (c.changes && c.changes.some(ch => ch.key === 'STATUT' && ch.new === 'SUPPRESSION')));

        if (circuitsToDelete.length > 0) {
            console.log(`[Admin] Suppression de ${circuitsToDelete.length} fichiers circuits...`);
            for (const c of circuitsToDelete) {
                try {
                    const indexUrl = `https://raw.githubusercontent.com/Stefanmartin1967/History-Walk-V1/main/public/circuits/${state.currentMapId || 'djerba'}.json`;
                    const remoteIndex = await fetch(indexUrl).then(r => r.json());
                    const target = remoteIndex.find(r => String(r.id) === String(c.id));

                    if (target && target.file) {
                        const path = `public/circuits/${target.file}`;
                        await deleteFileFromGitHub(token, 'Stefanmartin1967', 'History-Walk-V1', path, `Delete circuit ${c.name}`);
                        console.log(`[Admin] Supprimé: ${path}`);
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

        alert("Mise à jour effectuée avec succès !");
        document.getElementById('custom-modal-overlay').classList.remove('active');

    } catch (e) {
        console.error(e);
        showToast("Erreur: " + e.message, "error");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="rocket"></i> TOUT PUBLIER`;
            createIcons({ icons, root: btn });
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
        createIcons({ icons, root: btn });
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
            'Stefanmartin1967',
            'History-Walk-V1',
            'public/admin/personal_data.json',
            'Update Admin Personal Data'
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
            createIcons({ icons, root: btn });
        }
    }
}

async function downloadAdminData() {
    const btn = document.getElementById('btn-sync-download');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Récupération...`;
        createIcons({ icons, root: btn });
    }

    try {
        const timestamp = Date.now();
        const url = `https://raw.githubusercontent.com/Stefanmartin1967/History-Walk-V1/main/public/admin/personal_data.json?t=${timestamp}`;

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
            createIcons({ icons, root: btn });
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
