// circuit-compare.js — Panneau « Itinéraire » (PC, création de circuit).
//
// Au premier tracé et à « Tout re-tracer », l'auteur compare deux variantes
// calculées en même temps — Direct (le calcul historique) et Chemins (pistes et
// sentiers préférés, avec une force réglable) — et pose ses POINTS DE PASSAGE
// dans le même panneau, puis enregistre une variante. Handoff Claude Design du
// 12/11/2026 (.claude/handoff-comparateur-trace/README.md) ; panneau unique
// (variantes + points) validé par Stefan le 13/11/2026 (maquette « Panneau
// Itinéraire »).
//
// Points de passage : « Poser un point » est actif dès l'ouverture. Un point
// posé, glissé ou retiré recalcule son seul passage : tout de suite pour la
// variante choisie ; pour l'autre, en arrière-plan avec BRouter de ce PC, à la
// demande avec brouter.de (« Pas à jour » · Recalculer). Avec « éviter de
// repasser », toute la variante est recalculée (chaque passage évite les
// précédents).
//
// Ce module ne sauvegarde rien : il calcule, affiche le panneau à gauche de la
// carte, les deux lignes et les points, puis rend la main à l'appelant
// (ui-circuit-routing) via onApply (variante retenue, son résultat et les
// points) ou onCancel.
import L from 'leaflet';
import { map, trackRenderer } from './map.js';
import {
    routeCircuit, routeOneSegment, assembleRoute, resolveEngine, normalizeRouting,
    ROUTING_VARIANTS, DEFAULT_FORCE, FORCE_MAX, AVOID_WEIGHTS, DEFAULT_AVOID_WEIGHT,
} from './circuit-routing.js';
import { WAY_KEYS, repassedMeters, compareToDirect, WAY_BETTER, formatKmDelta } from './route-stats.js';
import { WAY_CATEGORIES, formatKm } from './way-types.js';
import { nearestPassage, insertionIndex } from './passage-order.js';
import { paintZoneWaysLoading } from './circuit-way-types.js';
import { toggleReferenceLayer, isReferenceVisible } from './circuit-reference-layer.js';
import { createIcons, appIcons } from './lucide-icons.js';

const VARIANTS = ['direct', 'chemins'];
// Écart en dessous duquel on affiche « = » (seuils du banc d'essai).
const KM_THRESHOLD_M = 50;
const ASCEND_THRESHOLD_M = 5;
// « Non classé » montré seulement au-delà de 100 m (décision de Stefan, 12/11/2026).
const NON_CLASSE_MIN_M = 100;

let cv = null; // session en cours (une à la fois)
// « Voies » affichées ou non : gardé d'une ouverture à l'autre (session).
let zoneVisible = true;

