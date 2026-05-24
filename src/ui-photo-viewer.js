// ui-photo-viewer.js
// Viewer photo de CONSULTATION — plein écran, immersif, zoom/pan + pellicule.
// Variante hw-modal (.hw-modal-overlay.is-photo-viewer). UN seul viewer partagé
// par tous les points d'entrée de consultation (hero d'une fiche, vignettes de
// la grille d'édition). AUCUNE action d'édition ici (handoff "viewer de
// consultation"). API openPhotoViewer(photos, startIndex) préservée.

import { openHwModal } from './modal.js';
import { setCurrentPhotos, currentPhotoList, currentPhotoIndex } from './photo-service.js';
import { createIcons, appIcons } from './lucide-icons.js';

// ── Constantes zoom ──
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEPS = [1, 1.6, 2.6, 4];   // paliers boutons + double-tap
const ZOOM_WHEEL_FACTOR = 0.0015;       // sensibilité molette
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 30;
const SWIPE_MIN = 50;

// ── État par ouverture (réinitialisé à chaque open) ──
let zoom = { level: 1, tx: 0, ty: 0 };
let activePointers = new Map();  // pointerId → { x, y }
let pinchStart = null;           // { dist, level }
let panStart = null;             // { x, y, tx, ty }
let swipeStart = null;           // { x, y } — seulement à level 1
let lastTapTime = 0;
let lastTapPos = { x: 0, y: 0 };

// Listeners au niveau document (à retirer à la fermeture — ils survivent au DOM).
// Les listeners posés sur la stage meurent avec l'élément quand la modale ferme.
let docListeners = [];

// ── Refs DOM (résolues au mount) ──
let viewerEl = null, stageEl = null, imgEl = null, stripEl = null;
let zoomLevelEl = null, zoomInBtn = null, zoomOutBtn = null;

function addDocListener(type, fn, opts) {
    document.addEventListener(type, fn, opts);
    docListeners.push({ type, fn, opts });
}

function clearDocListeners() {
    docListeners.forEach(({ type, fn, opts }) => document.removeEventListener(type, fn, opts));
    docListeners = [];
}

function resetState() {
    zoom = { level: 1, tx: 0, ty: 0 };
    activePointers = new Map();
    pinchStart = null;
    panStart = null;
    swipeStart = null;
    lastTapTime = 0;
    viewerEl = stageEl = imgEl = stripEl = null;
    zoomLevelEl = zoomInBtn = zoomOutBtn = null;
}

/**
 * Ouvre le viewer photo de consultation.
 * @param {string[]} photos - URLs / objectURLs des photos.
 * @param {number} startIndex - index initial (défaut 0).
 * @returns {Promise<void>} - résout à la fermeture.
 */
export function openPhotoViewer(photos, startIndex = 0) {
    if (!photos || photos.length === 0) return Promise.resolve();
    resetState();
    setCurrentPhotos(photos, startIndex);

    const isSingle = photos.length <= 1;

    const body = `
        <div class="hw-photo-viewer${isSingle ? ' is-single' : ''}" data-zoom="1">
            <button class="hw-pv-nav is-prev" id="hw-pv-prev" type="button" aria-label="Photo précédente"><i data-lucide="chevron-left"></i></button>

            <div class="hw-pv-stage" id="hw-pv-stage">
                <img class="hw-pv-img" id="hw-pv-img" alt="Photo" draggable="false">
            </div>

            <button class="hw-pv-nav is-next" id="hw-pv-next" type="button" aria-label="Photo suivante"><i data-lucide="chevron-right"></i></button>

            <div class="hw-pv-zoom" role="group" aria-label="Zoom">
                <button class="hw-pv-zoom-btn" id="hw-pv-zoom-in" type="button" aria-label="Agrandir">+</button>
                <span class="hw-pv-zoom-level" id="hw-pv-zoom-level" aria-live="polite">100%</span>
                <button class="hw-pv-zoom-btn" id="hw-pv-zoom-out" type="button" aria-label="Réduire">&minus;</button>
                <button class="hw-pv-zoom-btn" id="hw-pv-zoom-fit" type="button" aria-label="Ajuster"><i data-lucide="maximize-2"></i></button>
            </div>

            <div class="hw-pv-strip" id="hw-pv-strip" aria-label="Pellicule des photos"></div>
        </div>
    `;

    const promise = openHwModal({
        size: 'xl',
        title: getViewerTitle(),
        body,
        footer: false, // info-only : la croix du header est l'unique fermeture explicite
    });

    // Mount après injection DOM (hw-modal ajoute .is-active après reflow).
    setTimeout(() => mount(), 30);

    // Esc / clic backdrop : gérés nativement par hw-modal. On nettoie juste nos
    // listeners document à la fermeture (quelle qu'en soit la cause).
    promise.finally(() => {
        clearDocListeners();
        resetState();
    });

    return promise;
}

