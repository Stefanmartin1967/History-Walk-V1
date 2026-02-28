import { state } from './state.js';
import { eventBus } from './events.js';
import { downloadFile, getPoiId } from './utils.js';
import { showToast } from './toast.js';
import { closeAllDropdowns } from './ui.js';
import { map } from './map.js';
import { showAlert, showConfirm } from './modal.js';
import { ANIMAL_RANKS } from './statistics.js';
import { createIcons, icons } from 'lucide';
import { uploadFileToGitHub, deleteFileFromGitHub, getStoredToken, saveToken } from './github-sync.js';
import { initAdminControlCenter, openControlCenter, addToDraft } from './admin-control-center.js';
import { recalculatePlannedCountersForMap } from './gpx.js';

export function initAdminMode() {
    // Check for persistent session
    if (localStorage.getItem('admin_session') === 'active') {
        state.isAdmin = true;
    }

    // Initial check
    console.log("[Admin] Init mode. Is Admin?", state.isAdmin);
    toggleAdminUI(state.isAdmin);

    eventBus.on('admin:mode-toggled', (isAdmin) => {
        toggleAdminUI(isAdmin);
        // Persist state
        if (isAdmin) {
            localStorage.setItem('admin_session', 'active');
        } else {
            localStorage.removeItem('admin_session');
        }
        updateAdminLoginButton();
    });

    setupAdminListeners();
    setupGodModeListener();
    initAdminControlCenter(); // Setup the new Control Center logic
    updateAdminLoginButton(); // Setup/Update the login button
}

function updateAdminLoginButton() {
    const menuContent = document.getElementById('tools-menu-content');
    if (!menuContent) return;

    let btn = document.getElementById('btn-admin-login-logout');

    // Si le bouton n'existe pas, on le crée
    if (!btn) {
        // Ajout d'un séparateur avant le bouton s'il n'existe pas déjà juste avant
        const lastChild = menuContent.lastElementChild;
        if (lastChild && lastChild.tagName !== 'DIV') { // Simple heuristic
             const separator = document.createElement('div');
             separator.style.height = '1px';
             separator.style.width = '100%';
             separator.style.background = 'var(--line)';
             separator.style.margin = '5px 0';
             menuContent.appendChild(separator);
        }

        btn = document.createElement('button');
        btn.id = 'btn-admin-login-logout';
        btn.className = 'tools-menu-item';
        menuContent.appendChild(btn);
    }

    // On clone pour nettoyer les anciens écouteurs
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    if (state.isAdmin) {
        newBtn.innerHTML = `<i data-lucide="log-out"></i> Déconnexion`;
        newBtn.style.color = 'var(--danger)';
        newBtn.addEventListener('click', logoutAdmin);
    } else {
        newBtn.innerHTML = `<i data-lucide="lock"></i> Connexion Admin`;
        newBtn.style.color = 'var(--ink)';
        newBtn.addEventListener('click', showAdminLoginModal);
    }

    // Refresh icons
    createIcons({ icons, root: newBtn });
}

function logoutAdmin() {
    state.isAdmin = false;
    showToast("Déconnexion Admin effectuée.", "info");
    eventBus.emit('admin:mode-toggled', false);
}

function showAdminLoginModal() {
    const overlay = document.getElementById('custom-modal-overlay');
    const title = document.getElementById('custom-modal-title');
    const message = document.getElementById('custom-modal-message');
    const actions = document.getElementById('custom-modal-actions');

    if (!overlay || !title || !message || !actions) return;

    title.textContent = "Connexion Admin";
    message.innerHTML = `
        <div style="text-align: left;">
            <p style="margin-bottom: 15px; color: var(--ink-soft);">
                Veuillez entrer le mot de passe administrateur.
            </p>
            <input type="password" id="admin-password-input" placeholder="Mot de passe..."
                   style="width: 100%; padding: 10px; border: 1px solid var(--line); border-radius: 6px; font-size: 16px;">
            <div id="login-error-msg" style="color: var(--danger); margin-top: 10px; font-size: 0.9em; min-height: 1.2em;"></div>
        </div>
    `;

    actions.innerHTML = '';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'custom-modal-btn secondary';
    btnCancel.textContent = "Annuler";
    btnCancel.onclick = () => overlay.classList.remove('active');

    const btnLogin = document.createElement('button');
    btnLogin.className = 'custom-modal-btn primary';
    btnLogin.textContent = "Connexion";

    const handleLogin = () => {
        const input = document.getElementById('admin-password-input');
        const errorMsg = document.getElementById('login-error-msg');

        if (!input) return;

        const pwd = input.value.trim();

        if (pwd === 'S1a7n0d9r1i9n7e3') {
            state.isAdmin = true;
            showToast("Connexion réussie !", "success");
            eventBus.emit('admin:mode-toggled', true);
            overlay.classList.remove('active');
        } else {
            errorMsg.textContent = "Mot de passe incorrect.";
            input.value = '';
            input.focus();
        }
    };

    btnLogin.onclick = handleLogin;

    // Allow Enter key
    setTimeout(() => {
        const input = document.getElementById('admin-password-input');
        if(input) {
            input.focus();
            input.onkeydown = (e) => {
                if(e.key === 'Enter') handleLogin();
            };
        }
    }, 100);

    actions.appendChild(btnCancel);
    actions.appendChild(btnLogin);

    overlay.classList.add('active');
}

