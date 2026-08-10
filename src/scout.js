// scout.js — Scout in-app (admin). Réunification Lot B + flux inversé v2.
//
// Successeur in-app de tools/scout.html (supprimé en Lot C). Mode FOCALISÉ plein
// écran : topbar + sidebar masquées, vraie carte assombrie, panneau gauche + une
// BOÎTE bbox déplaçable/redimensionnable (8 poignées) sur la carte. Gated isAdmin.
//
// FLUX INVERSÉ (v2, validé 12/06/2026) : on crée la destination AVANT de la
// scouter. L'ancien toggle Nouvelle/Repasse faisait bifurquer la CAPTURE selon
// un état invisible — une capture « repasse » avec la carte sur Hammamet
// injectait 50 lieux dans Djerba. Désormais :
//   1. « Nouvelle destination… » (panneau) = recherche Nominatim → brouillon
//      local VIDE (createDestinationDraft) → bascule dessus (?map={id}) ;
//   2. le Scout moissonne TOUJOURS la destination active — les captures passent
//      par addPoiFeature → customPois_{id}, le canal canonique lu par la
//      publication (cf. publish-destination.js) ; autant de passes qu'on veut ;
//   3. garde-fou : une boîte qui ne touche pas les bounds de la destination
//      active bloque le scan (cible quasi sûrement erronée).
//
// MOISSON : cases catégories + « Scanner » → requête Overpass bbox
// (osm-overpass.js mutualisé) → mapping OSM→taxo + dédup vs data chargé →
// pastilles candidates + récap. Ajuster la boîte re-filtre les candidats EN
// DIRECT (sans re-requêter) ; sortir de la zone scannée → invite à re-scanner.
//
// La boîte est stockée en COORDONNÉES (bounds lat/lng) = source de vérité, et
// projetée en pixels (viewport) à chaque rendu → elle suit le pan/zoom. Idem
// pour les pastilles candidates.
import { map } from './map.js';
import { fetchWithTimeout } from './net.js';
import { state } from './state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { fetchOverpassJson } from './osm-overpass.js';
import { addPoiFeature } from './data.js';
import { isDestinationPublished } from './utils.js';
import { hwPrompt } from './modal.js';
import { makeUniqueDestId, saveDraftZones } from './local-destinations.js';
import { fetchZonesAuto } from './osm-zones.js';
import { zonesData, setZonesData } from './zones.js';
import { isRejected } from './rejected.js';
import { getHwCategory, resolveOsmNames } from './scout-categories.js';
import { collectKnownOsmRefs, isDuplicateCandidate } from './scout-dedup.js';
import { getStoredToken } from './github-sync.js';
import { registerDraftDestinationOnGitHub, pushDestinationZones } from './publish-destination.js';

let _overlay = null;
let _boxEl = null;
let _isOpen = false;
let _box = null;                // { north, south, east, west } — source de vérité
let _drag = null;               // état drag/resize en cours
let _onMapMove = null;          // resync boîte + pastilles sur pan/zoom
let _drawLayer = null;          // couche de tracé (armée par le bouton « Tracer la zone »)
let _drawArmed = false;         // tracé armé ? (false = navigation libre : pan/zoom/contrôles)
let _drawStart = null;          // point de départ (px) du tracé de la boîte au glisser
let _categories = null;         // Set des clés de catégorie cochées
let _candidates = [];           // résultats du dernier scan : {lat,lon,cat,unknown,dup,nameFr,nameAr,_el}
let _scannedBounds = null;      // bounds de la boîte au moment du scan (détection « zone modifiée »)
let _scanning = false;
let _geocoded = false;          // création : une recherche Nominatim a-t-elle volé la carte ?
let _geoBBox = null;            // création : bbox [[s,w],[n,e]] du lieu géocodé → bounds du brouillon
let _geoName = '';              // création : nom du lieu géocodé → pré-remplit le nom de la destination
let _geoCountry = '';           // création : code pays ISO (Nominatim) → niveau admin des zones OSM

const MIN_PX = 46;              // taille mini de la boîte à l'écran (poignées utilisables)
const MIN_VIEW_KM = 25;         // fenêtre mini après géocodage : de quoi tracer une boîte de 25 km
const TILE_KM = 25;             // côté max d'une tuile (km). Djerba (~18 km) tient en 1 passe — comme
                                // l'ancien Scout (1 bbox). Le découpage ne sert que pour des boîtes
                                // VRAIMENT vastes (multi-destinations). Réunif B2c, relevé 5→25.
const MAX_TILES = 36;           // garde-fou : au-delà, zone trop vaste → on refuse

// Catégories de moisson (clés alignées sur les clauses Overpass + libellés UI).
// Cochées par défaut : Lieux de culte / Patrimoine historique / Musées & culture.
// P1 : libellés neutres multi-pays (l'ancien « Religion (Mosquées) » était trop
// typé — la requête capte déjà toutes les confessions). « Tourisme / Art » et
// « Loisirs / Parcs » fusionnés en « Tourisme & loisirs » (ils moissonnaient tous
// deux vers la même catégorie « Curiosité »).
const CATEGORIES = [
    { key: 'religion', label: 'Lieux de culte', on: true },
    { key: 'history', label: 'Patrimoine historique', on: true },
    { key: 'museum', label: 'Musées & culture', on: true },
    { key: 'hotel', label: 'Hôtels', on: false },
    { key: 'restaurant', label: 'Restos / Cafés', on: false },
    { key: 'tourism', label: 'Tourisme & loisirs', on: false },
    { key: 'public', label: 'Services Publics', on: false },
];

// OSM tag → catégorie Heripia : getHwCategory, extrait dans le module feuille
// ./scout-categories.js (taxonomie v2, testable seul).

// ── Projection coords ↔ pixels viewport ─────────────────────────────────────
function mapRect() { return map.getContainer().getBoundingClientRect(); }

function geoToViewportRect(b) {
    const nw = map.latLngToContainerPoint([b.north, b.west]);
    const se = map.latLngToContainerPoint([b.south, b.east]);
    const r = mapRect();
    return { left: r.left + nw.x, top: r.top + nw.y, w: se.x - nw.x, h: se.y - nw.y };
}
function viewportRectToGeo(rect) {
    const r = mapRect();
    const nw = map.containerPointToLatLng([rect.left - r.left, rect.top - r.top]);
    const se = map.containerPointToLatLng([rect.left - r.left + rect.w, rect.top - r.top + rect.h]);
    return { north: nw.lat, west: nw.lng, south: se.lat, east: se.lng };
}

