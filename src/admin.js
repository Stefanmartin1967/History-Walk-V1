import { state } from './state.js';
import { eventBus } from './events.js';
import { downloadFile } from './utils.js';
import { showToast } from './toast.js';
import { closeAllDropdowns } from './ui.js';
import { map } from './map.js';
import { showAlert } from './modal.js';
import { ANIMAL_RANKS } from './statistics.js';
import { createIcons, icons } from 'lucide';
import { uploadFileToGitHub, getStoredToken, saveToken } from './github-sync.js';

export function initAdminMode() {
    // Initial check
    console.log("[Admin] Init mode. Is Admin?", state.isAdmin);
    toggleAdminUI(state.isAdmin);

    eventBus.on('admin:mode-toggled', (isAdmin) => {
        toggleAdminUI(isAdmin);
    });

    setupAdminListeners();
    setupGodModeListener();
    setupGitHubUploadUI(); // Setup the new UI logic
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

    const btnExport = document.getElementById('btn-admin-export-master');
    if (btnExport) {
        btnExport.addEventListener('click', exportMasterGeoJSON);
    }

    // --- NOUVEAU : Bouton Publier Carte Officielle (One-Click) ---
    const btnPublish = document.getElementById('btn-admin-publish-map');
    if (btnPublish) {
        btnPublish.addEventListener('click', publishMapToGitHub);
    }

    // --- NOUVEAU : Calibration Carte ---
    const btnCaptureView = document.getElementById('btn-admin-capture-view');
    if (btnCaptureView) {
        btnCaptureView.addEventListener('click', captureCurrentMapView);
    }

    const btnExportDestinations = document.getElementById('btn-admin-export-destinations');
    if (btnExportDestinations) {
        btnExportDestinations.addEventListener('click', exportDestinationsConfig);
    }

    // --- Ajout Dynamique du Bouton RANGS dans le Menu Admin ---
    const menuContainer = document.getElementById('admin-menu-content');
    if (menuContainer) {
        // On vérifie si le bouton existe déjà (pour éviter les doublons lors des HMR)
        let btnRanks = document.getElementById('btn-admin-show-ranks');
        if (!btnRanks) {
            btnRanks = document.createElement('button');
            btnRanks.id = 'btn-admin-show-ranks';
            btnRanks.className = 'tools-menu-item';
            btnRanks.innerHTML = `<i data-lucide="award"></i> Rangs & XP`;
            // Insérer avant le premier séparateur ou à la fin
            const separator = menuContainer.querySelector('div[style*="height:1px"]');
            if (separator) {
                menuContainer.insertBefore(btnRanks, separator);
            } else {
                menuContainer.appendChild(btnRanks);
            }
            // Refresh icons
            createIcons({ icons, root: btnRanks });
        }

        // Listener (on remplace l'ancien pour éviter les doublons d'écouteurs)
        const newBtn = btnRanks.cloneNode(true);
        btnRanks.parentNode.replaceChild(newBtn, btnRanks);
        newBtn.addEventListener('click', showRankTable);

        // --- NOUVEAU : Bouton Upload GitHub ---
        let btnGitHub = document.getElementById('btn-admin-github-upload');
        if (!btnGitHub) {
            btnGitHub = document.createElement('button');
            btnGitHub.id = 'btn-admin-github-upload';
            btnGitHub.className = 'tools-menu-item';
            btnGitHub.innerHTML = `<i data-lucide="upload-cloud"></i> Upload Fichier`;

            // Add at the end
            menuContainer.appendChild(btnGitHub);
            createIcons({ icons, root: btnGitHub });
        }

        const newGitHubBtn = btnGitHub.cloneNode(true);
        btnGitHub.parentNode.replaceChild(newGitHubBtn, btnGitHub);
        newGitHubBtn.addEventListener('click', showGitHubUploadModal);

        // --- NOUVEAU : Bouton Publier Carte (One-Click) ---
        let btnPublish = document.getElementById('btn-admin-publish-map');
        if (!btnPublish) {
            btnPublish = document.createElement('button');
            btnPublish.id = 'btn-admin-publish-map';
            btnPublish.className = 'tools-menu-item';
            btnPublish.style.color = 'var(--brand)';
            btnPublish.style.fontWeight = '600';
            btnPublish.innerHTML = `<i data-lucide="globe"></i> Publier Carte`;

            // Add at the end
            menuContainer.appendChild(btnPublish);
            createIcons({ icons, root: btnPublish });
        }

        const newPublishBtn = btnPublish.cloneNode(true);
        btnPublish.parentNode.replaceChild(newPublishBtn, btnPublish);
        newPublishBtn.addEventListener('click', publishMapToGitHub);
    }
}

