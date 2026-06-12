// scout.js — Scout in-app (admin). Réunification Lot B.
//
// Successeur in-app de tools/scout.html (supprimé en Lot C). Mode FOCALISÉ plein
// écran : topbar + sidebar masquées, vraie carte assombrie, panneau gauche + une
// BOÎTE bbox déplaçable/redimensionnable (8 poignées) sur la carte. Gated isAdmin.
//
// Découpage :
//   B1 — coquille + boîte + cote km live.
//   B2 (ici) — MOISSON : cases catégories + « Scanner » → requête Overpass bbox
//        (osm-overpass.js mutualisé) → mapping OSM→taxo + dédup vs data chargé →
//        pastilles candidates + récap (candidats/devinés/doublons/nouveaux).
//        Ajuster la boîte re-filtre les candidats déjà récupérés EN DIRECT
//        (sans re-requêter) ; sortir de la zone scannée → invite à re-scanner.
//   B2b — nouvelle zone (recherche Nominatim → flyTo). B3 — capture en candidats.
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
import { getZoneFromCoords, generateHWID } from './utils.js';
import { hwPrompt } from './modal.js';
import { createLocalDraftDestination, makeUniqueDestId } from './local-destinations.js';
import { fetchZonesAuto, zoneNameForPoint } from './osm-zones.js';

let _overlay = null;
let _boxEl = null;
let _isOpen = false;
let _mode = 'repasse';          // 'new' | 'repasse'
let _box = null;                // { north, south, east, west } — source de vérité
let _drag = null;               // état drag/resize en cours
let _onMapMove = null;          // resync boîte + pastilles sur pan/zoom
let _drawLayer = null;          // couche de tracé (active tant qu'aucune boîte n'existe)
let _drawStart = null;          // point de départ (px) du tracé de la boîte au glisser
let _categories = null;         // Set des clés de catégorie cochées
let _candidates = [];           // résultats du dernier scan : {lat,lon,cat,unknown,dup,name,_el}
let _scannedBounds = null;      // bounds de la boîte au moment du scan (détection « zone modifiée »)
let _scanning = false;
let _geocoded = false;          // mode Nouvelle : une recherche Nominatim a-t-elle volé la carte ?
let _geoBBox = null;            // mode Nouvelle : bbox [[s,w],[n,e]] du lieu géocodé → bounds du brouillon
let _geoName = '';              // mode Nouvelle : nom du lieu géocodé → pré-remplit le nom de la destination
let _geoCountry = '';           // mode Nouvelle : code pays ISO (Nominatim) → niveau admin des zones OSM

const MIN_PX = 46;              // taille mini de la boîte à l'écran (poignées utilisables)
const DEDUP_M = 50;             // un candidat à < 50 m d'un POI existant = doublon (règle #472)
const TILE_KM = 25;             // côté max d'une tuile (km). Djerba (~18 km) tient en 1 passe — comme
                                // l'ancien Scout (1 bbox). Le découpage ne sert que pour des boîtes
                                // VRAIMENT vastes (multi-destinations). Réunif B2c, relevé 5→25.
const MAX_TILES = 36;           // garde-fou : au-delà, zone trop vaste → on refuse

// Catégories de moisson (clés alignées sur les clauses Overpass + libellés UI).
// Cochées par défaut : Religion / Histoire / Culture (comme la maquette).
const CATEGORIES = [
    { key: 'religion', label: 'Religion (Mosquées)', on: true },
    { key: 'history', label: 'Histoire (Forts, Ruines)', on: true },
    { key: 'museum', label: 'Culture (Musées)', on: true },
    { key: 'hotel', label: 'Hôtels', on: false },
    { key: 'restaurant', label: 'Restos / Cafés', on: false },
    { key: 'leisure', label: 'Loisirs / Parcs', on: false },
    { key: 'tourism', label: 'Tourisme / Art', on: false },
    { key: 'public', label: 'Services Publics', on: false },
];

