// app-startup.js
import { state, setCurrentMap, setLoadedFeatures, setMyCircuits, setOfficialCircuits, setDestinations, setUserData, setOfficialCircuitsStatus, setTestedCircuits, setCustomFeatures, setHiddenCircuitIds, setPoiCategories } from './state.js';
import { setTaxonomy, getCategoryLabels } from './taxonomy.js';
import { setZonesData } from './zones.js';
import { getAppState, saveAppState, getAllPoiDataForMap, getAllCircuitsForMap, deleteCircuitById } from './database.js';
import { initMap } from './map.js';
import { displayGeoJSON, applyFilters, getPoiId, checkAndApplyMigrations } from './data.js';
import { isMobileView } from './mobile-state.js';
import { switchMobileView } from './mobile-nav.js';
import { DOM } from './ui-dom.js';
import { showToast } from './toast.js';
import { loadCircuitDraft } from './circuit.js';
import { updateCurrencyUnits } from './circuit-view.js';
import { enableDesktopCreationMode } from './desktopMode.js';
import { eventBus } from './events.js';
import { pullFromGist } from './gist-sync.js';
import { RAW_BASE, GITHUB_PATHS } from './config.js';
import { isDestinationPublished } from './utils.js';

// (setSaveButtonsState supprimée 10/05/2026, PR cleanup post-#514. Les boutons
// btn-open-backup-modal et btn-restore-data n'existent plus dans le DOM
// — Sauvegarder/Restaurer sont accessibles via Outils > Sauvegarder
// (PR3 dissolution Mon Espace, 06/06/2026 — cf. save-modal-ui.js).)

export function updateAppTitle(mapId) {
    if (!mapId) return;
    const mapName = mapId.charAt(0).toUpperCase() + mapId.slice(1);
    document.title = `Heripia - ${mapName}`;
    // PR 3 (refonte topbar) : le titre #app-title a été remplacé par le
    // sélecteur de destination. Le nom de la destination active y figure.
    const destName = document.getElementById('hw-dest-selector-name');
    if (destName) destName.textContent = mapName;
}