// ── « Boîte de la destination » : mémorisée par mapId ─────────────────────────
// La boîte de scout est PERSISTÉE (localStorage, par destination) et RESTAURÉE aux
// réouvertures → on re-scoute la même zone (nouvelles catégories, lieux récemment
// cartographiés…) ou on l'AGRANDIT aux poignées sans rien perdre (le scan
// dédoublonne l'existant, règle #472). Préférence locale (par appareil), comme
// hw_active_dest. Pas de boîte sauvée → boîte par défaut centrée → « Scanner » actif
// d'emblée (avant : « Scanner » grisé tant qu'on n'avait pas tracé à la main).
function boxStorageKey() { return `scout_box_${state.currentMapId}`; }
function persistBox() {
    try {
        const k = boxStorageKey();
        if (_box) localStorage.setItem(k, JSON.stringify(_box));
        else localStorage.removeItem(k);
    } catch (_) { /* quota / navigation privée : best-effort */ }
}
function loadSavedBox() {
    try {
        const b = JSON.parse(localStorage.getItem(boxStorageKey()) || 'null');
        if (b && ['north', 'south', 'east', 'west'].every(k => Number.isFinite(b[k]))) return b;
    } catch (_) { /* JSON corrompu → on ignore */ }
    return null;
}
// Boîte par défaut = portion centrale (~60 %) de la vue courante. À la profondeur de
// zoom d'une destination ça tient en 1 tuile ; une vue très dézoomée serait de toute
// façon refusée par le garde MAX_TILES de scan().
function defaultBox() {
    const r = mapRect();
    const w = r.width * 0.6, h = r.height * 0.6;
    return viewportRectToGeo({ left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, w, h });
}

// ── Géométrie ────────────────────────────────────────────────────────────────
// Les règles de dédup (identité OSM puis proximité 50 m) vivent dans le module
// pur scout-dedup.js — voir son en-tête pour le pourquoi des deux règles.
function inBox(c) {
    return _box && c.lat <= _box.north && c.lat >= _box.south && c.lon >= _box.west && c.lon <= _box.east;
}
function boxWithin(outer) {
    return outer && _box && _box.north <= outer.north && _box.south >= outer.south
        && _box.west >= outer.west && _box.east <= outer.east;
}
// La boîte touche-t-elle les bounds [[s,w],[n,e]] de la destination active ?
// Bounds illisibles (vieille entrée sans bounds…) → true : pas de garde plutôt
// qu'un faux blocage. Chevauchement PARTIEL accepté (étendre une dest est légitime).
function boxIntersectsBounds(b, bounds) {
    if (!Array.isArray(bounds) || !Array.isArray(bounds[0]) || !Array.isArray(bounds[1])) return true;
    const s = bounds[0][0], w = bounds[0][1], n = bounds[1][0], e = bounds[1][1];
    if (![s, w, n, e].every(Number.isFinite)) return true;
    return b.south <= n && b.north >= s && b.west <= e && b.east >= w;
}

// ── Cote (km) ───────────────────────────────────────────────────────────────
function boxKm(b) {
    const latMid = (b.north + b.south) / 2;
    return {
        wKm: Math.abs(b.east - b.west) * 111 * Math.cos(latMid * Math.PI / 180),
        hKm: Math.abs(b.north - b.south) * 111,
    };
}

// Découpe en grille de tuiles ≲ TILE_KM de côté (réunif B2c) : Overpass encaisse
// mieux plusieurs petites bbox qu'une grosse. 1 tuile si la boîte est déjà petite.
function tileGrid(b) {
    const { wKm, hKm } = boxKm(b);
    const cols = Math.max(1, Math.ceil(wKm / TILE_KM));
    const rows = Math.max(1, Math.ceil(hKm / TILE_KM));
    return { cols, rows, count: cols * rows };
}
function computeTiles(b) {
    const { cols, rows } = tileGrid(b);
    const dLat = (b.north - b.south) / rows;
    const dLon = (b.east - b.west) / cols;
    const tiles = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            tiles.push({
                north: b.north - r * dLat, south: b.north - (r + 1) * dLat,
                west: b.west + c * dLon, east: b.west + (c + 1) * dLon,
            });
        }
    }
    return tiles;
}

// ── Rendu ─────────────────────────────────────────────────────────────────────
function render() {
    if (!_boxEl) return;
    const hasBox = !!_box;
    // Pas de boîte → boîte masquée. La couche de tracé n'est active QUE si
    // l'admin a armé le tracé (bouton « Tracer la zone ») : par défaut la
    // carte reste navigable (pan/zoom/contrôles Leaflet cliquables).
    _boxEl.classList.toggle('is-hidden', !hasBox);
    if (_drawLayer) _drawLayer.classList.toggle('is-on', !hasBox && _drawArmed);
    if (hasBox) {
        const rect = geoToViewportRect(_box);
        _boxEl.style.left = rect.left + 'px';
        _boxEl.style.top = rect.top + 'px';
        _boxEl.style.width = rect.w + 'px';
        _boxEl.style.height = rect.h + 'px';
        positionCandidates();
    }
    updateReadout();
    refreshRecap();
}

function positionCandidates() {
    if (!_candidates.length) return;
    const r = mapRect();
    for (const c of _candidates) {
        if (!c._el) continue;
        const p = map.latLngToContainerPoint([c.lat, c.lon]);
        c._el.style.left = (r.left + p.x) + 'px';
        c._el.style.top = (r.top + p.y) + 'px';
    }
}

function updateReadout() {
    const dimEl = _overlay?.querySelector('[data-scout-dimtxt]');
    if (!_box) { if (dimEl) dimEl.textContent = '—'; return; }
    const { wKm, hKm } = boxKm(_box);
    const tiles = tileGrid(_box).count;
    const tooVast = tiles > MAX_TILES;
    const dimtxt = _overlay?.querySelector('[data-scout-dimtxt]');
    if (dimtxt) dimtxt.innerHTML = `${wKm.toFixed(1)} × ${hKm.toFixed(1)} km${tooVast ? ' <span class="warn">⚠</span>' : ''}`;
    const note = _overlay?.querySelector('[data-scout-note]');
    const notetxt = _overlay?.querySelector('[data-scout-notetxt]');
    if (note && notetxt) {
        note.classList.toggle('is-warn', tooVast);
        notetxt.textContent = tooVast
            ? `Zone très vaste (${tiles} parties) : réduis la boîte, ou scoute en plusieurs fois.`
            : tiles > 1
                ? `Grande zone : la moisson se fera en ${tiles} parties, l’une après l’autre.`
                : 'Au-delà d’une certaine taille, la moisson se découpe automatiquement en parties.';
    }
}

