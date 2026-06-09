// map.js
import L from 'leaflet';
// Side-effect : étend L avec L.markerClusterGroup
import 'leaflet.markercluster';
import { state, setOrthodromicPolyline, setRealTrackPolyline, setGeojsonLayer, setDraggingMarkerId } from './state.js';
import { addPoiToCircuit, isCircuitCompleted } from './circuit.js';
import { openDetailsPanel } from './ui-details.js';
import { eventBus } from './events.js';
import { showToast } from './toast.js';
import { getPoiId, getPoiName } from './data.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { saveAppState } from './database.js';
import { iconMap, getIconHtml, getIconForFeature } from './poi-icons.js';
import { showInfoPopover } from './info-popover.js';

export { iconMap, getIconHtml, getIconForFeature };

export let map;
let svgRenderer; // Renderer SVG spécifique pour les tracés (permet le CSS styling)
let mapResizeObserver; // Pour observer les changements de taille du conteneur

// --- INITIALISATION CARTE ---

// Centre/zoom par défaut alignés sur destinations.json (Djerba). Servent uniquement
// au moment de la création L.map ; fitMapToContent ajuste ensuite la vue selon
// state.destinations.maps[currentMapId].bounds (la source de vérité du cadrage).
const DEFAULT_CENTER = [33.77478, 10.94353];
const DEFAULT_ZOOM = 12.7;

export function initMap(initialCenter = DEFAULT_CENTER, initialZoom = DEFAULT_ZOOM) {

    // Si la carte existe déjà, on ignore (mais on pourrait repositionner si on le souhaitait)
    if (map) {
        return;
    }

    // Initialisation de la carte
    map = L.map('map', {
        center: initialCenter,
        zoom: initialZoom,
        zoomSnap: 0.1,
        zoomDelta: 0.1,
        wheelPxPerZoomLevel: 180,
        attributionControl: false,
        preferCanvas: true,
        zoomControl: false // On désactive le zoom par défaut pour le repositionner/styler nous-même si besoin
    });

    // L.map est créé avec initialCenter/initialZoom comme état par défaut.
    // fitMapToContent (appelé en fin d'initMap) ajuste la vue aux bounds de la
    // destination active dès que state.destinations est disponible.

    // Ajout explicite du contrôle de zoom en haut à gauche (position standard)
    L.control.zoom({
        position: 'topleft'
    }).addTo(map);

    // 1. Couche "Plan" (OpenStreetMap) - Très léger
    const planLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        // Google Satellite monte à z20, pas OSM/Voyager (tuiles jusqu'à z19). Sans
        // alignement, ces couches se GRISAIENT dans le contrôle de calques dès qu'on
        // zoomait à z20 (impossible de revenir en OSM/Voyager au zoom de pose d'un
        // point d'accès). Fix : maxNativeZoom=19 (tuiles agrandies au-delà) +
        // maxZoom=20 (couche sélectionnable sur toute la plage). Idem Voyager.
        maxNativeZoom: 19,
        maxZoom: 20
    });

    // 2. Couche "Satellite Hybride" (Google Maps) - Le meilleur compromis
    // HTTPS forcé : le CSP `img-src` n'autorise que `https://*.google.com`. En
    // ligne, Chrome fait un Mixed Content Auto-Upgrade pour HTTP → HTTPS, mais
    // en dev local (HTTP), pas d'auto-upgrade → la tile était bloquée.
    const googleHybridLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps'
    });

    // 3. Couche "Voyager" (CARTO) — beige clair, lisible pour les marqueurs
    //    ocre du chantier iconification. Devient la couche par défaut (20/05/2026).
    const voyagerLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxNativeZoom: 19, // tuiles Voyager jusqu'à z19, agrandies au-delà (cf. planLayer : évite le grisé à z20)
        maxZoom: 20,
        subdomains: 'abcd',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
    });

    // Ajout de la couche par défaut (Voyager — base claire, friendly pour les icônes ocre)
    voyagerLayer.addTo(map);

    // Initialisation du rendu SVG pour les lignes (contourne preferCanvas: true)
    svgRenderer = L.svg({ padding: 0.5 });
    svgRenderer.addTo(map);

    // Création du contrôleur de couches
    const baseMaps = {
        "Voyager": voyagerLayer,
        "Plan": planLayer,
        "Satellite": googleHybridLayer
    };

    L.control.layers(baseMaps, null, { position: 'topleft' }).addTo(map);
    L.control.attribution({ position: 'bottomleft' }).addTo(map);

    // --- BOUTON DE RÉINITIALISATION DE LA VUE ---
    const ResetViewControl = L.Control.extend({
        options: {
            position: 'topleft'
        },
        onAdd: function(mapInstance) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            const link = L.DomUtil.create('a', 'leaflet-control-custom', container);
            link.href = '#';
            link.title = "Recentrer la vue";
            link.role = "button";
            link.setAttribute('aria-label', 'Recentrer la vue');
            // Style hérité de leaflet-controls.css (raft doux).
            link.innerHTML = `<i data-lucide="rotate-ccw"></i>`;

            link.onclick = function(e) {
                e.preventDefault();
                fitMapToContent(); // Retourne à la vue définie dans destinations.json
            };

            return container;
        }
    });

    map.addControl(new ResetViewControl());

    // --- BOUTON LÉGENDE (déplacé depuis la topbar — PR harmonisation PC) ---
    const LegendControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function() {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            const link = L.DomUtil.create('a', 'leaflet-control-custom', container);
            link.href = '#';
            link.id = 'leaflet-btn-legend';
            link.title = 'Légende';
            link.role = 'button';
            link.setAttribute('aria-label', 'Légende');
            link.innerHTML = '<i data-lucide="book-open"></i>';
            L.DomEvent.disableClickPropagation(container);
            link.onclick = function(e) {
                e.preventDefault();
                showInfoPopover();
            };
            return container;
        }
    });
    map.addControl(new LegendControl());

    // Initialisation des icônes après ajout
    createIcons({ icons: appIcons });

    initMapListeners();
    initResizeObserver(); // Activation de l'observateur de redimensionnement

    // invalidateSize seul (pas de fitMapToContent ici) : on synchronise les
    // dimensions internes Leaflet avec le DOM stabilisé du 1er frame.
    // Le cadrage final est fait UNE SEULE FOIS dans loadAndInitializeMap
    // (await fitMapToContent après displayGeoJSON), pour éviter le saut
    // entre une 1re position (basée sur initialView ou destinations.bounds)
    // et une 2e position (basée sur les markers réels).
    requestAnimationFrame(() => {
        if (map) map.invalidateSize();
    });
}

