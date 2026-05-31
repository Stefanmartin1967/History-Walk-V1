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
//
// Refonte visuelle v2 (PR 1/5 — 31/05/2026, handoff Claude Design) :
//  - Drapeau classes .hw-flag + .hw-flag--moved (forme v1, palette nouvelle).
//    Tous les drapeaux posés via cet éditeur s'affichent en VERT (déplacé
//    manuellement). La distinction OSM/déplacé via champ source viendra en PR2.
//  - Barre d'action redesignée (.ap-bar) : pastille icône + titre + consigne +
//    mesure d'écart LIVE pendant le drag + actions structurées.
import L from 'leaflet';
import { map } from './map.js';
import { getPoiId, getPoiName, updatePoiData } from './data.js';
import { getAccessPoint, escapeXml } from './utils.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { prepoSeAccessPoint, getAccessPointStatus } from './access-point.js';
import { eventBus } from './events.js';

let _marker = null;     // drapeau draggable
let _line = null;       // ligne POI → drapeau
let _toolbar = null;    // barre flottante Enregistrer/Effacer/Annuler
let _measureEl = null;  // <b> où l'on injecte l'écart live (m)
let _onMapClick = null;
let _poiLatLng = null;  // [lat, lng] du POI (fixe)
let _poiId = null;
let _poiFeature = null; // référence pour le bouton « Pré-poser via OSM »
let _hadAccessPoint = false;
let _prepopBtn = null;  // bouton « Pré-poser via OSM »
let _flagState = 'moved'; // 'osm' | 'moved' — couleur courante du drapeau

function flagIcon(state) {
    // Couleur selon source : 'osm' = orange (pré-posé), 'moved' = vert (admin).
    // PR2 introduit le champ accessPointStatus ; le drapeau hérite de cette
    // valeur à l'ouverture, et bascule en 'moved' dès que l'admin drag (cf.
    // _marker.on('drag', ...) plus bas).
    const modifier = state === 'osm' ? 'hw-flag--osm' : 'hw-flag--moved';
    return L.divIcon({
        className: 'hw-flag ' + modifier,
        html: '<span class="hw-flag-mast"></span><span class="hw-flag-banner"></span>',
        iconSize: [22, 30],
        iconAnchor: [3, 30], // pointe du mât en bas-gauche
    });
}

function setFlagState(newState) {
    if (!_marker || newState === _flagState) return;
    _flagState = newState;
    _marker.setIcon(flagIcon(newState));
}