/** Le panneau est-il ouvert ? */
export function isComparing() {
    return !!cv;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wayLabel = (k) => (WAY_CATEGORIES.find(c => c.key === k) || {}).label || k;
const fmtForce = (f) => String(f).replace('.', ',');
const kmNum = (m) => (m / 1000).toFixed(1).replace('.', ',');
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
let _pid = 0;
const newPointId = () => `cvp_${++_pid}`;

/**
 * Ouvre le panneau et lance les deux calculs.
 * @param {Object} o
 * @param {Object[]} o.features  Lieux du circuit, dans l'ordre (≥ 2).
 * @param {{variant: string, force?: number}} o.initial  Variante présélectionnée et force.
 * @param {Object} [o.waypointsBySeg]  Points de passage enregistrés ({ [passage]: [{lat, lng}] }) :
 *   le panneau part d'eux, les deux variantes passent par eux (circuit-waypoints.js).
 * @param {(choice: {routing: Object, engine: Object, result: Object,
 *   points: {seg:number, lat:number, lng:number}[]}) => Promise<void>} o.onApply
 * @param {() => void} o.onCancel
 */
export async function openRouteCompare({ features, initial, waypointsBySeg = {}, onApply, onCancel }) {
    if (cv || !map) return;
    const init = normalizeRouting(initial);
    cv = {
        features: features.slice(),
        points: Object.keys(waypointsBySeg || {}).map(Number).sort((a, b) => a - b)
            .flatMap(seg => (waypointsBySeg[seg] || []).map(p => ({ id: newPointId(), seg, lat: p.lat, lng: p.lng }))),
        engine: null,
        selected: init.variant,
        // Force mémorisée si le circuit l'a (même s'il est en Direct), sinon 1.
        force: normalizeRouting({ variant: 'chemins', force: initial?.force ?? DEFAULT_FORCE }).force,
        // « Éviter de repasser » (vaut pour les deux variantes) et son poids.
        avoid: init.avoid === true,
        weight: init.weight || DEFAULT_AVOID_WEIGHT,
        adjustOpen: false,
        addMode: true, // décision de Stefan (13/11/2026) : actif dès l'ouverture
        hover: null,
        fitted: false,
        runs: { direct: newRun(), chemins: newRun() },
        tok: { direct: 0, chemins: 0 },
        lines: { direct: null, chemins: null },
        markers: null,
        zone: null,
        onApply, onCancel,
        panel: null,
        applying: false,
    };
    buildPanel();
    cv.markers = L.layerGroup().addTo(map);
    cv.zone = L.layerGroup().addTo(map);
    map.on('click', onMapClick);
    syncAddMode();
    drawMarkers();
    cv.engine = await resolveEngine();
    if (!cv) return; // annulé pendant la sonde
    renderEngine();
    VARIANTS.forEach(v => compute(v));
}

/** Ferme sans rien changer (Annuler, Échap, la croix, ou un changement de lieux). */
export function cancelRouteCompare() {
    if (!cv) return;
    const { onCancel } = cv;
    teardown();
    if (typeof onCancel === 'function') onCancel();
}

function newRun() {
    // busy : passages en cours de recalcul après un point ; stale : pas recalculée
    // depuis les derniers points (brouter.de, à la demande).
    return { status: 'pending', result: null, stats: null, progress: null, error: null, busy: 0, stale: false };
}

// --- Points de passage -----------------------------------------------------
function pointsBySeg() {
    const out = {};
    cv.points.forEach(p => { (out[p.seg] = out[p.seg] || []).push({ lat: p.lat, lng: p.lng }); });
    return out;
}

// Signature des points d'un passage : un résultat arrivé après un nouveau
// changement de ce passage est ignoré.
function segKey(seg) {
    return JSON.stringify(cv.points.filter(p => p.seg === seg).map(p => [p.lat, p.lng]));
}

function selectedSegments() {
    return cv.runs[cv.selected].result?.segments || null;
}

function onMapClick(e) {
    if (!cv || !cv.addMode || cv.applying) return;
    const segs = selectedSegments();
    if (!segs || !segs.length) return; // rien de calculé encore : rien où poser
    const seg = nearestPassage(segs, e.latlng);
    const at = insertionIndex(cv.points, seg, segs[seg]?.coords || [], e.latlng);
    cv.points.splice(at, 0, { id: newPointId(), seg, lat: e.latlng.lat, lng: e.latlng.lng });
    pointsChanged([seg]);
}

function removePoint(id) {
    const p = cv.points.find(x => x.id === id);
    if (!p) return;
    cv.points = cv.points.filter(x => x.id !== id);
    pointsChanged([p.seg]);
}

function clearPassage(seg) {
    if (!cv.points.some(p => p.seg === seg)) return;
    cv.points = cv.points.filter(p => p.seg !== seg);
    pointsChanged([seg]);
}

// Points changés sur ces passages : la variante choisie suit tout de suite ;
// l'autre en arrière-plan (BRouter de ce PC) ou à la demande (brouter.de).
function pointsChanged(segs) {
    drawMarkers();
    const other = VARIANTS.find(v => v !== cv.selected);
    segs.forEach(seg => updatePassage(cv.selected, seg));
    const o = cv.runs[other];
    // Un calcul complet en cours de l'autre reprendra ces points à son arrivée.
    if (o.result && o.status !== 'pending' && o.status !== 'failed') {
        if (cv.engine && cv.engine.key === 'local') segs.forEach(seg => updatePassage(other, seg));
        else o.stale = true;
    }
    render();
}

// Recalcule un passage d'une variante et remet son résultat à jour.
async function updatePassage(variant, seg) {
    const session = cv;
    const run = session.runs[variant];
    // Calcul complet en cours : il reverra les points à son arrivée.
    if (run.status === 'pending' || !run.result) return;
    // « Éviter de repasser » : chaque passage évite les précédents → tout recalculer.
    if (session.avoid) { compute(variant); return; }
    const key = segKey(seg);
    const tok = session.tok[variant];
    run.busy++;
    render();
    let res = null;
    try {
        res = await routeOneSegment(session.features, seg, pointsBySeg(), {
            routing: routingFor(variant), base: session.engine.base,
        });
    } catch (e) {
        console.error('[itinéraire] passage', seg, e);
    }
    if (cv !== session) return;
    run.busy = Math.max(0, run.busy - 1);
    // Un calcul complet est parti entre-temps, ou ce passage a encore changé.
    if (session.tok[variant] !== tok || segKey(seg) !== key || !run.result || !res) { render(); return; }
    const segments = run.result.segments.slice();
    segments[seg] = res;
    setResult(variant, assembleRoute(segments));
    render();
}

function drawMarkers() {
    if (!cv || !cv.markers) return;
    cv.markers.clearLayers();
    cv.points.forEach(p => {
        const m = L.marker([p.lat, p.lng], {
            draggable: true, zIndexOffset: 1300,
            icon: L.divIcon({ className: 'wp-marker', html: '<span class="wp-ring"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }),
            title: 'Glisser pour ajuster · cliquer pour retirer',
        });
        m.on('dragend', () => {
            const ll = m.getLatLng();
            p.lat = ll.lat; p.lng = ll.lng;
            pointsChanged([p.seg]);
        });
        m.on('click', () => removePoint(p.id)); // Leaflet annule le click après un glissé
        cv.markers.addLayer(m);
    });
}

function syncAddMode() {
    map.getContainer().classList.toggle('cv-placing', !!(cv && cv.addMode));
}

function drawZone() {
    if (!cv || !cv.zone) return;
    cv.zone.clearLayers();
    const segs = selectedSegments();
    if (zoneVisible && segs) paintZoneWaysLoading(cv.zone, segs, () => drawZone());
}

// --- Calcul --------------------------------------------------------------
function routingFor(variant) {
    return normalizeRouting({ variant, force: cv.force, avoid: cv.avoid, weight: cv.weight });
}

async function compute(variant) {
    const session = cv;
    const run = session.runs[variant];
    const tok = ++session.tok[variant];
    // Un recalcul garde l'ancien résultat affiché, atténué ; un premier calcul attend.
    run.status = run.result ? 'refreshing' : 'pending';
    run.progress = null;
    run.error = null;
    run.stale = false;
    run.busy = 0;
    render();
    const live = () => cv === session && session.tok[variant] === tok;
    // Points au départ du calcul : un passage changé pendant le calcul est repris après.
    const keys = session.features.slice(1).map((_, seg) => segKey(seg));
    let result;
    try {
        result = await routeCircuit(session.features, pointsBySeg(), {
            routing: routingFor(variant),
            base: session.engine.base,
            onProgress: (done, total) => {
                if (!live()) return;
                run.progress = { done, total };
                render();
            },
        });
    } catch (e) {
        if (!live()) return;
        fail(run, e && e.message);
        render();
        return;
    }
    if (!live()) return;
    // Aucun passage routé : la variante est en échec (serveur muet, débit limité…).
    if (result.segments.every(s => !s.ok)) {
        fail(run, (result.segments.find(s => s.error) || {}).error);
    } else {
        run.status = 'ready';
        setResult(variant, result);
        if (!session.fitted) fitTo(result.realTrack);
        keys.forEach((k, seg) => { if (segKey(seg) !== k) updatePassage(variant, seg); });
    }
    // La variante sélectionnée a échoué alors que l'autre tient : on passe à l'autre.
    if (run.status === 'failed' && session.selected === variant) {
        const other = VARIANTS.find(v => v !== variant);
        if (session.runs[other].status !== 'failed') session.selected = other;
    }
    restyleLines();
    render();
}

function setResult(variant, result) {
    const run = cv.runs[variant];
    run.result = result;
    run.stats = statsOf(result);
    drawLine(variant);
    restyleLines();
    if (variant === cv.selected) drawZone();
}

function fail(run, message) {
    run.status = 'failed';
    run.result = null;
    run.stats = null;
    run.stale = false;
    run.error = message || "BRouter n'a pas pu calculer l'itinéraire.";
    if (cv) VARIANTS.forEach(v => { if (cv.runs[v] === run) removeLine(v); });
}

function statsOf(result) {
    return {
        distM: (result.distanceKm || 0) * 1000,
        ascend: Number.isFinite(result.ascend) ? result.ascend : null,
        repassM: repassedMeters(result.realTrack),
        ways: result.ways,
        failCount: (result.failedSegments || []).length,
    };
}

// Réessayer une variante en échec. Si le moteur a changé entre-temps (BRouter de
// ce PC relancé ou arrêté), les deux variantes sont recalculées sur le nouveau.
async function retry(variant) {
    const session = cv;
    const engine = await resolveEngine();
    if (cv !== session) return;
    if (engine.key !== session.engine.key) {
        session.engine = engine;
        renderEngine();
        VARIANTS.forEach(v => compute(v));
    } else {
        compute(variant);
    }
}

// --- Carte ---------------------------------------------------------------
function drawLine(variant) {
    removeLine(variant);
    const run = cv.runs[variant];
    if (!run.result || !Array.isArray(run.result.realTrack) || run.result.realTrack.length < 2) return;
    const ll = run.result.realTrack;
    const halo = L.polyline(ll, { className: 'cv-route-halo', interactive: false, renderer: trackRenderer() });
    const line = L.polyline(ll, { className: `cv-route-line cv-route-line--${variant}`, renderer: trackRenderer() });
    // En mode « Poser un point », un clic sur une ligne pose un point (le clic
    // remonte à la carte) ; sinon il choisit la variante.
    line.on('click', () => { if (!cv.addMode) select(variant); });
    line.on('mouseover', () => setHover(variant));
    line.on('mouseout', () => setHover(null));
    const group = L.layerGroup([halo, line]).addTo(map);
    cv.lines[variant] = { group, halo, line };
}

function removeLine(variant) {
    const l = cv && cv.lines[variant];
    if (l) { l.group.remove(); cv.lines[variant] = null; }
}

// Sélectionnée (ou survolée) : dessus et pleine ; l'autre : dessous, plus fine.
function restyleLines() {
    if (!cv) return;
    const strong = cv.hover || cv.selected;
    const order = VARIANTS.filter(v => v !== strong).concat(strong);
    order.forEach(v => {
        const l = cv.lines[v];
        if (!l) return;
        const on = v === strong;
        [l.halo, l.line].forEach(p => p.getElement()?.classList.toggle('is-strong', on));
        l.halo.bringToFront();
        l.line.bringToFront();
    });
}

function fitTo(track) {
    cv.fitted = true;
    try {
        map.fitBounds(L.latLngBounds(track), {
            paddingTopLeft: [cv.panel.offsetWidth + 40, 40],
            paddingBottomRight: [40, 40],
        });
    } catch (e) { /* tracé dégénéré : on laisse la vue */ }
}

// --- Panneau -------------------------------------------------------------
function buildPanel() {
    const el = document.createElement('section');
    el.className = 'cv-panel';
    el.setAttribute('aria-labelledby', 'cv-title');
    el.innerHTML = `
        <div class="cv-head">
            <div class="cv-head-ico"><i data-lucide="route"></i></div>
            <div class="cv-head-txt">
                <h3 id="cv-title">Itinéraire</h3>
                <p class="cv-head-sub"></p>
            </div>
            <button class="cv-icon-btn" type="button" data-act="cancel" aria-label="Fermer"><i data-lucide="x"></i></button>
        </div>
        <div class="cv-body">
            <div class="cv-cards" role="radiogroup" aria-label="Variantes d'itinéraire"></div>
            <p class="cv-legend" hidden>Écarts avec Direct : <span class="cv-delta cv-delta--mieux">mieux</span><span class="cv-delta cv-delta--moins">moins bien</span></p>
            <p class="cv-slow cv-slow--other" hidden><i data-lucide="clock"></i><span>BRouter de ce PC ne répond pas : chaque point ne recalcule que la variante choisie. Les écarts reviennent quand l'autre est recalculée.</span></p>
            <div class="pp">
                <div class="pp-head"><span class="pp-ring" aria-hidden="true"></span>Points de passage<span class="pp-count"></span></div>
                <div class="pp-body">
                    <div class="pp-tools">
                        <button class="pp-tool" type="button" data-act="add" aria-pressed="true"><i data-lucide="crosshair"></i>Poser un point</button>
                        <button class="pp-tool" type="button" data-act="ways" aria-pressed="true"><i data-lucide="route"></i>Voies</button>
                        <button class="pp-tool" type="button" data-act="layer" aria-pressed="false"><i data-lucide="layers"></i>Calque</button>
                    </div>
                    <p class="pp-hint">Cliquez sur le tracé pour poser un point, puis glissez-le sur le chemin voulu. Cliquez un point pour le retirer. Les deux variantes passent par vos points.</p>
                    <ul class="pp-list"></ul>
                </div>
            </div>
            <div class="cv-adjust">
                <button class="cv-adjust-head" type="button" data-act="adjust" aria-expanded="false" aria-controls="cv-adjust-body">
                    <i data-lucide="settings-2"></i>Ajuster<span class="cv-sum"></span><i class="cv-chev" data-lucide="chevron-down"></i>
                </button>
                <div class="cv-adjust-body" id="cv-adjust-body" hidden>
                    <div class="cv-row">
                        <div class="cv-row-top">
                            <label class="cv-row-l" for="cv-force">Force de Chemins</label>
                            <output class="cv-range-val" for="cv-force"></output>
                        </div>
                        <div class="cv-range">
                            <input id="cv-force" type="range" min="0" max="${FORCE_MAX}" step="0.1">
                            <div class="cv-range-ticks" aria-hidden="true">
                                <span class="t0">0<small>sans effet</small></span>
                                <span class="t1">1<small>par défaut</small></span>
                                <span class="t2">2</span>
                                <span class="t3">3<small>très fort</small></span>
                            </div>
                        </div>
                    </div>
                    <div class="cv-row cv-row--sep">
                        <div class="cv-row-top">
                            <label class="cv-row-l" for="cv-avoid">Éviter de repasser</label>
                            <span class="cv-switch"><input id="cv-avoid" type="checkbox" role="switch"><span aria-hidden="true"></span></span>
                        </div>
                        <p class="cv-row-hint">Ne pas revenir par la même voie quand une autre existe. Vaut pour les deux variantes.</p>
                        <p class="cv-slow cv-slow--avoid" hidden><i data-lucide="clock"></i><span>Plus lent avec brouter.de : chaque passage est demandé à part.</span></p>
                    </div>
                    <div class="cv-row cv-row--weight">
                        <div class="cv-row-top"><span class="cv-row-l" id="cv-weight-l">Poids</span></div>
                        <div class="cv-seg-ctl" role="radiogroup" aria-labelledby="cv-weight-l">
                            ${AVOID_WEIGHTS.map((w, i) => `<button type="button" role="radio" data-act="weight" data-w="${w}">${['Léger', 'Net', 'Fort'][i]}<small>${w}</small></button>`).join('')}
                        </div>
                        <p class="cv-row-hint">Fort : quitte à faire de gros détours. S'il n'y a pas d'autre voie, le tracé repasse quand même.</p>
                    </div>
                    <p class="cv-row-hint">La force recalcule Chemins ; « éviter de repasser » et son poids recalculent les deux.</p>
                </div>
            </div>
            <p class="cv-engine"></p>
        </div>
        <div class="cv-foot">
            <button class="fb-btn" type="button" data-act="cancel">Annuler</button>
            <button class="fb-btn fb-cta" type="button" data-act="apply"></button>
        </div>`;
    cv.panel = el;
    const container = map.getContainer();
    container.appendChild(el);
    container.classList.add('is-comparing');
    // Le panneau vit dans la carte : ni glisser la carte, ni zoomer, ni poser
    // un point, depuis lui.
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);

    el.addEventListener('click', onPanelClick);
    el.addEventListener('change', onPanelChange);
    el.addEventListener('input', onPanelInput);
    el.addEventListener('mouseover', onPanelHover);
    el.addEventListener('mouseleave', () => setHover(null));
    cv.keyHandler = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) cancelRouteCompare(); };
    document.addEventListener('keydown', cv.keyHandler);

    const range = el.querySelector('#cv-force');
    range.value = String(cv.force);
    syncAdjust();
    createIcons({ icons: appIcons, root: el });
    render();
}

