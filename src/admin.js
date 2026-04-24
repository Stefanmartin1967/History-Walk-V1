import { state, setIsAdmin } from './state.js';
import { eventBus } from './events.js';
import { downloadFile, getPoiId } from './utils.js';
import { showToast } from './toast.js';
import { closeAllDropdowns } from './ui-utils.js';
import { showAlert, showConfirm } from './modal.js';
import { ANIMAL_RANKS, MATERIAL_RANKS, GLOBAL_RANKS } from './statistics.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { uploadFileToGitHub, getStoredToken } from './github-sync.js';
import { pullFromGist, injectSyncIndicator } from './gist-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, RAW_BASE, GITHUB_PATHS } from './config.js';
import { initAdminControlCenter, openControlCenter, addToDraft } from './admin-control-center.js';
import { generateMasterGeoJSONData } from './admin-geojson.js';

// ─── Authentification admin ──────────────────────────────────────────────────
// Hash SHA-256 du mot de passe admin. La valeur claire n'est PAS dans le
// source. Un attaquant qui lit le bundle doit inverser SHA-256 → protection
// par résistance pré-image (mot de passe 16 caractères, entropie ~104 bits).
// Pour changer le mdp : node -e "crypto.createHash('sha256').update('NOUVEAU').digest('hex')"
const ADMIN_PASSWORD_HASH = '92f0d12e77f7c551f3c1f57fe8376599a29518275d50978cd51175c8f8f44e03';

/** Hash SHA-256 d'une chaîne, retourne l'hex en minuscules. */
async function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/** Comparaison constant-time de deux chaînes de même longueur. */
function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

/** Vérifie si le mot de passe saisi correspond au hash admin. */
export async function verifyAdminPassword(pwd) {
    try {
        const hash = await sha256Hex(pwd);
        return constantTimeEqual(hash, ADMIN_PASSWORD_HASH);
    } catch {
        return false;
    }
}

export function initAdminMode() {
    // Check for persistent session
    if (localStorage.getItem('admin_session') === 'active') {
        setIsAdmin(true);
    }

    // Initial check
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
    initAdminControlCenter(); // Setup the new Control Center logic
    updateAdminLoginButton(); // Setup/Update the login button
}

function updateAdminLoginButton() {
    const menuContent = document.getElementById('tools-menu-content');
    if (!menuContent) return;

    let separator = document.getElementById('admin-menu-separator');
    let btn = document.getElementById('btn-admin-login-logout');

    if (!state.isAdmin) {
        // Non connecté : aucune trace dans le menu
        if (separator) separator.style.display = 'none';
        if (btn) btn.style.display = 'none';
        return;
    }

    // Connecté : afficher séparateur + bouton Déconnexion
    if (!separator) {
        separator = document.createElement('div');
        separator.id = 'admin-menu-separator';
        separator.style.cssText = 'height:1px;width:100%;background:var(--line);margin:5px 0';
        menuContent.appendChild(separator);
    }
    separator.style.display = '';

    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'btn-admin-login-logout';
        btn.className = 'tools-menu-item';
        menuContent.appendChild(btn);
    }
    btn.style.display = '';

    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.innerHTML = `<i data-lucide="log-out"></i> Déconnexion`;
    newBtn.style.color = 'var(--danger)';
    newBtn.addEventListener('click', logoutAdmin);
    createIcons({ icons: appIcons, root: newBtn });
}

export function logoutAdmin() {
    setIsAdmin(false);
    showToast("Déconnexion Admin effectuée.", "info");
    eventBus.emit('admin:mode-toggled', false);
}