function toggleAdminUI(isAdmin) {
    const adminContainer = document.getElementById('admin-tools-container');
    if (adminContainer) {
        adminContainer.style.display = isAdmin ? 'block' : 'none';
    }

    const fusionBtn = document.getElementById('btn-fusion-console');
    if (fusionBtn) {
        fusionBtn.style.display = isAdmin ? 'flex' : 'none';
    }
}

function setupAdminListeners() {
    const btnMenu = document.getElementById('btn-admin-menu');
    const menuContent = document.getElementById('admin-menu-content');

    if (btnMenu && menuContent) {
        btnMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = menuContent.classList.contains('active');
            closeAllDropdowns();
            if (!isActive) menuContent.classList.add('active');
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!btnMenu.contains(e.target) && !menuContent.contains(e.target)) {
                menuContent.classList.remove('active');
            }
        });
    }

    const btnScout = document.getElementById('btn-admin-scout');
    if (btnScout) {
        btnScout.addEventListener('click', () => {
            window.open('tools/scout.html', '_blank');
        });
    }

    // --- NOUVEAU : Bouton Data Manager ---
    if (menuContent) {
        let btnDataManager = document.getElementById('btn-admin-datamanager');
        if (!btnDataManager) {
             btnDataManager = document.createElement('button');
             btnDataManager.id = 'btn-admin-datamanager';
             btnDataManager.className = 'tools-menu-item';
             btnDataManager.innerHTML = `<i data-lucide="table"></i> Data Manager`;

             // Insérer après Scout
             if (btnScout && btnScout.parentNode === menuContent) {
                 menuContent.insertBefore(btnDataManager, btnScout.nextSibling);
             } else {
                 menuContent.prepend(btnDataManager);
             }
             createIcons({ icons, root: btnDataManager });
        }

        // Listener
        const newBtnDM = btnDataManager.cloneNode(true);
        btnDataManager.parentNode.replaceChild(newBtnDM, btnDataManager);
        newBtnDM.addEventListener('click', () => {
            window.open('history_walk_datamanager/index.html', '_blank');
        });
    }

    const btnExport = document.getElementById('btn-admin-export-master');
    if (btnExport) {
        btnExport.addEventListener('click', exportMasterGeoJSON);
    }

    // --- NOUVEAU : Bouton Publier Carte Officielle (One-Click) ---
    const btnPublish = document.getElementById('btn-admin-publish-map');
    if (btnPublish) {
        btnPublish.addEventListener('click', publishMapToGitHub);
    }

    // --- Ajout Dynamique du Bouton RANGS dans le Menu Admin ---
    // menuContent est déjà déclaré plus haut dans la fonction
    if (menuContent) {
        // On vérifie si le bouton existe déjà (pour éviter les doublons lors des HMR)
        let btnRanks = document.getElementById('btn-admin-show-ranks');
        if (!btnRanks) {
            btnRanks = document.createElement('button');
            btnRanks.id = 'btn-admin-show-ranks';
            btnRanks.className = 'tools-menu-item';
            btnRanks.innerHTML = `<i data-lucide="award"></i> Rangs & XP`;
            // Insérer avant le premier séparateur ou à la fin
            const separator = menuContent.querySelector('div[style*="height:1px"]');
            if (separator) {
                menuContent.insertBefore(btnRanks, separator);
            } else {
                menuContent.appendChild(btnRanks);
            }
            // Refresh icons
            createIcons({ icons, root: btnRanks });
        }

        // Listener (on remplace l'ancien pour éviter les doublons d'écouteurs)
        const newBtn = btnRanks.cloneNode(true);
        btnRanks.parentNode.replaceChild(newBtn, btnRanks);
        newBtn.addEventListener('click', showRankTable);

        // --- CENTRE DE CONTRÔLE (Remplace les anciens boutons) ---
        let btnControl = document.getElementById('btn-admin-control-center');
        if (!btnControl) {
            btnControl = document.createElement('button');
            btnControl.id = 'btn-admin-control-center';
            btnControl.className = 'tools-menu-item';
            btnControl.style.color = 'var(--brand)';
            btnControl.style.fontWeight = '600';
            btnControl.innerHTML = `<i data-lucide="layout-dashboard"></i> Centre de Contrôle`;

            // Add at the end
            menuContent.appendChild(btnControl);
            createIcons({ icons, root: btnControl });
        }

        const newControlBtn = btnControl.cloneNode(true);
        btnControl.parentNode.replaceChild(newControlBtn, btnControl);
        newControlBtn.addEventListener('click', openControlCenter);

        // --- RESTAURATION : Bouton Upload Fichier (Pour envoi GPX) ---
        let btnUpload = document.getElementById('btn-admin-github-upload');
        if (!btnUpload) {
            btnUpload = document.createElement('button');
            btnUpload.id = 'btn-admin-github-upload';
            btnUpload.className = 'tools-menu-item';
            btnUpload.innerHTML = `<i data-lucide="upload-cloud"></i> Upload Fichier`;

            // SECURITY CHECK: Verify parent before insert
            if (btnControl && btnControl.parentNode === menuContent) {
                menuContent.insertBefore(btnUpload, btnControl);
            } else {
                menuContent.appendChild(btnUpload);
            }
            createIcons({ icons, root: btnUpload });
        }

        const newUploadBtn = btnUpload.cloneNode(true);
        btnUpload.parentNode.replaceChild(newUploadBtn, btnUpload);
        newUploadBtn.addEventListener('click', showGitHubUploadModal);

        // --- NOUVEAU : Bouton Delete Fichier (Pour suppression GPX) ---
        let btnDeleteFile = document.getElementById('btn-admin-github-delete');
        if (!btnDeleteFile) {
            btnDeleteFile = document.createElement('button');
            btnDeleteFile.id = 'btn-admin-github-delete';
            btnDeleteFile.className = 'tools-menu-item';
            btnDeleteFile.innerHTML = `<i data-lucide="trash-2"></i> Delete Fichier`;

            // Insert just after the upload button
            menuContent.insertBefore(btnDeleteFile, btnControl);
            createIcons({ icons, root: btnDeleteFile });
        }

        const newDeleteBtn = btnDeleteFile.cloneNode(true);
        btnDeleteFile.parentNode.replaceChild(newDeleteBtn, btnDeleteFile);
        newDeleteBtn.addEventListener('click', showGitHubDeleteModal);

        // Nettoyage des anciens boutons s'ils existent (Migration)
        ['btn-admin-config-github', 'btn-admin-publish-map'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
    }
}