function teardown() {
    if (!cv) return;
    VARIANTS.forEach(removeLine);
    map?.off('click', onMapClick);
    cv.markers?.remove();
    cv.zone?.remove();
    document.removeEventListener('keydown', cv.keyHandler);
    cv.panel?.remove();
    map?.getContainer().classList.remove('is-comparing', 'cv-placing');
    cv = null;
}

function onPanelClick(e) {
    // Le rendu remplace souvent l'élément cliqué (× d'un passage, carte de
    // variante) : Leaflet ne reconnaît plus alors que le clic vient du panneau
    // et le prendrait pour un clic sur la carte — un point serait posé.
    e.stopPropagation();
    const target = e.target.closest('[data-act]');
    const act = target?.dataset.act;
    if (act === 'cancel') { cancelRouteCompare(); return; }
    if (act === 'apply') { apply(); return; }
    if (act === 'retry') { retry(target.closest('[data-variant]').dataset.variant); return; }
    if (act === 'recompute') { e.preventDefault(); compute(target.closest('[data-variant]').dataset.variant); return; }
    if (act === 'add') { cv.addMode = !cv.addMode; syncAddMode(); render(); return; }
    if (act === 'ways') { zoneVisible = !zoneVisible; drawZone(); render(); return; }
    if (act === 'layer') { toggleReferenceLayer(() => render()); return; }
    if (act === 'clear-seg') { clearPassage(Number(target.dataset.seg)); return; }
    if (act === 'weight') {
        const w = Number(target.dataset.w);
        if (!cv.avoid || w === cv.weight) return;
        cv.weight = w;
        syncAdjust();
        VARIANTS.forEach(v => compute(v));
        return;
    }
    if (act === 'adjust') {
        cv.adjustOpen = !cv.adjustOpen;
        const btn = cv.panel.querySelector('.cv-adjust-head');
        btn.setAttribute('aria-expanded', String(cv.adjustOpen));
        cv.panel.querySelector('.cv-adjust').classList.toggle('is-open', cv.adjustOpen);
        cv.panel.querySelector('#cv-adjust-body').hidden = !cv.adjustOpen;
    }
}

