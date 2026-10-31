// circuit-way-types.js — Coloration du tracé par type de voie, en création.
//
// Pendant la création et l'édition d'un circuit (PC), le tracé bleu est remplacé
// par des tronçons colorés selon la voie empruntée (route, rue, piste, sentier,
// non classé — cf. way-types.js). En consultation et côté visiteurs, il reste
// bleu : rien de ceci n'est publié.
//
// Deux points d'entrée :
//   • hors « Éditer l'itinéraire » : map.js signale chaque tracé bleu dessiné
//     ('circuit:realtrack-drawn') ; on pose par-dessus un calque coloré et on
//     masque le bleu. Le calque suit la vie du tracé bleu (retiré avec lui).
//   • dans « Éditer l'itinéraire » : circuit-focus dessine ses passages via
//     paintTrackParts, et toutes les voies de la zone en fond via paintZoneWays
//     (bouton « Voies »), pour repérer une alternative au tracé.
// Les voies viennent d'Overpass, sur un rectangle autour du tracé (une requête
// sert aux deux). Tant qu'un tronçon n'est pas couvert, il reste bleu ; si
// Overpass échoue, la carte du tracé l'indique (« Réessayer ») et rien n'est
// bloqué.
import L from 'leaflet';
import { state } from './state.js';
import { map, trackRenderer } from './map.js';
import { eventBus } from './events.js';
import { fetchOverpassJson } from './osm-overpass.js';
import { getActiveCircuit } from './circuit-lookup.js';
import { buildRealTrack } from './circuit-routing.js';
import { trackFingerprint } from './track-fingerprint.js';
import {
    WAY_CATEGORIES, ZONE_MARGIN_M, createSegmentIndex, addOverpassWays,
    classifyParts, pendingZone, zoneQuery, boundsOf, boxesIntersect,
} from './way-types.js';

const WAY_KEYS = new Set(WAY_CATEGORIES.map(c => c.key));

// Voies et rectangles déjà interrogés, par destination (la projection d'un index
// est calée sur sa première latitude) : gardés pour la session — un passage
// recalculé dans la même zone se recolore sans nouvelle requête.
//   ways  : index spatial (classement des tronçons)
//   list  : les mêmes voies, à dessiner en fond ({ll, t, box})
//   cover : rectangles interrogés
const _indexes = new Map();
function indexes() {
    const key = String(state.currentMapId);
    if (!_indexes.has(key)) _indexes.set(key, { ways: createSegmentIndex(), list: [], cover: [] });
    return _indexes.get(key);
}

let _inflight = null;    // requête Overpass en cours
let _failedFor = null;   // circuit dont la dernière requête a échoué (pas de relance auto)
let _view = null;        // { meters } du dernier tracé peint
let _lastRefresh = null; // redessin du dernier tracé peint (pour « Réessayer »)
let _base = null;        // tracé bleu recouvert (hors édition)
let _overlay = null;     // calque coloré posé dessus

function inCreation() { return state.isCircuitCreationMode || state.editingMode; }

function notify() {
    window.dispatchEvent(new CustomEvent('circuit:way-types'));
}

// Dessine les passages dans `group` : liserés d'abord, puis traits. Un tronçon
// non couvert reste bleu ; un passage en échec n'est dessiné que si drawFail
// (hors édition, refreshFailOverlay s'en charge).
function paint(group, parts, { drawFail = false, onRefresh = null } = {}) {
    const { ways, cover } = indexes();
    const { runs, meters } = classifyParts(parts, ways, cover);
    const line = (ll, className) => L.polyline(ll, { className, interactive: false, renderer: trackRenderer() });
    runs.forEach(r => {
        if (WAY_KEYS.has(r.t)) group.addLayer(line(r.ll, `way-halo way-halo--${r.t}`));
    });
    runs.forEach(r => {
        let cls = null;
        if (WAY_KEYS.has(r.t)) cls = `way-line way-line--${r.t}`;
        else if (r.t === 'pending') cls = 'real-track-polyline';
        else if (r.t === 'droite' && drawFail) cls = 'route-fail-segment';
        if (cls) group.addLayer(line(r.ll, cls));
    });
    _view = { meters };
    _lastRefresh = onRefresh;
    if (meters.pending) requestCoverage(runs, onRefresh);
    notify();
}

