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
import { iconMap, getIconHtml, getIconForFeature } from './poi-icons.js';

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
        maxZoom: 19
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

    // Cadrage initial unique : fitMapToContent décide entre config.bounds
    // (destinations.json) et fallback sur le geojsonLayer si présent.
    fitMapToContent();
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

    // Re-fit demandé après une action qui modifie la taille du panneau droit
    // (ex : welcome:choice qui replie/déplie la sidebar). Le délai laisse le
    // temps à la transition CSS (0.3s) de se terminer avant de recalculer.
    eventBus.on('map:request-refit', () => {
        setTimeout(() => fitMapToContent(), 400);
    });
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
        // Padding uniforme de 20px tout autour pour donner un peu d'air et éviter
        // que la zone géographique ne touche les bords. paddingBottomRight ajoute
        // en plus la largeur de la sidebar (si dépliée) pour décaler le centre
        // "utile" vers la gauche.
        const sidebarHidden = document.body.classList.contains('sidebar-collapsed');
        const sidebarWidth = sidebarHidden ? 0 : (document.getElementById('right-sidebar')?.offsetWidth || 0);
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