/**
 * Initialise le ResizeObserver pour adapter la carte automatiquement
 */
function initResizeObserver() {
    if (!map) return;

    // Utilisation d'un debounce via requestAnimationFrame pour fluidité
    let resizeRequest;

    mapResizeObserver = new ResizeObserver(() => {
        if (resizeRequest) return;

        resizeRequest = requestAnimationFrame(() => {
            if (map) {
                map.invalidateSize();
            }
            resizeRequest = null;
        });
    });

    const mapContainer = map.getContainer();
    if (mapContainer) {
        mapResizeObserver.observe(mapContainer);
    }
}

/**
 * Initialise les écouteurs d'événements pour la carte
 */
export function initMapListeners() {

    // --- SAUVEGARDE POSITION CARTE (SUPPRIMÉE) ---
    // On ne sauvegarde plus la vue pour garantir une initialisation propre à chaque démarrage.

    eventBus.on('map:close-popup', () => { if (map) map.closePopup(); });
    eventBus.on('map:clear-highlights', () => clearMarkerHighlights());
    eventBus.on('map:start-marker-drag', ({ poiId, onDrag, onEnd }) => startMarkerDrag(poiId, onDrag, onEnd));
    eventBus.on('map:fit-bounds-to-points', ({ points, options }) => {
        if (!map || !points || points.length === 0) return;
        map.flyToBounds(L.latLngBounds(points), options);
    });

    window.addEventListener('circuit:updated', (e) => {
        const { points, activeId } = e.detail;

        // 1. On nettoie tout
        clearMapLines();

        if (points.length < 2) return;

        // 2. On récupère les infos fraîches depuis le state (Locaux OU Officiels)
        let activeCircuit = state.myCircuits.find(c => c.id === activeId);
        if (!activeCircuit && state.officialCircuits) {
            activeCircuit = state.officialCircuits.find(c => c.id === activeId);
        }

        const isCompleted = isCircuitCompleted(activeCircuit);

        // 3. Choix du tracé (Réel prioritaire sur Vol d'oiseau).
        // Routing in-app (05/06/2026) : éditer ne jette plus le tracé. On affiche
        // donc le tracé réel même en édition, SAUF s'il est PÉRIMÉ (la séquence de
        // POIs a changé depuis qu'il a été posé → on retombe sur le vol d'oiseau
        // pour signaler qu'il faut re-tracer). Avant : `!state.editingMode`.
        if (activeCircuit?.realTrack && !isRouteStale(points)) {
            drawLineOnMap(activeCircuit.realTrack, true, isCompleted);
        } else {
            const coords = points.map(f => [
                f.geometry.coordinates[1],
                f.geometry.coordinates[0]
            ]);
            drawLineOnMap(coords, false, isCompleted);
        }
    });
}