// OSM tag → catégorie Heripia (porté de tools/scout.html).
const HW_MAPPING = {
    place_of_worship: 'Mosquée', museum: 'Culture et tradition',
    fort: 'Site historique', castle: 'Site historique', ruins: 'Site historique',
    archaeological_site: 'Site historique', hotel: 'Hôtel', guest_house: 'Hôtel',
    restaurant: 'Restaurant', cafe: 'Restaurant', theme_park: 'Curiosité',
    zoo: 'Curiosité', viewpoint: 'Curiosité', artwork: 'Curiosité',
    attraction: 'Curiosité', monument: 'Site historique', memorial: 'Site historique',
};
function getHwCategory(tags) {
    if (tags.building === 'mosque') return 'Mosquée';
    if (tags.building === 'synagogue') return 'Site religieux';
    if (tags.building === 'church') return 'Site religieux';
    if (tags.amenity === 'place_of_worship') {
        if (tags.religion === 'muslim') return 'Mosquée';
        if (tags.religion === 'christian' || tags.religion === 'jewish') return 'Site religieux';
        return 'Mosquée';
    }
    const raw = tags.historic || tags.tourism || tags.amenity || tags.leisure;
    return HW_MAPPING[raw] || null; // null = catégorie non devinée
}

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

// ── Géométrie / dédup ────────────────────────────────────────────────────────
function haversineM(aLat, aLon, bLat, bLon) {
    const R = 6371000, toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(bLat - aLat), dLng = toRad(bLon - aLon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
// Règle #472 (validée Stefan 07/05) : on ne RECRÉE jamais un POI existant —
// candidat à < 50 m d'un POI du data chargé = doublon, écarté de l'import.
function isAlreadyInData(lat, lon) {
    const feats = state.loadedFeatures || [];
    return feats.some(f => {
        const c = f.geometry?.coordinates;
        return Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])
            && haversineM(lat, lon, c[1], c[0]) < DEDUP_M;
    });
}
function inBox(c) {
    return _box && c.lat <= _box.north && c.lat >= _box.south && c.lon >= _box.west && c.lon <= _box.east;
}
function boxWithin(outer) {
    return outer && _box && _box.north <= outer.north && _box.south >= outer.south
        && _box.west >= outer.west && _box.east <= outer.east;
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
    // Pas de boîte → boîte masquée + couche de tracé active (l'admin la dessine).
    _boxEl.classList.toggle('is-hidden', !hasBox);
    if (_drawLayer) _drawLayer.classList.toggle('is-on', !hasBox);
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
}

// ── Tracé de la boîte au glisser (réunif peaufinage) ───────────────────────────
// Pas de boîte par défaut : l'admin la dessine sur la carte. `_drawLayer` ne
// capture les pointeurs QUE tant qu'aucune boîte n'existe (.is-on) ; une fois la
// boîte tracée, elle s'efface → carte pannable + boîte déplaçable normalement.
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
        if (rect.w < MIN_PX || rect.h < MIN_PX) _box = null; // glisser trop court → annulé
    }
    render();          // boîte valide → affichée + couche masquée ; sinon → couche réactivée
    updatePrimary();
}

// ── Mode + catégories ─────────────────────────────────────────────────────────
function setMode(m) {
    _mode = m;
    _overlay?.querySelector('[data-scout-mode="new"]')?.classList.toggle('is-on', m === 'new');
    _overlay?.querySelector('[data-scout-mode="repasse"]')?.classList.toggle('is-on', m === 'repasse');
    _boxEl?.classList.toggle('is-repasse', m === 'repasse');
    const destmode = _overlay?.querySelector('[data-scout-destmode]');
    if (destmode) destmode.textContent = m === 'repasse' ? 'publiée · repasse' : 'nouveau brouillon';
    // Repasse : dest. publiée courante (lecture seule) ; Nouvelle : recherche Nominatim.
    const repasseEl = _overlay?.querySelector('[data-scout-dest-repasse]');
    const newEl = _overlay?.querySelector('[data-scout-dest-new]');
    if (repasseEl) repasseEl.hidden = (m !== 'repasse');
    if (newEl) newEl.hidden = (m !== 'new');
    // Changement de contexte → on oublie le scan précédent.
    _geocoded = false;
    _geoBBox = null; _geoName = ''; _geoCountry = '';
    const fl = _overlay?.querySelector('[data-scout-found-label]');
    if (fl) { fl.hidden = true; fl.textContent = ''; }
    clearCandidates();
    _scannedBounds = null;
    refreshRecap();
    updatePrimary();
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
        // Mode Nouvelle : Scanner désactivé tant qu'aucune recherche n'a volé
        // la carte (sinon la boîte est encore sur la destination active).
        btn.disabled = (_categories.size === 0) || _scanning || !_box || (_mode === 'new' && !_geocoded);
    }
}