function setupGodModeListener() {
    // 1. Version PC (Clavier)
    let buffer = [];
    let timeout;

    window.addEventListener('keydown', (e) => {
        // Ignorer si on est dans un champ texte
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const key = e.key.toLowerCase();
        buffer.push(key);

        // Reset buffer si pause trop longue
        clearTimeout(timeout);
        timeout = setTimeout(() => { buffer = []; }, 1000);

        // Check sequence "god"
        if (buffer.join('').endsWith('god')) {
            toggleGodMode();
            buffer = []; // Reset
        }
    });

    // 2. Version Mobile (Quintuple Tap)
    // On cible le bouton Outils (visible) au lieu du bouton Admin (caché)
    const btnMenu = document.getElementById('btn-tools-menu');
    if (btnMenu) {
        let tapCount = 0;
        let tapTimeout;

        btnMenu.addEventListener('click', (e) => {
            // On laisse le comportement par défaut (ouvrir le menu) pour les 4 premiers taps
            // Si on est Admin, le bouton ouvre déjà le menu, donc pas de conflit majeur.
            // Si on n'est pas Admin, le bouton est quand même là (Menu Outils).

            tapCount++;
            clearTimeout(tapTimeout);

            // Reset après 2 secondes sans tap (plus tolérant pour mobile)
            tapTimeout = setTimeout(() => {
                tapCount = 0;
            }, 2000);

            if (tapCount === 5) {
                console.log("[GodMode] 5 taps detected!");
                e.preventDefault(); // Empêche le menu de s'ouvrir/fermer sur le 5ème tap
                e.stopPropagation();

                toggleGodMode();
                tapCount = 0; // Reset immédiat

                // Petit feedback visuel (vibration si supporté)
                if (navigator.vibrate) navigator.vibrate(200);
            }
        });
    }
}