// Marker carte HW : icône SVG ocre 44 px, halo blanc CSS pour la lisibilité
// sur le fond Voyager. Accepte une feature pour faire le lookup sous-type
// (un marabout fortifié, une mosquée à minaret…). Fallback compat : un
// string (category) est aussi accepté pour les rares appelants legacy.
//
// PR 3/5 chantier point d'accès v2 : ajout d'une pastille ambre .hw-poi-flagdot
// sur le marqueur si le POI a `accessPointStatus='failed'` (Overpass échoué à
// la création) ET qu'on est admin. Visuel discret qui repère « ce POI attend
// son drapeau » directement sur la carte normale, en complément de la passe
// globale qui les liste.
export function createHistoryWalkIcon(featureOrCategory) {
    const iconHtml = typeof featureOrCategory === 'string'
        ? getIconHtml(featureOrCategory)
        : getIconForFeature(featureOrCategory);

    // Pastille « non-évalué » : admin uniquement, et seulement si la feature
    // porte effectivement le status 'failed' (lookup userData prioritaire).
    let flagDotHtml = '';
    if (state.isAdmin && typeof featureOrCategory !== 'string') {
        const f = featureOrCategory;
        const status = f?.properties?.userData?.accessPointStatus
                    ?? f?.properties?.accessPointStatus;
        if (status === 'failed') {
            flagDotHtml = '<span class="hw-poi-flagdot" title="Drapeau d\'accès à reprendre"></span>';
        }
        // Réunif C1b : badge « à curer » sur un candidat Scout (admin uniquement).
        if (f?.properties?.candidate) {
            flagDotHtml += '<span class="hw-poi-canddot" title="Candidat à curer (Scout)"></span>';
        }
    }

    return L.divIcon({
        html: `<div class="hw-icon-wrapper">${iconHtml}${flagDotHtml}</div>`,
        className: 'hw-icon',
        iconSize: [44, 44],
        iconAnchor: [22, 44],
        popupAnchor: [0, -44]
    });
}

export function handleMarkerClick(feature) {
    // Si ce marqueur est en cours de déplacement (via le bouton "Déplacer"), on ignore le clic
    // Cela évite d'ajouter le point au circuit alors qu'on veut juste valider sa position
    if (state.draggingMarkerId === getPoiId(feature)) return;

    // En focus mode « Ajuster le tracé » (niveau 2), la carte sert à poser des
    // points de passage, PAS à modifier la séquence : on ignore le clic POI.
    if (state.circuitFocusActive) return;

    clearMarkerHighlights();

    // On ajoute au circuit UNIQUEMENT si :
    //  - Mode création actif ET
    //  - On est réellement en train d'éditer (brouillon OU admin en mode édition).
    // Refactor PR2 (15/05/2026) : drapeau renommé en isCircuitCreationMode. La
    // nuance `inEditMode` reste utile pour distinguer création vierge / édition
    // admin d'un officiel — `convertToDraft` ne met pas (encore) le flag de
    // création quand l'admin clique « Modifier ».
    const inEditMode = !state.activeCircuitId || state.editingMode;
    if (state.isCircuitCreationMode && inEditMode) {
        // --- MODE SELECTION (ON) ---
        // On délègue toute la logique (ajout, bouclage, limitation) à addPoiToCircuit
        addPoiToCircuit(feature);
    } else {
        // --- MODE CONSULTATION (OFF) ou consultation d'un circuit chargé ---
        const globalIndex = state.loadedFeatures.findIndex(f => f.properties.HW_ID === feature.properties.HW_ID);
        const coords = feature.geometry.coordinates;
        map.flyTo([coords[1], coords[0]], Math.max(map.getZoom(), 16), { animate: true, duration: 0.6 });
        openDetailsPanel(globalIndex, null);
    }
}

// --- LE NOUVEAU PEINTRE ---
let currentDrawnLine = null; 

export function clearMarkerHighlights() {
    if (state.geojsonLayer) {
        state.geojsonLayer.eachLayer(layer => {
            if (layer.getElement()) {
                layer.getElement().classList.remove('marker-highlight');
            }
        });
    }
}

// Tracé PÉRIMÉ : un realTrack existe mais la séquence de POIs (ordonnée) a changé
// depuis qu'il a été posé (state.routeBasisKey, posé au Tracer / à l'entrée en
// édition). Dans ce cas on préfère afficher le vol d'oiseau (le tracé bleu ne
// correspond plus aux lieux). routeBasisKey null ⇒ jamais périmé.
function isRouteStale(features) {
    if (state.routeBasisKey == null) return false;
    const key = (features || []).map(getPoiId).join('|');
    return key !== state.routeBasisKey;
}