function requestCoverage(runs, onRefresh) {
    const cid = String(state.activeCircuitId);
    if (_inflight || _failedFor === cid) return;
    const box = pendingZone(runs);
    if (!box) return;
    const { ways, list, cover } = indexes();
    // Une zone de circuit à Djerba ≈ 800 voies, ~900 Ko : laisser au serveur
    // ses 25 s ([timeout:25]) plus le transfert, sans nouvelle tentative.
    _inflight = fetchOverpassJson(zoneQuery(box), { timeoutMs: 30000, retries: 0 })
        .then(json => {
            list.push(...addOverpassWays(ways, json));
            cover.push(box);
            _failedFor = null;
        })
        .catch(err => {
            console.warn('[types de voie] Overpass indisponible', err);
            _failedFor = cid;
        })
        .finally(() => {
            _inflight = null;
            if (onRefresh) onRefresh();
            else notify();
        });
}

// Passages du tracé enregistré : ceux de la session s'ils lui correspondent
// exactement (on connaît alors les passages en échec), sinon le tracé entier.
function currentParts() {
    const track = getActiveCircuit()?.realTrack;
    if (!Array.isArray(track) || track.length < 2) return [];
    const segs = state.routeSegments;
    if (Array.isArray(segs) && segs.length && trackFingerprint(buildRealTrack(segs)) === trackFingerprint(track)) {
        return segs;
    }
    return [{ coords: track, ok: true }];
}

function clearOverlay() {
    if (_overlay) { _overlay.remove(); _overlay = null; }
    if (_base) _base.getElement()?.classList.remove('is-way-typed');
    _base = null;
    _view = null;
}

function renderOverlay() {
    if (!_base || !map || !map.hasLayer(_base)) { notify(); return; }
    if (_overlay) _overlay.clearLayers();
    else _overlay = L.layerGroup().addTo(map);
    paint(_overlay, currentParts(), { onRefresh: renderOverlay });
    _base.getElement()?.classList.add('is-way-typed');
}

function onRealTrackDrawn(polyline) {
    clearOverlay();
    if (!polyline || !inCreation() || state.circuitFocusActive) return;
    _base = polyline;
    polyline.once('remove', () => { if (_base === polyline) clearOverlay(); });
    renderOverlay();
}

/**
 * « Éditer l'itinéraire » : dessine les passages (segments de session) colorés
 * dans `group`, passages en échec compris. `onRefresh` redessine quand les voies
 * d'une zone nouvelle sont arrivées.
 */
export function paintTrackParts(group, parts, onRefresh) {
    paint(group, parts, { drawFail: true, onRefresh });
}

// Pane sous le tracé (z-index en CSS) : les voies de la zone restent dessous
// quel que soit l'ordre de dessin, et leur transparence s'applique au pane entier
// (liseré et trait ne se cumulent pas).
const ZONE_PANE = 'way-zone';
let _zoneRenderer = null;
function zoneRenderer() {
    if (!_zoneRenderer) {
        if (!map.getPane(ZONE_PANE)) map.createPane(ZONE_PANE);
        _zoneRenderer = L.svg({ pane: ZONE_PANE, padding: 0.5 });
    }
    return _zoneRenderer;
}

/**
 * « Éditer l'itinéraire », bouton « Voies » : dessine dans `group` toutes les
 * voies connues autour des passages (rectangle du tracé élargi de ZONE_MARGIN_M),
 * en traits fins des cinq couleurs.
 */
export function paintZoneWays(group, parts) {
    const zone = boundsOf((parts || []).flatMap(p => p?.coords || []), ZONE_MARGIN_M);
    if (!zone) return;
    const renderer = zoneRenderer();
    const shown = indexes().list.filter(w => boxesIntersect(w.box, zone));
    const line = (ll, className) => L.polyline(ll, { className, interactive: false, pane: ZONE_PANE, renderer });
    shown.forEach(w => group.addLayer(line(w.ll, `way-zone-halo way-halo--${w.t}`)));
    shown.forEach(w => group.addLayer(line(w.ll, `way-zone-line way-line--${w.t}`)));
}

/**
 * État pour la carte du tracé, ou null si aucun tracé n'est coloré.
 * @returns {{meters: Object<string, number>, loading: boolean, error: boolean} | null}
 */
export function wayTypesView() {
    if (!_view) return null;
    const pending = (_view.meters.pending || 0) > 0;
    return {
        meters: _view.meters,
        loading: pending && !!_inflight,
        error: pending && !_inflight && _failedFor === String(state.activeCircuitId),
    };
}

/** « Réessayer » après un échec d'Overpass. */
export function retryWayTypes() {
    _failedFor = null;
    if (_lastRefresh) _lastRefresh();
}

eventBus.on('circuit:realtrack-drawn', onRealTrackDrawn);