function onPanelChange(e) {
    if (e.target.name === 'cv-variant') { select(e.target.value); return; }
    if (e.target.id === 'cv-force') {
        const f = normalizeRouting({ variant: 'chemins', force: e.target.value }).force;
        if (f === cv.force) return;
        cv.force = f;
        syncAdjust();
        compute('chemins');
        return;
    }
    if (e.target.id === 'cv-avoid') {
        cv.avoid = e.target.checked;
        syncAdjust();
        VARIANTS.forEach(v => compute(v));
    }
}

// Pendant le glissé : la valeur et la piste suivent, sans recalcul.
function onPanelInput(e) {
    if (e.target.id !== 'cv-force') return;
    syncAdjust(Number(e.target.value));
}

function onPanelHover(e) {
    const card = e.target.closest('.cv-card[data-variant]');
    setHover(card && cv.runs[card.dataset.variant].status !== 'failed' ? card.dataset.variant : null);
}

function setHover(variant) {
    if (!cv || cv.hover === variant) return;
    cv.hover = variant;
    cv.panel.querySelectorAll('.cv-card[data-variant]').forEach(c => c.classList.toggle('is-hover', c.dataset.variant === variant));
    restyleLines();
}

function select(variant) {
    if (!cv || cv.runs[variant].status === 'failed' || cv.selected === variant) return;
    cv.selected = variant;
    // Variante pas à jour de vos derniers points : on la recalcule en la choisissant.
    if (cv.runs[variant].stale) compute(variant);
    restyleLines();
    drawZone();
    render();
}