function mount() {
    const overlay = document.querySelector('.hw-modal-overlay.is-active');
    if (overlay) overlay.classList.add('is-photo-viewer');

    viewerEl = document.querySelector('.hw-modal-overlay.is-photo-viewer .hw-photo-viewer');
    if (!viewerEl) return;
    stageEl = viewerEl.querySelector('#hw-pv-stage');
    imgEl = viewerEl.querySelector('#hw-pv-img');
    stripEl = viewerEl.querySelector('#hw-pv-strip');
    zoomLevelEl = viewerEl.querySelector('#hw-pv-zoom-level');
    zoomInBtn = viewerEl.querySelector('#hw-pv-zoom-in');
    zoomOutBtn = viewerEl.querySelector('#hw-pv-zoom-out');

    createIcons({ icons: appIcons, root: viewerEl });

    buildStrip();
    bindNavigation();
    bindZoomButtons();
    bindGestures();
    bindKeyboard();

    renderCurrentPhoto();
}

// ── Rendu ──

function renderCurrentPhoto() {
    if (!imgEl) return;
    const url = currentPhotoList[currentPhotoIndex];
    if (!url) return;

    if (stageEl) stageEl.classList.add('is-loading');
    imgEl.onload = () => { if (stageEl) stageEl.classList.remove('is-loading'); };
    imgEl.onerror = () => { if (stageEl) stageEl.classList.remove('is-loading'); };
    imgEl.src = url;

    resetZoom();        // chaque changement de photo réinitialise le zoom
    updateTitle();
    setActiveThumb();
}

function updateTitle() {
    const titleEl = document.querySelector('.hw-modal-overlay.is-photo-viewer .hw-modal-title');
    if (titleEl) titleEl.textContent = getViewerTitle();
}

function getViewerTitle() {
    return `Photo ${currentPhotoIndex + 1} / ${currentPhotoList.length}`;
}

// ── Navigation ──

function bindNavigation() {
    viewerEl.querySelector('#hw-pv-prev')?.addEventListener('click', (e) => {
        e.stopPropagation(); goBy(-1); e.currentTarget.blur();
    });
    viewerEl.querySelector('#hw-pv-next')?.addEventListener('click', (e) => {
        e.stopPropagation(); goBy(1); e.currentTarget.blur();
    });
}

// Wraparound géré localement (évite la dépendance au side-effect DOM de changePhoto).
function goBy(delta) {
    const len = currentPhotoList.length;
    if (len <= 1) return;
    let idx = currentPhotoIndex + delta;
    if (idx >= len) idx = 0;
    if (idx < 0) idx = len - 1;
    setCurrentPhotos(currentPhotoList, idx);
    renderCurrentPhoto();
}

function goTo(index) {
    if (index < 0 || index >= currentPhotoList.length || index === currentPhotoIndex) return;
    setCurrentPhotos(currentPhotoList, index);
    renderCurrentPhoto();
}

function bindKeyboard() {
    addDocListener('keydown', (e) => {
        if (e.key === 'ArrowRight') goBy(1);
        else if (e.key === 'ArrowLeft') goBy(-1);
    });
}

// ── Pellicule ──

function buildStrip() {
    if (!stripEl || currentPhotoList.length <= 1) return; // .is-single masque déjà
    stripEl.innerHTML = '';
    currentPhotoList.forEach((url, i) => {
        const thumb = document.createElement('button');
        thumb.type = 'button';
        thumb.className = 'hw-pv-strip-thumb';
        thumb.dataset.index = String(i);
        thumb.setAttribute('aria-label', `Photo ${i + 1}`);
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        thumb.appendChild(img);
        thumb.addEventListener('click', () => goTo(i));
        stripEl.appendChild(thumb);
    });
}

function setActiveThumb() {
    if (!stripEl) return;
    stripEl.querySelectorAll('.hw-pv-strip-thumb').forEach((t, i) => {
        const active = i === currentPhotoIndex;
        t.classList.toggle('is-active', active);
        if (active) t.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    });
}

// ── Zoom & pan ──