function refreshRecap() {
    let found = 0, dup = 0, guess = 0;
    for (const c of _candidates) {
        if (!inBox(c)) { c._el?.classList.add('out'); continue; }
        c._el?.classList.remove('out');
        found++;
        if (c.dup) dup++; else if (!c.unknown) guess++;
    }
    const net = found - dup;
    const set = (sel, v) => { const el = _overlay?.querySelector(sel); if (el) el.textContent = v; };
    set('[data-scout-found]', found);
    set('[data-scout-guess]', guess);
    set('[data-scout-dup]', dup);
    set('[data-scout-net]', net);

    // Badge sous la boîte : non scanné / zone modifiée / compteur.
    const counttxt = _overlay?.querySelector('[data-scout-counttxt]');
    if (counttxt) {
        if (!_scannedBounds) counttxt.textContent = '—';
        else if (!boxWithin(_scannedBounds)) counttxt.textContent = 'zone modifiée · re-scanner';
        else counttxt.textContent = `${found} candidat${found > 1 ? 's' : ''}${dup ? ` · ${dup} doublon${dup > 1 ? 's' : ''}` : ''}`;
    }
    updatePrimary();
}

// ── Drag / resize (pixels) ───────────────────────────────────────────────────
function onPointerDown(e) {
    const handle = e.target.closest('.scout-handle');
    if (!handle && !e.target.closest('.scout-box')) return;
    e.preventDefault();
    _drag = { mode: handle ? handle.dataset.h : 'move', px: e.clientX, py: e.clientY, rect: geoToViewportRect(_box) };
    map.dragging.disable();
    try { _boxEl.setPointerCapture(e.pointerId); } catch (_) {}
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
}
function onPointerMove(e) {
    if (!_drag) return;
    const dx = e.clientX - _drag.px, dy = e.clientY - _drag.py;
    let { left, top, w, h } = _drag.rect;
    const m = _drag.mode;
    if (m === 'move') { left += dx; top += dy; }
    else {
        if (m.includes('e')) w = _drag.rect.w + dx;
        if (m.includes('s')) h = _drag.rect.h + dy;
        if (m.includes('w')) { w = _drag.rect.w - dx; left = _drag.rect.left + dx; }
        if (m.includes('n')) { h = _drag.rect.h - dy; top = _drag.rect.top + dy; }
        if (w < MIN_PX) { if (m.includes('w')) left -= (MIN_PX - w); w = MIN_PX; }
        if (h < MIN_PX) { if (m.includes('n')) top -= (MIN_PX - h); h = MIN_PX; }
    }
    const r = mapRect();
    left = Math.max(r.left, Math.min(left, r.right - w));
    top = Math.max(r.top, Math.min(top, r.bottom - h));
    w = Math.min(w, r.right - left); h = Math.min(h, r.bottom - top);
    _box = viewportRectToGeo({ left, top, w, h });
    render();
}
function onPointerUp() {
    _drag = null;
    map.dragging.enable();
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    persistBox(); // boîte redimensionnée/déplacée → mémoriser pour la destination
}

// ── Tracé de la boîte au glisser (réunif peaufinage) ───────────────────────────
// Pas de boîte par défaut, et pas de tracé armé d'office : plein écran, la couche
// de tracé masquait les contrôles Leaflet et bloquait pan/zoom — impossible de
// cadrer la carte AVANT de dessiner. L'admin arme le tracé via le bouton
// « Tracer la zone » du panneau ; une fois la boîte posée, la couche se désarme
// → carte pannable + boîte déplaçable normalement.
function setDrawArmed(on) {
    _drawArmed = on;
    render();          // (dés)active la couche de tracé selon _drawArmed
    updateTraceBtn();
}
function updateTraceBtn() {
    const btn = _overlay?.querySelector('[data-scout-trace]');
    if (!btn) return;
    btn.classList.toggle('is-armed', _drawArmed && !_box);
    const txt = btn.querySelector('[data-scout-trace-txt]');
    if (txt) txt.textContent = _box ? 'Retracer la zone' : (_drawArmed ? 'Annuler le tracé' : 'Tracer la zone');
}
function onDrawDown(e) {
    if (_box) return;
    e.preventDefault();
    _drawStart = { x: e.clientX, y: e.clientY };
    map.dragging.disable();
    try { _drawLayer.setPointerCapture(e.pointerId); } catch (_) {}
    document.addEventListener('pointermove', onDrawMove);
    document.addEventListener('pointerup', onDrawUp);
}
function onDrawMove(e) {
    if (!_drawStart) return;
    const r = mapRect();
    let left = Math.min(_drawStart.x, e.clientX), top = Math.min(_drawStart.y, e.clientY);
    let w = Math.abs(e.clientX - _drawStart.x), h = Math.abs(e.clientY - _drawStart.y);
    left = Math.max(r.left, left); top = Math.max(r.top, top);
    w = Math.min(w, r.right - left); h = Math.min(h, r.bottom - top);
    _box = viewportRectToGeo({ left, top, w, h });
    // Aperçu direct : on montre la boîte sans masquer la couche (capture en cours).
    _boxEl.classList.remove('is-hidden');
    _boxEl.style.left = left + 'px'; _boxEl.style.top = top + 'px';
    _boxEl.style.width = w + 'px'; _boxEl.style.height = h + 'px';
    updateReadout();
}
function onDrawUp() {
    document.removeEventListener('pointermove', onDrawMove);
    document.removeEventListener('pointerup', onDrawUp);
    map.dragging.enable();
    _drawStart = null;
    if (_box) {
        const rect = geoToViewportRect(_box);
        if (rect.w < MIN_PX || rect.h < MIN_PX) _box = null; // glisser trop court → annulé (on reste armé)
        else _drawArmed = false; // boîte posée → désarmé (navigation libre, ajustement par poignées)
    }
    render();          // boîte valide → affichée + couche masquée ; sinon → couche toujours armée
    updateTraceBtn();
    updatePrimary();
    persistBox();      // nouvelle boîte tracée (ou annulée) → mémoriser pour la destination
}

// ── Formulaire « Nouvelle destination… » (Scout v2) ──────────────────────────
// Ouvre/ferme le sous-formulaire de création (recherche Nominatim + « Créer »).
// Fermer réinitialise le contexte géocodé — la carte reste où elle est (inoffensif).
function setNewDestFormOpen(open) {
    const form = _overlay?.querySelector('[data-scout-newdest]');
    const toggle = _overlay?.querySelector('[data-scout-newdest-toggle]');
    if (form) form.hidden = !open;
    if (toggle) toggle.hidden = open;
    if (open) {
        _overlay?.querySelector('[data-scout-search]')?.focus();
        return;
    }
    _geocoded = false;
    _geoBBox = null; _geoName = ''; _geoCountry = '';
    const input = _overlay?.querySelector('[data-scout-search]');
    if (input) input.value = '';
    const fl = _overlay?.querySelector('[data-scout-found-label]');
    if (fl) { fl.hidden = true; fl.textContent = ''; }
    const create = _overlay?.querySelector('[data-scout-newdest-create]');
    if (create) create.disabled = true;
}

