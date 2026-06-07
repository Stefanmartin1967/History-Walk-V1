// circuit-focus.js — Focus mode « Ajuster le tracé » (routing in-app niveau 2 / PR2).
//
// Plein écran dédié pour affiner le tracé réel BRouter en posant des POINTS DE
// PASSAGE (waypoints) entre deux POIs. Calqué sur la passe drapeaux OSM
// (osm-pass.js) : body.circuit-focus-active masque la sidebar, on superpose un
// rail latéral (séquence) + une barre d'action basse + un bouton « Quitter ».
//
// Modèle de données (état de SESSION, jamais persisté — cf. décision « trace
// finale seule ») :
//   • state.routeSegments  = [{coords:[[lat,lon],…], ok, distanceKm}] — un par
//     couple de POIs consécutifs. Source de vérité du tracé pendant l'édition.
//   • state.draftWaypoints = [{id, seg, lat, lng}] — points de passage posés
//     dans la session ; vidés à la sortie (re-rouvrir = repartir de la trace).
//
// Routing SEGMENT PAR SEGMENT (circuit-routing.js) : poser / glisser / supprimer
// un point ne re-route QUE le segment concerné (au dragend, pas en continu).
// Le realTrack final = concat des segments, sauvegardé UNIQUEMENT à « Terminer »
// (« Quitter » annule via le snapshot d'entrée). Un segment non routable retombe
// en ligne droite pointillée (.route-fail-segment) = échec partiel.
import L from 'leaflet';
import { state } from './state.js';
import { map, updatePolylines, clearMapLines } from './map.js';
import {
    anchorOf, routeOneSegment, splitTrackByAnchors, buildRealTrack, segmentsDistanceKm, segmentsAscend,
} from './circuit-routing.js';
import { saveAndExportCircuit } from './circuit-actions.js';
import { renderCircuitPanel, currentPoiKey } from './circuit.js';
import { getPoiId } from './data.js';
import { getDraggedAnchors, revertDraggedFlags, resyncFlags } from './circuit-flags.js';
import { toggleReferenceLayer, isReferenceVisible } from './circuit-reference-layer.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { eventBus } from './events.js';

let _overlay = null;   // conteneur rail + barre + bouton quitter
let _segLayer = null;  // L.layerGroup des polylignes de segment (+ hit-lines)
let _wpLayer = null;   // L.layerGroup des marqueurs waypoint
let _failLayer = null; // L.layerGroup des segments en échec (rendu HORS focus)
let _addMode = false;  // « Ajouter un point » actif → clic du tracé = insertion
let _dirty = false;    // un point a été posé/déplacé/supprimé dans la session
let _rerouting = 0;    // nb de re-routes BRouter en cours (spinner barre)
let _snapshot = null;  // copie de routeSegments à l'entrée (annulation « Quitter »)
let _ghostLayer = null;      // L.layerGroup des fantômes (segments d'origine modifiés)
let _editedSegs = new Set(); // index des segments modifiés dans la session → fantôme