export function clearMapLines() {
    if (currentDrawnLine) {
        currentDrawnLine.remove();
        currentDrawnLine = null;
    }

    if (state.orthodromicPolyline) {
        state.orthodromicPolyline.remove();
        setOrthodromicPolyline(null);
    }

    if (state.realTrackPolyline) {
        state.realTrackPolyline.remove();
        setRealTrackPolyline(null);
    }
}

export function drawLineOnMap(coordinates, isRealTrack = false, isCompleted = false) {
    clearMapLines();

    let className = 'circuit-polyline'; // Default (Bird flight - Red)

    if (isRealTrack) {
        if (isCompleted) {
            className = 'real-track-polyline-done'; // Real Done (Green)
        } else {
            className = 'real-track-polyline'; // Real Not Done (Blue)
        }
    }

    const polyline = L.polyline(coordinates, {
        className: className,
        interactive: false,
        renderer: svgRenderer
    }).addTo(map);

    currentDrawnLine = polyline;
    
    if (isRealTrack) {
        setRealTrackPolyline(polyline);
    } else {
        setOrthodromicPolyline(polyline);
    }
}

export function updatePolylines() {
    if (state.orthodromicPolyline) state.orthodromicPolyline.remove();
    if (state.realTrackPolyline) state.realTrackPolyline.remove();

    if (!state.currentCircuit || state.currentCircuit.length < 2) return;

    // Récupération du circuit (Local ou Officiel)
    let activeCircuitData = state.myCircuits.find(c => c.id === state.activeCircuitId);
    if (!activeCircuitData && state.officialCircuits) {
        activeCircuitData = state.officialCircuits.find(c => c.id === state.activeCircuitId);
    }

    const isCompleted = isCircuitCompleted(activeCircuitData);

    if (activeCircuitData && activeCircuitData.realTrack && !isRouteStale(state.currentCircuit)) {
        const className = isCompleted ? 'real-track-polyline-done' : 'real-track-polyline';
        setRealTrackPolyline(L.polyline(activeCircuitData.realTrack, {
            className: className,
            renderer: svgRenderer
        }).addTo(map));
    }
    else {
        const latLngs = state.currentCircuit.map(feature => {
            const [lon, lat] = feature.geometry.coordinates;
            return [lat, lon];
        });
        setOrthodromicPolyline(L.polyline(latLngs, {
            className: 'circuit-polyline',
            renderer: svgRenderer
        }).addTo(map));
    }
}

// --- CALQUE DE RÉFÉRENCE (PR3) ---
// Trace importée (Wikiloc…) affichée en fond comme GUIDE VISUEL. N'entre PAS
// dans le tracé du circuit (purement décoratif, en session). Pointillé gris
// (.route-reference-layer), non interactif, sous les marqueurs.
let referenceLayerPolyline = null;

export function drawReferenceLayer(latlngs) {
    clearReferenceLayer();
    if (!Array.isArray(latlngs) || latlngs.length < 2 || !map) return;
    referenceLayerPolyline = L.polyline(latlngs, {
        className: 'route-reference-layer',
        interactive: false,
        renderer: svgRenderer,
    }).addTo(map);
}

export function clearReferenceLayer() {
    if (referenceLayerPolyline) { referenceLayerPolyline.remove(); referenceLayerPolyline = null; }
}

// Cadre la carte sur le calque (après import) pour qu'on le voie tout de suite.
export function fitReferenceLayer() {
    if (referenceLayerPolyline && map) {
        map.fitBounds(referenceLayerPolyline.getBounds(), { padding: [50, 50] });
    }
}

