// app-startup.js
import { state, setCurrentMap, setLoadedFeatures, setMyCircuits, setOfficialCircuits, setDestinations, setUserData, setOfficialCircuitsStatus, setTestedCircuits, setCustomFeatures, setSelectedOfficialCircuitIds } from './state.js';
import { getAppState, saveAppState, getAllPoiDataForMap, getAllCircuitsForMap, deleteCircuitById } from './database.js';
import { initMap } from './map.js';
import { displayGeoJSON, applyFilters, getPoiId, checkAndApplyMigrations } from './data.js';
import { isMobileView } from './mobile-state.js';
import { switchMobileView } from './mobile-nav.js';
import { DOM } from './ui-dom.js';
import { showToast } from './toast.js';
import { loadCircuitDraft } from './circuit.js';
import { recalculatePlannedCountersForMap } from './circuit-actions.js';
import { enableDesktopCreationMode } from './desktopMode.js';
import { eventBus } from './events.js';
import { pullFromGist, injectSyncIndicator } from './gist-sync.js';
import { RAW_BASE, GITHUB_PATHS } from './config.js';

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
}

export async function loadOfficialCircuits() {
    const mapId = state.currentMapId || 'djerba';
    const circuitsUrl = `./circuits/${mapId}.json`;

    // Le SW gère NetworkFirst avec fallback cache (timeout 8s) — pas besoin de double-fetch
    let officials = [];
    try {
        const response = await fetch(circuitsUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        officials = await response.json();
    } catch (e) {
        console.error(`[Startup] Erreur chargement circuits:`, e);
    }

    if (officials.length > 0) {
        const processedOfficials = officials.map(off => ({
            ...off,
            isOfficial: true,
            id: String(off.id || `official_${off.name.replace(/\s+/g, '_')}`),
            poiIds: (off.poiIds || []).map(pid => String(pid))
        }));
        setOfficialCircuits(processedOfficials);

        // Charger la sélection Mon Espace depuis IndexedDB
        const savedSelection = await getAppState('selectedOfficialCircuits');
        if (savedSelection !== null && savedSelection !== undefined) {
            setSelectedOfficialCircuitIds(savedSelection);
        }
        // null = pas encore défini = tous affichés (comportement par défaut)

        // Si on est déjà en mode Admin, on déclenche une migration pour mettre à jour les circuits chargés
        if (state.isAdmin) {
            checkAndApplyMigrations();
        }

        eventBus.emit('circuit:list-updated');
    } else {
        setOfficialCircuits([]);
    }
}

export async function loadDestinationsConfig() {
    const baseUrl = import.meta.env?.BASE_URL || './';
    const configUrl = baseUrl + 'destinations.json';

    // Le SW gère NetworkFirst avec fallback cache (timeout 8s) — pas besoin de double-fetch
    let config = null;
    try {
        const response = await fetch(configUrl);
        if (response.ok) {
            config = await response.json();
        }
    } catch (e) {
        console.error("[Startup] Erreur chargement destinations.json.", e);
    }

    if (config) {
        setDestinations(config);
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

    if (DOM.loaderOverlay) DOM.loaderOverlay.classList.remove('is-hidden');

    try {
        // Cache-bust : sans ça, le navigateur peut servir une version HTTP-cachée
        // du geojson jusqu'à plusieurs minutes après une publication admin. Le SW
        // en NetworkFirst ne protège pas contre le cache HTTP amont. Résultat :
        // la session admin voyait ses propres modifs "réapparaître" dans le CC
        // car le diff engine fetchait raw.githubusercontent (frais) tandis que
        // l'app servait une version stale de GH Pages.
        const resp = await fetch(`${baseUrl}${fileName}?t=${Date.now()}`, { cache: 'reload' });
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
        if (DOM.loaderOverlay) DOM.loaderOverlay.classList.add('is-hidden');
        return;
    }

    // 3. Mise à jour État
    setCurrentMap(activeMapId);
    updateAppTitle(activeMapId);
    await saveAppState('lastMapId', activeMapId);
    if (!isMobileView()) await saveAppState('lastGeoJSON', geojsonData);

    // 4. Chargement User Data & Circuits (Smart Merge)
    try {
        const loadedUserData = await getAllPoiDataForMap(activeMapId) || {};

        // Migration one-shot (visité binaire → vuManual + visitedByCircuits).
        // Pour chaque POI où `vu=true` sans trace des nouveaux champs,
        // on suppose que l'état actuel vient d'une coche manuelle → vuManual=true.
        // Les décochages de circuits ultérieurs ne toucheront pas à ce flag.
        const migrationUpdates = [];
        for (const [poiId, ud] of Object.entries(loadedUserData)) {
            if (!ud || typeof ud !== 'object') continue;
            const alreadyMigrated = ud.vuManual !== undefined || Array.isArray(ud.visitedByCircuits);
            if (ud.vu === true && !alreadyMigrated) {
                ud.vuManual = true;
                ud.visitedByCircuits = [];
                migrationUpdates.push({ poiId, data: ud });
            }
        }
        if (migrationUpdates.length > 0) {
            try {
                const { batchSavePoiData } = await import('./database.js');
                await batchSavePoiData(activeMapId, migrationUpdates);
                console.log(`[Migration] ${migrationUpdates.length} POI(s) migrés vers vuManual.`);
            } catch (e) {
                console.warn("[Migration] Échec sauvegarde migration vuManual :", e);
            }
        }

        setUserData(loadedUserData);
        const loadedCircuits = await getAllCircuitsForMap(activeMapId) || [];
        setMyCircuits(loadedCircuits);
        const loadedStatus = await getAppState(`official_circuits_status_${activeMapId}`) || {};
        setOfficialCircuitsStatus(loadedStatus);
        const loadedTested = await getAppState(`tested_circuits_${activeMapId}`) || {};
        setTestedCircuits(loadedTested);

        // Fetch du statut "vérifié" public (publié par admin via Control Center).
        // Le public écrase le local pour que tous les users voient la même chose.
        // 404 attendu avant la 1re publication → fallback silencieux.
        try {
            const testedUrl = `${RAW_BASE}/${GITHUB_PATHS.tested(activeMapId)}?t=${Date.now()}`;
            const respTested = await fetch(testedUrl);
            if (respTested.ok) {
                const publicTested = await respTested.json();
                if (publicTested && typeof publicTested === 'object') {
                    setTestedCircuits({ ...state.testedCircuits, ...publicTested });
                    await saveAppState(`tested_circuits_${activeMapId}`, state.testedCircuits);
                }
            }
        } catch (e) {
            // Silencieux : pas de fichier = premier démarrage, ou offline.
        }
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
            const mergedOfficials = state.officialCircuits.map(off => {
                const loc = state.myCircuits.find(l => String(l.id) === String(off.id));
                return loc ? { ...off, ...loc, isOfficial: true } : off;
            });
            setOfficialCircuits(mergedOfficials);

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
            setLoadedFeatures([...state.loadedFeatures, ...customPois]);
            setCustomFeatures(customPois);
        }

        // FIX: Ensure userData is linked to features on Mobile too
        state.loadedFeatures.forEach(feature => {
            const id = getPoiId(feature);
            if (state.userData[id]) {
                feature.properties.userData = state.userData[id];
            }
        });

        // Recalculate counters to ensure consistency with loaded official circuits
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

        try {
            await displayGeoJSON(geojsonData, activeMapId);

            // Recalculate counters to ensure consistency with loaded official circuits
            await recalculatePlannedCountersForMap(activeMapId);

            // Refresh UI with new counters
            applyFilters();

            // Rétablissement du centrage intelligent
            import('./map.js').then(m => m.fitMapToContent());

            try { await loadCircuitDraft(); } catch (e) {}
            setSaveButtonsState(true);
            if (DOM.btnRestoreData) DOM.btnRestoreData.disabled = false;

            eventBus.emit('circuit:list-updated');
        } catch (e) {
            console.error("Erreur lors du rendu de la carte :", e);
            showToast("Erreur lors de l'affichage de la carte. Réessayez ou rechargez la page.", "error");
        }
    }

    if (DOM.loaderOverlay) DOM.loaderOverlay.classList.add('is-hidden');

    // Gist sync : pull après chargement complet + injecter indicateur
    injectSyncIndicator();
    pullFromGist();
}