function toggleGodMode() {
    state.isAdmin = !state.isAdmin;
    showToast(`Mode GOD : ${state.isAdmin ? 'ACTIVÉ' : 'DÉSACTIVÉ'}`, state.isAdmin ? 'success' : 'info');
    eventBus.emit('admin:mode-toggled', state.isAdmin);
}

export function generateMasterGeoJSONData(excludedIds = []) {
    if (!state.loadedFeatures || state.loadedFeatures.length === 0) {
        return null;
    }

    const features = state.loadedFeatures
        .filter(f => {
             const id = getPoiId(f);
             // 1. Exclu explicitement (via le brouillon admin)
             if (excludedIds.includes(id)) return false;

             // 2. Marqué comme supprimé dans userData (via deletePoi)
             if (f.properties.userData && f.properties.userData._deleted) return false;

             return true;
        })
        .map(f => {
        // Clone profond pour ne pas modifier l'original
        const properties = JSON.parse(JSON.stringify(f.properties));
        const standardizedHWID = properties.HW_ID; // Sauvegarde de l'ID unifié

        // Fusionner userData dans properties (Officialisation des modifs)
        if (properties.userData) {
            Object.assign(properties, properties.userData);
            delete properties.userData; // On nettoie
        }

        // --- BLINDAGE ID ---
        // On s'assure que l'ID unifié n'a pas été écrasé par une vieille valeur dans userData
        if (standardizedHWID) {
            properties.HW_ID = standardizedHWID;
        }

        // --- NETTOYAGE CRITIQUE : Suppression des photos Base64 ---
        if (properties.photos && Array.isArray(properties.photos)) {
            // On ne garde que les URL (http/https/relative)
            // On exclut tout ce qui commence par "data:image"
            properties.photos = properties.photos.filter(p => !p.startsWith('data:image'));
        }

        // Supprimer les clés internes inutiles
        delete properties._leaflet_id;

        return {
            type: "Feature",
            geometry: f.geometry,
            properties: properties
        };
    });

    return {
        type: "FeatureCollection",
        features: features
    };
}

function exportMasterGeoJSON() {
    const geojson = generateMasterGeoJSONData();

    if (!geojson) {
        showToast("Aucune donnée à exporter.", "error");
        return;
    }

    const filename = prompt("Nom du fichier à exporter :", `djerba-master-${Date.now()}.geojson`);
    if (!filename) return;

    try {
        const jsonStr = JSON.stringify(geojson, null, 2);
        const finalName = filename.endsWith('.geojson') ? filename : `${filename}.geojson`;

        downloadFile(finalName, jsonStr, 'application/geo+json');
        showToast("Export réussi !", "success");
    } catch (e) {
        console.error(e);
        showToast("Erreur lors de l'export.", "error");
    }
}

// --- PUBLICATION AUTOMATIQUE SUR GITHUB ---