// Contrôles d'« Ajuster » et son résumé : force (valeur et partie remplie de la
// piste), interrupteur, poids (grisé s'il n'y a rien à éviter), note brouter.de.
function syncAdjust(liveForce) {
    const f = Number.isFinite(liveForce) ? liveForce : cv.force;
    const p = cv.panel;
    p.querySelector('#cv-force').style.setProperty('--pct', `${(f / FORCE_MAX) * 100}%`);
    p.querySelector('.cv-range-val').textContent = fmtForce(f);
    p.querySelector('.cv-sum').textContent = `force ${fmtForce(cv.force)} · ${cv.avoid ? 'éviter de repasser' : 'repasser permis'}`;
    p.querySelector('#cv-avoid').checked = cv.avoid;
    p.querySelector('.cv-switch').classList.toggle('is-on', cv.avoid);
    p.querySelector('.cv-row--weight').classList.toggle('is-off', !cv.avoid);
    p.querySelectorAll('[data-act="weight"]').forEach(b => {
        const on = Number(b.dataset.w) === cv.weight;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
        b.disabled = !cv.avoid;
    });
    p.querySelector('.cv-slow--avoid').hidden = !(cv.avoid && cv.engine && cv.engine.key !== 'local');
}

function renderEngine() {
    const p = cv.panel.querySelector('.cv-engine');
    p.innerHTML = cv.engine.key === 'local'
        ? '<i data-lucide="monitor"></i><span>Calculé par <b>BRouter de ce PC</b></span>'
        : '<i data-lucide="globe"></i><span>Calculé par <b>brouter.de</b> · BRouter de ce PC indisponible</span>';
    createIcons({ icons: appIcons, root: p });
    syncAdjust(); // la note « plus lent avec brouter.de » dépend du moteur
}

