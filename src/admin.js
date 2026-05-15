import { state, setIsAdmin } from './state.js';
import { eventBus } from './events.js';
import { downloadFile, getPoiId } from './utils.js';
import { showToast } from './toast.js';
import { closeAllDropdowns } from './ui-utils.js';
import { showAlert, showConfirm, openHwModal } from './modal.js';
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
        separator.className = 'tools-menu-separator';
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

export async function showAdminLoginModal() {
    // Migration V2 : utilise openHwModal (sm, icône lock, variante default,
    // banner is-error pour mot de passe invalide).
    const { openHwModal, closeHwModal } = await import('./modal.js');

    const body = `
        <p>Veuillez entrer le mot de passe administrateur.</p>
        <input type="password" id="admin-password-input" placeholder="Mot de passe…" class="hw-input hw-mt-3">
        <div class="hw-banner is-error hw-mt-3" id="login-error-banner" hidden>
            <i data-lucide="alert-circle"></i>
            <div><b>Mot de passe incorrect.</b></div>
        </div>
    `;

    const footer = `
        <button class="btn btn-ghost" data-admin-login-action="cancel">Annuler</button>
        <button class="btn btn-primary" data-admin-login-action="confirm">Connexion</button>
    `;

    openHwModal({
        size: 'sm',
        icon: 'lock',
        title: 'Connexion Admin',
        body,
        footer,
    });

    // Bind après ouverture (DOM prêt)
    setTimeout(() => {
        const input = document.getElementById('admin-password-input');
        const errorBanner = document.getElementById('login-error-banner');
        const btnConfirm = document.querySelector('[data-admin-login-action="confirm"]');
        const btnCancel = document.querySelector('[data-admin-login-action="cancel"]');

        if (input) {
            input.focus();
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    btnConfirm?.click();
                }
            });
        }

        btnCancel?.addEventListener('click', () => closeHwModal());

        btnConfirm?.addEventListener('click', async () => {
            if (!input) return;
            const pwd = input.value.trim();
            const ok = await verifyAdminPassword(pwd);

            if (ok) {
                setIsAdmin(true);
                showToast('Connexion réussie !', 'success');
                eventBus.emit('admin:mode-toggled', true);
                closeHwModal();
            } else {
                if (errorBanner) errorBanner.hidden = false;
                input.value = '';
                input.focus();
            }
        });
    }, 30);
}

function toggleAdminUI(isAdmin) {
    const adminContainer = document.getElementById('admin-tools-container');
    if (adminContainer) {
        adminContainer.classList.toggle('is-hidden', !isAdmin);
    }
    // Expose le mode admin au CSS pour conditionner certains affichages
    // (ex: bouton "Modifier" sur circuits officiels/vérifiés — cf. panels.css).
    document.body.classList.toggle('admin-mode', isAdmin);
}

function setupAdminListeners() {
    const btnMenu = document.getElementById('btn-admin-menu');
    const menuContent = document.getElementById('admin-menu-content');

    if (btnMenu && menuContent) {
        btnMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = menuContent.classList.contains('active');
            closeAllDropdowns();
            if (!isActive) {
                // Ferme aussi les autres popups topbar (dest, theme, info-popover)
                // qui n'écoutent pas closeAllDropdowns. Cf. fix #6 PR R3.
                eventBus.emit('topbar:popup-opening', { id: 'god-mode' });
                menuContent.classList.add('active');
            }
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!btnMenu.contains(e.target) && !menuContent.contains(e.target)) {
                menuContent.classList.remove('active');
            }
        });
    }

    // Boutons "Scout", "Data Manager", "Export Master GeoJSON" et
    // "Importer Carte (GeoJSON)" retirés du menu admin God Mode 15/05/2026 :
    // déplacés en cartes dans la section Outils du Centre de Contrôle (CC admin).
    // Une seule porte d'entrée admin pour tous les outils. IDs purgés dans
    // la liste de nettoyage migration plus bas pour les users avec ancienne
    // version cachée.

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

        // Nettoyage des anciens boutons s'ils existent (Migration). IDs retirés
        // historiquement pour limiter les boutons résiduels chez les users qui
        // auraient l'ancienne version cachée par le SW PWA :
        //   - btn-admin-config-github, btn-admin-publish-map (anciens, pré-CC)
        //   - btn-admin-github-upload (PR #592 — doublon de "Publier un circuit")
        //   - btn-admin-scout, btn-admin-export-master, btn-open-geojson,
        //     btn-admin-datamanager (15/05/2026 — déplacés dans CC admin > Outils)
        [
            'btn-admin-config-github',
            'btn-admin-publish-map',
            'btn-admin-github-upload',
            'btn-admin-scout',
            'btn-admin-export-master',
            'btn-open-geojson',
            'btn-admin-datamanager'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
    }
}

export function exportMasterGeoJSON() {
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
    // Couleur dynamique via data-color : appliquée au CSSOM post-render (CSP sans 'unsafe-inline')
    const materialRows = MATERIAL_RANKS.map(r => `
        <tr>
            <td><span class="rank-dot" data-color="${r.color}"></span></td>
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

    // Migration V2 : openHwModal md avec subheader (tabs) + body (panels).
    // Pattern Mon Espace : footer false (croix uniquement) — c'est une modale
    // info-only, le bouton "Fermer" en footer ne sert à rien.
    const subheader = `
        <div class="ue-tabs">
            <button class="ue-tab is-active" type="button" data-rank-tab="animals">🐾 Animaux</button>
            <button class="ue-tab" type="button" data-rank-tab="materials">💎 Matières</button>
            <button class="ue-tab" type="button" data-rank-tab="global">⭐ Global</button>
        </div>
    `;

    const body = `
        <div class="rank-tabs-wrapper">
            <div class="rank-tab-panel is-active" id="rank-panel-animals">
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

    openHwModal({
        size: 'md',
        icon: 'award',
        title: 'Tableau des Rangs',
        subheader,
        body,
        footer: false,
    });

    // Bind après ouverture (DOM prêt)
    setTimeout(() => {
        const modalEl = document.querySelector('.hw-modal-overlay.is-active .hw-modal');
        if (!modalEl) return;

        // 1. Icônes Lucide
        createIcons({ icons: appIcons, root: modalEl });

        // 2. Couleur des rank-dot via CSSOM (CSP-safe)
        modalEl.querySelectorAll('.rank-dot[data-color]').forEach(dot => {
            dot.style.backgroundColor = dot.dataset.color;
        });

        // 3. Logique des onglets
        const tabs = modalEl.querySelectorAll('.ue-tab[data-rank-tab]');
        const panels = modalEl.querySelectorAll('.rank-tab-panel');
        tabs.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.rankTab;
                tabs.forEach(b => b.classList.remove('is-active'));
                panels.forEach(p => p.classList.remove('is-active'));
                btn.classList.add('is-active');
                modalEl.querySelector(`#rank-panel-${target}`)?.classList.add('is-active');
            });
        });
    }, 30);
}

// --- GITHUB UPLOAD UI ---

// Fonction showGitHubUploadModal retirée 15/05/2026 — doublon legacy de
// renderUploadCircuitPanel (CC admin > Outils > "Importer un circuit") qui
// offre la même fonctionnalité (upload GPX/JSON sur GitHub) avec une UI
// moderne intégrée. La modale legacy avait été restaurée à l'époque où le
// CC admin ne fonctionnait pas — plus de raison de la garder.
