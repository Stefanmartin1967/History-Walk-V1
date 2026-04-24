// map.js
import L from 'leaflet';
import { state, setOrthodromicPolyline, setRealTrackPolyline, setGeojsonLayer, setDraggingMarkerId } from './state.js';
import { addPoiToCircuit, isCircuitCompleted } from './circuit.js';
import { openDetailsPanel } from './ui-details.js';
import { eventBus } from './events.js';
import { showToast } from './toast.js';
import { getPoiId, getPoiName } from './data.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { saveAppState } from './database.js';

export let map;
let svgRenderer; // Renderer SVG spécifique pour les tracés (permet le CSS styling)
let mapResizeObserver; // Pour observer les changements de taille du conteneur

// --- DÉFINITION DES ICÔNES ---
// Icônes MDI (Material Design Icons) — style filled, viewBox 0 0 24 24
const ICON_MDI = (path) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">${path}</svg>`;

const ICON_MOSQUE_SVG       = ICON_MDI('<path d="M24 7C24 5.9 22 4 22 4S20 5.9 20 7C20 7.7 20.4 8.4 21 8.7V13H19V11C19 10.1 18.3 9.3 17.5 9.1C17.8 8.5 18 7.9 18 7.1C18 5.8 17.4 4.6 16.3 3.9L12 1L7.7 3.8C6.7 4.6 6 5.8 6 7.1C6 7.8 6.2 8.5 6.6 9.1C5.7 9.3 5 10.1 5 11V13H3V8.7C3.6 8.4 4 7.7 4 7C4 5.9 2 4 2 4S0 5.9 0 7C0 7.7 .4 8.4 1 8.7V21H11V17C11 16.5 11.4 16 12 16S13 16.5 13 17V21H23V8.7C23.6 8.4 24 7.7 24 7M8.9 5.5L12 3.4L15.1 5.5C15.7 5.9 16 6.4 16 7.1C16 8.1 15.1 9 14.1 9H9.9C8.9 9 8 8.1 8 7.1C8 6.4 8.3 5.9 8.9 5.5M21 19H15V17C15 15.4 13.6 14 12 14S9 15.4 9 17V19H3V15H7V11H17V15H21V19Z" />');
const ICON_PRAY_SVG         = ICON_MDI('<path d="M11.43 9.67C11.47 9.78 11.5 9.88 11.5 10V15.22C11.5 15.72 11.31 16.2 10.97 16.57L8.18 19.62L4.78 16.22L6 15L8.8 2.86C8.92 2.36 9.37 2 9.89 2C10.5 2 11 2.5 11 3.11V8.07C10.84 8.03 10.67 8 10.5 8C9.4 8 8.5 8.9 8.5 10V13C8.5 13.28 8.72 13.5 9 13.5S9.5 13.28 9.5 13V10C9.5 9.45 9.95 9 10.5 9C10.69 9 10.85 9.07 11 9.16C11.12 9.23 11.21 9.32 11.3 9.42C11.33 9.46 11.36 9.5 11.38 9.55C11.4 9.59 11.42 9.63 11.43 9.67M2 19L6 22L7.17 20.73L3.72 17.28L2 19M18 15L15.2 2.86C15.08 2.36 14.63 2 14.11 2C13.5 2 13 2.5 13 3.11V8.07C13.16 8.03 13.33 8 13.5 8C14.6 8 15.5 8.9 15.5 10V13C15.5 13.28 15.28 13.5 15 13.5S14.5 13.28 14.5 13V10C14.5 9.45 14.05 9 13.5 9C13.31 9 13.15 9.07 13 9.16C12.88 9.23 12.79 9.32 12.71 9.42C12.68 9.46 12.64 9.5 12.62 9.55C12.6 9.59 12.58 9.63 12.57 9.67C12.53 9.78 12.5 9.88 12.5 10V15.22C12.5 15.72 12.69 16.2 13.03 16.57L15.82 19.62L19.22 16.22L18 15M20.28 17.28L16.83 20.73L18 22L22 19L20.28 17.28Z" />');
const ICON_COFFEE_SVG       = ICON_MDI('<path d="M2,21V19H20V21H2M20,8V5H18V8H20M20,3A2,2 0 0,1 22,5V8A2,2 0 0,1 20,10H18V13A4,4 0 0,1 14,17H8A4,4 0 0,1 4,13V3H20M16,5H6V13A2,2 0 0,0 8,15H14A2,2 0 0,0 16,13V5Z" />');
const ICON_TEA_SVG          = ICON_MDI('<path d="M4,19H20V21H4V19M21.4,3.6C21,3.2 20.6,3 20,3H4V13C4,14.1 4.4,15 5.2,15.8C6,16.6 6.9,17 8,17H14C15.1,17 16,16.6 16.8,15.8C17.6,15 18,14.1 18,13V10H20C20.6,10 21,9.8 21.4,9.4C21.8,9 22,8.6 22,8V5C22,4.5 21.8,4 21.4,3.6M16,5V8L16,10V13C16,13.6 15.8,14 15.4,14.4C15,14.8 14.6,15 14,15H8C7.4,15 7,14.8 6.6,14.4C6.2,14 6,13.5 6,13V5H10V6.4L8.2,7.8C8,7.9 8,8.1 8,8.2V12.5C8,12.8 8.2,13 8.5,13H12.5C12.8,13 13,12.8 13,12.5V8.2C13,8 12.9,7.9 12.8,7.8L11,6.4V5H16M20,8H18V5H20V8Z" />');
const ICON_WATER_WELL_SVG   = ICON_MDI('<path d="M3.62 8H5V15H7V8H11V10H13V8H17V15H19V8H20.61C21.16 8 21.61 7.56 21.61 7C21.61 6.89 21.6 6.78 21.56 6.68L19 2H5L2.72 6.55C2.47 7.04 2.67 7.64 3.16 7.89C3.31 7.96 3.46 8 3.62 8M6.24 4H17.76L18.76 6H5.24L6.24 4M2 16V18H4V22H20V18H22V16H2M18 20H6V18H18V20M13.93 11C14.21 11 14.43 11.22 14.43 11.5C14.43 11.5 14.43 11.54 14.43 11.56L14.05 14.56C14 14.81 13.81 15 13.56 15H10.44C10.19 15 10 14.81 9.95 14.56L9.57 11.56C9.54 11.29 9.73 11.04 10 11C10.03 11 10.05 11 10.07 11H13.93Z" />');
const ICON_CAKE_SVG         = ICON_MDI('<path d="M12 6C13.11 6 14 5.1 14 4C14 3.62 13.9 3.27 13.71 2.97L12 0L10.29 2.97C10.1 3.27 10 3.62 10 4C10 5.1 10.9 6 12 6M18 9H13V7H11V9H6C4.34 9 3 10.34 3 12V21C3 21.55 3.45 22 4 22H20C20.55 22 21 21.55 21 21V12C21 10.34 19.66 9 18 9M19 20H5V17C5.9 17 6.76 16.63 7.4 16L8.5 14.92L9.56 16C10.87 17.3 13.15 17.29 14.45 16L15.53 14.92L16.6 16C17.24 16.63 18.1 17 19 17V20M19 15.5C18.5 15.5 18 15.3 17.65 14.93L15.5 12.8L13.38 14.93C12.64 15.67 11.35 15.67 10.61 14.93L8.5 12.8L6.34 14.93C6 15.29 5.5 15.5 5 15.5V12C5 11.45 5.45 11 6 11H18C18.55 11 19 11.45 19 12V15.5Z" />');
const ICON_STORE_SVG        = ICON_MDI('<path d="M18.36 9L18.96 12H5.04L5.64 9H18.36M20 4H4V6H20V4M20 7H4L3 12V14H4V20H14V14H18V20H20V14H21V12L20 7M6 18V14H12V18H6Z" />');
const ICON_RESTAURANT_SVG   = ICON_MDI('<path d="M11,9H9V2H7V9H5V2H3V9C3,11.12 4.66,12.84 6.75,12.97V22H9.25V12.97C11.34,12.84 13,11.12 13,9V2H11V9M16,6V14H18.5V22H21V2C18.24,2 16,4.24 16,6Z" />');
const ICON_PILLAR_SVG       = ICON_MDI('<path d="M6,5H18A1,1 0 0,1 19,6A1,1 0 0,1 18,7H6A1,1 0 0,1 5,6A1,1 0 0,1 6,5M21,2V4H3V2H21M15,8H17V22H15V8M7,8H9V22H7V8M11,8H13V22H11V8Z" />');
const ICON_BINOCULARS_SVG   = ICON_MDI('<path d="M11,6H13V13H11V6M9,20A1,1 0 0,1 8,21H5A1,1 0 0,1 4,20V15L6,6H10V13A1,1 0 0,1 9,14V20M10,5H7V3H10V5M15,20V14A1,1 0 0,1 14,13V6H18L20,15V20A1,1 0 0,1 19,21H16A1,1 0 0,1 15,20M14,5V3H17V5H14Z" />');

