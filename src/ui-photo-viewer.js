// ui-photo-viewer.js
// Viewer photo de CONSULTATION — plein écran, immersif, chrome flottant épuré.
// Refonte chrome (handoff Claude Design) : fond noir opaque, header retiré (pas de
// compteur), boutons ronds « glass » unifiés (fermer / plein écran / nav / zoom),
// zoom = 3 pastilles (in/out/reset), vrai plein écran (API Fullscreen) qui masque
// tout sauf les flèches, pellicule centrée/scrollable. AUCUNE action d'édition.
// API openPhotoViewer(photos, startIndex) préservée.

import { openHwModal, closeHwModal } from './modal.js';
import { setCurrentPhotos, currentPhotoList, currentPhotoIndex } from './photo-service.js';
import { createIcons, appIcons } from './lucide-icons.js';

// ── Constantes zoom ──
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEPS = [1, 1.6, 2.6, 4];
const ZOOM_WHEEL_FACTOR = 0.0015;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 30;
const SWIPE_MIN = 50;

// ── État par ouverture ──
let zoom = { level: 1, tx: 0, ty: 0 };
let activePointers = new Map();
let pinchStart = null;
let panStart = null;
let swipeStart = null;
let lastTapTime = 0;
let lastTapPos = { x: 0, y: 0 };

// Listeners document (à retirer à la fermeture). Les listeners sur la stage
// meurent avec l'élément quand la modale ferme.
let docListeners = [];

// ── Refs DOM ──
let overlayEl = null, viewerEl = null, stageEl = null, imgEl = null, stripEl = null;
let zoomInBtn = null, zoomOutBtn = null;

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
    overlayEl = viewerEl = stageEl = imgEl = stripEl = null;
    zoomInBtn = zoomOutBtn = null;
}