export function showAdminLoginModal() {
    const overlay = document.getElementById('custom-modal-overlay');
    const title = document.getElementById('custom-modal-title');
    const message = document.getElementById('custom-modal-message');
    const actions = document.getElementById('custom-modal-actions');

    if (!overlay || !title || !message || !actions) return;

    title.textContent = "Connexion Admin";
    message.innerHTML = `
        <div class="admin-login-body">
            <p>Veuillez entrer le mot de passe administrateur.</p>
            <input type="password" id="admin-password-input" placeholder="Mot de passe..." class="admin-login-input">
            <div id="login-error-msg" class="admin-login-error"></div>
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

    const handleLogin = async () => {
        const input = document.getElementById('admin-password-input');
        const errorMsg = document.getElementById('login-error-msg');

        if (!input) return;

        const pwd = input.value.trim();
        const ok = await verifyAdminPassword(pwd);

        if (ok) {
            setIsAdmin(true);
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
             createIcons({ icons: appIcons, root: btnDataManager });
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
            createIcons({ icons: appIcons, root: btnRanks });
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
            createIcons({ icons: appIcons, root: btnControl });
        }

        const newControlBtn = btnControl.cloneNode(true);
        btnControl.parentNode.replaceChild(newControlBtn, btnControl);
        newControlBtn.addEventListener('click', openControlCenter);

        // --- RESTAURATION : Bouton Upload Circuit (Pour envoi GPX) ---
        let btnUpload = document.getElementById('btn-admin-github-upload');
        if (!btnUpload) {
            btnUpload = document.createElement('button');
            btnUpload.id = 'btn-admin-github-upload';
            btnUpload.className = 'tools-menu-item';
            btnUpload.innerHTML = `<i data-lucide="upload-cloud"></i> Upload Circuit`;

            // SECURITY CHECK: Verify parent before insert
            if (btnControl && btnControl.parentNode === menuContent) {
                menuContent.insertBefore(btnUpload, btnControl);
            } else {
                menuContent.appendChild(btnUpload);
            }
            createIcons({ icons: appIcons, root: btnUpload });
        }

        const newUploadBtn = btnUpload.cloneNode(true);
        btnUpload.parentNode.replaceChild(newUploadBtn, btnUpload);
        newUploadBtn.addEventListener('click', showGitHubUploadModal);

        // Nettoyage des anciens boutons s'ils existent (Migration)
        ['btn-admin-config-github', 'btn-admin-publish-map'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
    }
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

function showRankTable() {
    // --- Lignes Animaux (% Distance officielle) ---
    const animalRows = ANIMAL_RANKS.map(r => `
        <tr>
            <td><i data-lucide="${r.icon}"></i></td>
            <td>${r.title}</td>
            <td>${r.min}%</td>
        </tr>
    `).join('');

    // --- Lignes Matières (% POIs visités) ---
    const materialRows = MATERIAL_RANKS.map(r => `
        <tr>
            <td><span class="rank-dot" style="background:${r.color};"></span></td>
            <td>${r.title}</td>
            <td>${r.min}%</td>
        </tr>
    `).join('');

    // --- Lignes Global (Distance% × POI% / 100) ---
    const globalRows = GLOBAL_RANKS.map(r => `
        <tr>
            <td><i data-lucide="star"></i></td>
            <td>${r.title}</td>
            <td>${r.min}%</td>
        </tr>
    `).join('');

    const html = `
        <div class="rank-tabs-wrapper">
            <div class="rank-tabs-nav">
                <button class="rank-tab-btn active" data-tab="animals">🐾 Animaux</button>
                <button class="rank-tab-btn" data-tab="materials">💎 Matières</button>
                <button class="rank-tab-btn" data-tab="global">⭐ Global</button>
            </div>

            <div class="rank-tab-panel active" id="rank-panel-animals">
                <p class="rank-tab-hint">Basé sur le % de distance officielle parcourue</p>
                <table class="rank-table">
                    <thead><tr><th>Badge</th><th>Titre</th><th>Requis</th></tr></thead>
                    <tbody>${animalRows}</tbody>
                </table>
            </div>

            <div class="rank-tab-panel" id="rank-panel-materials">
                <p class="rank-tab-hint">Basé sur le % de lieux visités</p>
                <table class="rank-table">
                    <thead><tr><th>Couleur</th><th>Titre</th><th>Requis</th></tr></thead>
                    <tbody>${materialRows}</tbody>
                </table>
            </div>

            <div class="rank-tab-panel" id="rank-panel-global">
                <p class="rank-tab-hint">Distance% × Lieux% ÷ 100 — exceller sur les deux axes est nécessaire</p>
                <table class="rank-table">
                    <thead><tr><th></th><th>Titre</th><th>Requis</th></tr></thead>
                    <tbody>${globalRows}</tbody>
                </table>
            </div>
        </div>
    `;

    showAlert("Tableau des Rangs", html, "Fermer");

    // Activer la logique des onglets + refresh icônes
    const modalContent = document.getElementById('custom-modal-message');
    if (modalContent) {
        createIcons({ icons: appIcons, root: modalContent });

        modalContent.querySelectorAll('.rank-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.tab;
                modalContent.querySelectorAll('.rank-tab-btn').forEach(b => b.classList.remove('active'));
                modalContent.querySelectorAll('.rank-tab-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                modalContent.querySelector(`#rank-panel-${target}`).classList.add('active');
            });
        });
    }
}

// --- GITHUB UPLOAD UI ---

export function showGitHubUploadModal() {
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
        <div class="admin-form-body">
            <p>Cette fonction permet d'ajouter un circuit officiel directement sur GitHub.
                Cela déclenchera automatiquement la mise à jour du site.</p>

            <label class="admin-form-label">Fichier Circuit (.json / .gpx)</label>
            <input type="file" id="gh-file-input" accept=".json,.gpx" class="admin-form-input">

            <div id="gh-status" class="admin-form-status admin-form-status--info"></div>
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
        const fileInput = message.querySelector('#gh-file-input');
        const statusDiv = message.querySelector('#gh-status');

        const token = getStoredToken();
        const file = fileInput?.files[0];

        if (!token) {
            statusDiv.textContent = "Token manquant — configurez-le dans Centre de Contrôle → Config.";
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
                <div class="admin-file-warning-body">
                    <p>Le fichier <strong>${file.name}</strong> ne semble pas être un circuit (.gpx) ou des données (.json).</p>
                    <p class="admin-file-warning-danger">⚠️ L'envoi de fichiers exécutables ou inconnus peut compromettre la sécurité de l'application.</p>
                    <p>Voulez-vous vraiment continuer l'upload ?</p>
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
            showAlert("Upload en cours", `<div class="admin-upload-loading"><i data-lucide="loader-2" class="spin lucide"></i><br>Envoi du fichier exceptionnel...</div>`, null);
        }

        statusDiv.textContent = "Envoi en cours...";
        statusDiv.style.color = "var(--primary)";
        btnSend.disabled = true;

        try {
            // Determine path based on file type
            // The default folder for Djerba circuits is now public/circuits/djerba/
            const path = `public/circuits/djerba/${file.name}`;

            await uploadFileToGitHub(file, token, GITHUB_OWNER, GITHUB_REPO, path, `feat(circuit): Ajout "${file.name}"`);

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
