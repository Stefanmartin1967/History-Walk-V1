// scout.js — Scout in-app (admin). Réunification Lot B.
//
// Successeur in-app de tools/scout.html (qui sera supprimé en Lot C). Mode
// FOCALISÉ plein écran : topbar + sidebar masquées, vraie carte assombrie, un
// panneau gauche + une BOÎTE bbox déplaçable/redimensionnable (8 poignées) sur
// la carte. Gated state.isAdmin.
//
// Découpage : B1 (ici) = coquille + boîte + cote km live. La moisson Overpass
// (bbox → POIs + mapping taxo + dédup + compteurs) = B2 ; la capture en
// candidats « à curer » = B3. En B1 les compteurs sont à 0 et « Capturer » est
// désactivé.
//
// La boîte est stockée en COORDONNÉES (bounds lat/lng) = source de vérité, et
// projetée en pixels (viewport) à chaque rendu → elle suit le pan/zoom de la
// carte. Le drag/resize travaille en pixels puis ré-injecte les coords.
import { map } from './map.js';
import { state } from './state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';

let _overlay = null;
let _boxEl = null;
let _isOpen = false;
let _mode = 'repasse';          // 'new' | 'repasse'
let _box = null;                // { north, south, east, west } — source de vérité
let _drag = null;               // état drag/resize en cours
let _onMapMove = null;          // resync de la boîte sur pan/zoom

const MIN_PX = 46;              // taille mini de la boîte à l'écran (poignées utilisables)
const BIG_KM2 = 14;             // au-delà : avertissement « Overpass lent »

// ── Projection coords ↔ pixels viewport ─────────────────────────────────────
function mapRect() { return map.getContainer().getBoundingClientRect(); }

// bounds géo → rectangle px viewport (l'overlay est fixed inset:0 = viewport).
function geoToViewportRect(b) {
    const nw = map.latLngToContainerPoint([b.north, b.west]);
    const se = map.latLngToContainerPoint([b.south, b.east]);
    const r = mapRect();
    return { left: r.left + nw.x, top: r.top + nw.y, w: se.x - nw.x, h: se.y - nw.y };
}

// rectangle px viewport → bounds géo.
function viewportRectToGeo(rect) {
    const r = mapRect();
    const nw = map.containerPointToLatLng([rect.left - r.left, rect.top - r.top]);
    const se = map.containerPointToLatLng([rect.left - r.left + rect.w, rect.top - r.top + rect.h]);
    return { north: nw.lat, west: nw.lng, south: se.lat, east: se.lng };
}

// ── Cote (km) ───────────────────────────────────────────────────────────────
function boxKm(b) {
    const latMid = (b.north + b.south) / 2;
    const wKm = Math.abs(b.east - b.west) * 111 * Math.cos(latMid * Math.PI / 180);
    const hKm = Math.abs(b.north - b.south) * 111;
    return { wKm, hKm };
}

function projectBox() {
    if (!_boxEl || !_box) return;
    const rect = geoToViewportRect(_box);
    _boxEl.style.left = rect.left + 'px';
    _boxEl.style.top = rect.top + 'px';
    _boxEl.style.width = rect.w + 'px';
    _boxEl.style.height = rect.h + 'px';
    updateReadout();
}

function updateReadout() {
    const { wKm, hKm } = boxKm(_box);
    const big = (wKm * hKm) > BIG_KM2;
    const dimtxt = _overlay?.querySelector('[data-scout-dimtxt]');
    if (dimtxt) dimtxt.innerHTML = `${wKm.toFixed(1)} × ${hKm.toFixed(1)} km${big ? ' <span class="warn">⚠</span>' : ''}`;
    // Note Overpass : info ↔ avertissement selon la taille (leçon timeout #719).
    const note = _overlay?.querySelector('[data-scout-note]');
    const notetxt = _overlay?.querySelector('[data-scout-notetxt]');
    if (note && notetxt) {
        note.classList.toggle('is-warn', big);
        notetxt.textContent = big
            ? 'Boîte large : la moisson Overpass risque d’être lente. Réduis-la, ou découpe en plusieurs passes.'
            : 'Overpass peut être lent sur une grande zone. Garde la boîte raisonnablement petite — tu pourras repasser à côté.';
    }
}

// ── Drag / resize (pixels) ───────────────────────────────────────────────────
function onPointerDown(e) {
    const handle = e.target.closest('.scout-handle');
    if (!handle && !e.target.closest('.scout-box')) return;
    e.preventDefault();
    _drag = {
        mode: handle ? handle.dataset.h : 'move',
        px: e.clientX, py: e.clientY,
        rect: geoToViewportRect(_box),
    };
    map.dragging.disable();
    try { _boxEl.setPointerCapture(e.pointerId); } catch (_) {}
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e) {
    if (!_drag) return;
    const dx = e.clientX - _drag.px;
    const dy = e.clientY - _drag.py;
    let { left, top, w, h } = _drag.rect;
    const m = _drag.mode;
    if (m === 'move') { left += dx; top += dy; }
    else {
        if (m.includes('e')) w = _drag.rect.w + dx;
        if (m.includes('s')) h = _drag.rect.h + dy;
        if (m.includes('w')) { w = _drag.rect.w - dx; left = _drag.rect.left + dx; }
        if (m.includes('n')) { h = _drag.rect.h - dy; top = _drag.rect.top + dy; }
        // clamp mini en préservant le bord opposé
        if (w < MIN_PX) { if (m.includes('w')) left -= (MIN_PX - w); w = MIN_PX; }
        if (h < MIN_PX) { if (m.includes('n')) top -= (MIN_PX - h); h = MIN_PX; }
    }
    // clamp dans la carte
    const r = mapRect();
    left = Math.max(r.left, Math.min(left, r.right - w));
    top = Math.max(r.top, Math.min(top, r.bottom - h));
    w = Math.min(w, r.right - left);
    h = Math.min(h, r.bottom - top);
    _box = viewportRectToGeo({ left, top, w, h });
    projectBox();
}