// Bouton primaire = machine à états : « Scanner la zone » par défaut ; après un
// scan frais avec des nouveaux dans la boîte → « Capturer N lieux » (réunif C1).
function updatePrimary() {
    const btn = _overlay?.querySelector('[data-scout-primary]');
    if (!btn) return;
    const label = btn.querySelector('[data-scout-primary-txt]');
    let found = 0, dup = 0;
    for (const c of _candidates) { if (inBox(c)) { found++; if (c.dup) dup++; } }
    const net = found - dup;
    const fresh = !!_scannedBounds && boxWithin(_scannedBounds);
    if (fresh && net > 0 && !_scanning) {
        btn.dataset.action = 'capture';
        if (label) label.textContent = `Capturer ${net} lieu${net > 1 ? 'x' : ''}`;
        btn.disabled = false;
    } else {
        btn.dataset.action = 'scan';
        if (label) label.textContent = 'Scanner la zone';
        btn.disabled = (_categories.size === 0) || _scanning || !_box;
    }
}

// La bbox Nominatim d'une ville est serrée (le bâti) → vue trop zoomée pour
// tracer une boîte de moisson autour. On garantit une fenêtre d'au moins
// MIN_VIEW_KM de côté, centrée sur le lieu — la bbox d'origine reste celle
// mémorisée pour les bounds du futur brouillon (_geoBBox).
function minViewBounds(south, north, west, east) {
    const latMid = (south + north) / 2;
    const kmPerLat = 111, kmPerLon = 111 * Math.cos(latMid * Math.PI / 180);
    const padLat = Math.max(0, MIN_VIEW_KM - (north - south) * kmPerLat) / kmPerLat / 2;
    const padLon = Math.max(0, MIN_VIEW_KM - (east - west) * kmPerLon) / kmPerLon / 2;
    return [[south - padLat, west - padLon], [north + padLat, east + padLon]];
}