// Icône SVG personnalisée Lucide (style outline) — conservée pour Culture et tradition
const ICON_AMPHORA_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v5.632c0 .424-.272.795-.653.982A6 6 0 0 0 6 14c.006 4 3 7 5 8"/><path d="M10 5H8a2 2 0 0 0 0 4h.68"/><path d="M14 2v5.632c0 .424.272.795.652.982A6 6 0 0 1 18 14c0 4-3 7-5 8"/><path d="M14 5h2a2 2 0 0 1 0 4h-.68"/><path d="M18 22H6"/><path d="M9 2h6"/></svg>';

export const iconMap = {
    'A définir':           'circle-help',
    'Café':                ICON_COFFEE_SVG,
    'Commerce':            ICON_STORE_SVG,
    'Culture et tradition': ICON_AMPHORA_SVG,
    'Curiosité':           ICON_BINOCULARS_SVG,
    'Hôtel':               'hotel',
    'Mosquée':             ICON_MOSQUE_SVG,
    'Pâtisserie':          ICON_CAKE_SVG,
    'Photo':               'camera',
    'Puits':               ICON_WATER_WELL_SVG,
    'Restaurant':          ICON_RESTAURANT_SVG,
    'Salon de thé':        ICON_TEA_SVG,
    'Site historique':     ICON_PILLAR_SVG,
    'Site religieux':      ICON_PRAY_SVG,
    'Taxi':                'car-taxi-front'
};