// Mode Nouvelle (réunif B2b) : géocode un lieu via Nominatim → vole la carte
// dessus → recentre la boîte. Mémorise le lieu (nom + bbox) pour pré-remplir la
// création du brouillon de destination au moment de « Capturer » (C2a-2).
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
            map.fitBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { maxZoom: 16, animate: false });
        } else if (Number.isFinite(lat) && Number.isFinite(lon)) {
            _geoBBox = null;
            map.setView([lat, lon], 14, { animate: false });
        } else {
            showToast('Réponse Nominatim inattendue.', 'error', 3000); return;
        }
        // Zone neuve → on oublie le scan + la boîte (l'admin la retrace sur la zone).
        clearBox();
        _geocoded = true;
        updatePrimary();
        const fl = _overlay?.querySelector('[data-scout-found-label]');
        if (fl) { fl.hidden = false; fl.textContent = '📍 ' + _geoName.split(',').slice(0, 2).join(','); }
    } catch (e) {
        showToast('Recherche indisponible (Nominatim). Réessaie.', 'error', 3500);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ── Boîte effacée → mode tracé (l'admin la dessine au glisser) ─────────────────
function clearBox() {
    _box = null;
    clearCandidates();
    _scannedBounds = null;
    render();          // → boîte masquée + couche de tracé active
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
    if (cats.has('history')) c.push(`nwr["historic"~"fort|castle|ruins|archaeological_site|monument|memorial"]${bb};`);
    if (cats.has('museum')) c.push(`nwr["tourism"="museum"]${bb};`);
    if (cats.has('hotel')) c.push(`nwr["tourism"~"hotel|guest_house|hostel"]${bb};`);
    if (cats.has('restaurant')) c.push(`nwr["amenity"~"restaurant|cafe"]${bb};`);
    if (cats.has('leisure')) { c.push(`nwr["leisure"~"park|water_park"]${bb};`); c.push(`nwr["tourism"~"theme_park|zoo|aquarium"]${bb};`); }
    if (cats.has('tourism')) c.push(`nwr["tourism"~"viewpoint|artwork|attraction|gallery"]${bb};`);
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
                    const tags = el.tags || {};
                    const cat = getHwCategory(tags);
                    // Doublon si < 50 m d'un POI EXISTANT (règle #472) OU d'un candidat
                    // déjà retenu dans CE scan : OSM a parfois 2 entrées au même lieu
                    // (ex. mosquée dédoublée). On garde la 1ʳᵉ, on écarte la 2ᵉ.
                    const dup = isAlreadyInData(lat, lon)
                        || all.some(c => !c.dup && haversineM(lat, lon, c.lat, c.lon) < DEDUP_M);
                    all.push({ lat, lon, cat, unknown: !cat, dup, name: tags.name || tags['name:fr'] || '' });
                }
                _candidates = all;
                renderCandidates(); // rendu progressif : les pastilles apparaissent tuile par tuile
                refreshRecap();
            }
            pending = stillFailed; // on ne retente QUE les tuiles encore en échec
        }
        _scannedBounds = { ..._box };
        refreshRecap(); // badge final : les refresh en boucle tournaient avant que _scannedBounds soit posé
        const net = all.filter(c => inBox(c) && !c.dup).length;
        const failed = pending.length;
        if (failed === tiles.length) {
            showToast(multi ? 'Overpass indisponible sur toutes les parties. Réessaie.' : 'Overpass indisponible (timeout/erreur). Réessaie ou réduis la boîte.', 'error', 4500);
        } else if (failed) {
            showToast(`${all.length} objets · ${net} nouveaux. ⚠ ${failed}/${tiles.length} partie(s) toujours en échec après ${MAX_ATTEMPTS} essais — réduis la boîte ou réessaie.`, 'warning', 5500);
        } else {
            showToast(`${all.length} objet${all.length > 1 ? 's' : ''} OSM · ${net} nouveau${net > 1 ? 'x' : ''} à importer.`, 'success', 3000);
        }
    } finally {
        _scanning = false; updatePrimary();
        showLoading(false);
    }
}

