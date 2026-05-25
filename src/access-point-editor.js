// access-point-editor.js
// Mode de pose du « point d'accès au tracé » d'un POI (admin, desktop).
//
// Pose un drapeau DRAGGABLE sur la carte (clic carte = place/déplace, glisser =
// ajuste), relié au POI par une ligne pointillée pour visualiser l'écart, puis
// enregistre le couple [lon, lat] dans le champ public `accessPoint` via
// updatePoiData. Sert aux POI « hors voie » (bâtiment isolé) : l'admin pose le
// drapeau sur la voie la plus proche → GPX Studio peut router jusque-là sans
// ignorer le POI (cf. gpx.js trackAnchorOf).
//
// IMPORTANT : on ne touche JAMAIS au marqueur ni aux coordonnées réelles du POI
// (≠ « Déplacer le marqueur » qui, lui, mute geometry.coordinates). Le <wpt>
// reste sur le vrai lieu ; seul le champ accessPoint est écrit.
import L from 'leaflet';
import { map } from './map.js';
import { getPoiId, getPoiName, updatePoiData } from './data.js';
import { getAccessPoint, escapeXml } from './utils.js';
import { showToast } from './toast.js';

let _marker = null;     // drapeau draggable
let _line = null;       // ligne POI → drapeau
let _toolbar = null;    // barre flottante Enregistrer/Effacer/Annuler
let _onMapClick = null;
let _poiLatLng = null;  // [lat, lng] du POI (fixe)
let _poiId = null;
let _hadAccessPoint = false;

function flagIcon() {
    return L.divIcon({
        className: 'hw-access-flag',
        html: '<span class="hw-access-flag-pole"></span><span class="hw-access-flag-banner"></span>',
        iconSize: [28, 28],
        iconAnchor: [3, 26], // pointe du mât en bas-gauche
    });
}

function redrawLine() {
    if (!_marker || !_line) return;
    const { lat, lng } = _marker.getLatLng();
    _line.setLatLngs([_poiLatLng, [lat, lng]]);
}

function teardown() {
    if (_onMapClick) { map.off('click', _onMapClick); _onMapClick = null; }
    if (_marker) { _marker.remove(); _marker = null; }
    if (_line) { _line.remove(); _line = null; }
    if (_toolbar && _toolbar.parentNode) { _toolbar.parentNode.removeChild(_toolbar); }
    _toolbar = null;
    _poiId = null;
    _poiLatLng = null;
    _hadAccessPoint = false;
}

function buildToolbar(feature) {
    const bar = document.createElement('div');
    bar.className = 'hw-access-toolbar';
    const name = escapeXml(getPoiName(feature) || 'ce lieu');
    bar.innerHTML = `
        <div class="hw-access-toolbar-text">
            <strong>Point d'accès au tracé</strong>
            <span>${name} — pose le drapeau sur la voie la plus proche</span>
        </div>
        <div class="hw-access-toolbar-actions">
            <button type="button" class="hw-access-btn hw-access-btn--primary" data-act="save">Enregistrer</button>
            <button type="button" class="hw-access-btn" data-act="erase">Effacer</button>
            <button type="button" class="hw-access-btn" data-act="cancel">Annuler</button>
        </div>`;
    // Les clics sur la barre ne doivent pas atteindre la carte (sinon ils
    // déplaceraient le drapeau).
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.disableScrollPropagation(bar);
    bar.querySelector('[data-act="save"]').addEventListener('click', onSave);
    bar.querySelector('[data-act="erase"]').addEventListener('click', onErase);
    bar.querySelector('[data-act="cancel"]').addEventListener('click', teardown);
    return bar;
}

export function startAccessPointPlacement(feature) {
    if (!map || !feature?.geometry?.coordinates) return;
    teardown(); // sécurité : ferme une éventuelle session précédente

    _poiId = getPoiId(feature);
    const [poiLon, poiLat] = feature.geometry.coordinates;
    _poiLatLng = [poiLat, poiLon];

    const existing = getAccessPoint(feature); // [lon, lat] | null
    _hadAccessPoint = !!existing;
    const start = existing ? [existing[1], existing[0]] : [poiLat, poiLon];

    _marker = L.marker(start, { draggable: true, icon: flagIcon(), zIndexOffset: 1200 }).addTo(map);
    _line = L.polyline([_poiLatLng, start], {
        color: '#c0392b', weight: 2, dashArray: '5,8', opacity: 0.9, interactive: false,
    }).addTo(map);

    _marker.on('drag', redrawLine);
    _marker.on('dragend', redrawLine);

    // Clic sur la carte « vide » = (re)place le drapeau à cet endroit.
    _onMapClick = (e) => { _marker.setLatLng(e.latlng); redrawLine(); };
    map.on('click', _onMapClick);

    _toolbar = buildToolbar(feature);
    map.getContainer().appendChild(_toolbar);

    map.panTo(start, { animate: true });
    // Pas de toast d'instruction : la barre de pose (persistante) porte déjà la
    // consigne « pose le drapeau sur la voie la plus proche ». Le fond par défaut
    // (Voyager) montre les routes ; l'admin bascule via le contrôle de calques
    // existant si besoin (satellite pour le bâti, OSM pour les voies routables).
}

async function onSave() {
    if (!_marker || !_poiId) return;
    const { lat, lng } = _marker.getLatLng();
    const poiId = _poiId;
    teardown();
    // Format [lon, lat] (cohérent avec geometry.coordinates et gpx.js).
    await updatePoiData(poiId, 'accessPoint', [lng, lat]);
    // updatePoiData affiche déjà un toast « Enregistré ».
}

async function onErase() {
    const poiId = _poiId;
    const had = _hadAccessPoint;
    teardown();
    if (!poiId || !had) return; // rien à retirer → on ferme simplement
    // null (et non undefined) : une valeur explicite dans userData PRIME sur le
    // patrimoine publié (cf. getPoiProp). admin-geojson retire le null au publish
    // → le geojson ne porte pas de `accessPoint: null` résiduel.
    await updatePoiData(poiId, 'accessPoint', null);
    showToast('Point d’accès retiré.', 'info', 2500);
}