export async function loadOfficialCircuits() {
    const mapId = state.currentMapId || 'djerba';
    // BASE_URL (chemin FIXE), pas un chemin relatif : si l'app est lancée à une
    // URL profonde (ex. scan d'un QR de partage …/circuits/x.gpx qui ouvre la
    // PWA), un './circuits/...' se résoudrait en …/circuits/circuits/...json →
    // 404 → « Mes Circuits » vide. Aligné sur les autres loaders (destinations,
    // catégories, geojson).
    const baseUrl = import.meta.env?.BASE_URL || './';
    const circuitsUrl = `${baseUrl}circuits/${mapId}.json`;

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

        // Charger la blacklist des circuits cachés depuis IndexedDB.
        // [] par défaut = tous visibles. Persistance écrite par PR2 (bouton "Cacher ce circuit").
        const savedHidden = await getAppState('hiddenCircuitIds');
        if (Array.isArray(savedHidden)) {
            setHiddenCircuitIds(savedHidden);
        }

        // Si on est déjà en mode Admin, on déclenche une migration pour mettre à jour les circuits chargés
        if (state.isAdmin) {
            checkAndApplyMigrations();
        }

        // Pas d'émission `circuit:list-updated` ici : `loadOfficialCircuits` est
        // appelé pendant le boot AVANT que `setLoadedFeatures` ne soit invoqué.
        // Émettre maintenant déclenche un 1er render avec validPois=[] (POI=0,
        // pas de pastille Resto). L'appelant (loadAndInitializeMap) émet déjà
        // l'event après chargement complet — c'est suffisant.
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

// Zones (quartiers OSM) de la destination ACTIVE — réunif : remplace l'ancien
// zones.js codé en dur (Djerba only) par un chargement PAR destination.
//   - publiée : fetch public/{dest}-zones.geojson (+ cache offline `lastZones_`) ;
//   - brouillon local : IndexedDB (clé draftZones_{id}).
// Échec/absence → zones vides → getZoneFromCoords renvoie « A définir » (sûr).
async function loadZonesForActive(mapId, dest) {
    try {
        if (dest?.custom) {
            const z = await getAppState(`draftZones_${mapId}`);
            setZonesData(z || { type: 'FeatureCollection', features: [] });
            return;
        }
        const baseUrl = import.meta.env?.BASE_URL || './';
        const zonesFile = dest?.zonesFile || `${mapId}-zones.geojson`;
        const resp = await fetch(`${baseUrl}${zonesFile}?t=${Date.now()}`, { cache: 'reload' });
        if (resp.ok) {
            const z = await resp.json();
            setZonesData(z);
            try { await saveAppState(`lastZones_${mapId}`, z); } catch (e) {}
            return;
        }
        throw new Error(`zones HTTP ${resp.status}`);
    } catch (e) {
        const cached = await getAppState(`lastZones_${mapId}`);
        setZonesData(cached || { type: 'FeatureCollection', features: [] });
    }
}

export async function loadPoiCategoriesConfig() {
    const baseUrl = import.meta.env?.BASE_URL || './';
    const configUrl = baseUrl + 'poi-categories.json';

    try {
        const response = await fetch(configUrl);
        if (response.ok) {
            const data = await response.json();
            setTaxonomy(data);
            setPoiCategories(getCategoryLabels());
        }
    } catch (e) {
        console.warn("[Startup] poi-categories.json indisponible — fallback sur la taxonomie intégrée.", e);
    }
}

export async function loadAndInitializeMap() {
    // Migration one-shot : la clé localStorage `hw_poi_tools_open` (drawer
    // outils PC, refonte 11/05/2026) n'est plus utilisée. Cleanup pour les
    // users existants. No-op si la clé n'existe pas.
    try { localStorage.removeItem('hw_poi_tools_open'); } catch {}

    // 0. Configs (CRITIQUE : On attend les configs avant tout)
    await Promise.all([
        loadDestinationsConfig(),
        loadPoiCategoriesConfig()
    ]);

    const baseUrl = import.meta.env?.BASE_URL || './';

    // 1. Calcul de la stratégie de vue (Avant d'init la carte)
    let activeMapId = 'djerba';
    let initialView = { center: [33.77478, 10.94353], zoom: 11.5 }; // Fallback ultime

    // A. Détermination Map ID — priorité :
    //    1. URL `?map=...` (intention explicite)
    //    2. localStorage `hw_active_dest` (dernier choix utilisateur, partagé avec le DM)
    //    3. `destinations.activeMapId` (default config)
    //    4. fallback "djerba"
    if (state.destinations) {
        const urlParams = new URLSearchParams(window.location.search);
        const urlMapId = urlParams.get('map');
        const lsMapId = localStorage.getItem('hw_active_dest');
        if (urlMapId && state.destinations.maps[urlMapId]) {
            activeMapId = urlMapId;
        } else if (lsMapId && state.destinations.maps[lsMapId]) {
            activeMapId = lsMapId;
        } else if (state.destinations.activeMapId) {
            activeMapId = state.destinations.activeMapId;
        }

        // Garde brouillon : un user non-admin ne doit jamais booter sur une
        // destination non publiée (URL ?map=hammamet partagée, ou clé
        // hw_active_dest héritée d'une session admin). Repli sur la destination
        // par défaut publiée (sinon la 1ʳᵉ publiée trouvée). L'admin garde tout.
        if (!state.isAdmin && !isDestinationPublished(state.destinations.maps[activeMapId])) {
            const fallback = state.destinations.activeMapId;
            if (fallback && isDestinationPublished(state.destinations.maps[fallback])) {
                activeMapId = fallback;
            } else {
                const firstPublished = Object.keys(state.destinations.maps)
                    .find(id => isDestinationPublished(state.destinations.maps[id]));
                if (firstPublished) activeMapId = firstPublished;
            }
        }
        // Synchronise le localStorage avec le choix final → si Stefan ouvre
        // le DM ensuite, il prendra la même destination active.
        try { localStorage.setItem('hw_active_dest', activeMapId); } catch (e) { /* QuotaExceeded etc. */ }
        // B. Config View (si dispo)
        if (state.destinations.maps[activeMapId] && state.destinations.maps[activeMapId].startView) {
            initialView = state.destinations.maps[activeMapId].startView;
        }

        // Peuple le sélecteur de destination du topbar maintenant qu'on connaît
        // l'activeMapId définitif (URL > activeMapId config > fallback).
        // Toute destination présente dans destinations.json est cliquable —
        // plus de section "Bientôt" hardcodée.
        try {
            const { renderDestinationMenu } = await import('./topbar-v2.js');
            renderDestinationMenu(state.destinations, activeMapId);
        } catch (e) {
            console.warn('[Startup] renderDestinationMenu failed', e);
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

    // Zones de la destination active (réunif) : chargement dynamique par dest
    // (fetch {dest}-zones.geojson, ou IndexedDB pour un brouillon local).
    await loadZonesForActive(activeMapId, state.destinations?.maps?.[activeMapId]);

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

        // Migrations one-shot userData :
        //   1. Visité binaire (vu=true sans vuManual) → vuManual=true + visitedByCircuits=[]
        //   2. Champs legacy `timeH/timeM/price` → supprimés (PR 5 chantier DM, le geojson
        //      stocke désormais Temps_minutes / Prix_TND en racine, plus en userData).
        const migrationUpdates = [];
        for (const [poiId, ud] of Object.entries(loadedUserData)) {
            if (!ud || typeof ud !== 'object') continue;
            let dirty = false;

            // Migration 1
            const alreadyMigrated = ud.vuManual !== undefined || Array.isArray(ud.visitedByCircuits);
            if (ud.vu === true && !alreadyMigrated) {
                ud.vuManual = true;
                ud.visitedByCircuits = [];
                dirty = true;
            }

            // Migration 2 (PR 5)
            if ('timeH' in ud) { delete ud.timeH; dirty = true; }
            if ('timeM' in ud) { delete ud.timeM; dirty = true; }
            if ('price' in ud) { delete ud.price; dirty = true; }

            if (dirty) migrationUpdates.push({ poiId, data: ud });
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
        // AUTORITÉ SERVEUR : le fichier publié est la SEULE source de vérité du
        // « vérifié » → on REMPLACE le local (pas de fusion). Une fusion
        // `{...local, ...public}` n'ôtait jamais une clé absente du serveur → un
        // vérifié retiré par l'admin restait collé À VIE côté user (et obligeait à
        // vider la DB). Le remplacement fait propager les RETRAITS. Sûr car le
        // local ne contient que ce qui vient des publications passées (le user
        // n'est pas admin). Si le fetch échoue (offline / 404 avant 1re
        // publication) → on garde le dernier local connu (fallback ligne ~279).
        try {
            const testedUrl = `${RAW_BASE}/${GITHUB_PATHS.tested(activeMapId)}?t=${Date.now()}`;
            const respTested = await fetch(testedUrl);
            if (respTested.ok) {
                const publicTested = await respTested.json();
                if (publicTested && typeof publicTested === 'object') {
                    setTestedCircuits(publicTested);
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

        // Compteur planifié calculé à la volée par computePlanifieCounter (data.js) — plus de recalc à faire ici
        await saveAppState('lastGeoJSON', geojsonData); // Mobile cache specific
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

            // Compteur planifié calculé à la volée par computePlanifieCounter (data.js)
            // Refresh UI avec les filtres
            applyFilters();

            // Cadrage carte au boot : on fait confiance au startView défini
            // dans destinations.json (utilisé par L.map à la création) et on
            // ne re-cadre PAS — sinon glissement visible entre la position
            // initiale et le fit recalculé sur les markers (zoom ~identique
            // mais pas exact). fitMapToContent reste utilisé par le bouton
            // "Reset view" et au boot SI aucun startView n'est défini (cas
            // fallback : cadrage sur les markers).
            const hasStartView = !!state.destinations?.maps?.[activeMapId]?.startView;
            if (!hasStartView) {
                try {
                    const { fitMapToContent } = await import('./map.js');
                    fitMapToContent();
                } catch (e) { console.warn('fitMapToContent failed:', e); }
            }

            try { await loadCircuitDraft(); } catch (e) {}

            // V2 : premier rendu de l'onglet Circuit (applique data-mode/data-flag,
            // rend l'empty state ou les steps existants, met à jour le breadcrumb)
            try {
                const { renderCircuitPanel } = await import('./circuit.js');
                renderCircuitPanel();
                updateCurrencyUnits();
            } catch (e) { console.warn('Init circuit panel V2 failed:', e); }

            eventBus.emit('circuit:list-updated');
        } catch (e) {
            console.error("Erreur lors du rendu de la carte :", e);
            showToast("Erreur lors de l'affichage de la carte. Réessayez ou rechargez la page.", "error");
        }
    }

    if (DOM.loaderOverlay) DOM.loaderOverlay.classList.add('is-hidden');

    // Splash de boot retiré : tout est chargé (POIs, circuits, layout stabilisé,
    // 1er render circuit-list-updated émis). Double rAF pour s'assurer que les
    // pixels du 1er frame sont peints avant le fade out (sinon on peut encore
    // voir un saut sur des layouts complexes).
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            document.documentElement.setAttribute('hw-ready', '');
        });
    });

    // Gist sync : pull après chargement complet
    pullFromGist();
}