async function publishMapToGitHub() {
    const token = getStoredToken();
    if (!token) {
        showToast("Token GitHub manquant. Configurez-le dans 'Upload Fichier'.", "error");
        // On pourrait ouvrir la modale de config ici si on voulait être sympa
        return;
    }

    const mapId = state.currentMapId || 'djerba';
    const filename = `${mapId}.geojson`;
    const repoOwner = 'Stefanmartin1967';
    const repoName = 'History-Walk-V1';
    const path = `public/${filename}`;

    if (!confirm(`Voulez-vous publier la carte officielle (${filename}) sur GitHub ?\n\nCela rendra visibles toutes vos modifications (photos, déplacements) pour tous les utilisateurs.\n\nAttention : Cette action est irréversible.`)) {
        return;
    }

    showToast("Génération du fichier...", "info");

    // Recalcul des compteurs "Planifié" pour être sûr qu'ils sont à jour avant publication
    // Cela permet de mettre à jour le statut des POI pour TOUS les circuits (y compris existants)
    try {
        await recalculatePlannedCountersForMap(state.currentMapId || 'djerba');
    } catch (e) {
        console.warn("Erreur recalcul compteurs:", e);
    }

    const geojson = generateMasterGeoJSONData();
    if (!geojson) {
        showToast("Erreur: Données vides.", "error");
        return;
    }

    try {
        showToast("Envoi vers GitHub...", "info");

        const jsonStr = JSON.stringify(geojson, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/geo+json' });
        const file = new File([blob], filename, { type: 'application/geo+json' });

        const message = `Update map data ${filename} via Admin One-Click`;

        await uploadFileToGitHub(file, token, repoOwner, repoName, path, message);

        showToast("Carte publiée avec succès !", "success");
        alert("La carte a été mise à jour sur GitHub.\nLes changements seront visibles d'ici quelques minutes.");

    } catch (error) {
        console.error("Erreur publication carte:", error);
        showToast(`Erreur : ${error.message}`, "error");
    }
}

function showRankTable() {
    // Construction du tableau HTML pour les Animaux (Distance)
    let tableRows = ANIMAL_RANKS.map(r => `
        <tr style="border-bottom: 1px solid var(--line);">
            <td style="padding: 10px; font-size: 24px;">
                <i data-lucide="${r.icon}"></i>
            </td>
            <td style="padding: 10px; text-align: left; font-weight: 600; color: var(--ink);">
                ${r.title}
            </td>
            <td style="padding: 10px; text-align: right; color: var(--ink-soft); font-family: monospace;">
                ${r.min} km
            </td>
        </tr>
    `).join('');

    const html = `
        <div style="max-height: 60vh; overflow-y: auto;">
            <table style="width: 100%; border-collapse: collapse;">
                <thead style="background: var(--surface-muted); position: sticky; top: 0;">
                    <tr>
                        <th style="padding: 10px;">Badge</th>
                        <th style="padding: 10px; text-align: left;">Titre</th>
                        <th style="padding: 10px; text-align: right;">Requis</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
            <p style="margin-top: 15px; font-size: 12px; color: var(--ink-soft); font-style: italic;">
                Les rangs sont basés sur la distance totale parcourue (circuits terminés).
            </p>
        </div>
    `;

    showAlert("Tableau des Rangs", html, "Fermer");

    // Refresh icons in modal immediately
    const modalContent = document.getElementById('custom-modal-message');
    if (modalContent) {
        createIcons({ icons, root: modalContent });
    }
}

// --- GITHUB UPLOAD UI ---

function setupGitHubUploadUI() {
    // Nothing complex to setup on init, logic is inside showGitHubUploadModal
}

function showGitHubConfigModal() {
    const storedToken = getStoredToken() || '';

    const html = `
        <div style="text-align: left;">
            <p style="margin-bottom: 15px; font-size: 0.9em; color: var(--ink-soft);">
                Configurez votre Token d'accès personnel (PAT) pour autoriser l'application à publier sur GitHub depuis ce navigateur.
            </p>

            <label style="display:block; margin-bottom: 5px; font-weight: 600;">GitHub Token (PAT)</label>
            <input type="password" id="gh-config-token" value="${storedToken}" placeholder="ghp_..."
                   style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 6px; margin-bottom: 15px;">

            <div style="font-size: 0.8em; color: var(--ink-soft);">
                Ce token est stocké uniquement dans votre navigateur local.
            </div>
        </div>
    `;

    showAlert("Configuration GitHub", html, "Sauvegarder").then(() => {
        // La promesse se résout à la fermeture (OK cliqué)
        // Mais showAlert ne retourne pas la valeur des inputs.
        // On doit ruser ou utiliser un bouton personnalisé dans showAlert (qui n'est pas prévu pour ça ici)
        // Mieux vaut utiliser une implémentation custom comme showGitHubUploadModal
    });

    // REFACTO: showAlert est trop simple, on utilise le pattern manuel comme showGitHubUploadModal
    // pour avoir accès aux inputs avant la fermeture.

    // 1. Récupération des éléments de la modale globale
    const overlay = document.getElementById('custom-modal-overlay');
    const title = document.getElementById('custom-modal-title');
    const message = document.getElementById('custom-modal-message');
    const actions = document.getElementById('custom-modal-actions');

    if (!overlay || !title || !message || !actions) return;

    title.textContent = "Configuration GitHub";
    message.innerHTML = html;
    actions.innerHTML = '';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'custom-modal-btn secondary';
    btnCancel.textContent = "Annuler";
    btnCancel.onclick = () => overlay.classList.remove('active');

    const btnSave = document.createElement('button');
    btnSave.className = 'custom-modal-btn primary';
    btnSave.textContent = "Sauvegarder";
    btnSave.onclick = () => {
        const input = message.querySelector('#gh-config-token');
        if (input) {
            const token = input.value.trim();
            saveToken(token);
            showToast("Token sauvegardé !", "success");
            overlay.classList.remove('active');
        }
    };

    actions.appendChild(btnCancel);
    actions.appendChild(btnSave);
    overlay.classList.add('active');
}

export function showGitHubDeleteModal() {
    const storedToken = getStoredToken() || '';
    const repoOwner = 'Stefanmartin1967'; // Default from user info
    const repoName = 'History-Walk-V1';   // Default from user info

    // 1. Récupération des éléments de la modale globale
    const overlay = document.getElementById('custom-modal-overlay');
    const title = document.getElementById('custom-modal-title');
    const message = document.getElementById('custom-modal-message');
    const actions = document.getElementById('custom-modal-actions');

    if (!overlay || !title || !message || !actions) {
        console.error("Modal elements not found");
        return;
    }

    // 2. Configuration du contenu
    title.textContent = "Supprimer un circuit sur GitHub";

    // Générer la liste des circuits à partir du state ou de l'index distant
    const officialCircuits = state.officialCircuits || [];
    let optionsHtml = '<option value="">Sélectionnez un circuit...</option>';
    officialCircuits.forEach(c => {
        optionsHtml += `<option value="${c.id}">${c.name}</option>`;
    });

    message.innerHTML = `
        <div style="text-align: left; overflow-y: auto; padding-right: 5px; white-space: normal !important;">
            <p style="margin-bottom: 15px; font-size: 0.9em; color: var(--ink-soft);">
                Cette fonction supprime un circuit officiel (fichier GPX ou JSON) directement sur GitHub.
                Cela déclenchera la mise à jour de l'index du site.
            </p>

            <label style="display:block; margin-bottom: 5px; font-weight: 600;">GitHub Token (PAT)</label>
            <input type="password" id="gh-del-token" value="${storedToken}" placeholder="ghp_..."
                   style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 6px; margin-bottom: 15px;">

            <label style="display:block; margin-bottom: 5px; font-weight: 600;">Circuit à supprimer</label>
            <select id="gh-del-circuit" style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 6px; margin-bottom: 15px;">
                ${optionsHtml}
            </select>

            <div id="gh-del-status" style="margin-top: 10px; font-size: 0.9em; color: var(--danger);"></div>
        </div>
    `;

    // 3. Configuration des boutons
    actions.innerHTML = ''; // Reset

    // Bouton Annuler
    const btnCancel = document.createElement('button');
    btnCancel.className = 'custom-modal-btn secondary';
    btnCancel.textContent = "Annuler";
    btnCancel.onclick = () => {
        overlay.classList.remove('active');
    };

    // Bouton Supprimer
    const btnDelete = document.createElement('button');
    btnDelete.className = 'custom-modal-btn primary';
    btnDelete.style.backgroundColor = "var(--danger)";
    btnDelete.style.color = "white";
    btnDelete.textContent = "Supprimer définitivement";

    btnDelete.onclick = async () => {
        const tokenInput = message.querySelector('#gh-del-token');
        const circuitSelect = message.querySelector('#gh-del-circuit');
        const statusDiv = message.querySelector('#gh-del-status');

        const token = tokenInput.value.trim();
        const circuitId = circuitSelect.value;
        const circuitName = circuitSelect.options[circuitSelect.selectedIndex]?.text || circuitId;

        if (!token) {
            statusDiv.textContent = "Erreur: Token manquant.";
            return;
        }
        if (!circuitId) {
            statusDiv.textContent = "Erreur: Aucun circuit sélectionné.";
            return;
        }

        if (!confirm(`Êtes-vous sûr de vouloir supprimer DÉFINITIVEMENT le circuit "${circuitName}" du serveur ?\nCette action est irréversible.`)) {
            return;
        }

        statusDiv.textContent = "Recherche du fichier sur le serveur...";
        statusDiv.style.color = "var(--ink-soft)";
        btnDelete.disabled = true;

        try {
            saveToken(token);

            // On doit trouver le nom du fichier depuis l'index
            const timestamp = Date.now();
            const indexUrl = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/public/circuits/${state.currentMapId || 'djerba'}.json?t=${timestamp}`;
            const remoteIndex = await fetch(indexUrl).then(r => r.json());
            const target = remoteIndex.find(r => String(r.id) === String(circuitId));

            if (!target || !target.file) {
                 throw new Error(`Fichier introuvable sur le serveur pour le circuit ID: ${circuitId}`);
            }

            const path = `public/circuits/${target.file}`;
            statusDiv.textContent = "Suppression en cours...";

            await deleteFileFromGitHub(token, repoOwner, repoName, path, `Delete official circuit: ${circuitName}`);

            // Nettoyage local mémoire + IndexedDB
            state.officialCircuits = state.officialCircuits.filter(c => String(c.id) !== String(circuitId));
            import('./database.js').then(async ({ deleteCircuit }) => {
                await deleteCircuit(circuitId);
            });

            statusDiv.textContent = "Succès ! Circuit supprimé. L'index du site va se mettre à jour.";
            statusDiv.style.color = "green";

            setTimeout(() => {
                overlay.classList.remove('active');
                window.location.reload();
            }, 2000);

        } catch (e) {
            console.error("Delete error:", e);
            statusDiv.textContent = `Erreur: ${e.message}`;
            statusDiv.style.color = "var(--danger)";
            btnDelete.disabled = false;
        }
    };

    actions.appendChild(btnCancel);
    actions.appendChild(btnDelete);
    overlay.classList.add('active');
}

export function showGitHubUploadModal() {
    const storedToken = getStoredToken() || '';
    const repoOwner = 'Stefanmartin1967'; // Default from user info
    const repoName = 'History-Walk-V1';   // Default from user info

    // 1. Récupération des éléments de la modale globale
    const overlay = document.getElementById('custom-modal-overlay');
    const title = document.getElementById('custom-modal-title');
    const message = document.getElementById('custom-modal-message');
    const actions = document.getElementById('custom-modal-actions');

    if (!overlay || !title || !message || !actions) {
        console.error("Modal elements not found");
        return;
    }

    // 2. Configuration du contenu
    title.textContent = "Mise en ligne GitHub";
    message.innerHTML = `
        <div style="text-align: left;">
            <p style="margin-bottom: 15px; font-size: 0.9em; color: var(--ink-soft);">
                Cette fonction permet d'ajouter un circuit officiel directement sur GitHub.
                Cela déclenchera automatiquement la mise à jour du site.
            </p>

            <label style="display:block; margin-bottom: 5px; font-weight: 600;">GitHub Token (PAT)</label>
            <input type="password" id="gh-token" value="${storedToken}" placeholder="ghp_..."
                   style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 6px; margin-bottom: 15px;">

            <label style="display:block; margin-bottom: 5px; font-weight: 600;">Fichier Circuit (.json / .gpx)</label>
            <input type="file" id="gh-file-input" accept=".json,.gpx"
                   style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 6px; margin-bottom: 15px;">

            <div id="gh-status" style="margin-top: 10px; font-size: 0.9em; color: var(--primary);"></div>
        </div>
    `;

    // 3. Configuration des boutons
    actions.innerHTML = ''; // Reset

    // Bouton Annuler
    const btnCancel = document.createElement('button');
    btnCancel.className = 'custom-modal-btn secondary';
    btnCancel.textContent = "Annuler";
    btnCancel.onclick = () => {
        overlay.classList.remove('active');
    };

    // Bouton Envoyer
    const btnSend = document.createElement('button');
    btnSend.className = 'custom-modal-btn primary';
    btnSend.textContent = "Envoyer sur GitHub";
    btnSend.onclick = async () => {
        // Use querySelector on the container to ensure we target the current modal content
        // This avoids issues with stale elements if the DOM was previously malformed
        const tokenInput = message.querySelector('#gh-token');
        const fileInput = message.querySelector('#gh-file-input');
        const statusDiv = message.querySelector('#gh-status');

        if (!tokenInput || !fileInput) {
            console.error("Inputs not found in modal message container");
            return;
        }

        const token = tokenInput.value.trim();
        const file = fileInput.files[0];

        if (!token) {
            statusDiv.textContent = "Erreur: Token manquant.";
            statusDiv.style.color = "red";
            return;
        }
        if (!file) {
            statusDiv.textContent = "Erreur: Aucun fichier sélectionné.";
            statusDiv.style.color = "red";
            return;
        }

        // --- SECURITY CHECK ---
        const allowedExtensions = ['.gpx', '.json'];
        const fileNameLower = file.name.toLowerCase();
        const isAllowed = allowedExtensions.some(ext => fileNameLower.endsWith(ext));

        if (!isAllowed) {
            // Utilisation de la modale custom (showConfirm) pour plus d'élégance
            // Attention: showConfirm remplace le contenu de la modale actuelle.
            // On doit donc gérer le flux UX : Si annulé, on revient (idéalement) ou on ferme tout.
            // Ici, on est déjà DANS une modale. showConfirm va écraser le contenu.
            // C'est un peu brutal mais acceptable pour une alerte de sécurité.
            // Le mieux serait de restaurer la modale d'upload si annulé, mais pour l'instant on ferme tout si annulé.

            const warningMsg = `
                <div style="text-align:left; color:var(--ink);">
                    <p style="margin-bottom:10px;">Le fichier <strong>${file.name}</strong> ne semble pas être un circuit (.gpx) ou des données (.json).</p>
                    <p style="font-size:0.9em; color:var(--danger);">⚠️ L'envoi de fichiers exécutables ou inconnus peut compromettre la sécurité de l'application.</p>
                    <p style="margin-top:10px;">Voulez-vous vraiment continuer l'upload ?</p>
                </div>
            `;

            const userConfirmed = await showConfirm(
                "Fichier non standard",
                warningMsg,
                "Uploader quand même", // Confirm Label
                "Annuler",             // Cancel Label
                true                   // isDanger = true (Red button)
            );

            if (!userConfirmed) {
                // Si l'utilisateur annule, la modale showConfirm s'est fermée.
                // On pourrait rouvrir la modale d'upload ici si on voulait être très poli,
                // mais pour une action critique annulée, fermer tout est aussi un bon feedback "Retour à la sécurité".
                showToast("Upload annulé par sécurité.", "info");
                return;
            }

            // Si confirmé, on doit rouvrir "virtuellement" le contexte d'upload ou juste continuer ?
            // showConfirm a fermé la modale. On a perdu le statut "Envoi en cours..." visuel.
            // On peut réafficher une modale de statut simple.
            showAlert("Upload en cours", `<div style="text-align:center; padding:20px;"><i data-lucide="loader-2" class="spin" style="width:32px; height:32px;"></i><br>Envoi du fichier exceptionnel...</div>`, null);
        }

        // Save token
        saveToken(token);

        statusDiv.textContent = "Envoi en cours...";
        statusDiv.style.color = "var(--primary)";
        btnSend.disabled = true;

        try {
            // Determine path based on file type
            // The default folder for Djerba circuits is now public/circuits/djerba/
            const path = `public/circuits/djerba/${file.name}`;

            await uploadFileToGitHub(file, token, repoOwner, repoName, path, `Add official circuit: ${file.name}`);

            // Track in Admin Draft
            addToDraft('circuit', file.name, { type: 'upload' });

            // --- RETRAIT DE L'AUTOMATISATION INDEX/GEOJSON ---
            // Conformément à la demande stricte : ON N'ENVOIE QUE LE GPX.
            // Le serveur (script) s'occupera du reste.

            // On ne recalcule pas les compteurs, on n'envoie pas le GeoJSON maître.
            // Juste le fichier GPX.

            statusDiv.textContent = "Succès ! Fichier envoyé. Le serveur traitera l'index.";
            statusDiv.style.color = "green";
            showToast("Circuit et Carte mis à jour avec succès !", "success");

            setTimeout(() => {
                overlay.classList.remove('active');
            }, 2000);

        } catch (error) {
            console.error(error);
            statusDiv.textContent = "Erreur: " + error.message;
            statusDiv.style.color = "red";
            btnSend.disabled = false;
        }
    };

    actions.appendChild(btnCancel);
    actions.appendChild(btnSend);

    // 4. Affichage
    overlay.classList.add('active');
}
