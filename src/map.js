// map.js
import L from 'leaflet';
import { state } from './state.js';
import { addPoiToCircuit, isCircuitCompleted } from './circuit.js';
import { openDetailsPanel } from './ui-details.js';
import { showToast } from './toast.js';
import { getPoiId, getPoiName } from './data.js';
import { createIcons, icons } from 'lucide';
import { saveAppState } from './database.js';
import { calculateDistance } from './utils.js';

export let map;
let svgRenderer; // Renderer SVG spécifique pour les tracés (permet le CSS styling)
let mapResizeObserver; // Pour observer les changements de taille du conteneur

// --- DÉFINITION DES ICÔNES ---
const ICON_BINOCULARS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-binoculars-icon lucide-binoculars"><path d="M10 10h4"/><path d="M19 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3"/><path d="M20 21a2 2 0 0 0 2-2v-3.851c0-1.39-2-2.962-2-4.829V8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2z"/><path d="M 22 16 L 2 16"/><path d="M4 21a2 2 0 0 1-2-2v-3.851c0-1.39 2-2.962 2-4.829V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2z"/><path d="M9 7V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3"/></svg>';
const ICON_AMPHORA_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-amphora-icon lucide-amphora"><path d="M10 2v5.632c0 .424-.272.795-.653.982A6 6 0 0 0 6 14c.006 4 3 7 5 8"/><path d="M10 5H8a2 2 0 0 0 0 4h.68"/><path d="M14 2v5.632c0 .424.272.795.652.982A6 6 0 0 1 18 14c0 4-3 7-5 8"/><path d="M14 5h2a2 2 0 0 1 0 4h-.68"/><path d="M18 22H6"/><path d="M9 2h6"/></svg>';

export const iconMap = {
    'A définir': 'circle-help',
    'Café': 'beer',
    'Commerce': 'shopping-cart',
    'Culture et tradition': ICON_AMPHORA_SVG,
    'Curiosité': ICON_BINOCULARS_SVG,
    'Hôtel': 'hotel',
    'Mosquée': 'landmark',
    'Pâtisserie': 'croissant',
    'Photo': 'camera',
    'Puits': 'droplets',
    'Restaurant': 'utensils-crossed',
    'Salon de thé': 'coffee',
    'Site historique': 'castle',
    'Site religieux': 'church',
    'Taxi': 'car-taxi-front'
};

// --- INITIALISATION CARTE ---

// Valeurs par défaut alignées sur destinations.json (Djerba)
// Ces valeurs par défaut ne servent que si fitBounds échoue ou n'est pas utilisé
const DEFAULT_CENTER = [33.77478, 10.94353];
const DEFAULT_ZOOM = 12.7;

// Limites idéales par défaut pour Djerba (Fallback)
const DJERBA_BOUNDS = [
    [33.65, 10.72], // Sud-Ouest
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
    createIcons({ icons });

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
        console.log("🌍 Carte initialisée avec fitBounds sur :", bounds);

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
    console.log("📍 La carte est maintenant à l'écoute des changements de circuit...");

    // --- SAUVEGARDE POSITION CARTE (SUPPRIMÉE) ---
    // On ne sauvegarde plus la vue pour garantir une initialisation propre à chaque démarrage.

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
        state.orthodromicPolyline = null;
    }
    
    if (state.realTrackPolyline) {
        state.realTrackPolyline.remove();
        state.realTrackPolyline = null;
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
        state.realTrackPolyline = polyline;
    } else {
        state.orthodromicPolyline = polyline;
    }
}

// --- GESTION DES DISTANCES ET TRACÉS ---

function calculateRealDistance(latLngs) {
    let totalDistance = 0;
    for (let i = 0; i < latLngs.length - 1; i++) {
        const p1 = latLngs[i];
        const p2 = latLngs[i + 1];

        // Sécurité : Ignorer les points mal formés (null, undefined, non-tableau, longueur insuffisante)
        if (!Array.isArray(p1) || p1.length < 2 || typeof p1[0] !== 'number' || typeof p1[1] !== 'number' ||
            !Array.isArray(p2) || p2.length < 2 || typeof p2[0] !== 'number' || typeof p2[1] !== 'number') {
            console.warn(`[Map] Point invalide détecté dans le tracé à l'index ${i}`, p1, p2);
            continue;
        }

        // Optimisation de performance : Haversine direct (9x plus rapide)
        // latLngs est un tableau de [lat, lng]
        totalDistance += calculateDistance(p1[0], p1[1], p2[0], p2[1]);
    }
    return totalDistance;
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
        state.realTrackPolyline = L.polyline(activeCircuitData.realTrack, {
            className: className,
            renderer: svgRenderer
        }).addTo(map);
    }
    else {
        const latLngs = state.currentCircuit.map(feature => {
            const [lon, lat] = feature.geometry.coordinates;
            return [lat, lon];
        });
        state.orthodromicPolyline = L.polyline(latLngs, {
            className: 'circuit-polyline',
            renderer: svgRenderer
        }).addTo(map);
    }
}

export function getRealDistance(circuitData) {
    if (!circuitData || !circuitData.realTrack) return 0;
    return calculateRealDistance(circuitData.realTrack);
}

export function getOrthodromicDistance(circuit) {
    if (!circuit || circuit.length < 2) return 0;
    let totalDistance = 0;
    for (let i = 0; i < circuit.length - 1; i++) {
        const from = circuit[i].geometry.coordinates;
        const to = circuit[i + 1].geometry.coordinates;
        totalDistance += L.latLng(from[1], from[0]).distanceTo(L.latLng(to[1], to[0]));
    }
    return totalDistance;
}

// --- LE PEINTRE DE POINTS (Reçoit les données déjà filtrées) ---
export function refreshMapMarkers(visibleFeatures) {
    if (!map) return;

    if (!state.geojsonLayer) {
        state.geojsonLayer = L.featureGroup().addTo(map); 
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
            }

            if ((props.planifieCounter || 0) > 0) {
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

    createIcons({ icons });
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
        state.draggingMarkerId = poiId;
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
            state.draggingMarkerId = null;

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
            console.log(`🔎 FIT BOUNDS APPLIQUÉ avec padding droite: ${sidebarWidth}px`);
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
