// app-startup.js
import { state, setCurrentMap, setLoadedFeatures, setMyCircuits } from './state.js';
import { getAppState, saveAppState, getAllPoiDataForMap, getAllCircuitsForMap, deleteCircuitById } from './database.js';
import { initMap } from './map.js';
import { displayGeoJSON, applyFilters, getPoiId, checkAndApplyMigrations } from './data.js';
import { isMobileView, switchMobileView } from './mobile.js';
import { updateExportButtonLabel, DOM } from './ui.js';
import { showToast } from './toast.js';
import { loadCircuitDraft } from './circuit.js';
import { enableDesktopCreationMode } from './desktopMode.js';
import { eventBus } from './events.js';

// --- FONCTION UTILITAIRE : Gestion des boutons de sauvegarde ---
export function setSaveButtonsState(enabled) {
    const btnBackup = document.getElementById('btn-open-backup-modal');
    const btnRestore = document.getElementById('btn-restore-data');

    if (btnBackup) btnBackup.disabled = !enabled;
    if (btnRestore) btnRestore.disabled = false;
}

export function updateAppTitle(mapId) {
    if (!mapId) return;
    const mapName = mapId.charAt(0).toUpperCase() + mapId.slice(1);
    const title = `History Walk - ${mapName}`;
    document.title = title;
    const appTitle = document.getElementById('app-title');
    if (appTitle) appTitle.textContent = title;

    updateExportButtonLabel(mapId);
}

export async function loadOfficialCircuits() {
    const mapId = state.currentMapId || 'djerba';
    const circuitsUrl = `./circuits/${mapId}.json`;

    let officials = [];
    try {
        // 1. Tentative Réseau (Bypass Cache SW avec timestamp)
        const response = await fetch(`${circuitsUrl}?t=${Date.now()}`);
        if (!response.ok) throw new Error("Network error");
        officials = await response.json();
        console.log(`[Startup] Circuits officiels chargés (Network).`);
    } catch (e) {
        // 2. Fallback Cache (Offline ou Erreur)
        console.warn(`[Startup] Echec réseau, tentative cache...`, e);
        try {
            const response = await fetch(circuitsUrl);
            if (response.ok) {
                officials = await response.json();
                console.log(`[Startup] Circuits officiels chargés (Cache).`);
            }
        } catch (e2) {
            console.error(`[Startup] Erreur finale chargement circuits:`, e2);
        }
    }

    if (officials.length > 0) {
        state.officialCircuits = officials.map(off => ({
            ...off,
            isOfficial: true,
            id: String(off.id || `official_${off.name.replace(/\s+/g, '_')}`),
            poiIds: (off.poiIds || []).map(pid => String(pid))
        }));

        // Si on est déjà en mode Admin, on déclenche une migration pour mettre à jour les circuits chargés
        if (state.isAdmin) {
            checkAndApplyMigrations();
        }

        eventBus.emit('circuit:list-updated');
    } else {
        state.officialCircuits = [];
    }
}

export async function loadDestinationsConfig() {
    const baseUrl = import.meta.env?.BASE_URL || './';
    const configUrl = baseUrl + 'destinations.json';

    let config = null;
    try {
        // 1. Network First
        const response = await fetch(`${configUrl}?t=${Date.now()}`);
        if (response.ok) {
            config = await response.json();
            console.log("[Startup] destinations.json chargé (Network).", config);
        }
    } catch (e) {
        // 2. Fallback Cache
        try {
            const response = await fetch(configUrl);
            if (response.ok) {
                config = await response.json();
                console.log("[Startup] destinations.json chargé (Cache).", config);
            }
        } catch (e2) {
            console.error("[Startup] Erreur chargement destinations.json.", e2);
        }
    }

    if (config) {
        state.destinations = config;
    }
}

