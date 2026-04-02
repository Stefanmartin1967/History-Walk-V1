// src/map.js — Carte Leaflet pour le Data Manager
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

let map = null;
let markersLayer = null;
let activeMarker = null;     // Marqueur sélectionné/édité
let allMarkers = new Map();  // hwId → marker
let onDragCallback = null;

// --- INITIALISATION ---

export function initMap(containerId) {
    map = L.map(containerId, {
        center: [33.77, 10.94],
        zoom: 12,
        zoomControl: true
    });

    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    });

    const satelliteLayer = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '© Google Maps'
    });

    osmLayer.addTo(map);

    L.control.layers({ 'Plan': osmLayer, 'Satellite': satelliteLayer }, {}, {
        position: 'topright', collapsed: true
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
}

// --- RENDU DE TOUS LES MARQUEURS ---

export function renderMarkers(features) {
    if (!map) return;
    markersLayer.clearLayers();
    allMarkers.clear();

    features.forEach((feature, index) => {
        const coords = feature.geometry?.coordinates;
        if (!coords || coords.length < 2) return;
        const [lng, lat] = coords;

        const marker = L.circleMarker([lat, lng], {
            radius: 6,
            fillColor: '#205596',
            color: '#fff',
            weight: 1.5,
            fillOpacity: 0.85
        });

        const id = feature.properties?.HW_ID || String(index);
        marker.hwId = id;
        marker.featureIndex = index;

        marker.on('click', () => {
            document.dispatchEvent(new CustomEvent('map:markerClick', { detail: { index } }));
            highlightMarker(marker);
        });

        marker.bindTooltip(feature.properties?.['Nom du site FR'] || '?', {
            permanent: false, direction: 'top', offset: [0, -6]
        });

        markersLayer.addLayer(marker);
        allMarkers.set(id, marker);
    });
}

// --- FOCUS SUR UN POI (depuis la table) ---

export function focusFeature(feature, index) {
    if (!map || !feature.geometry?.coordinates) return;
    const [lng, lat] = feature.geometry.coordinates;

    map.flyTo([lat, lng], Math.max(map.getZoom(), 16), { animate: true, duration: 0.5 });

    const id = feature.properties?.HW_ID || String(index);
    const marker = allMarkers.get(id);
    if (marker) highlightMarker(marker);
}

function highlightMarker(marker) {
    // Reset ancien
    if (activeMarker && activeMarker !== marker) {
        activeMarker.setStyle({ radius: 6, fillColor: '#205596', weight: 1.5 });
    }
    marker.setStyle({ radius: 9, fillColor: '#e88c32', weight: 2.5 });
    activeMarker = marker;
}

// --- MARQUEUR ÉDITABLE (pendant l'édition dans la modale) ---

let editMarker = null;

export function startEditMarker(lat, lng, onDrag) {
    if (!map) return;
    onDragCallback = onDrag;

    // Supprimer l'ancien marqueur d'édition
    if (editMarker) { map.removeLayer(editMarker); editMarker = null; }

    editMarker = L.marker([lat, lng], {
        draggable: true,
        icon: L.divIcon({
            className: 'edit-marker-icon',
            html: `<div style="
                width:16px;height:16px;border-radius:50%;
                background:#ef4444;border:3px solid #fff;
                box-shadow:0 0 0 2px #ef4444;
                cursor:grab;
            "></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        })
    }).addTo(map);

    editMarker.on('drag', (e) => {
        const { lat, lng } = e.target.getLatLng();
        if (onDragCallback) onDragCallback(lat, lng);
    });

    map.flyTo([lat, lng], Math.max(map.getZoom(), 17), { animate: true, duration: 0.4 });
}

export function stopEditMarker() {
    if (editMarker) { map.removeLayer(editMarker); editMarker = null; }
    onDragCallback = null;
}

export function moveEditMarker(lat, lng) {
    if (editMarker) editMarker.setLatLng([lat, lng]);
}