// ---------- Helpers ----------
function features() { return state.currentCircuit || []; }
function inCreation() { return state.isCircuitCreationMode || state.editingMode; }
function activeCircuit() {
    if (!state.activeCircuitId) return null;
    return [...(state.officialCircuits || []), ...(state.myCircuits || [])]
        .find(c => c.id === state.activeCircuitId) || null;
}
function genId() { return 'wp_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
function fmtKm(km) { return km ? km.toFixed(1).replace('.', ',') + ' km' : '—'; }

function wpIcon() {
    return L.divIcon({
        className: 'wp-marker', html: '<span class="wp-ring"></span>',
        iconSize: [18, 18], iconAnchor: [9, 9],
    });
}

// Projection scalaire normalisée de p sur la corde a→b (points [lon, lat]).
// Sert à ORDONNER les points de passage d'un même segment le long du chemin,
// pour qu'un point posé/glissé s'insère au bon endroit (pas de zigzag).
function projT(p, a, b) {
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    if (!len2) return 0;
    return ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
}

// Ancres déplacées en session (drapeaux d'accès glissés en focus), indexées par
// position de POI : { [idx]: [lon, lat] }. Priment sur l'accessPoint enregistré
// pour que le re-route (et l'ordre des points de passage) suive la position LIVE
// du drapeau — cf. routeOneSegment / anchorOf.
function anchorOverrides() {
    const dragged = getDraggedAnchors(); // { [poiId]: [lon, lat] }
    const out = {};
    features().forEach((f, idx) => { const id = getPoiId(f); if (dragged[id]) out[idx] = dragged[id]; });
    return out;
}

// Regroupe state.draftWaypoints par segment, ordonnés le long de la corde.
function waypointsBySeg() {
    const ov = anchorOverrides();
    const anchors = features().map((f, idx) => ov[idx] || anchorOf(f));
    const bySeg = {};
    (state.draftWaypoints || []).forEach(w => { (bySeg[w.seg] = bySeg[w.seg] || []).push(w); });
    Object.keys(bySeg).forEach(s => {
        const i = +s, a = anchors[i], b = anchors[i + 1];
        if (a && b) bySeg[s].sort((w1, w2) => projT([w1.lng, w1.lat], a, b) - projT([w2.lng, w2.lat], a, b));
    });
    return bySeg;
}

// ---------- Rendu carte ----------
function drawSegments() {
    if (_segLayer) _segLayer.clearLayers();
    else _segLayer = L.layerGroup().addTo(map);

    (state.routeSegments || []).forEach((seg) => {
        if (!Array.isArray(seg.coords) || seg.coords.length < 2) return;
        const cls = seg.ok ? 'real-track-polyline' : 'route-fail-segment';
        // Non interactif : l'ajout d'un point passe par le clic carte (onAddClick),
        // pas par un clic sur le tracé (une polyligne transparente ne capte pas les
        // events SVG — pointer-events: visiblePainted). Plus robuste + plus tolérant.
        _segLayer.addLayer(L.polyline(seg.coords, { className: cls, interactive: false }));
    });
}

// Fantôme du segment remplacé (item 3) : pour chaque segment MODIFIÉ dans la
// session, dessine sa géométrie d'ORIGINE (snapshot d'entrée du focus) en
// pointillé, SOUS le tracé courant, pour visualiser le « avant → après ».
function drawGhosts() {
    if (!_ghostLayer) return;
    _ghostLayer.clearLayers();
    const snap = _snapshot || [];
    _editedSegs.forEach((i) => {
        const seg = snap[i];
        if (seg && Array.isArray(seg.coords) && seg.coords.length >= 2) {
            _ghostLayer.addLayer(L.polyline(seg.coords, { className: 'route-ghost-segment', interactive: false }));
        }
    });
}

// Segment le plus proche d'un point cliqué (nearest-vertex) — pour rattacher un
// nouveau point de passage au bon tronçon POI→POI.
function nearestSegmentIndex(latlng) {
    const segs = state.routeSegments || [];
    let best = 0, bestD = Infinity;
    segs.forEach((s, i) => {
        (s.coords || []).forEach(([lat, lon]) => {
            const d = (lat - latlng.lat) ** 2 + (lon - latlng.lng) ** 2;
            if (d < bestD) { bestD = d; best = i; }
        });
    });
    return best;
}

// Mode « Ajouter un point » actif : un clic GAUCHE sur la carte pose un point de
// passage à cet endroit, rattaché au segment le plus proche (le tracé s'y plie).
function onAddClick(e) {
    if (!_addMode) return;
    insertWaypoint(nearestSegmentIndex(e.latlng), e.latlng);
}

function drawWaypoints() {
    if (_wpLayer) _wpLayer.clearLayers();
    else _wpLayer = L.layerGroup().addTo(map);

    (state.draftWaypoints || []).forEach(w => {
        const m = L.marker([w.lat, w.lng], { draggable: true, icon: wpIcon(), zIndexOffset: 1300 });
        // Position live pendant le drag (le segment se redessine au dragend).
        m.on('drag', () => { const ll = m.getLatLng(); w.lat = ll.lat; w.lng = ll.lng; });
        m.on('dragend', () => { const ll = m.getLatLng(); w.lat = ll.lat; w.lng = ll.lng; _dirty = true; rerouteSegment(w.seg); });
        m.on('click', () => removeWaypoint(w.id)); // clic = retirer (Leaflet annule le click après un drag)
        _wpLayer.addLayer(m);
    });
}

// ---------- Opérations sur les points de passage ----------
function insertWaypoint(seg, latlng) {
    state.draftWaypoints.push({ id: genId(), seg, lat: latlng.lat, lng: latlng.lng });
    _dirty = true;
    rerouteSegment(seg);
}

function removeWaypoint(id) {
    const idx = (state.draftWaypoints || []).findIndex(w => w.id === id);
    if (idx < 0) return;
    const seg = state.draftWaypoints[idx].seg;
    state.draftWaypoints.splice(idx, 1);
    _dirty = true;
    rerouteSegment(seg);
}

// Re-route le SEUL segment touché, met à jour state.routeSegments[i] et
// rafraîchit carte + rail + barre. routeOneSegment ne jette pas (échec →
// segment ok:false en ligne droite).
async function rerouteSegment(i) {
    if (!Array.isArray(state.routeSegments)) return;
    _editedSegs.add(i); // segment modifié → affiche le fantôme de son origine
    _rerouting++;
    renderBar();
    try {
        const seg = await routeOneSegment(features(), i, waypointsBySeg(), undefined, anchorOverrides());
        state.routeSegments[i] = seg;
    } catch (e) {
        console.error('[focus] re-route segment', i, e);
    } finally {
        _rerouting = Math.max(0, _rerouting - 1);
    }
    drawSegments();
    drawGhosts();
    drawWaypoints();
    renderBar();
}

// Un drapeau d'accès a été glissé EN FOCUS (event 'circuit-flag:moved', émis par
// circuit-flags) → re-route les segments qui bordent ce POI : le POI d'index idx
// borde le segment idx-1 (POI précédent → lui) et le segment idx (lui → suivant).
// La position live du drapeau est lue via anchorOverrides() dans rerouteSegment.
function onFlagMoved(poiId) {
    if (!state.circuitFocusActive) return;
    const feats = features();
    const idx = feats.findIndex(f => getPoiId(f) === poiId);
    if (idx < 0) return;
    _dirty = true;
    if (idx > 0) rerouteSegment(idx - 1);
    if (idx < feats.length - 1) rerouteSegment(idx);
}

// ---------- Rendu de la barre d'action flottante ----------
function renderBar() {
    const bar = _overlay && _overlay.querySelector('.focus-bar');
    if (!bar) return;
    const distTxt = fmtKm(state.routeSegments ? segmentsDistanceKm(state.routeSegments) : 0);
    const wpCount = (state.draftWaypoints || []).length;
    const wpTxt = wpCount ? ` · <b>${wpCount}</b> point${wpCount > 1 ? 's' : ''} de passage` : '';
    const measure = _rerouting
        ? '<span class="spin"></span> Calcul…'
        : `Distance <b>${distTxt}</b>${wpTxt}`;
    bar.innerHTML = `
        <div class="focus-bar-main">
            <div class="focus-bar-mark"><i data-lucide="navigation"></i></div>
            <div class="focus-bar-txt">
                <h5>Édition du tracé</h5>
                <p>${_addMode ? 'Cliquez la carte le long du tracé pour poser un point' : 'Glissez un point pour l\'ajuster · cliquez-le pour le retirer'}</p>
            </div>
            <span class="focus-measure">${measure}</span>
            <span class="focus-bar-sep"></span>
            <button class="fb-btn ${_addMode ? 'is-active' : ''}" type="button" id="fb-add">
                <i data-lucide="waypoints"></i> ${_addMode ? 'Clic carte actif' : 'Ajouter un point'}
            </button>
            <button class="fb-btn ${isReferenceVisible() ? 'is-active' : ''}" type="button" id="fb-layer">
                <i data-lucide="layers"></i> Calque
            </button>
            <span class="focus-bar-sep"></span>
            <button class="fb-btn" type="button" id="fb-quit"><i data-lucide="x"></i> Annuler</button>
            <button class="fb-btn fb-cta" type="button" id="fb-done"><i data-lucide="check"></i> Terminer</button>
        </div>`;
    bar.querySelector('#fb-add').addEventListener('click', toggleAdd);
    bar.querySelector('#fb-layer').addEventListener('click', () => toggleReferenceLayer(renderBar));
    bar.querySelector('#fb-done').addEventListener('click', finish);
    bar.querySelector('#fb-quit').addEventListener('click', requestQuit);
    createIcons({ icons: appIcons, root: bar });
}

function toggleAdd() {
    _addMode = !_addMode;
    document.body.classList.toggle('circuit-focus-add', _addMode);
    if (_addMode) map.on('click', onAddClick);
    else map.off('click', onAddClick);
    renderBar();
}

// ---------- Entrée / sortie ----------
export function enterCircuitFocus() {
    if (state.circuitFocusActive) return;
    const feats = features();
    if (feats.length < 2) { showToast('Ajoutez au moins 2 lieux pour ajuster le tracé.', 'warning'); return; }
    const circuit = activeCircuit();
    if (!circuit) return;

    state.circuitFocusActive = true;
    document.body.classList.add('circuit-focus-active');

    // Découpage de travail : réutilise celui d'un Tracer récent s'il correspond,
    // sinon re-découpe le realTrack sauvegardé par ancres (préserve la géométrie
    // enregistrée — aucun re-routage à l'entrée).
    if (!Array.isArray(state.routeSegments) || state.routeSegments.length !== feats.length - 1) {
        state.routeSegments = splitTrackByAnchors(circuit.realTrack || [], feats);
    }
    _snapshot = JSON.parse(JSON.stringify(state.routeSegments));
    state.draftWaypoints = [];
    _addMode = false; _dirty = false; _rerouting = 0; _editedSegs = new Set();

    // On dessine par segment → on retire TOUTES les polylignes globales (vol
    // d'oiseau + tracé réel) pour ne pas superposer du rouge sous nos segments.
    clearMapLines();
    if (_failLayer) { _failLayer.remove(); _failLayer = null; }

    // Réunif A2 : plus de rail séparé ni de plein écran — l'édition se fait « en
    // place ». Le panneau Circuit (ÉTAPES) reste la liste de séquence ; l'overlay
    // ne porte que la barre d'action flottante (seule elle intercepte les events).
    _overlay = document.createElement('div');
    _overlay.className = 'circuit-focus-overlay';
    _overlay.innerHTML = `<div class="focus-bar"></div>`;
    document.body.appendChild(_overlay);

    _ghostLayer = L.layerGroup().addTo(map); // fantômes SOUS les segments (ajouté avant eux)
    drawSegments();
    drawGhosts();
    drawWaypoints();
    resyncFlags(); // re-rend les drapeaux d'accès DÉVERROUILLÉS pour l'édition en focus
    renderBar();
    createIcons({ icons: appIcons, root: _overlay });
    // Le panneau Circuit reflète « édition du tracé en cours » (updateTraceBlock).
    window.dispatchEvent(new CustomEvent('circuit:updated'));
}

// « Terminer » : sauvegarde le realTrack (concat des segments) et sort.
async function finish() {
    const segs = state.routeSegments;
    if (!Array.isArray(segs) || !segs.length) { teardown({ keepSegments: true }); return; }
    const realTrack = buildRealTrack(segs);
    // D+ : si TOUS les segments ont un dénivelé connu (cas où ils ont été
    // (re)routés par BRouter), on recalcule le total. Sinon — édition partielle :
    // des segments viennent du re-découpage de la trace enregistrée (sans
    // altitude) — on PRÉSERVE le D+ existant plutôt que de le fausser (somme
    // partielle) ou de l'effacer. Un nudge de waypoint change le total de façon
    // négligeable ; un vrai changement passe par « Re-tracer » (flux PR1 complet).
    const existing = activeCircuit();
    const existingAscend = Number.isFinite(existing?.ascend) ? existing.ascend : null;
    const ascend = segs.every(s => Number.isFinite(s.ascend)) ? segmentsAscend(segs) : existingAscend;
    // Réutilise le flux PR1 : pose le realTrack (+ D+) et reste en création (pour
    // continuer d'ajuster / re-tracer ensuite).
    await saveAndExportCircuit(realTrack, { stayInCreation: true, ascend });
    state.routeBasisKey = currentPoiKey(); // le tracé édité correspond à cette séquence
    teardown({ keepSegments: true });
}

// « Quitter » : annule les ajustements de la session (confirmation si dirty).
async function requestQuit() {
    if (_dirty) {
        const ok = await showConfirm(
            'Abandonner les ajustements ?',
            'Les points de passage et déplacements de drapeaux de cette session seront perdus, et le tracé reviendra à sa version enregistrée.',
            'Abandonner', "Continuer l'ajustement", false
        );
        if (!ok) return;
    }
    // Annule les drapeaux glissés dans la session (remet position + couleur) AVANT
    // de restaurer le tracé : ni l'accessPoint ni le realTrack ne sont touchés
    // (sauvegarde uniquement à « Terminer »).
    revertDraggedFlags();
    state.routeSegments = _snapshot;
    teardown({ keepSegments: true });
}

function teardown({ keepSegments = false } = {}) {
    state.circuitFocusActive = false;
    document.body.classList.remove('circuit-focus-active', 'circuit-focus-add');
    map.off('click', onAddClick); // coupe le mode ajout (clic carte)
    state.draftWaypoints = [];
    _addMode = false; _dirty = false; _rerouting = 0; _snapshot = null; _editedSegs = new Set();
    if (!keepSegments) state.routeSegments = null;

    if (_segLayer) { _segLayer.remove(); _segLayer = null; }
    if (_wpLayer) { _wpLayer.remove(); _wpLayer = null; }
    if (_ghostLayer) { _ghostLayer.remove(); _ghostLayer = null; }
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;

    updatePolylines();      // redessine la polyligne realTrack normale
    refreshFailOverlay();   // ré-affiche les segments en échec en pointillé
    renderCircuitPanel();   // restaure le panneau (déclenche updateTraceBlock)
    resyncFlags();          // re-verrouille les drapeaux préexistants (focus terminé)
}

// Overlay des segments en échec HORS focus (pointillé gris sur le tracé bleu).
// Piloté par state.routeSegments ; appelé après un Tracer et à la sortie du focus.
export function refreshFailOverlay() {
    if (_failLayer) { _failLayer.remove(); _failLayer = null; }
    if (state.circuitFocusActive || !inCreation()) return;
    const segs = state.routeSegments;
    if (!Array.isArray(segs) || !segs.some(s => s && !s.ok)) return;
    _failLayer = L.layerGroup().addTo(map);
    segs.forEach(s => {
        if (s && !s.ok && Array.isArray(s.coords) && s.coords.length >= 2) {
            _failLayer.addLayer(L.polyline(s.coords, { className: 'route-fail-segment', interactive: false }));
        }
    });
}

// Écoute (posée au boot) : un drapeau d'accès glissé EN FOCUS → re-route les
// segments bordant son POI. onFlagMoved est guardé par circuitFocusActive → no-op
// hors focus (en édition normale, glisser un drapeau ne re-route rien ; il est
// persisté au save circuit comme avant via commitDirtyFlags).
eventBus.on('circuit-flag:moved', ({ poiId }) => onFlagMoved(poiId));
