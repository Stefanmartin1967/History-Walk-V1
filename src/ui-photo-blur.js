/**
 * ui-photo-blur.js
 * Modale « Flouter la photo » (outil de la modale d'import, à côté de « Rogner »).
 *
 * L'utilisateur trace des rectangles sur les visages, plaques ou panneaux ;
 * chaque zone s'affiche déjà pixelisée, une croix la retire. « Flouter » rend
 * l'image pleine résolution (plafonnée comme le rognage) avec les zones
 * pixelisées, en JPEG. L'appelant remplace la copie de travail ; l'original sur
 * le disque n'est jamais touché.
 *
 * Les zones sont gardées en coordonnées NORMALISÉES (0..1) : le même jeu sert à
 * l'aperçu réduit et au rendu final pleine résolution.
 */

import { openHwModal, closeHwModal } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { applyPixelation } from './photo-blur.js';

/** Plus grand côté du canvas d'aperçu (affiché ensuite à la taille de la modale). */
const PREVIEW_MAX = 1600;

/** Plus grand côté du rendu final — même plafond que le rognage (getCroppedCanvas). */
const OUTPUT_MAX = 4096;

/** En dessous de cette taille (pixels d'écran), un tracé est un simple clic : ignoré. */
const MIN_DRAG_PX = 8;

function makeCanvas(img, maxSide) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    return canvas;
}

/**
 * Ouvre l'éditeur sur `file`. L'appelant gère suspendHwModal/resumeHwModal.
 * @param {File|Blob} file
 * @returns {Promise<Blob|null>} le JPEG flouté, ou null si annulé / sans zone.
 */
export async function openBlurEditor(file) {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.src = objectUrl;
    try {
        await img.decode();
    } catch (e) {
        URL.revokeObjectURL(objectUrl);
        throw e;
    }

    /** @type {Array<{x:number,y:number,w:number,h:number}>} */
    const rects = [];

    const bodyEl = document.createElement('div');
    bodyEl.className = 'pb-blur-body';
    const hint = document.createElement('p');
    hint.className = 'pb-blur-hint';
    hint.textContent = 'Tracez un rectangle sur chaque visage, plaque ou panneau à masquer. La croix retire une zone.';
    const wrap = document.createElement('div');
    wrap.className = 'pb-blur-wrap';
    const stage = document.createElement('div');
    stage.className = 'pb-blur-stage';
    const canvas = makeCanvas(img, PREVIEW_MAX);
    canvas.className = 'pb-blur-canvas';
    const layer = document.createElement('div');
    layer.className = 'pb-blur-layer';
    stage.append(canvas, layer);
    wrap.appendChild(stage);
    bodyEl.append(hint, wrap);

    const ctx = canvas.getContext('2d');

    const footer = `
        <button class="btn btn-ghost" data-hw-modal-action="close" type="button">Annuler</button>
        <button class="btn btn-primary" id="pb-blur-apply" type="button" disabled><i data-lucide="grid-2x2"></i><span>Flouter</span></button>
    `;

    let resultBlob = null;

    const closed = openHwModal({
        size: 'xl',
        icon: 'grid-2x2',
        title: 'Flouter la photo',
        body: bodyEl,
        footer,
        closeOnBackdrop: false,
    });

    const applyBtn = document.getElementById('pb-blur-apply');

    const pct = (v) => `${(v * 100).toFixed(4)}%`;

    function render() {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        applyPixelation(ctx, canvas.width, canvas.height, rects);
        layer.replaceChildren();
        rects.forEach((r, i) => {
            const box = document.createElement('div');
            box.className = 'pb-blur-rect';
            box.style.left = pct(r.x);
            box.style.top = pct(r.y);
            box.style.width = pct(r.w);
            box.style.height = pct(r.h);
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'pb-blur-rect-del';
            del.title = 'Retirer cette zone';
            del.setAttribute('aria-label', 'Retirer cette zone');
            del.innerHTML = '<i data-lucide="x"></i>';
            del.addEventListener('pointerdown', (e) => e.stopPropagation());
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                rects.splice(i, 1);
                render();
            });
            box.appendChild(del);
            layer.appendChild(box);
        });
        createIcons({ icons: appIcons, root: layer });
        if (applyBtn) applyBtn.disabled = rects.length === 0;
    }

    // --- Tracé d'un rectangle (souris, doigt ou stylet) ---
    let drag = null; // { x0, y0, box, pointerId }

    function pointAt(e) {
        const b = stage.getBoundingClientRect();
        return {
            x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)),
            y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)),
            bw: b.width,
            bh: b.height,
        };
    }

    function dragRect(p) {
        return {
            x: Math.min(drag.x0, p.x),
            y: Math.min(drag.y0, p.y),
            w: Math.abs(p.x - drag.x0),
            h: Math.abs(p.y - drag.y0),
        };
    }

    stage.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        const p = pointAt(e);
        const box = document.createElement('div');
        box.className = 'pb-blur-rect is-drawing';
        layer.appendChild(box);
        drag = { x0: p.x, y0: p.y, box, pointerId: e.pointerId };
        try { stage.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    });

    stage.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const r = dragRect(pointAt(e));
        drag.box.style.left = pct(r.x);
        drag.box.style.top = pct(r.y);
        drag.box.style.width = pct(r.w);
        drag.box.style.height = pct(r.h);
    });

    function endDrag(e, keep) {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const p = pointAt(e);
        const r = dragRect(p);
        drag.box.remove();
        drag = null;
        if (keep && r.w * p.bw >= MIN_DRAG_PX && r.h * p.bh >= MIN_DRAG_PX) {
            rects.push(r);
        }
        render();
    }
    stage.addEventListener('pointerup', (e) => endDrag(e, true));
    stage.addEventListener('pointercancel', (e) => endDrag(e, false));

    if (applyBtn) applyBtn.addEventListener('click', () => {
        if (rects.length === 0) return;
        applyBtn.disabled = true;
        const out = makeCanvas(img, OUTPUT_MAX);
        const octx = out.getContext('2d');
        octx.drawImage(img, 0, 0, out.width, out.height);
        applyPixelation(octx, out.width, out.height, rects);
        out.toBlob((blob) => {
            resultBlob = blob;
            closeHwModal();
        }, 'image/jpeg', 0.92);
    });

    render();

    await closed;
    URL.revokeObjectURL(objectUrl);
    return resultBlob;
}