function render() {
    if (!cv || !cv.panel) return;
    const p = cv.panel;
    const n = cv.features.length;
    const nPts = cv.points.length;
    p.querySelector('.cv-head-sub').textContent =
        `${n} lieux · ${plural(n - 1, 'passage', 'passages')}${nPts ? ` · ${plural(nPts, 'point', 'points')} de passage` : ''}`;

    const cards = p.querySelector('.cv-cards');
    // Le rendu remplace les cartes : on rend le focus clavier au radio sélectionné.
    const hadFocus = cards.contains(document.activeElement);
    cards.innerHTML = VARIANTS.map(cardHtml).join('');
    if (hadFocus) cards.querySelector('input[name="cv-variant"]:checked')?.focus();
    createIcons({ icons: appIcons, root: cards });
    // Largeurs de la barre posées par le CSSOM (la CSP refuse les attributs style).
    cards.querySelectorAll('.cv-seg[data-w]').forEach(s => { s.style.width = `${s.dataset.w}%`; });

    const showDeltas = cv.selected === 'chemins' && cv.runs.direct.stats && !cv.runs.direct.stale && cv.runs.chemins.stats;
    p.querySelector('.cv-legend').hidden = !showDeltas;
    p.querySelector('.cv-slow--other').hidden = !VARIANTS.some(v => v !== cv.selected && cv.runs[v].stale);

    renderPoints();

    const btn = p.querySelector('[data-act="apply"]');
    const sel = cv.runs[cv.selected];
    const label = ROUTING_VARIANTS[cv.selected].label;
    if (cv.applying) {
        btn.disabled = true;
        btn.textContent = 'Enregistrement…';
    } else if (sel.status === 'ready' && !sel.busy && !sel.stale) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="check"></i><span>Enregistrer avec ${label}</span>`;
        createIcons({ icons: appIcons, root: btn });
    } else {
        btn.disabled = true;
        btn.textContent = sel.status === 'failed' ? `Enregistrer avec ${label}` : `${label} se calcule…`;
    }
}

function renderPoints() {
    const p = cv.panel;
    const nPts = cv.points.length;
    p.querySelector('.pp-count').textContent = nPts ? plural(nPts, 'point', 'points') : 'aucun';
    const tool = (act, on) => {
        const b = p.querySelector(`[data-act="${act}"]`);
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
    };
    tool('add', cv.addMode);
    tool('ways', zoneVisible);
    tool('layer', isReferenceVisible());
    const counts = {};
    cv.points.forEach(pt => { counts[pt.seg] = (counts[pt.seg] || 0) + 1; });
    const list = p.querySelector('.pp-list');
    list.innerHTML = cv.features.slice(1).map((_, seg) => {
        const c = counts[seg] || 0;
        const ends = `<span class="pp-num">${seg + 1}</span><span class="pp-arrow" aria-hidden="true">→</span><span class="pp-num">${seg + 2}</span>`;
        return c
            ? `<li>${ends}<span class="pp-pts">${plural(c, 'point', 'points')}</span><button class="pp-x" type="button" data-act="clear-seg" data-seg="${seg}" aria-label="Retirer les points du passage ${seg + 1} → ${seg + 2}"><i data-lucide="x"></i></button></li>`
            : `<li>${ends}<span class="pp-pts is-none">aucun</span></li>`;
    }).join('');
    createIcons({ icons: appIcons, root: list });
}

function cardHtml(variant) {
    const run = cv.runs[variant];
    const selected = cv.selected === variant;
    const label = ROUTING_VARIANTS[variant].label;
    const tag = variant === 'chemins' ? `<span class="cv-tag">force ${fmtForce(cv.force)}</span>` : '';

    if (run.status === 'failed') {
        const top = `<div class="cv-card-top"><span class="cv-radio"></span><span class="cv-sw cv-sw--${variant}"></span><span class="cv-name">${label}</span><span class="cv-tag">non calculée</span></div>`;
        return `<div class="cv-card is-failed" data-variant="${variant}">
            ${top}
            <div class="cv-fail"><i data-lucide="alert-triangle"></i><p>${esc(run.error)}<small>${esc(failHint(run.error))}</small></p></div>
            <button class="cv-retry" type="button" data-act="retry"><i data-lucide="rotate-cw"></i>Réessayer</button>
        </div>`;
    }
    const updating = run.status === 'refreshing' || run.busy > 0;
    const cls = ['cv-card', 'is-compact', selected ? 'is-selected' : '', cv.hover === variant ? 'is-hover' : '',
        run.status === 'pending' ? 'is-pending' : '', updating ? 'is-refreshing' : ''].filter(Boolean).join(' ');
    const radio = `<input type="radio" name="cv-variant" value="${variant}"${selected ? ' checked' : ''}>`;
    const spin = '<span class="cv-updating"><span class="cv-spin"></span>Mise à jour…</span>';

    if (run.status === 'pending') {
        const prog = run.progress ? ` · passage ${run.progress.done} sur ${run.progress.total}` : '…';
        const top = `<div class="cv-card-top"><span class="cv-radio"></span><span class="cv-sw cv-sw--${variant}"></span><span class="cv-name">${label}</span>${tag}</div>`;
        return `<label class="${cls}" data-variant="${variant}">${radio}${top}
            <div class="cv-wait"><span class="cv-spin"></span>Calcul en cours${prog}</div>
            <div class="cv-skel"></div>
        </label>`;
    }

    const s = run.stats;
    const ways = s.ways || {};
    const nc = ways['non-classe'] || 0;
    const showNc = nc >= NON_CLASSE_MIN_M;
    const barKeys = showNc ? [...WAY_KEYS, 'non-classe'] : WAY_KEYS;
    const barTotal = barKeys.reduce((t, k) => t + (ways[k] || 0), 0) || 1;
    const bar = `<div class="cv-bar" aria-hidden="true">${barKeys.filter(k => ways[k] > 0)
        .map(k => `<span class="cv-seg cv-seg--${k}" data-w="${((ways[k] / barTotal) * 100).toFixed(2)}"></span>`).join('')}</div>`;

    // Variante non choisie : une ligne (distance, D+) et sa barre (décision de
    // Stefan, 13/11/2026) ; « Pas à jour » quand elle attend un recalcul.
    if (!selected) {
        const mini = run.stale
            ? '<span class="cv-mini is-stale">avant vos derniers points</span>'
            : updating ? spin
                : `<span class="cv-mini"><b>${kmNum(s.distM)}</b> km · D+ ${s.ascend == null ? '–' : s.ascend} m</span>`;
        const top = `<div class="cv-card-top"><span class="cv-radio"></span><span class="cv-sw cv-sw--${variant}"></span><span class="cv-name">${label}</span>${mini}</div>`;
        const stale = run.stale
            ? `<div class="cv-stale"><span>Pas à jour</span><button class="cv-retry" type="button" data-act="recompute"><i data-lucide="refresh-cw"></i>Recalculer ${label}</button></div>`
            : bar;
        return `<label class="${cls}" data-variant="${variant}">${radio}${top}${stale}</label>`;
    }

    const top = `<div class="cv-card-top"><span class="cv-radio"></span><span class="cv-sw cv-sw--${variant}"></span><span class="cv-name">${label}</span>${updating ? spin : tag}</div>`;
    // Écarts : Chemins seulement, et seulement si Direct est là, à jour, pour comparer.
    const ref = variant === 'chemins' && cv.runs.direct.stats && !cv.runs.direct.stale && !updating ? cv.runs.direct.stats : null;
    const delta = (value, refValue, better, threshold, fmt) => {
        if (!ref || !Number.isFinite(value) || !Number.isFinite(refValue)) return '';
        const d = compareToDirect(value, refValue, better, threshold);
        if (d.kind === 'egal') return '<span class="cv-delta cv-delta--egal">=</span>';
        return `<span class="cv-delta cv-delta--${d.kind}">${fmt(d.diff)}</span>`;
    };
    const kmDelta = (m) => formatKmDelta(m);
    const mDelta = (m) => (m < 0 ? '−' : '+') + Math.abs(Math.round(m));

    const stat = (l, v, unit, d) => `<div><div class="cv-stat-l">${l}</div><div class="cv-stat-v">${v} <small>${unit}</small>${d}</div></div>`;
    const stats = `<div class="cv-stats">
        ${stat('Distance', kmNum(s.distM), 'km', delta(s.distM, ref?.distM, 'less', KM_THRESHOLD_M, kmDelta))}
        ${stat('D+', s.ascend == null ? '–' : s.ascend, 'm', delta(s.ascend, ref?.ascend, 'less', ASCEND_THRESHOLD_M, mDelta))}
        ${stat('Repassé', kmNum(s.repassM), 'km', delta(s.repassM, ref?.repassM, 'less', KM_THRESHOLD_M, kmDelta))}
    </div>`;
    const cols = `<div class="cv-ways">${WAY_KEYS.map(k => `<div>
        <div class="cv-way-l"><span class="trace-way-sw trace-way-sw--${k}"></span>${wayLabel(k)}</div>
        <div class="cv-way-v">${formatKm(ways[k] || 0)}${delta(ways[k] || 0, ref?.ways?.[k] ?? NaN, WAY_BETTER[k], KM_THRESHOLD_M, kmDelta)}</div>
    </div>`).join('')}</div>`;
    const ncLine = showNc ? `<p class="cv-way-nc"><span class="trace-way-sw trace-way-sw--non-classe"></span>Non classé <b>${formatKm(nc)}</b></p>` : '';
    const warn = s.failCount > 0
        ? `<p class="cv-warn"><i data-lucide="alert-triangle"></i>${s.failCount > 1 ? `${s.failCount} passages` : '1 passage'} en ligne droite</p>` : '';

    return `<label class="${cls}" data-variant="${variant}">${radio}${top}${stats}${bar}${cols}${ncLine}${warn}</label>`;
}

// Deuxième ligne du message d'échec : ce que l'auteur peut faire.
function failHint(message) {
    if (/ce PC/.test(message || '')) return "Vérifiez qu'il est lancé, puis réessayez.";
    if (/limite/.test(message || '')) return 'Réessayez dans quelques minutes.';
    return 'Réessayez dans un instant.';
}

async function apply() {
    if (!cv || cv.applying) return;
    const run = cv.runs[cv.selected];
    if (run.status !== 'ready' || run.busy || run.stale) return;
    cv.applying = true;
    render();
    const choice = {
        routing: routingFor(cv.selected), engine: cv.engine, result: run.result,
        points: cv.points.map(({ seg, lat, lng }) => ({ seg, lat, lng })),
    };
    const { onApply } = cv;
    // Les lignes de comparaison partent avant que le tracé retenu soit redessiné
    // avec ses types de voie.
    teardown();
    await onApply(choice);
}
