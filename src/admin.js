import { state } from './state.js';
import { eventBus } from './events.js';
import { downloadFile } from './utils.js';
import { showToast } from './toast.js';
import { closeAllDropdowns } from './ui.js';
import { map } from './map.js';

export function initAdminMode() {
    // Initial check
    console.log("[Admin] Init mode. Is Admin?", state.isAdmin);
    toggleAdminUI(state.isAdmin);

    eventBus.on('admin:mode-toggled', (isAdmin) => {
        toggleAdminUI(isAdmin);
    });

    setupAdminListeners();
    setupGodModeListener();
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

    // --- NOUVEAU : Calibration Carte ---
    const btnCaptureView = document.getElementById('btn-admin-capture-view');
    if (btnCaptureView) {
        btnCaptureView.addEventListener('click', captureCurrentMapView);
    }

    const btnExportDestinations = document.getElementById('btn-admin-export-destinations');
    if (btnExportDestinations) {
        btnExportDestinations.addEventListener('click', exportDestinationsConfig);
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

function exportMasterGeoJSON() {
    if (!state.loadedFeatures || state.loadedFeatures.length === 0) {
        showToast("Aucune donnée à exporter.", "error");
        return;
    }

    const filename = prompt("Nom du fichier à exporter :", `djerba-master-${Date.now()}.geojson`);
    if (!filename) return;

    // Nettoyage et préparation des données
    const features = state.loadedFeatures.map(f => {
        // Clone profond pour ne pas modifier l'original
        const properties = JSON.parse(JSON.stringify(f.properties));

        // Fusionner userData dans properties (Officialisation des modifs)
        if (properties.userData) {
            Object.assign(properties, properties.userData);
            delete properties.userData; // On nettoie
        }

        // Supprimer les clés internes inutiles
        delete properties._leaflet_id;

        return {
            type: "Feature",
            geometry: f.geometry,
            properties: properties
        };
    });

    const geojson = {
        type: "FeatureCollection",
        features: features
    };

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