/**
 * Ouvre le viewer photo de consultation.
 * @param {string[]} photos - URLs / objectURLs.
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
            <div class="hw-pv-stage" id="hw-pv-stage">
                <img class="hw-pv-img" id="hw-pv-img" alt="Photo" draggable="false">

                <div class="hw-pv-topright">
                    <button class="hw-pv-btn" id="hw-pv-fullscreen" type="button" aria-label="Plein écran"><i data-lucide="maximize"></i></button>
                    <button class="hw-pv-btn" id="hw-pv-close" type="button" aria-label="Fermer"><i data-lucide="x"></i></button>
                </div>

                <button class="hw-pv-btn is-lg hw-pv-nav is-prev" id="hw-pv-prev" type="button" aria-label="Photo précédente"><i data-lucide="chevron-left"></i></button>
                <button class="hw-pv-btn is-lg hw-pv-nav is-next" id="hw-pv-next" type="button" aria-label="Photo suivante"><i data-lucide="chevron-right"></i></button>

                <div class="hw-pv-zoom" role="group" aria-label="Zoom">
                    <button class="hw-pv-btn" id="hw-pv-zoom-in" type="button" aria-label="Agrandir"><i data-lucide="zoom-in"></i></button>
                    <button class="hw-pv-btn" id="hw-pv-zoom-out" type="button" aria-label="Réduire"><i data-lucide="zoom-out"></i></button>
                    <button class="hw-pv-btn" id="hw-pv-zoom-reset" type="button" aria-label="Réinitialiser le zoom"><i data-lucide="rotate-ccw"></i></button>
                </div>
            </div>

            <div class="hw-pv-strip" id="hw-pv-strip" aria-label="Pellicule des photos"></div>
        </div>
    `;

    const promise = openHwModal({
        size: 'xl',
        title: 'Photo',   // header masqué en CSS (.is-photo-viewer) — titre non affiché
        body,
        footer: false,
    });

    setTimeout(() => mount(), 30);

    promise.finally(() => {
        // Sortir du plein écran si on ferme depuis là
        if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (_) {} }
        clearDocListeners();
        resetState();
    });

    return promise;
}

function mount() {
    overlayEl = document.querySelector('.hw-modal-overlay.is-active');
    if (overlayEl) overlayEl.classList.add('is-photo-viewer');

    viewerEl = document.querySelector('.hw-modal-overlay.is-photo-viewer .hw-photo-viewer');
    if (!viewerEl) return;
    stageEl = viewerEl.querySelector('#hw-pv-stage');
    imgEl = viewerEl.querySelector('#hw-pv-img');
    stripEl = viewerEl.querySelector('#hw-pv-strip');
    zoomInBtn = viewerEl.querySelector('#hw-pv-zoom-in');
    zoomOutBtn = viewerEl.querySelector('#hw-pv-zoom-out');

    createIcons({ icons: appIcons, root: viewerEl });

    buildStrip();
    bindNavigation();
    bindZoomButtons();
    bindChrome();      // fermer + plein écran
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

    resetZoom();
    setActiveThumb();
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

// ── Chrome : fermer + plein écran ──

function bindChrome() {
    viewerEl.querySelector('#hw-pv-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (_) {} }
        closeHwModal();
    });
    viewerEl.querySelector('#hw-pv-fullscreen')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFullscreen();
    });
    // La classe .is-fullscreen (chrome minimal) suit l'état réel du Fullscreen API,
    // pour que Échap (sortie native) ramène aussi le chrome.
    addDocListener('fullscreenchange', () => {
        const fs = !!document.fullscreenElement;
        viewerEl?.classList.toggle('is-fullscreen', fs);
    });
}

function toggleFullscreen() {
    if (document.fullscreenElement) {
        try { document.exitFullscreen(); } catch (_) {}
    } else {
        const target = overlayEl || viewerEl;
        try { target?.requestFullscreen?.(); } catch (_) {}
    }
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
        if (i === currentPhotoIndex) thumb.classList.add('is-active');
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        thumb.appendChild(img);
        thumb.addEventListener('click', () => goTo(i));
        stripEl.appendChild(thumb);
    });
    // Débordement → flex-start (le scroll horizontal s'engage naturellement).
    requestAnimationFrame(() => {
        if (!stripEl) return;
        const overflows = stripEl.scrollWidth > stripEl.clientWidth + 1;
        stripEl.classList.toggle('is-overflow', overflows);
        if (overflows) {
            stripEl.querySelector('.hw-pv-strip-thumb.is-active')
                ?.scrollIntoView({ inline: 'center', block: 'nearest' });
        }
    });
}

function setActiveThumb() {
    if (!stripEl) return;
    stripEl.querySelectorAll('.hw-pv-strip-thumb').forEach((t, i) => {
        const active = i === currentPhotoIndex;
        t.classList.toggle('is-active', active);
        if (active && stripEl.classList.contains('is-overflow')) {
            t.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
        }
    });
}

// ── Zoom & pan ──

function applyTransform() {
    if (!imgEl || !viewerEl) return;
    imgEl.style.transform = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.level})`;
    viewerEl.dataset.zoom = zoom.level === 1 ? '1' : 'zoomed';
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

function clampPan() {
    if (!stageEl || !imgEl) return;
    const s = stageEl.getBoundingClientRect();
    const i = imgEl.getBoundingClientRect();
    const maxX = Math.max(0, (i.width - s.width) / 2);
    const maxY = Math.max(0, (i.height - s.height) / 2);
    zoom.tx = Math.max(-maxX, Math.min(maxX, zoom.tx));
    zoom.ty = Math.max(-maxY, Math.min(maxY, zoom.ty));
}

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

function stepZoom(dir) {
    const cur = zoom.level;
    const target = dir > 0
        ? (ZOOM_STEPS.find(s => s > cur + 0.001) ?? ZOOM_MAX)
        : ([...ZOOM_STEPS].reverse().find(s => s < cur - 0.001) ?? ZOOM_MIN);
    const c = stageCenter();
    zoomAtPoint(target, c.x, c.y);
}

function toggleZoom(clientX, clientY) {
    if (zoom.level === 1) zoomAtPoint(2.6, clientX, clientY);
    else resetZoom();
}

function bindZoomButtons() {
    zoomInBtn?.addEventListener('click', (e) => { e.stopPropagation(); stepZoom(1); });
    zoomOutBtn?.addEventListener('click', (e) => { e.stopPropagation(); stepZoom(-1); });
    viewerEl.querySelector('#hw-pv-zoom-reset')?.addEventListener('click', (e) => { e.stopPropagation(); resetZoom(); });
}

// ── Gestes (Pointer Events) ──

function bindGestures() {
    if (!stageEl) return;

    stageEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoomAtPoint(zoom.level + (-e.deltaY * ZOOM_WHEEL_FACTOR), e.clientX, e.clientY);
    }, { passive: false });

    stageEl.addEventListener('dblclick', (e) => {
        if (e.target.closest('.hw-pv-btn')) return;
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
    // Les contrôles flottants vivent dans la stage : ne pas démarrer un
    // pan/swipe/pinch quand on appuie sur un bouton.
    if (e.target.closest('.hw-pv-btn')) return;
    stageEl.setPointerCapture?.(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2) {
        const [a, b] = [...activePointers.values()];
        pinchStart = { dist: dist(a, b), level: zoom.level };
        panStart = null;
        swipeStart = null;
        return;
    }

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

    if (activePointers.size === 2 && pinchStart) {
        const [a, b] = [...activePointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        zoomAtPoint(pinchStart.level * (dist(a, b) / pinchStart.dist), mid.x, mid.y);
        return;
    }

    if (panStart && zoom.level > 1) {
        zoom.tx = panStart.tx + (e.clientX - panStart.x);
        zoom.ty = panStart.ty + (e.clientY - panStart.y);
        clampPan();
        applyTransform();
    }
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