// Formulaire « Nouvelle destination… » (réunif B2b → Scout v2) : géocode un lieu
// via Nominatim → vole la carte dessus. Mémorise le lieu (nom + bbox + pays) pour
// pré-remplir la création du brouillon (createDestinationDraft).
async function geocodeAndFly(query) {
    query = (query || '').trim();
    if (!query) return;
    const btn = _overlay?.querySelector('[data-scout-search-btn]');
    if (btn) btn.disabled = true;
    try {
        const res = await fetchWithTimeout(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!Array.isArray(data) || !data.length) { showToast(`Aucun lieu trouvé pour « ${query} ».`, 'warning', 3500); return; }
        const hit = data[0];
        const lat = parseFloat(hit.lat), lon = parseFloat(hit.lon);
        const bb = (hit.boundingbox || []).map(parseFloat); // [south, north, west, east]
        _geoName = hit.display_name || query;
        _geoCountry = hit.address?.country_code || '';
        if (bb.length === 4 && bb.every(Number.isFinite)) {
            _geoBBox = [[bb[0], bb[2]], [bb[1], bb[3]]]; // [[s,w],[n,e]] → bounds du futur brouillon
            map.fitBounds(minViewBounds(bb[0], bb[1], bb[2], bb[3]), { animate: false });
        } else if (Number.isFinite(lat) && Number.isFinite(lon)) {
            _geoBBox = null;
            map.fitBounds(minViewBounds(lat, lat, lon, lon), { animate: false });
        } else {
            showToast('Réponse Nominatim inattendue.', 'error', 3000); return;
        }
        // Zone neuve → on oublie le scan + la boîte (l'admin la retrace sur la zone).
        clearBox();
        _geocoded = true;
        updatePrimary();
        const fl = _overlay?.querySelector('[data-scout-found-label]');
        if (fl) { fl.hidden = false; fl.textContent = '📍 ' + _geoName.split(',').slice(0, 2).join(','); }
        const create = _overlay?.querySelector('[data-scout-newdest-create]');
        if (create) create.disabled = false;
    } catch (e) {
        showToast('Recherche indisponible (Nominatim). Réessaie.', 'error', 3500);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ── Boîte effacée → navigation libre (re-tracer = bouton « Tracer la zone ») ───
function clearBox() {
    _box = null;
    _drawArmed = false;
    clearCandidates();
    _scannedBounds = null;
    persistBox();      // « Retracer » : on oublie la boîte mémorisée (une nouvelle suivra)
    render();          // → boîte masquée, couche de tracé désarmée
    updateTraceBtn();
    updatePrimary();
}

// ── Pastilles candidates ──────────────────────────────────────────────────────
function clearCandidates() {
    for (const c of _candidates) c._el?.remove();
    _candidates = [];
}
function renderCandidates() {
    // Idempotent (rendu progressif tuile par tuile) : on repart des pastilles à zéro.
    _overlay.querySelectorAll('.scout-cand').forEach(el => el.remove());
    for (const c of _candidates) {
        // Réunif peaufinage : on n'affiche QUE les nouveaux. Les doublons restent
        // comptés dans le récap mais ne sont plus tracés (ils encombraient la carte).
        if (c.dup) { c._el = null; continue; }
        const el = document.createElement('span');
        el.className = 'scout-cand';
        el.title = c.unknown ? 'Catégorie non devinée' : (c.cat || '');
        c._el = el;
        _overlay.appendChild(el);
    }
    positionCandidates();
}

// ── Scan (moisson Overpass) ────────────────────────────────────────────────────
function buildQuery(b, cats) {
    const bb = `(${b.south},${b.west},${b.north},${b.east})`;
    const c = [];
    if (cats.has('religion')) { c.push(`nwr["amenity"="place_of_worship"]${bb};`); c.push(`way["building"~"mosque|church|synagogue"]${bb};`); }
    // P1 Niveau 1 : « Patrimoine historique » élargi (ouvrages défensifs, sites
    // funéraires, palais/monastères/aqueducs…) + patrimoine technique (`man_made`).
    if (cats.has('history')) {
        c.push(`nwr["historic"~"fort|castle|fortress|citadel|city_gate|citywalls|bastion|tower|archaeological_site|ruins|tomb|tumulus|mausoleum|monument|memorial|aqueduct|monastery|palace|manor|wayside_shrine|heritage"]${bb};`);
        c.push(`nwr["man_made"~"lighthouse|windmill|watermill|water_well"]${bb};`);
    }
    // « Musées & culture » : musées + artisanat traditionnel (poterie/tissage).
    if (cats.has('museum')) { c.push(`nwr["tourism"="museum"]${bb};`); c.push(`nwr["craft"~"pottery|weaving"]${bb};`); c.push(`nwr["shop"="pottery"]${bb};`); }
    if (cats.has('hotel')) c.push(`nwr["tourism"~"hotel|guest_house|hostel"]${bb};`);
    if (cats.has('restaurant')) c.push(`nwr["amenity"~"restaurant|cafe"]${bb};`);
    // « Tourisme & loisirs » = ex « Tourisme / Art » + ex « Loisirs / Parcs » fusionnés.
    if (cats.has('tourism')) { c.push(`nwr["tourism"~"viewpoint|artwork|attraction|gallery|theme_park|zoo|aquarium"]${bb};`); c.push(`nwr["leisure"~"park|water_park"]${bb};`); }
    if (cats.has('public')) c.push(`nwr["amenity"~"townhall|police|post_office|library"]${bb};`);
    return `[out:json][timeout:60];(${c.join('')});out center;`;
}

function showLoading(on, sub) {
    const el = _overlay?.querySelector('[data-scout-loading]');
    if (!el) return;
    el.classList.toggle('is-on', on); // classe (CSP-safe) — l'overlay n'a plus de style inline
    if (on && sub) { const s = el.querySelector('[data-scout-loadingsub]'); if (s) s.textContent = sub; }
}

async function scan() {
    if (_scanning || !_box) return;
    if (_categories.size === 0) { showToast('Sélectionne au moins une catégorie.', 'warning', 3000); return; }
    // Garde-fou géographique (Scout v2) : une boîte qui ne touche pas la
    // destination active = cible quasi sûrement erronée (leçon du test Hammamet :
    // 50 lieux capturés à 400 km injectés dans Djerba). On bloque en indiquant
    // le bon geste — le chevauchement partiel reste accepté.
    const destBounds = state.destinations?.maps?.[state.currentMapId]?.bounds;
    if (!boxIntersectsBounds(_box, destBounds)) {
        showToast(`La boîte est hors de « ${destName()} ». Pour scouter un autre endroit, crée d'abord sa destination (« Nouvelle destination… »).`, 'warning', 6000);
        return;
    }
    const tiles = computeTiles(_box);
    if (tiles.length > MAX_TILES) {
        showToast(`Zone trop vaste (${tiles.length} parties). Réduis la boîte ou scoute en plusieurs fois.`, 'warning', 4500);
        return;
    }
    const multi = tiles.length > 1;
    _scanning = true; updatePrimary();
    clearCandidates();
    const seen = new Set();   // dédup inter-tuiles (POI à cheval sur 2 bbox) par id OSM
    const all = [];
    // Index des objets OSM déjà représentés dans le data chargé, construit UNE fois
    // pour tout le scan (l'import ne se fait qu'à la capture : le data ne bouge pas
    // pendant la moisson) et reconstruit à chaque scan pour refléter les curations.
    const knownOsmRefs = collectKnownOsmRefs(state.loadedFeatures || []);
    let rejectedSkipped = 0;  // objets déjà rejetés (corbeille) ignorés — transparence au récap
    showLoading(true, multi ? `Moisson 1/${tiles.length}…` : 'Interrogation d’Overpass…');
    let pending = tiles.map((t, i) => ({ t, i }));  // tuiles restant à scanner
    let attempt = 0;
    const MAX_ATTEMPTS = 3;                          // re-tente AUTO les parties en échec (3 essais)
    try {
        // Séquentiel (une tuile à la fois) : poli pour Overpass (round-robin 3 mirrors).
        // Les tuiles en échec sont re-tentées automatiquement (jusqu'à 3 passes), avec
        // une pause entre chaque ; les tuiles réussies sont conservées (all/seen persistent).
        while (pending.length && attempt < MAX_ATTEMPTS) {
            attempt++;
            if (attempt > 1) {
                showLoading(true, `Nouvel essai des parties en échec (${pending.length})…`);
                await new Promise(r => setTimeout(r, 1500)); // pause : laisse Overpass respirer
                if (!_isOpen) return;
            }
            const stillFailed = [];
            for (const { t, i } of pending) {
                if (!_isOpen) return; // quitté entre deux tuiles
                if (multi) showLoading(true, `Moisson ${i + 1}/${tiles.length}… (${all.length} trouvés)`);
                let json = null;
                // Échec rapide par tuile (retries:0) ; on la retentera à la passe suivante.
                try { json = await fetchOverpassJson(buildQuery(t, _categories), { timeoutMs: 25000, retries: 0 }); }
                catch (e) { stillFailed.push({ t, i }); continue; }
                if (!_isOpen) return; // quitté pendant la requête
                for (const el of (json.elements || [])) {
                    const lat = el.lat ?? el.center?.lat;
                    const lon = el.lon ?? el.center?.lon;
                    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                    const key = el.type + '/' + el.id;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    // Tombstone de curation : objet déjà REJETÉ (supprimé puis poussé
                    // dans {dest}-rejected.json) → on ne le re-propose PAS (sinon le
                    // re-scan le ressort comme neuf). Compté pour le dire au récap
                    // (pas de masquage silencieux ; restauration via la corbeille).
                    if (isRejected(key)) { rejectedSkipped++; continue; }
                    const tags = el.tags || {};
                    const cat = getHwCategory(tags);
                    // Doublon si l'objet OSM est DÉJÀ porté par un POI chargé (identité
                    // osm_ref, quelle que soit la distance), sinon < 50 m d'un POI
                    // existant (règle #472) ou d'un candidat déjà retenu dans CE scan.
                    const dup = isDuplicateCandidate(
                        { lat, lon, osmRef: key },
                        { knownOsmRefs, features: state.loadedFeatures || [], retained: all },
                    );
                    // P5 — routage FR/AR du nom OSM (évite qu'un nom arabe atterrisse
                    // dans le champ français). Logique pure testée dans scout-categories.
                    const { nameFr, nameAr } = resolveOsmNames(tags);
                    // osmRef = identité OSM stable (« node/123 ») portée jusqu'au POI
                    // capturé → permet de tombstoner le bon objet à la suppression,
                    // de le skipper au re-scan (chantier rejets/corbeille) et de le
                    // reconnaître comme déjà représenté (règle 1 de scout-dedup).
                    all.push({ lat, lon, cat, unknown: !cat, dup, nameFr, nameAr, osmRef: key });
                }
                _candidates = all;
                renderCandidates(); // rendu progressif : les pastilles apparaissent tuile par tuile
                refreshRecap();
            }
            pending = stillFailed; // on ne retente QUE les tuiles encore en échec
        }
        _scannedBounds = { ..._box };
        persistBox();   // la boîte scannée devient la « boîte de la destination » (mémorisée)
        refreshRecap(); // badge final : les refresh en boucle tournaient avant que _scannedBounds soit posé
        const net = all.filter(c => inBox(c) && !c.dup).length;
        const failed = pending.length;
        // Transparence : on dit combien d'objets déjà rejetés (corbeille) ont été
        // ignorés, pour que l'admin ne se demande pas pourquoi un lieu attendu manque.
        const rej = rejectedSkipped
            ? ` · ${rejectedSkipped} déjà rejeté${rejectedSkipped > 1 ? 's' : ''} ignoré${rejectedSkipped > 1 ? 's' : ''}`
            : '';
        if (failed === tiles.length) {
            showToast(multi ? 'Overpass indisponible sur toutes les parties. Réessaie.' : 'Overpass indisponible (timeout/erreur). Réessaie ou réduis la boîte.', 'error', 4500);
        } else if (failed) {
            showToast(`${all.length} objets · ${net} nouveaux${rej}. ⚠ ${failed}/${tiles.length} partie(s) toujours en échec après ${MAX_ATTEMPTS} essais — réduis la boîte ou réessaie.`, 'warning', 5500);
        } else {
            showToast(`${all.length} objet${all.length > 1 ? 's' : ''} OSM · ${net} nouveau${net > 1 ? 'x' : ''} à importer${rej}.`, 'success', 3000);
        }
    } finally {
        _scanning = false; updatePrimary();
        showLoading(false);
    }
}

// Réunif C1 + Scout v2 : « Capturer » → les candidats non-doublons dans la boîte
// deviennent des POIs PERSISTANTS `candidate:true` de la DESTINATION ACTIVE
// (addPoiFeature → customPois_{id}, le canal canonique lu par la publication,
// cf. publish-destination.js — valable pour une dest publiée COMME un brouillon).
// draft:false → jamais poussés tant que non validés (le tri = C1b).
async function capture() {
    if (_scanning) return;
    const fresh = !!_scannedBounds && boxWithin(_scannedBounds);
    const toCapture = _candidates.filter(c => inBox(c) && !c.dup);
    if (!fresh || !toCapture.length) return;

    // Garde-fou zonage (PR B) : ÉTENDRE les zones OSM à la boîte de capture. La Zone
    // d'un POI se dérive désormais à la volée (dégel, getDerivedZone) du jeu de
    // quartiers `zonesData` — donc compléter ce jeu ici suffit à ce que les captures
    // hors de la bbox (souvent plus serrée que le cadre scouté) ne tombent pas « Hors
    // zone ». try/catch SÉPARÉ et NON bloquant : un échec réseau Overpass ne doit pas
    // empêcher la capture.
    if (_box) {
        try {
            const bbox = [[_box.south, _box.west], [_box.north, _box.east]];
            const country = _geoCountry || state.destinations?.maps?.[state.currentMapId]?.country || '';
            const fc = await fetchZonesAuto(bbox, country);
            const seen = new Set((zonesData.features || []).map(f => f.properties?.osm_id).filter(v => v != null));
            const added = (fc.features || []).filter(f => f.properties?.osm_id == null || !seen.has(f.properties.osm_id));
            if (added.length) {
                const merged = { type: 'FeatureCollection', features: [...(zonesData.features || []), ...added] };
                setZonesData(merged);
                // PERSISTANCE DURABLE DES QUARTIERS (P9) — « les quartiers suivent les
                // POI dès la capture ». La création ne pousse les quartiers que pour un
                // halo de ~25 km autour de la ville (MIN_VIEW_KM) ; une dest qui s'étale
                // au-delà laissait sa couronne de POI « Hors zone » au reload (admin ET
                // visiteur). On rend donc l'extension durable TOUT DE SUITE, GARDÉE PAR
                // LE DELTA (`added.length` — on est déjà dedans) :
                //   • re-scouter d'AUTRES catégories sur le MÊME cadre → quartiers déjà
                //     connus → `added` vide → on ne ré-entre pas ici → AUCUN push. Donc
                //     #push = #zones DISTINCTES capturées, pas #captures : pas « bavard »
                //     malgré le push à la capture (l'ancien refus de pousser supposait un
                //     push inconditionnel).
                //   • dest GitHub (modèle C, custom:false) → push {id}-zones.geojson
                //     (token requis ; en scout on est toujours connecté — créer/publier
                //     l'exigent déjà). Échec/sans token → extension gardée en RAM, le
                //     bouton « Compléter les quartiers » reste le secours.
                //   • brouillon LOCAL legacy (custom:true) → cache IndexedDB.
                const isCustom = state.destinations?.maps?.[state.currentMapId]?.custom === true;
                if (isCustom) {
                    try { await saveDraftZones(state.currentMapId, merged); } catch (_) { /* best-effort */ }
                } else if (getStoredToken()) {
                    try {
                        await pushDestinationZones(state.currentMapId, merged);
                    } catch (e) {
                        console.warn('[scout] push des quartiers à la capture échoué (extension gardée en RAM) :', e);
                    }
                }
            }
        } catch (e) {
            console.warn('[scout] extension des zones à la boîte de capture échouée :', e);
        }
    }

    const n = toCapture.length;
    let saved = 0;
    try {
        for (const c of toCapture) {
            await addPoiFeature({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
                properties: {
                    'Nom du site FR': c.nameFr || '',
                    // P5 : clé arabe écrite seulement si présente (geojson propre).
                    ...(c.nameAr ? { 'Nom du site arabe': c.nameAr } : {}),
                    'Catégorie': c.cat || 'A définir',
                    // osm_ref : identité OSM stable conservée → si l'admin supprime ce
                    // candidat, on tombstone le BON objet (rejected.js) pour qu'il ne
                    // soit pas re-proposé au re-scan. Écrit seulement si présent.
                    ...(c.osmRef ? { osm_ref: c.osmRef } : {}),
                    // Dégel de Zone : on ne fige plus le quartier à la capture — il se
                    // dérive de la position (getDerivedZone). L'extension du fichier de
                    // zones ci-dessus reste nécessaire pour QUE la dérivation matche.
                    candidate: true,
                },
            }, { draft: false });
            saved++;
        }
    } catch (e) {
        // Échec d'écriture en cours de boucle (IndexedDB pleine/fermée — audit
        // R5) : sans ce catch la capture partielle était MUETTE. On nettoie
        // comme en succès (un re-scan re-marquera les déjà-écrits en doublons,
        // donc pas de double capture) mais on dit la vérité.
        console.warn('[scout] capture interrompue :', e);
        clearCandidates();
        _scannedBounds = null;
        refreshRecap();
        showToast(`Capture interrompue : ${saved}/${n} lieu(x) enregistré(s). Relance un scan pour capturer le reste.`, 'error', 5000);
        return;
    }
    // Les candidats deviennent de vrais marqueurs sur la carte → on retire les
    // pastilles éphémères et on repart « à zéro » pour un éventuel nouveau scan.
    clearCandidates();
    _scannedBounds = null;
    refreshRecap();
    showToast(`${n} lieu${n > 1 ? 'x' : ''} capturé${n > 1 ? 's' : ''} en candidat${n > 1 ? 's' : ''} — à curer (tri à venir).`, 'success', 3800);
}

// Scout v2 (flux inversé) : crée une DESTINATION BROUILLON locale VIDE — aucun
// POI, les lieux arrivent ensuite par les captures sur la destination devenue
// active. Récupère les ZONES admin OSM (niveau déduit du pays géocodé) puis bascule
// dessus (rechargement ?map={id}). MODÈLE C : la création POUSSE directement sur
// GitHub (entrée status:'draft' + geojson vide + zones + index circuits) ; le boot
// admin relit l'API GitHub fraîche. Bounds = fenêtre élargie à MIN_VIEW_KM autour du
// lieu géocodé : la bbox Nominatim d'une ville (son bâti) est trop serrée pour le
// cadrage d'une destination qui s'étendra autour.
async function createDestinationDraft() {
    if (!_geocoded) return;
    // MODÈLE C : la création écrit sur GitHub (entrée draft + fichiers) → token REQUIS.
    // On garde AVANT de demander le nom et de moissonner les zones, pour ne pas faire
    // saisir/attendre l'admin pour rien.
    if (!getStoredToken()) {
        showToast('Connecte ton token GitHub (Centre de Contrôle › Connexion) pour créer une destination.', 'warning', 4500);
        return;
    }
    const suggested = (_geoName || '').split(',')[0].trim();
    const name = await hwPrompt({
        title: 'Nouvelle destination',
        body: 'Créer une destination <strong>vide</strong> (brouillon, masquée du public) — tu scoutes ses lieux juste après, dessus. Nom de la destination :',
        defaultValue: suggested,
        placeholder: 'ex. Varna, Sozopol, Trapani…',
        confirmLabel: 'Créer le brouillon',
    });
    if (name === null) return;                       // annulé
    const trimmed = name.trim();
    if (!trimmed) { showToast('Nom vide — création annulée.', 'warning', 3000); return; }

    const id = await makeUniqueDestId(trimmed);
    const raw = _geoBBox || (() => { const c = map.getCenter(); return [[c.lat, c.lng], [c.lat, c.lng]]; })();
    const bounds = minViewBounds(raw[0][0], raw[1][0], raw[0][1], raw[1][1]);

    // Zones admin OSM : niveau déduit du pays géocodé. Échec/timeout → zones vides,
    // la création continue (non bloquant — complétables via « Compléter les quartiers »).
    showLoading(true, 'Zones administratives (OSM)…');
    let zones = { type: 'FeatureCollection', features: [] };
    try { zones = await fetchZonesAuto(bounds, _geoCountry); } catch (_) {}
    showLoading(false);

    const center = map.getCenter();
    const entry = {
        name: trimmed,
        bounds,
        startView: { center: [center.lat, center.lng], zoom: map.getZoom() },
        currency: '',
        country: _geoCountry || '',   // code pays ISO → niveau admin des zones OSM (re-scan/recalcul)
    };

    // Push GitHub ATOMIQUE : registerDraftDestinationOnGitHub pousse les données puis
    // destinations.json EN DERNIER (anti-orphelin). On ne reflète l'état en mémoire et
    // on ne bascule QU'EN CAS DE SUCCÈS COMPLET → l'état mémoire ne diverge jamais de
    // GitHub (pas de zombie, pas d'écriture IndexedDB locale). Échec → on s'arrête net.
    showLoading(true, 'Création sur GitHub…');
    let res;
    try {
        res = await registerDraftDestinationOnGitHub(id, entry, zones, (msg) => showLoading(true, msg));
    } catch (e) {
        showLoading(false);
        showToast(`Échec de la création sur GitHub : ${e.message}`, 'error', 5000);
        return;
    }
    showLoading(false);

    // Reflet mémoire immédiat (avant reload). `&scout=1` → le boot rouvre le Scout
    // DESSUS (main.js, patron ?poi=) ; le boot admin relit l'API GitHub fraîche (A1)
    // → la dest apparaît sans attendre le redéploiement Pages (~1-2 min).
    if (!state.destinations) state.destinations = { activeMapId: 'djerba', maps: {} };
    if (!state.destinations.maps) state.destinations.maps = {};
    state.destinations.maps[id] = { ...res.entry, custom: false };

    try { localStorage.setItem('hw_active_dest', id); } catch (_) {}
    const zTxt = zones.features.length ? ` · ${zones.features.length} zone${zones.features.length > 1 ? 's' : ''} OSM` : '';
    showToast(`Destination « ${trimmed} » créée${zTxt}. Bascule — le Scout rouvre dessus pour la remplir.`, 'success', 3200);
    setTimeout(() => { location.href = `${location.pathname}?map=${encodeURIComponent(id)}&scout=1`; }, 650);
}

// ── Shell ─────────────────────────────────────────────────────────────────────
function destName() {
    const id = state.currentMapId;
    return state.destinations?.maps?.[id]?.name || id || '—';
}

function renderShell() {
    _categories = new Set(CATEGORIES.filter(c => c.on).map(c => c.key));
    _overlay = document.createElement('div');
    _overlay.className = 'scout-overlay';
    _overlay.innerHTML = `
        <div class="scout-box" data-scout-box>
            <span class="scout-dim"><i data-lucide="crop"></i><span data-scout-dimtxt>—</span></span>
            <span class="scout-handle nw" data-h="nw"></span><span class="scout-handle ne" data-h="ne"></span>
            <span class="scout-handle sw" data-h="sw"></span><span class="scout-handle se" data-h="se"></span>
            <span class="scout-handle n" data-h="n"></span><span class="scout-handle s" data-h="s"></span>
            <span class="scout-handle e" data-h="e"></span><span class="scout-handle w" data-h="w"></span>
            <span class="scout-count"><i data-lucide="scan-eye"></i><span data-scout-counttxt>—</span></span>
        </div>
        <div class="scout-draw" data-scout-draw><span class="scout-draw-hint"><i data-lucide="crop"></i>Trace ta zone : clique-glisse sur la carte</span></div>
        <aside class="scout-panel">
            <div class="scout-panel-hd">
                <span class="ic"><i data-lucide="scan-eye"></i></span>
                <div class="scout-hd-main"><h4>Capturer une zone</h4><div class="sub">Moisson OpenStreetMap</div></div>
                <button class="scout-quit" type="button" data-scout-quit><i data-lucide="x"></i>Quitter</button>
            </div>
            <div class="scout-panel-bd">
                <div>
                    <label class="scout-lbl">Destination</label>
                    <button class="dest-sel" type="button" disabled>
                        <span class="ic"><i data-lucide="map"></i></span>
                        <span class="scout-dest-main"><span class="nm" data-scout-destname>—</span><span class="ct" data-scout-deststatus>—</span></span>
                    </button>
                    <button class="btn btn-ghost scout-newdest-btn" type="button" data-scout-newdest-toggle><i data-lucide="map-pin"></i>Nouvelle destination…</button>
                    <div class="scout-newdest" data-scout-newdest hidden>
                        <div class="scout-search">
                            <input type="search" data-scout-search placeholder="Ville, région, île…" autocomplete="off">
                            <button class="scout-search-btn" data-scout-search-btn type="button" title="Rechercher" aria-label="Rechercher le lieu"><i data-lucide="search"></i></button>
                        </div>
                        <div class="scout-found" data-scout-found-label hidden></div>
                        <div class="scout-newdest-actions">
                            <button class="btn btn-ghost" type="button" data-scout-newdest-cancel>Annuler</button>
                            <button class="btn btn-primary" type="button" data-scout-newdest-create disabled><i data-lucide="plus"></i>Créer le brouillon</button>
                        </div>
                    </div>
                </div>
                <div>
                    <label class="scout-lbl">Zone à moissonner</label>
                    <button class="btn btn-secondary scout-trace-btn" type="button" data-scout-trace><i data-lucide="crop"></i><span data-scout-trace-txt>Tracer la zone</span></button>
                </div>
                <div>
                    <label class="scout-lbl">Catégories à moissonner</label>
                    <div class="scout-cats">
                        ${CATEGORIES.map(c => `<label class="scout-cat"><input type="checkbox" data-scout-cat="${c.key}"${c.on ? ' checked' : ''}><span>${c.label}</span></label>`).join('')}
                    </div>
                </div>
                <div class="scout-recap">
                    <div class="rr cand"><span class="k"><i data-lucide="scan-eye"></i>Candidats dans la boîte</span><span class="v" data-scout-found>0</span></div>
                    <div class="rr"><span class="k"><i data-lucide="tags"></i>Catégorie devinée</span><span class="v" data-scout-guess>0</span></div>
                    <div class="rr dup"><span class="k"><i data-lucide="copy"></i>Doublons écartés</span><span class="v" data-scout-dup>0</span></div>
                    <div class="rr scout-recap-net"><span class="k"><i data-lucide="plus"></i>Nouveaux à importer</span><span class="v" data-scout-net>0</span></div>
                </div>
                <div class="scout-note" data-scout-note><i data-lucide="info"></i><span data-scout-notetxt>Overpass peut être lent sur une grande zone. Garde la boîte raisonnablement petite — tu pourras repasser à côté.</span></div>
            </div>
            <div class="scout-panel-ft">
                <button class="btn btn-ghost scout-ft-btn" type="button" data-scout-reset><i data-lucide="rotate-ccw"></i>Réinit.</button>
                <button class="btn btn-primary scout-ft-btn scout-ft-btn--primary" type="button" data-scout-primary><i data-lucide="scan-eye"></i><span data-scout-primary-txt>Scanner la zone</span></button>
            </div>
        </aside>
        <div class="scout-loading" data-scout-loading><span class="spin"></span><div><div class="scout-loading-title">Moisson en cours…</div><div class="scout-loading-sub" data-scout-loadingsub>Interrogation d’Overpass…</div></div></div>
    `;
    document.body.appendChild(_overlay);
    document.body.classList.add('scout-active');
    _boxEl = _overlay.querySelector('[data-scout-box]');
    _drawLayer = _overlay.querySelector('[data-scout-draw]');

    // On (re)cale la carte puis on POSE une boîte : la « boîte de la destination »
    // mémorisée (dernier scan) si elle est encore dans la destination, sinon une
    // boîte par défaut centrée sur la vue → « Scanner la zone » est actif tout de
    // suite (ajustable aux poignées, ou « Retracer » pour une autre zone). La carte
    // reste pannable autour de la boîte.
    setTimeout(() => {
        try { map.invalidateSize(); } catch (_) {}
        const destBounds = state.destinations?.maps?.[state.currentMapId]?.bounds;
        const saved = loadSavedBox();
        _box = (saved && boxIntersectsBounds(saved, destBounds)) ? saved : defaultBox();
        render();
        updatePrimary();
    }, 80);

    _overlay.querySelector('[data-scout-destname]').textContent = destName();
    // Statut de la dest active (modèle 2-phases Option A) : publiée, sinon brouillon
    // LOCAL (IDB). Plus de « brouillon GitHub » intermédiaire — une dest non publiée
    // sur laquelle on scoute est forcément un brouillon local (custom).
    const activeDest = state.destinations?.maps?.[state.currentMapId];
    _overlay.querySelector('[data-scout-deststatus]').textContent =
        isDestinationPublished(activeDest) ? 'publiée' : 'brouillon local';
    _overlay.querySelector('[data-scout-quit]').addEventListener('click', stopScout);
    _overlay.querySelector('[data-scout-reset]').addEventListener('click', clearBox);
    // Boîte posée → « Retracer » (efface + ré-arme) ; sinon toggle armer/annuler.
    _overlay.querySelector('[data-scout-trace]').addEventListener('click', () => {
        if (_box) { clearBox(); setDrawArmed(true); }
        else setDrawArmed(!_drawArmed);
    });
    _overlay.querySelector('[data-scout-primary]').addEventListener('click', (e) => {
        (e.currentTarget.dataset.action === 'capture') ? capture() : scan();
    });
    _overlay.querySelector('[data-scout-newdest-toggle]').addEventListener('click', () => setNewDestFormOpen(true));
    _overlay.querySelector('[data-scout-newdest-cancel]').addEventListener('click', () => setNewDestFormOpen(false));
    _overlay.querySelector('[data-scout-newdest-create]').addEventListener('click', createDestinationDraft);
    _overlay.querySelectorAll('[data-scout-cat]').forEach(cb =>
        cb.addEventListener('change', () => {
            if (cb.checked) _categories.add(cb.dataset.scoutCat); else _categories.delete(cb.dataset.scoutCat);
            updatePrimary();
        }));
    const searchInput = _overlay.querySelector('[data-scout-search]');
    _overlay.querySelector('[data-scout-search-btn]')?.addEventListener('click', () => geocodeAndFly(searchInput?.value));
    searchInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); geocodeAndFly(searchInput.value); } });
    _boxEl.addEventListener('pointerdown', onPointerDown);
    _drawLayer.addEventListener('pointerdown', onDrawDown);
    _onMapMove = () => render();
    map.on('move zoom zoomanim resize', _onMapMove);
    updateTraceBtn();
    updatePrimary();

    createIcons({ icons: appIcons, root: _overlay });
}

// Point d'entrée public — bouton « Scout » du Control Center.
export function startScout() {
    if (_isOpen) return;
    if (!state.isAdmin) { showToast("Outil réservé à l'admin.", 'warning', 3000); return; }
    if (!state.currentMapId) { showToast('Aucune destination active.', 'warning', 3000); return; }
    _isOpen = true;
    _candidates = [];
    _scannedBounds = null;
    _drawArmed = false;
    _geocoded = false;
    _geoBBox = null; _geoName = ''; _geoCountry = '';
    renderShell();
}

export function stopScout() {
    if (!_isOpen) return;
    if (_drag) onPointerUp();
    if (_drawStart) onDrawUp(); // tracé en cours → on clôt proprement (retire les listeners)
    if (_onMapMove) { map.off('move zoom zoomanim resize', _onMapMove); _onMapMove = null; }
    clearCandidates();
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null; _boxEl = null; _drawLayer = null; _box = null; _scannedBounds = null; _drawArmed = false;
    document.body.classList.remove('scout-active');
    setTimeout(() => { try { map.invalidateSize(); } catch (_) {} }, 80);
    _isOpen = false; _scanning = false;
}
