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
import { state } from './state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { fetchOverpassJson } from './osm-overpass.js';

let _overlay = null;
let _boxEl = null;
let _isOpen = false;
let _mode = 'repasse';          // 'new' | 'repasse'
let _box = null;                // { north, south, east, west } — source de vérité
let _drag = null;               // état drag/resize en cours
let _onMapMove = null;          // resync boîte + pastilles sur pan/zoom
let _categories = null;         // Set des clés de catégorie cochées
let _candidates = [];           // résultats du dernier scan : {lat,lon,cat,unknown,dup,name,_el}
let _scannedBounds = null;      // bounds de la boîte au moment du scan (détection « zone modifiée »)
let _scanning = false;
let _geocoded = false;          // mode Nouvelle : une recherche Nominatim a-t-elle volé la carte ?

const MIN_PX = 46;              // taille mini de la boîte à l'écran (poignées utilisables)
const BIG_KM2 = 14;             // au-delà : avertissement « Overpass lent »
const DEDUP_M = 50;             // un candidat à < 50 m d'un POI existant = doublon (règle #472)

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

// ── Rendu ─────────────────────────────────────────────────────────────────────
function render() {
    if (!_boxEl || !_box) return;
    const rect = geoToViewportRect(_box);
    _boxEl.style.left = rect.left + 'px';
    _boxEl.style.top = rect.top + 'px';
    _boxEl.style.width = rect.w + 'px';
    _boxEl.style.height = rect.h + 'px';
    positionCandidates();
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
    const { wKm, hKm } = boxKm(_box);
    const big = (wKm * hKm) > BIG_KM2;
    const dimtxt = _overlay?.querySelector('[data-scout-dimtxt]');
    if (dimtxt) dimtxt.innerHTML = `${wKm.toFixed(1)} × ${hKm.toFixed(1)} km${big ? ' <span class="warn">⚠</span>' : ''}`;
    const note = _overlay?.querySelector('[data-scout-note]');
    const notetxt = _overlay?.querySelector('[data-scout-notetxt]');
    if (note && notetxt) {
        note.classList.toggle('is-warn', big);
        notetxt.textContent = big
            ? 'Boîte large : la moisson Overpass risque d’être lente. Réduis-la, ou découpe en plusieurs passes.'
            : 'Overpass peut être lent sur une grande zone. Garde la boîte raisonnablement petite — tu pourras repasser à côté.';
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
    const fl = _overlay?.querySelector('[data-scout-found-label]');
    if (fl) { fl.hidden = true; fl.textContent = ''; }
    clearCandidates();
    _scannedBounds = null;
    refreshRecap();
    syncScanEnabled();
}
function syncScanEnabled() {
    const btn = _overlay?.querySelector('[data-scout-scan]');
    // En mode Nouvelle, on attend une recherche (sinon la boîte est encore sur
    // la destination active) → Scanner reste désactivé tant qu'on n'a pas volé.
    if (btn) btn.disabled = (_categories.size === 0) || _scanning || (_mode === 'new' && !_geocoded);
}

// Mode Nouvelle (réunif B2b) : géocode un lieu via Nominatim → vole la carte
// dessus → recentre la boîte. PAS de persistance (créer le brouillon de
// destination = Lot C) : on prévisualise/scoute juste une zone neuve.
async function geocodeAndFly(query) {
    query = (query || '').trim();
    if (!query) return;
    const btn = _overlay?.querySelector('[data-scout-search-btn]');
    if (btn) btn.disabled = true;
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!Array.isArray(data) || !data.length) { showToast(`Aucun lieu trouvé pour « ${query} ».`, 'warning', 3500); return; }
        const hit = data[0];
        const lat = parseFloat(hit.lat), lon = parseFloat(hit.lon);
        const bb = (hit.boundingbox || []).map(parseFloat); // [south, north, west, east]
        if (bb.length === 4 && bb.every(Number.isFinite)) {
            map.fitBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { maxZoom: 16, animate: false });
        } else if (Number.isFinite(lat) && Number.isFinite(lon)) {
            map.setView([lat, lon], 14, { animate: false });
        } else {
            showToast('Réponse Nominatim inattendue.', 'error', 3000); return;
        }
        // Zone neuve → on oublie le scan précédent + on recentre la boîte dessus.
        clearCandidates();
        _scannedBounds = null;
        resetBox();
        _geocoded = true;
        syncScanEnabled();
        const fl = _overlay?.querySelector('[data-scout-found-label]');
        if (fl) { fl.hidden = false; fl.textContent = '📍 ' + (hit.display_name || query).split(',').slice(0, 2).join(','); }
    } catch (e) {
        showToast('Recherche indisponible (Nominatim). Réessaie.', 'error', 3500);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ── Boîte par défaut ───────────────────────────────────────────────────────────
function defaultBox() {
    const r = mapRect();
    return viewportRectToGeo({ left: r.left + r.width * 0.33, top: r.top + r.height * 0.28, w: r.width * 0.34, h: r.height * 0.40 });
}
function resetBox() {
    _box = defaultBox();
    render();
}

// ── Pastilles candidates ──────────────────────────────────────────────────────
function clearCandidates() {
    for (const c of _candidates) c._el?.remove();
    _candidates = [];
}
function renderCandidates() {
    for (const c of _candidates) {
        const el = document.createElement('span');
        el.className = 'scout-cand' + (c.dup ? ' dup' : '');
        el.title = c.unknown ? 'Catégorie non devinée' : (c.cat || '') + (c.dup ? ' (doublon)' : '');
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
    el.style.display = on ? 'flex' : 'none';
    if (on && sub) { const s = el.querySelector('[data-scout-loadingsub]'); if (s) s.textContent = sub; }
}

async function scan() {
    if (_scanning || !_box) return;
    if (_categories.size === 0) { showToast('Sélectionne au moins une catégorie.', 'warning', 3000); return; }
    _scanning = true; syncScanEnabled();
    showLoading(true, 'Interrogation d’Overpass…');
    try {
        // Interactif → échec rapide (un passage sur les 3 mirrors, pas de retry
        // agressif) : si Overpass rame, l'admin re-scanne plutôt que d'attendre.
        const json = await fetchOverpassJson(buildQuery(_box, _categories), { timeoutMs: 25000, retries: 0 });
        const els = (json && json.elements) || [];
        clearCandidates();
        const seen = new Set();
        const cands = [];
        for (const el of els) {
            const lat = el.lat ?? el.center?.lat;
            const lon = el.lon ?? el.center?.lon;
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            const key = el.type + '/' + el.id;
            if (seen.has(key)) continue;
            seen.add(key);
            const tags = el.tags || {};
            const cat = getHwCategory(tags);
            cands.push({ lat, lon, cat, unknown: !cat, dup: isAlreadyInData(lat, lon), name: tags.name || tags['name:fr'] || '' });
        }
        _candidates = cands;
        _scannedBounds = { ..._box };
        renderCandidates();
        refreshRecap();
        const net = cands.filter(c => inBox(c) && !c.dup).length;
        showToast(`${cands.length} objet${cands.length > 1 ? 's' : ''} OSM · ${net} nouveau${net > 1 ? 'x' : ''} à importer.`, 'success', 3000);
    } catch (e) {
        showToast('Overpass indisponible (timeout/erreur). Réduis la boîte ou réessaie.', 'error', 4500);
    } finally {
        _scanning = false; syncScanEnabled();
        showLoading(false);
    }
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
        <aside class="scout-panel">
            <div class="scout-panel-hd">
                <span class="ic"><i data-lucide="scan-eye"></i></span>
                <div style="flex:1"><h4>Capturer une zone</h4><div class="sub">Moisson OpenStreetMap</div></div>
                <button class="scout-quit" type="button" data-scout-quit><i data-lucide="x"></i>Quitter</button>
            </div>
            <div class="scout-panel-bd">
                <div>
                    <label class="scout-lbl">Destination</label>
                    <button class="dest-sel" data-scout-dest-repasse type="button" disabled>
                        <span class="ic"><i data-lucide="map"></i></span>
                        <span style="flex:1"><span class="nm" data-scout-destname>—</span><span class="ct" data-scout-destmode>publiée · repasse</span></span>
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
                <button class="btn btn-ghost" type="button" data-scout-reset style="flex:1;justify-content:center"><i data-lucide="rotate-ccw"></i>Réinit.</button>
                <button class="btn btn-primary" type="button" data-scout-scan style="flex:1.5;justify-content:center"><i data-lucide="scan-eye"></i>Scanner la zone</button>
            </div>
        </aside>
        <div class="scout-loading" data-scout-loading style="display:none"><span class="spin"></span><div><div style="font-weight:600">Moisson en cours…</div><div style="font-size:11.5px;color:var(--ink-soft)" data-scout-loadingsub>Interrogation d’Overpass…</div></div></div>
    `;
    document.body.appendChild(_overlay);
    document.body.classList.add('scout-active');
    _boxEl = _overlay.querySelector('[data-scout-box]');

    setTimeout(() => { try { map.invalidateSize(); } catch (_) {} resetBox(); }, 80);

    _overlay.querySelector('[data-scout-destname]').textContent = destName();
    _overlay.querySelector('[data-scout-quit]').addEventListener('click', stopScout);
    _overlay.querySelector('[data-scout-reset]').addEventListener('click', resetBox);
    _overlay.querySelector('[data-scout-scan]').addEventListener('click', scan);
    _overlay.querySelectorAll('[data-scout-mode]').forEach(el =>
        el.addEventListener('click', () => setMode(el.dataset.scoutMode)));
    _overlay.querySelectorAll('[data-scout-cat]').forEach(cb =>
        cb.addEventListener('change', () => {
            if (cb.checked) _categories.add(cb.dataset.scoutCat); else _categories.delete(cb.dataset.scoutCat);
            syncScanEnabled();
        }));
    const searchInput = _overlay.querySelector('[data-scout-search]');
    _overlay.querySelector('[data-scout-search-btn]')?.addEventListener('click', () => geocodeAndFly(searchInput?.value));
    searchInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); geocodeAndFly(searchInput.value); } });
    _boxEl.addEventListener('pointerdown', onPointerDown);
    _onMapMove = () => render();
    map.on('move zoom zoomanim resize', _onMapMove);
    syncScanEnabled();

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
    renderShell();
}

export function stopScout() {
    if (!_isOpen) return;
    if (_drag) onPointerUp();
    if (_onMapMove) { map.off('move zoom zoomanim resize', _onMapMove); _onMapMove = null; }
    clearCandidates();
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null; _boxEl = null; _box = null; _scannedBounds = null;
    document.body.classList.remove('scout-active');
    setTimeout(() => { try { map.invalidateSize(); } catch (_) {} }, 80);
    _isOpen = false; _scanning = false;
}