function onPointerUp() {
    _drag = null;
    map.dragging.enable();
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
}

// ── Mode (Nouvelle / Repasse) — visuel en B1 ─────────────────────────────────
function setMode(m) {
    _mode = m;
    _overlay?.querySelector('[data-scout-mode="new"]')?.classList.toggle('is-on', m === 'new');
    _overlay?.querySelector('[data-scout-mode="repasse"]')?.classList.toggle('is-on', m === 'repasse');
    _boxEl?.classList.toggle('is-repasse', m === 'repasse');
    const destmode = _overlay?.querySelector('[data-scout-destmode]');
    if (destmode) destmode.textContent = m === 'repasse' ? 'publiée · repasse' : 'nouveau brouillon';
}

// ── Boîte par défaut : ~34 % × 40 % de la vue, centrée ───────────────────────
function defaultBox() {
    const r = mapRect();
    const rect = { left: r.left + r.width * 0.33, top: r.top + r.height * 0.28, w: r.width * 0.34, h: r.height * 0.40 };
    return viewportRectToGeo(rect);
}

function resetBox() {
    _box = defaultBox();
    projectBox();
}

// ── Shell ─────────────────────────────────────────────────────────────────────
function destName() {
    const id = state.currentMapId;
    return state.destinations?.maps?.[id]?.name || id || '—';
}

function renderShell() {
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
                    <button class="dest-sel" type="button" disabled>
                        <span class="ic"><i data-lucide="map"></i></span>
                        <span style="flex:1"><span class="nm" data-scout-destname>—</span><span class="ct" data-scout-destmode>publiée · repasse</span></span>
                    </button>
                </div>
                <div>
                    <label class="scout-lbl">Type de moisson</label>
                    <div class="scout-mode">
                        <div class="scout-mode-opt" data-scout-mode="new"><div class="top"><i data-lucide="map-pin"></i><span class="t">Nouvelle</span></div><div class="h">Zone vierge — première moisson</div></div>
                        <div class="scout-mode-opt is-on repasse" data-scout-mode="repasse"><div class="top"><i data-lucide="refresh-cw"></i><span class="t">Repasse</span></div><div class="h">Compléter une dest. existante</div></div>
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
                <button class="btn btn-primary" type="button" data-scout-capture disabled style="flex:1.5;justify-content:center"><i data-lucide="scan-eye"></i><span data-scout-capturetxt>Capturer</span></button>
            </div>
        </aside>
    `;
    document.body.appendChild(_overlay);
    document.body.classList.add('scout-active');
    _boxEl = _overlay.querySelector('[data-scout-box]');

    // La carte s'étend (topbar + sidebar masquées) → resynchroniser Leaflet,
    // puis poser la boîte par défaut une fois la nouvelle taille connue.
    setTimeout(() => {
        try { map.invalidateSize(); } catch (_) {}
        resetBox();
    }, 80);

    _overlay.querySelector('[data-scout-destname]').textContent = destName();
    _overlay.querySelector('[data-scout-quit]').addEventListener('click', stopScout);
    _overlay.querySelector('[data-scout-reset]').addEventListener('click', resetBox);
    _overlay.querySelectorAll('[data-scout-mode]').forEach(el =>
        el.addEventListener('click', () => setMode(el.dataset.scoutMode)));
    _boxEl.addEventListener('pointerdown', onPointerDown);
    _onMapMove = () => projectBox();
    map.on('move zoom zoomanim resize', _onMapMove);

    createIcons({ icons: appIcons, root: _overlay });
}

// Point d'entrée public — bouton « Scout » du Control Center (réunif B1).
export function startScout() {
    if (_isOpen) return;
    if (!state.isAdmin) { showToast("Outil réservé à l'admin.", 'warning', 3000); return; }
    if (!state.currentMapId) { showToast('Aucune destination active.', 'warning', 3000); return; }
    _isOpen = true;
    _mode = 'repasse';
    renderShell();
}

export function stopScout() {
    if (!_isOpen) return;
    if (_drag) onPointerUp();
    if (_onMapMove) { map.off('move zoom zoomanim resize', _onMapMove); _onMapMove = null; }
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null; _boxEl = null; _box = null;
    document.body.classList.remove('scout-active');
    setTimeout(() => { try { map.invalidateSize(); } catch (_) {} }, 80);
    _isOpen = false;
}
