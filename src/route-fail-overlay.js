// route-fail-overlay.js — Passages restés en ligne droite, en pointillé.
//
// Après un tracé, un passage que BRouter n'a pas su router reste en ligne
// droite (échec partiel) : on le dessine en pointillé gris par-dessus le tracé,
// en création seulement. Piloté par state.routeSegments (découpage de la
// session) ; masqué pendant que le panneau « Itinéraire » est ouvert, qui
// dessine ses propres variantes.
import L from 'leaflet';
import { state } from './state.js';
import { map, trackRenderer } from './map.js';

let _failLayer = null;

function inCreation() { return state.isCircuitCreationMode || state.editingMode; }

/** Retire les passages en ligne droite de la carte. */
export function clearFailOverlay() {
    if (_failLayer) { _failLayer.remove(); _failLayer = null; }
}

/** Redessine les passages en ligne droite du tracé de la session. */
export function refreshFailOverlay() {
    clearFailOverlay();
    if (state.routePanelOpen || !inCreation() || !map) return;
    const segs = state.routeSegments;
    if (!Array.isArray(segs) || !segs.some(s => s && !s.ok)) return;
    _failLayer = L.layerGroup().addTo(map);
    segs.forEach(s => {
        if (s && !s.ok && Array.isArray(s.coords) && s.coords.length >= 2) {
            _failLayer.addLayer(L.polyline(s.coords, { className: 'route-fail-segment', interactive: false, renderer: trackRenderer() }));
        }
    });
}