export async function loadAndInitializeMap() {
    // 0. Config (CRITIQUE : On attend la config avant tout)
    await loadDestinationsConfig();

    const baseUrl = import.meta.env?.BASE_URL || './';

    // 1. Calcul de la stratégie de vue (Avant d'init la carte)
    let activeMapId = 'djerba';
    let initialView = { center: [33.77478, 10.94353], zoom: 11.5 }; // Fallback ultime

    // A. Détermination Map ID
    if (state.destinations) {
        const urlParams = new URLSearchParams(window.location.search);
        const urlMapId = urlParams.get('map');
        if (urlMapId && state.destinations.maps[urlMapId]) {
            activeMapId = urlMapId;
        } else if (state.destinations.activeMapId) {
            activeMapId = state.destinations.activeMapId;
        }
        // B. Config View (si dispo)
        if (state.destinations.maps[activeMapId] && state.destinations.maps[activeMapId].startView) {
            initialView = state.destinations.maps[activeMapId].startView;
        }
    }

    // C. Restauration Vue Utilisateur (SUPPRIMÉE)
    // On force la vue par défaut pour éviter les conflits d'initialisation

    // 2. Chargement des données (GeoJSON)
    let geojsonData = null;
    let fileName = `${activeMapId}.geojson`;
    if (state.destinations?.maps[activeMapId]?.file) {
        fileName = state.destinations.maps[activeMapId].file;
    }

    if (DOM.loaderOverlay) DOM.loaderOverlay.style.display = 'flex';

    try {
        const resp = await fetch(baseUrl + fileName);
        if(resp.ok) geojsonData = await resp.json();
    } catch(e) {
        // Fallback offline
        const lastMapId = await getAppState('lastMapId');
        const lastGeoJSON = await getAppState('lastGeoJSON');
        if (lastMapId === activeMapId && lastGeoJSON) {
            geojsonData = lastGeoJSON;
            console.warn("Chargement hors-ligne (fallback)");
        } else {
            console.error("Erreur download map", e);
        }
    }

    if (!geojsonData) {
        showToast("Impossible de charger la carte.", 'error');
        if (DOM.loaderOverlay) DOM.loaderOverlay.style.display = 'none';
        return;
    }

    // 3. Mise à jour État
    setCurrentMap(activeMapId);
    updateAppTitle(activeMapId);
    await saveAppState('lastMapId', activeMapId);
    if (!isMobileView()) await saveAppState('lastGeoJSON', geojsonData);

    // 4. Chargement User Data & Circuits (Smart Merge)
    try {
        state.userData = await getAllPoiDataForMap(activeMapId) || {};
        const loadedCircuits = await getAllCircuitsForMap(activeMapId) || [];
        setMyCircuits(loadedCircuits);
        state.officialCircuitsStatus = await getAppState(`official_circuits_status_${activeMapId}`) || {};
        await loadOfficialCircuits();

        const validCircuits = [];
        for (const c of state.myCircuits) {
            let toDelete = false;
            if (!c.poiIds || c.poiIds.length === 0) toDelete = true;
            if (toDelete) await deleteCircuitById(c.id);
            else validCircuits.push(c);
        }
        setMyCircuits(validCircuits);

        if (state.officialCircuits) {
            state.officialCircuits = state.officialCircuits.map(off => {
                const loc = state.myCircuits.find(l => String(l.id) === String(off.id));
                return loc ? { ...off, ...loc, isOfficial: true } : off;
            });
            const filteredCircuits = state.myCircuits.filter(c =>
                !state.officialCircuits.some(off => String(off.id) === String(c.id))
            );
            setMyCircuits(filteredCircuits);
        }
    } catch (e) { console.warn("Erreur chargement user data", e); }

    // 5. RENDU (La stabilisation est ici)
    if (isMobileView()) {
        setLoadedFeatures(geojsonData.features || []);

        // --- MERGE CUSTOM POIS (MOBILE) ---
        const customPois = await getAppState(`customPois_${activeMapId}`) || [];
        if (customPois.length > 0) {
            console.log(`[Mobile] Fusion de ${customPois.length} lieux personnalisés.`);
            setLoadedFeatures([...state.loadedFeatures, ...customPois]);
            state.customFeatures = customPois;
        }

        // FIX: Ensure userData is linked to features on Mobile too
        state.loadedFeatures.forEach(feature => {
            const id = getPoiId(feature);
            if (state.userData[id]) {
                feature.properties.userData = state.userData[id];
            }
        });

        // Recalculate counters to ensure consistency with loaded official circuits
        const { recalculatePlannedCountersForMap } = await import('./gpx.js');
        await recalculatePlannedCountersForMap(activeMapId);

        await saveAppState('lastGeoJSON', geojsonData); // Mobile cache specific
        setSaveButtonsState(true);
        switchMobileView('circuits');
    } else {
        // CORRECTION: On doit aussi peupler loadedFeatures sur Desktop
        setLoadedFeatures(geojsonData.features || []);

        // INIT MAP UNE SEULE FOIS AVEC LA BONNE VUE
        // Plus de "Djerba default" puis "Jump"
        initMap(initialView.center, initialView.zoom);

        // NOUVEAU : On active la création desktop après que la map soit prête
        enableDesktopCreationMode();

        await displayGeoJSON(geojsonData, activeMapId);

        // Recalculate counters to ensure consistency with loaded official circuits
        const { recalculatePlannedCountersForMap } = await import('./gpx.js');
        await recalculatePlannedCountersForMap(activeMapId);

        // Refresh UI with new counters
        applyFilters();

        // Rétablissement du centrage intelligent
        import('./map.js').then(m => m.fitMapToContent());

        try { await loadCircuitDraft(); } catch (e) {}
        setSaveButtonsState(true);
        if (DOM.btnRestoreData) DOM.btnRestoreData.disabled = false;

        eventBus.emit('circuit:list-updated');
    }

    if (DOM.loaderOverlay) DOM.loaderOverlay.style.display = 'none';
}