// Réunif C1 : « Capturer » → les candidats non-doublons dans la boîte deviennent
// des POIs PERSISTANTS `candidate:true` (IndexedDB admin, via addPoiFeature).
// draft:false → jamais poussés tant que non validés (le tri = C1b).
//   - Repasse  : alimente la destination active (existante).
//   - Nouvelle : crée une destination BROUILLON locale (C2a-2, voir ci-dessous).
async function capture() {
    if (_scanning) return;
    const fresh = !!_scannedBounds && boxWithin(_scannedBounds);
    const toCapture = _candidates.filter(c => inBox(c) && !c.dup);
    if (!fresh || !toCapture.length) return;
    if (_mode === 'new') { await captureAsNewDestination(toCapture); return; }
    const n = toCapture.length;
    let saved = 0;
    try {
        for (const c of toCapture) {
            await addPoiFeature({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
                properties: {
                    'Nom du site FR': c.name || '',
                    'Catégorie': c.cat || 'À définir',
                    Zone: getZoneFromCoords(c.lat, c.lon) || '',
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

// Mode Nouvelle (réunif C2a-2) : « Capturer » crée une DESTINATION BROUILLON
// locale (entrée + candidats candidate:true) au lieu d'alimenter la dest active,
// récupère ses ZONES admin OSM (C2a-2b, niveau déduit du pays géocodé) + en
// déduit la Zone de chaque candidat, puis bascule dessus (rechargement ?map={id}
// → boot C2a-1b vérifié). Tout en local : aucune écriture GitHub.
async function captureAsNewDestination(toCapture) {
    const n = toCapture.length;
    const suggested = (_geoName || '').split(',')[0].trim();
    const name = await hwPrompt({
        title: 'Nouvelle destination',
        body: `Créer un brouillon local avec <strong>${n} lieu${n > 1 ? 'x' : ''}</strong>. Nom de la destination :`,
        defaultValue: suggested,
        placeholder: 'ex. Varna, Sozopol, Trapani…',
        confirmLabel: 'Créer le brouillon',
    });
    if (name === null) return;                       // annulé
    const trimmed = name.trim();
    if (!trimmed) { showToast('Nom vide — création annulée.', 'warning', 3000); return; }

    const id = await makeUniqueDestId(trimmed);
    const bbox = _geoBBox || [[_box.south, _box.west], [_box.north, _box.east]];
    const features = toCapture.map(c => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: {
            HW_ID: generateHWID(),
            'Nom du site FR': c.name || '',
            'Catégorie': c.cat || 'À définir',
            Zone: '',                                // affectée ci-dessous si des zones OSM existent
            candidate: true,
        },
    }));

    // Zones admin OSM (réunif C2a-2b) : niveau déduit du pays géocodé, avec repli
    // si la 1ʳᵉ passe est vide. Échec/timeout → zones vides, la création continue
    // (non bloquant — les zones se complètent plus tard si besoin).
    showLoading(true, 'Zones administratives (OSM)…');
    let zones = { type: 'FeatureCollection', features: [] };
    try { zones = await fetchZonesAuto(bbox, _geoCountry); } catch (_) {}
    showLoading(false);
    if (zones.features.length) {
        for (const f of features) {
            f.properties.Zone = zoneNameForPoint(f.geometry.coordinates[1], f.geometry.coordinates[0], zones);
        }
    }

    const center = map.getCenter();
    const entry = {
        name: trimmed,
        bounds: bbox,
        startView: { center: [center.lat, center.lng], zoom: map.getZoom() },
        currency: '',
        file: null, zonesFile: null, circuitsFile: null,
    };
    try {
        await createLocalDraftDestination(id, entry, { type: 'FeatureCollection', features }, zones);
    } catch (e) {
        showToast('Échec de la création du brouillon.', 'error', 4000);
        return;
    }
    // Bascule : on mémorise le choix puis on recharge sur le brouillon (le boot
    // C2a-1b le fusionne + charge ses POIs depuis l'IDB ; admin déjà connecté).
    try { localStorage.setItem('hw_active_dest', id); } catch (_) {}
    const zTxt = zones.features.length ? ` · ${zones.features.length} zone${zones.features.length > 1 ? 's' : ''}` : '';
    showToast(`Destination « ${trimmed} » créée (${n} candidat${n > 1 ? 's' : ''}${zTxt}). Bascule en cours…`, 'success', 2600);
    setTimeout(() => { location.href = `${location.pathname}?map=${encodeURIComponent(id)}`; }, 650);
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
        <div class="scout-box is-repasse" data-scout-box>
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
                    <button class="dest-sel" data-scout-dest-repasse type="button" disabled>
                        <span class="ic"><i data-lucide="map"></i></span>
                        <span class="scout-dest-main"><span class="nm" data-scout-destname>—</span><span class="ct" data-scout-destmode>publiée · repasse</span></span>
                    </button>
                    <div class="scout-search" data-scout-dest-new hidden>
                        <input type="search" data-scout-search placeholder="Lieu : hôtel, ville, site…" autocomplete="off">
                        <button class="scout-search-btn" data-scout-search-btn type="button" title="Rechercher" aria-label="Rechercher le lieu"><i data-lucide="search"></i></button>
                    </div>
                    <div class="scout-found" data-scout-found-label hidden></div>
                </div>
                <div>
                    <label class="scout-lbl">Type de moisson</label>
                    <div class="scout-mode">
                        <div class="scout-mode-opt" data-scout-mode="new"><div class="top"><i data-lucide="map-pin"></i><span class="t">Nouvelle</span></div><div class="h">Zone vierge — première moisson</div></div>
                        <div class="scout-mode-opt is-on repasse" data-scout-mode="repasse"><div class="top"><i data-lucide="refresh-cw"></i><span class="t">Repasse</span></div><div class="h">Compléter une dest. existante</div></div>
                    </div>
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

    // Pas de boîte au départ : on (re)cale la carte puis render() → boîte masquée
    // + couche de tracé active (l'admin dessine sa zone au glisser).
    setTimeout(() => { try { map.invalidateSize(); } catch (_) {} render(); }, 80);

    _overlay.querySelector('[data-scout-destname]').textContent = destName();
    _overlay.querySelector('[data-scout-quit]').addEventListener('click', stopScout);
    _overlay.querySelector('[data-scout-reset]').addEventListener('click', clearBox);
    _overlay.querySelector('[data-scout-primary]').addEventListener('click', (e) => {
        (e.currentTarget.dataset.action === 'capture') ? capture() : scan();
    });
    _overlay.querySelectorAll('[data-scout-mode]').forEach(el =>
        el.addEventListener('click', () => setMode(el.dataset.scoutMode)));
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
    updatePrimary();

    createIcons({ icons: appIcons, root: _overlay });
}

// Point d'entrée public — bouton « Scout » du Control Center.
export function startScout() {
    if (_isOpen) return;
    if (!state.isAdmin) { showToast("Outil réservé à l'admin.", 'warning', 3000); return; }
    if (!state.currentMapId) { showToast('Aucune destination active.', 'warning', 3000); return; }
    _isOpen = true;
    _mode = 'repasse';
    _candidates = [];
    _scannedBounds = null;
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
    _overlay = null; _boxEl = null; _drawLayer = null; _box = null; _scannedBounds = null;
    document.body.classList.remove('scout-active');
    setTimeout(() => { try { map.invalidateSize(); } catch (_) {} }, 80);
    _isOpen = false; _scanning = false;
}