function setupGodModeListener() {
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
            state.isAdmin = !state.isAdmin;
            showToast(`Mode GOD : ${state.isAdmin ? 'ACTIVÉ' : 'DÉSACTIVÉ'}`, state.isAdmin ? 'success' : 'info');

            // Émettre un événement pour que l'UI se mette à jour
            eventBus.emit('admin:mode-toggled', state.isAdmin);

            buffer = []; // Reset
        }
    });
}

function generateMasterGeoJSONData() {
    if (!state.loadedFeatures || state.loadedFeatures.length === 0) {
        return null;
    }

    const features = state.loadedFeatures.map(f => {
        // Clone profond pour ne pas modifier l'original
        const properties = JSON.parse(JSON.stringify(f.properties));

        // Fusionner userData dans properties (Officialisation des modifs)
        if (properties.userData) {
            Object.assign(properties, properties.userData);
            delete properties.userData; // On nettoie
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

// --- CALIBRATION CARTE (GOD MODE) ---

function captureCurrentMapView() {
    if (!map) {
        showToast("Carte non initialisée.", "error");
        return;
    }

    if (!state.currentMapId) {
        showToast("Aucune carte active identifiée.", "error");
        return;
    }

    // --- BLINDAGE DE SÉCURITÉ ---
    // On s'assure que la structure existe même si le chargement initial a échoué
    if (!state.destinations) {
        state.destinations = { activeMapId: state.currentMapId, maps: {} };
    }
    if (!state.destinations.maps) {
        state.destinations.maps = {};
    }
    if (!state.destinations.maps[state.currentMapId]) {
        // Initialisation de la destination courante si nouvelle
        state.destinations.maps[state.currentMapId] = {
            name: state.currentMapId.charAt(0).toUpperCase() + state.currentMapId.slice(1),
            file: `${state.currentMapId}.geojson`
        };
    }

    // Récupération des valeurs actuelles
    const center = map.getCenter();
    const zoom = map.getZoom();

    // Arrondi pour propreté (5 décimales pour lat/lng, 1 pour zoom)
    const newCenter = [
        parseFloat(center.lat.toFixed(5)),
        parseFloat(center.lng.toFixed(5))
    ];
    const newZoom = parseFloat(zoom.toFixed(1));

    // Mise à jour de l'objet state
    state.destinations.maps[state.currentMapId].startView = {
        center: newCenter,
        zoom: newZoom
    };

    console.log(`[GodMode] Nouvelle vue capturée pour ${state.currentMapId}:`, state.destinations.maps[state.currentMapId].startView);
    showToast(`Vue mémorisée pour ${state.currentMapId} !`, "success");
}

function exportDestinationsConfig() {
    if (!state.destinations) {
        showToast("Aucune configuration à exporter.", "error");
        return;
    }

    const jsonStr = JSON.stringify(state.destinations, null, 2);
    downloadFile('destinations.json', jsonStr, 'application/json');
    showToast("destinations.json exporté !", "success");
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

function showGitHubUploadModal() {
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

            statusDiv.textContent = "Succès ! Le site se mettra à jour dans quelques minutes.";
            statusDiv.style.color = "green";
            showToast("Fichier envoyé avec succès !", "success");

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