// --- LE PEINTRE DE POINTS (Reçoit les données déjà filtrées) ---
export function refreshMapMarkers(visibleFeatures) {
    if (!map) return;

    if (!state.geojsonLayer) {
        // Clustering progressif : Leaflet regroupe les marqueurs dont la distance
        // est inférieure à maxClusterRadius pixels. Plus on zoome, plus la
        // distance pixel entre POIs augmente, donc les clusters se défont
        // naturellement. Pas de seuil binaire = transition douce.
        // Au max zoom, spiderfyOnMaxZoom permet d'éclater en spirale les POIs
        // qui restent superposés (cas Houmt Souk : 23 mosquées sur ~50m).
        // Toutes les icônes POI sont désormais des SVG inline (poi-icons.js),
        // donc pas besoin de re-déclencher createIcons sur l'animation des
        // clusters — les icônes apparaissent immédiatement dans le DOM.
        setGeojsonLayer(L.markerClusterGroup({
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            chunkedLoading: true,
            maxClusterRadius: 50
        }).addTo(map));
    } else {
        state.geojsonLayer.clearLayers();
    }

    if (visibleFeatures.length === 0) return;

    const tempLayer = L.geoJSON(visibleFeatures, {
        pointToLayer: (feature, latlng) => {
            // On passe la feature à createHistoryWalkIcon pour qu'elle puisse
            // résoudre catégorie + sous-type (lookup hiérarchique poi-icons.js)
            // et tirer l'icône la plus spécifique (ex: Mosquée à minaret).
            const icon = createHistoryWalkIcon(feature);

            // Suppression volontaire des décorations marker-vip/-visited/-planned
            // (audit Stefan #5) : redondantes avec les filtres "Mon parcours",
            // "Officiel", "Incontournable" qui contrôlent déjà l'affichage des POIs.
            // Garde le marqueur en marker-highlight (utilisé par la recherche topbar
            // pour mettre en évidence un POI ciblé).

            const marker = L.marker(latlng, {
                icon: icon,
                title: getPoiName(feature) // Tooltip natif au survol
            });
            
            marker.on('click', (e) => {
                L.DomEvent.stop(e); 
                handleMarkerClick(feature); 
            });
            return marker;
        }
    });
    
    tempLayer.eachLayer(layer => state.geojsonLayer.addLayer(layer));

    if (state.activeFilters.zone && state.geojsonLayer.getLayers().length > 0) {
        const bounds = state.geojsonLayer.getBounds();
        if (bounds.isValid()) map.flyToBounds(bounds.pad(0.1));
    }

    createIcons({ icons: appIcons });
}

// --- NOUVEAU : AUTO-CENTRAGE INTELLIGENT (FITBOUNDS) ---
export function startMarkerDrag(poiId, onDrag, onEnd) {
    if (!state.geojsonLayer) return false;

    let targetLayer = null;
    state.geojsonLayer.eachLayer(layer => {
        if (getPoiId(layer.feature) === poiId) targetLayer = layer;
    });

    if (!targetLayer) {
        showToast("Marqueur introuvable sur la carte.", "error");
        return false;
    }

    if (targetLayer.dragging) {
        setDraggingMarkerId(poiId);
        targetLayer.dragging.enable();
        targetLayer.setOpacity(0.7);
        showToast("Mode déplacement activé. Glissez le marqueur !", "info");

        const originalLatLng = targetLayer.getLatLng();

        const dragHandler = (e) => {
            const { lat, lng } = e.target.getLatLng();
            if (onDrag) onDrag(lat, lng);
        };

        const endHandler = (e) => {
            const { lat, lng } = e.target.getLatLng();

            // Cleanup
            targetLayer.dragging.disable();
            targetLayer.setOpacity(1);
            targetLayer.off('drag', dragHandler);
            targetLayer.off('dragend', endHandler);
            setDraggingMarkerId(null);

            if (onEnd) {
                // Pass new coords + Revert function
                onEnd(lat, lng, () => {
                    targetLayer.setLatLng(originalLatLng);
                });
            }
        };

        targetLayer.on('drag', dragHandler);
        targetLayer.on('dragend', endHandler);
        return true;
    }
    return false;
}

export function fitMapToContent() {
    if (!map) return;

    // Niveau 1 : bounds définis dans destinations.json pour la carte active.
    const config = state.currentMapId && state.destinations?.maps?.[state.currentMapId];
    if (config?.bounds) {
        // La sidebar droite est toujours visible sur desktop (PR 6).
        // paddingBottomRight ajoute la largeur de la sidebar pour décaler le
        // centre "utile" vers la gauche, plus 20px d'air. paddingTopLeft : 20px
        // d'air uniforme sur les autres bords.
        const sidebarWidth = document.getElementById('right-sidebar')?.offsetWidth || 0;
        map.fitBounds(config.bounds, {
            paddingTopLeft: [20, 20],
            paddingBottomRight: [sidebarWidth + 20, 20],
            maxZoom: 18
        });
        return;
    }

    // Niveau 2 (fallback) : fit sur les POIs chargés s'ils existent.
    if (state.geojsonLayer && state.geojsonLayer.getLayers().length > 0) {
        const bounds = state.geojsonLayer.getBounds();
        if (bounds.isValid()) {
            map.fitBounds(bounds.pad(0.05));
        }
    }
    // Niveau 3 (rien) : la carte garde l'état initial (initialCenter/initialZoom).
}