// --- INITIALISATION CARTE ---

// Valeurs par défaut alignées sur destinations.json (Djerba)
// Ces valeurs par défaut ne servent que si fitBounds échoue ou n'est pas utilisé
const DEFAULT_CENTER = [33.77478, 10.94353];
const DEFAULT_ZOOM = 12.7;

// Limites idéales par défaut pour Djerba (Fallback)
const DJERBA_BOUNDS = [
    [33.62, 10.72], // Sud-Ouest
    [33.91, 11.06]  // Nord-Est
];

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

    // NOTE: On ne fait plus setView ici, car fitMapToContent va s'en charger intelligemment

    // Ajout explicite du contrôle de zoom en haut à gauche (position standard)
    L.control.zoom({
        position: 'topleft'
    }).addTo(map);

    // 1. Couche "Plan" (OpenStreetMap) - Très léger
    const planLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    });

    // 2. Couche "Satellite Hybride" (Google Maps) - Le meilleur compromis
    const googleHybridLayer = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps'
    });

    // Ajout de la couche par défaut (Plan)
    planLayer.addTo(map);

    // Initialisation du rendu SVG pour les lignes (contourne preferCanvas: true)
    svgRenderer = L.svg({ padding: 0.5 });
    svgRenderer.addTo(map);

    // Création du contrôleur de couches
    const baseMaps = {
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

            // Style de base pour ressembler aux boutons Leaflet
            link.href = '#';
            link.title = "Réinitialiser la vue";
            link.role = "button";
            link.style.width = '44px';
            link.style.height = '44px';
            link.style.backgroundColor = 'var(--bg)';
            link.style.color = '#fff';
            link.style.display = 'flex';
            link.style.alignItems = 'center';
            link.style.justifyContent = 'center';
            link.style.cursor = 'pointer';

            // Icône Lucide "Rotate CCW"
            link.innerHTML = `<i data-lucide="rotate-ccw"></i>`;

            link.onclick = function(e) {
                e.preventDefault();
                fitMapToContent(); // Retourne à la vue définie dans destinations.json
            };

            return container;
        }
    });

    map.addControl(new ResetViewControl());

    // Initialisation des icônes après ajout
    createIcons({ icons: appIcons });

    initMapListeners();
    initResizeObserver(); // Activation de l'observateur de redimensionnement

    // --- MISE A L'ECHELLE INITIALE (FITBOUNDS) ---
    // On essaie d'adapter la vue immédiatement aux limites idéales
    try {
        // On récupère les bounds depuis destinations.json via state si possible, sinon fallback
        let bounds = DJERBA_BOUNDS;

        if (state.currentMapId && state.destinations && state.destinations.maps && state.destinations.maps[state.currentMapId] && state.destinations.maps[state.currentMapId].bounds) {
             bounds = state.destinations.maps[state.currentMapId].bounds;
        }

        // On applique le fitBounds avec un padding pour ne pas coller aux bords
        map.fitBounds(bounds, {
            padding: [20, 20],
            maxZoom: 18
        });

    } catch (e) {
        console.warn("Erreur lors du fitBounds initial, repli sur setView", e);
        map.setView(initialCenter, initialZoom);
    }
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
        
        // 3. Choix du tracé (Réel prioritaire sur Vol d'oiseau)
        if (activeCircuit?.realTrack) {
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

/**
 * Génère le code HTML de l'icône pour une catégorie donnée
 */
export function getIconHtml(category) {
    const defaultIcon = 'map-pin';
    const iconContent = iconMap[category] || defaultIcon;

    if (iconContent.startsWith('<svg')) {
        return iconContent;
    } else {
        return `<i data-lucide="${iconContent}"></i>`;
    }
}

export function createHistoryWalkIcon(category) {
    const iconHtml = getIconHtml(category);

    return L.divIcon({
        html: `<div class="hw-icon-wrapper">${iconHtml}</div>`,
        className: 'hw-icon',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
    });
}

export function getIconForFeature(feature) {
    const category = (feature.properties.userData && feature.properties.userData.Catégorie) || feature.properties.Catégorie;
    return getIconHtml(category);
}

export function handleMarkerClick(feature) {
    // Si ce marqueur est en cours de déplacement (via le bouton "Déplacer"), on ignore le clic
    // Cela évite d'ajouter le point au circuit alors qu'on veut juste valider sa position
    if (state.draggingMarkerId === getPoiId(feature)) return;

    clearMarkerHighlights();
    if (state.isSelectionModeActive) {
        // --- MODE SELECTION (ON) ---
        // On délègue toute la logique (ajout, bouclage, limitation) à addPoiToCircuit
        // Cela permet de :
        // 1. Ignorer le dernier point (déjà géré dans addPoiToCircuit)
        // 2. Boucler sur le premier point (déjà géré)
        // 3. Ajouter des points intermédiaires (forme de 8)

        addPoiToCircuit(feature);
    } else {
        // --- MODE CONSULTATION (OFF) ---
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

    if (activeCircuitData && activeCircuitData.realTrack) {
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

// --- LE PEINTRE DE POINTS (Reçoit les données déjà filtrées) ---
export function refreshMapMarkers(visibleFeatures) {
    if (!map) return;

    if (!state.geojsonLayer) {
        setGeojsonLayer(L.featureGroup().addTo(map));
    } else {
        state.geojsonLayer.clearLayers();
    }

    if (visibleFeatures.length === 0) return;

    const tempLayer = L.geoJSON(visibleFeatures, {
        pointToLayer: (feature, latlng) => {
            const category = (feature.properties.userData && feature.properties.userData.Catégorie) || feature.properties.Catégorie || 'default';
            const icon = createHistoryWalkIcon(category);

            const props = feature.properties.userData || {};

            if (props.incontournable === true) {
                icon.options.className += ' marker-vip'; 
            }

            if (props.vu === true) {
                icon.options.className += ' marker-visited';
            } else if ((props.planifieCounter || 0) > 0) {
                // Visité prime sur planifié : on n'applique "planned" que si pas encore visité
                icon.options.className += ' marker-planned';
            }

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
    // Si on a une configuration fixe pour la carte actuelle, on l'utilise
    if (state.currentMapId && state.destinations && state.destinations.maps && state.destinations.maps[state.currentMapId]) {
        const config = state.destinations.maps[state.currentMapId];

        // NOUVEAU : Gestion par BOUNDS (Prioritaire)
        if (config.bounds) {
            const sidebarWidth = document.body.classList.contains('sidebar-open') ? document.getElementById('right-sidebar').offsetWidth : 0;
            // paddingBottomRight permet de décaler le centre "utile" vers la gauche pour éviter la sidebar
            map.fitBounds(config.bounds, {
                paddingBottomRight: [sidebarWidth, 0],
                maxZoom: 18 // Sécurité
            });
            return;
        }

        // ANCIEN : Gestion par startView (Fallback)
        if (config.startView) {
            map.setView(config.startView.center, config.startView.zoom);
            return;
        }
    }

    // Sinon, comportement par défaut (Fit Bounds sur les données)
    if (map && state.geojsonLayer && state.geojsonLayer.getLayers().length > 0) {
        const bounds = state.geojsonLayer.getBounds();
        if (bounds.isValid()) {
             // On ajoute un peu de marge (5%) pour ne pas coller aux bords
             map.fitBounds(bounds.pad(0.05));
        }
    }
}