// Haversine — distance en mètres entre deux points [lat, lng]. Utilisée pour
// la mesure d'écart live affichée dans la barre pendant le drag.
function distanceMeters(a, b) {
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const h = Math.sin(dLat/2)**2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function updateMeasure() {
    if (!_marker || !_measureEl || !_poiLatLng) return;
    const { lat, lng } = _marker.getLatLng();
    const m = distanceMeters(_poiLatLng, [lat, lng]);
    _measureEl.textContent = m < 10 ? m.toFixed(1) + ' m' : Math.round(m) + ' m';
}

function redrawLine() {
    if (!_marker || !_line) return;
    const { lat, lng } = _marker.getLatLng();
    _line.setLatLngs([_poiLatLng, [lat, lng]]);
    updateMeasure();
}

function teardown() {
    if (_onMapClick) { map.off('click', _onMapClick); _onMapClick = null; }
    if (_marker) { _marker.remove(); _marker = null; }
    if (_line) { _line.remove(); _line = null; }
    if (_toolbar && _toolbar.parentNode) { _toolbar.parentNode.removeChild(_toolbar); }
    _toolbar = null;
    _measureEl = null;
    _prepopBtn = null;
    _poiId = null;
    _poiLatLng = null;
    _poiFeature = null;
    _hadAccessPoint = false;
    _flagState = 'moved';
}

function buildToolbar(feature) {
    // Barre redesignée (.ap-bar) — Variante A du handoff Design.
    // Structure : pastille icône + titre/consigne + mesure live + actions.
    // PR 2/5 : ajout du bouton « Pré-poser via OSM » (à gauche). Direct si
    // pas de drapeau OU drapeau orange OSM ; modale de confirmation si vert
    // déplacé manuellement (évite d'écraser un ajustement humain).
    const bar = document.createElement('div');
    bar.className = 'ap-bar';
    const name = escapeXml(getPoiName(feature) || 'ce lieu');
    bar.innerHTML = `
        <div class="ap-bar-head">
            <div class="ap-bar-mark"><i data-lucide="flag"></i></div>
            <div class="ap-bar-txt">
                <h5>Point d'accès au tracé</h5>
                <p>${name} — glisse le drapeau sur la voie la plus proche.</p>
            </div>
            <span class="ap-measure">Écart <b data-measure>—</b></span>
        </div>
        <div class="ap-bar-actions">
            <button type="button" class="ap-bar-btn" data-act="prepop">
                <i data-lucide="sparkles"></i> Pré-poser via OSM
            </button>
            <span class="grow"></span>
            <button type="button" class="ap-bar-btn" data-act="erase">Effacer</button>
            <button type="button" class="ap-bar-btn" data-act="cancel">Annuler</button>
            <button type="button" class="ap-bar-btn ap-bar-btn--primary" data-act="save">
                <i data-lucide="check"></i> Enregistrer
            </button>
        </div>`;
    // Les clics sur la barre ne doivent pas atteindre la carte (sinon ils
    // déplaceraient le drapeau).
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.disableScrollPropagation(bar);
    bar.querySelector('[data-act="save"]').addEventListener('click', onSave);
    bar.querySelector('[data-act="erase"]').addEventListener('click', onErase);
    bar.querySelector('[data-act="cancel"]').addEventListener('click', teardown);
    _prepopBtn = bar.querySelector('[data-act="prepop"]');
    _prepopBtn.addEventListener('click', onPrepop);
    _measureEl = bar.querySelector('[data-measure]');
    return bar;
}

export function startAccessPointPlacement(feature) {
    if (!map || !feature?.geometry?.coordinates) return;
    teardown(); // sécurité : ferme une éventuelle session précédente

    _poiId = getPoiId(feature);
    _poiFeature = feature;
    const [poiLon, poiLat] = feature.geometry.coordinates;
    _poiLatLng = [poiLat, poiLon];

    const existing = getAccessPoint(feature); // [lon, lat] | null
    _hadAccessPoint = !!existing;
    const start = existing ? [existing[1], existing[0]] : [poiLat, poiLon];

    // Couleur initiale : orange si status='osm', vert sinon (legacy,
    // 'moved', undefined, ou pas de drapeau). Le drag bascule en 'moved'.
    const initialStatus = getAccessPointStatus(feature);
    _flagState = initialStatus === 'osm' ? 'osm' : 'moved';

    _marker = L.marker(start, { draggable: true, icon: flagIcon(_flagState), zIndexOffset: 1200 }).addTo(map);
    _line = L.polyline([_poiLatLng, start], {
        color: '#c0392b', weight: 2, dashArray: '5,8', opacity: 0.9, interactive: false,
    }).addTo(map);

    // Drag = geste manuel → bascule visuelle vers vert (moved). Le status data
    // n'est écrit qu'au Save (onSave écrit 'moved').
    _marker.on('drag', () => { setFlagState('moved'); redrawLine(); });
    _marker.on('dragend', redrawLine);

    // Clic sur la carte « vide » = (re)place le drapeau à cet endroit (geste
    // manuel → bascule en moved/vert).
    _onMapClick = (e) => { _marker.setLatLng(e.latlng); setFlagState('moved'); redrawLine(); };
    map.on('click', _onMapClick);

    _toolbar = buildToolbar(feature);
    map.getContainer().appendChild(_toolbar);

    // Render des icônes Lucide injectées dans la barre (flag, check).
    createIcons({ icons: appIcons, attrs: { 'stroke-width': 2 }, nameAttr: 'data-lucide' });

    // Première mise à jour de la mesure (drapeau démarre sur le POI = 0 m, ou
    // à l'emplacement du drapeau existant = écart effectif).
    updateMeasure();

    map.panTo(start, { animate: true });
    // Pas de toast d'instruction : la barre de pose (persistante) porte déjà la
    // consigne « glisse le drapeau sur la voie la plus proche ». Le fond par
    // défaut (Voyager) montre les routes ; l'admin bascule via le contrôle de
    // calques existant si besoin (satellite pour le bâti).
}

async function onSave() {
    if (!_marker || !_poiId) return;
    const { lat, lng } = _marker.getLatLng();
    const poiId = _poiId;
    // Si l'admin n'a rien touché (drapeau initial = orange OSM intact), on
    // garde 'osm'. Dès qu'il a bougé le drapeau, _flagState passe à 'moved'.
    const newStatus = _flagState === 'osm' ? 'osm' : 'moved';
    teardown();
    // Format [lon, lat] (cohérent avec geometry.coordinates et gpx.js).
    // updatePoiData affiche déjà un toast « Enregistré » par appel ; on
    // appelle 2× (accessPoint + accessPointStatus) — toast 2× ici est OK
    // car geste explicite et bref. La version silencieuse de la pré-pose
    // (writeAccessPointSilent) est dans access-point.js pour la création POI.
    await updatePoiData(poiId, 'accessPoint', [lng, lat]);
    await updatePoiData(poiId, 'accessPointStatus', newStatus);
}

async function onPrepop() {
    if (!_poiFeature || !_prepopBtn) return;
    // Confirmation seulement si on s'apprête à ÉCRASER un drapeau déplacé
    // manuellement par l'admin (vert). Pas de drapeau OU orange OSM = direct.
    if (_flagState === 'moved' && _hadAccessPoint) {
        const ok = await showConfirm(
            'Remplacer le drapeau',
            'Le drapeau actuel a été ajusté manuellement. Le remplacer par la suggestion OSM ?',
            'Remplacer',
            'Annuler',
            false
        );
        if (!ok) return;
    }
    // UI loading.
    _prepopBtn.disabled = true;
    const oldHtml = _prepopBtn.innerHTML;
    _prepopBtn.innerHTML = '<i data-lucide="loader-2"></i> Recherche…';
    createIcons({ icons: appIcons, attrs: { 'stroke-width': 2 }, nameAttr: 'data-lucide' });
    try {
        // force:true → re-fetch même si cache (l'admin demande une fraîche
        // suggestion ; les drapeaux silencieux/passe globale utilisent le cache).
        const result = await prepoSeAccessPoint(_poiFeature, { force: true });
        if (result.status === 'osm' && result.coords) {
            // Place le drapeau sur la suggestion OSM. État = osm (orange).
            _marker.setLatLng([result.coords[1], result.coords[0]]);
            setFlagState('osm');
            _hadAccessPoint = true;
            redrawLine();
            showToast(`Drapeau posé sur la voie · ${Math.round(result.distance)} m`, 'success', 2500);
        } else if (result.status === 'on-track') {
            showToast(`POI déjà sur la voie (${Math.round(result.distance)} m). Pas de drapeau nécessaire.`, 'info', 3500);
        } else if (result.status === 'failed') {
            showToast('Aucune voie OSM trouvée dans le rayon — à reprendre plus tard.', 'warning', 4000);
        }
    } catch (e) {
        console.error('[access-point] Pré-pose OSM échouée:', e);
        showToast('Échec de la recherche OSM (réseau ?). À reprendre plus tard.', 'warning', 4000);
    } finally {
        if (_prepopBtn) {
            _prepopBtn.disabled = false;
            _prepopBtn.innerHTML = oldHtml;
            createIcons({ icons: appIcons, attrs: { 'stroke-width': 2 }, nameAttr: 'data-lucide' });
        }
    }
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

// Auto-teardown quand l'admin bascule sur un autre POI ou ferme la fiche
// (bug signalé sur PR #708 : la barre restait figée sur l'ancien POI).
// Module importé statiquement par ui-details, ces listeners sont posés
// dès le boot — ils ne font rien tant qu'aucune session n'est active.
eventBus.on('details-panel:opened', ({ poiId }) => {
    if (_poiId && _poiId !== poiId) teardown();
});
eventBus.on('details-panel:closed', () => {
    if (_poiId) teardown();
});