function applyTransform() {
    if (!imgEl || !viewerEl) return;
    imgEl.style.transform = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.level})`;
    viewerEl.dataset.zoom = zoom.level === 1 ? '1' : 'zoomed';
    if (zoomLevelEl) zoomLevelEl.textContent = `${Math.round(zoom.level * 100)}%`;
    if (zoomOutBtn) zoomOutBtn.disabled = zoom.level <= ZOOM_MIN;
    if (zoomInBtn) zoomInBtn.disabled = zoom.level >= ZOOM_MAX;
}

function resetZoom() {
    zoom = { level: 1, tx: 0, ty: 0 };
    applyTransform();
}

function clampLevel(l) {
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, l));
}

// Contraint le pan pour que l'image ne sorte pas plus que sa moitié hors-cadre.
function clampPan() {
    if (!stageEl || !imgEl) return;
    const s = stageEl.getBoundingClientRect();
    const i = imgEl.getBoundingClientRect();
    const maxX = Math.max(0, (i.width - s.width) / 2);
    const maxY = Math.max(0, (i.height - s.height) / 2);
    zoom.tx = Math.max(-maxX, Math.min(maxX, zoom.tx));
    zoom.ty = Math.max(-maxY, Math.min(maxY, zoom.ty));
}

// Zoom centré sur un point écran (curseur / midpoint pinch) : (px,py) reste fixe.
function zoomAtPoint(newLevel, clientX, clientY) {
    newLevel = clampLevel(newLevel);
    if (stageEl) {
        const r = stageEl.getBoundingClientRect();
        const px = clientX - (r.left + r.width / 2);
        const py = clientY - (r.top + r.height / 2);
        const ratio = newLevel / zoom.level;
        zoom.tx = px - (px - zoom.tx) * ratio;
        zoom.ty = py - (py - zoom.ty) * ratio;
    }
    zoom.level = newLevel;
    if (zoom.level === 1) { zoom.tx = 0; zoom.ty = 0; }
    clampPan();
    applyTransform();
}

function stageCenter() {
    const r = stageEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Passe au palier ZOOM_STEPS suivant/précédent, centré (sur un point ou le centre).
function stepZoom(dir, atX, atY) {
    const cur = zoom.level;
    const target = dir > 0
        ? (ZOOM_STEPS.find(s => s > cur + 0.001) ?? ZOOM_MAX)
        : ([...ZOOM_STEPS].reverse().find(s => s < cur - 0.001) ?? ZOOM_MIN);
    const c = stageCenter();
    zoomAtPoint(target, atX ?? c.x, atY ?? c.y);
}

function toggleZoom(clientX, clientY) {
    if (zoom.level === 1) zoomAtPoint(2.6, clientX, clientY);
    else resetZoom();
}

function bindZoomButtons() {
    zoomInBtn?.addEventListener('click', (e) => { e.stopPropagation(); stepZoom(1); });
    zoomOutBtn?.addEventListener('click', (e) => { e.stopPropagation(); stepZoom(-1); });
    viewerEl.querySelector('#hw-pv-zoom-fit')?.addEventListener('click', (e) => { e.stopPropagation(); resetZoom(); });
    zoomLevelEl?.addEventListener('click', (e) => { e.stopPropagation(); resetZoom(); });
}

// ── Gestes (Pointer Events unifient souris / tactile / stylet) ──

function bindGestures() {
    if (!stageEl) return;

    // Molette → zoom centré curseur
    stageEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoomAtPoint(zoom.level + (-e.deltaY * ZOOM_WHEEL_FACTOR), e.clientX, e.clientY);
    }, { passive: false });

    // Double-clic souris → toggle zoom (le tactile passe par le double-tap)
    stageEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        toggleZoom(e.clientX, e.clientY);
    });

    stageEl.addEventListener('pointerdown', onPointerDown);
    stageEl.addEventListener('pointermove', onPointerMove);
    stageEl.addEventListener('pointerup', onPointerUp);
    stageEl.addEventListener('pointercancel', onPointerUp);
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function onPointerDown(e) {
    stageEl.setPointerCapture?.(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 2 doigts → démarrer pinch
    if (activePointers.size === 2) {
        const [a, b] = [...activePointers.values()];
        pinchStart = { dist: dist(a, b), level: zoom.level };
        panStart = null;
        swipeStart = null;
        return;
    }

    // Double-tap tactile (le double-clic souris est géré séparément)
    const now = Date.now();
    if (e.pointerType !== 'mouse'
        && now - lastTapTime < DOUBLE_TAP_MS
        && Math.hypot(e.clientX - lastTapPos.x, e.clientY - lastTapPos.y) < DOUBLE_TAP_DIST) {
        toggleZoom(e.clientX, e.clientY);
        lastTapTime = 0;
        panStart = null;
        swipeStart = null;
        return;
    }
    lastTapTime = now;
    lastTapPos = { x: e.clientX, y: e.clientY };

    if (zoom.level > 1) {
        panStart = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty };
        swipeStart = null;
        viewerEl.classList.add('is-panning');
    } else {
        swipeStart = { x: e.clientX, y: e.clientY };
        panStart = null;
    }
}

function onPointerMove(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Pinch (2 doigts)
    if (activePointers.size === 2 && pinchStart) {
        const [a, b] = [...activePointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        zoomAtPoint(pinchStart.level * (dist(a, b) / pinchStart.dist), mid.x, mid.y);
        return;
    }

    // Pan (1 doigt, zoomé)
    if (panStart && zoom.level > 1) {
        zoom.tx = panStart.tx + (e.clientX - panStart.x);
        zoom.ty = panStart.ty + (e.clientY - panStart.y);
        clampPan();
        applyTransform();
    }
    // À level 1 : on ne bouge rien, la décision swipe se prend au pointerup.
}

function onPointerUp(e) {
    const wasSwipe = swipeStart && zoom.level === 1;
    const dx = wasSwipe ? e.clientX - swipeStart.x : 0;
    const dy = wasSwipe ? e.clientY - swipeStart.y : 0;

    activePointers.delete(e.pointerId);
    stageEl.releasePointerCapture?.(e.pointerId);

    if (activePointers.size < 2) pinchStart = null;
    if (panStart) {
        panStart = null;
        viewerEl.classList.remove('is-panning');
    }

    if (wasSwipe && Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy)) {
        goBy(dx > 0 ? -1 : 1);
    }
    swipeStart = null;
}
