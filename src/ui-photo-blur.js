/**
 * ui-photo-blur.js
 * Modale « Flouter la photo » (outil de la modale d'import, à côté de « Rogner »).
 *
 * L'utilisateur trace des rectangles sur les visages, plaques ou panneaux ;
 * chaque zone s'affiche déjà pixelisée, une croix la retire. « Flouter » rend
 * le JPEG. L'appelant remplace la copie de travail ; l'original sur le disque
 * n'est jamais touché.
 *
 * Zoom (demandé par Stefan le 09/11/2026, « pas évident à l'usage ») : boutons
 * − / + / Ajuster et molette sur la photo (centrée sur le curseur). Une fois
 * zoomé, on se déplace avec le mode « Déplacer », la barre d'espace maintenue,
 * le bouton du milieu de la souris ou les barres de défilement.
 *
 * Le canvas affiché EST le rendu final (pleine résolution, plafonnée comme le
 * rognage) : ce qu'on vérifie au zoom est exactement ce qui sera enregistré.
 * Les zones sont gardées en coordonnées NORMALISÉES (0..1), indépendantes du zoom.
 */

import { openHwModal, closeHwModal } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { applyPixelation } from './photo-blur.js';

/** Plus grand côté du rendu — même plafond que le rognage (getCroppedCanvas). */
const OUTPUT_MAX = 4096;

/** En dessous de cette taille (pixels d'écran), un tracé est un simple clic : ignoré. */
const MIN_DRAG_PX = 8;

/** Niveaux de zoom, relatifs à la photo ajustée à la fenêtre. */
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8];

/** Hauteur maximale de la zone d'image (même borne que le rognage). */
const VIEW_MAX_VH = 0.68;

function makeCanvas(img, maxSide) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    return canvas;
}

function toolButton(icon, label, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pb-blur-tool';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = `<i data-lucide="${icon}"></i>${label ? `<span>${label}</span>` : ''}`;
    return b;
}

/**
 * Ouvre l'éditeur sur `file`. L'appelant gère suspendHwModal/resumeHwModal.
 * @param {File|Blob} file
 * @returns {Promise<Blob|null>} le JPEG flouté, ou null si annulé / sans zone.
 */
export async function openBlurEditor(file) {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    // onload plutôt que img.decode() : decode() reste en attente tant que la
    // page n'est pas peinte (constaté dans un onglet masqué) ; drawImage
    // décode de toute façon à la demande.
    const loaded = new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('image illisible'));
    });
    img.src = objectUrl;
    try {
        await loaded;
    } catch (e) {
        URL.revokeObjectURL(objectUrl);
        throw e;
    }

    /** @type {Array<{x:number,y:number,w:number,h:number}>} */
    const rects = [];
    let mode = 'draw';      // 'draw' | 'pan'
    let spaceHeld = false;  // barre d'espace maintenue = déplacement temporaire
    let zoomIdx = 0;
    let baseW = 0, baseH = 0; // taille affichée à ×1 (photo ajustée)

    // --- DOM ---
    const bodyEl = document.createElement('div');
    bodyEl.className = 'pb-blur-body';

    const tools = document.createElement('div');
    tools.className = 'pb-blur-tools';
    const modeGroup = document.createElement('div');
    modeGroup.className = 'pb-blur-toolgroup';
    const drawBtn = toolButton('square-dashed', 'Tracer', 'Tracer une zone à flouter');
    const panBtn = toolButton('hand', 'Déplacer', 'Déplacer la photo zoomée (ou maintenir Espace)');
    modeGroup.append(drawBtn, panBtn);
    const zoomGroup = document.createElement('div');
    zoomGroup.className = 'pb-blur-toolgroup';
    const outBtn = toolButton('zoom-out', '', 'Dézoomer');
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'pb-blur-zoom-label';
    const inBtn = toolButton('zoom-in', '', 'Zoomer (ou molette sur la photo)');
    const fitBtn = toolButton('maximize', 'Ajuster', 'Voir la photo entière');
    zoomGroup.append(outBtn, zoomLabel, inBtn, fitBtn);
    tools.append(modeGroup, zoomGroup);

    const hint = document.createElement('p');
    hint.className = 'pb-blur-hint';
    hint.textContent = 'Tracez un rectangle sur chaque visage, plaque ou panneau à masquer ; la croix retire une zone. Zoomez (molette ou +) pour vérifier qu\'elle est bien couverte.';

    const wrap = document.createElement('div');
    wrap.className = 'pb-blur-wrap';
    const stage = document.createElement('div');
    stage.className = 'pb-blur-stage';
    const canvas = makeCanvas(img, OUTPUT_MAX);
    canvas.className = 'pb-blur-canvas';
    const layer = document.createElement('div');
    layer.className = 'pb-blur-layer';
    stage.append(canvas, layer);
    wrap.appendChild(stage);
    bodyEl.append(tools, hint, wrap);

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
    createIcons({ icons: appIcons, root: tools });

    const pct = (v) => `${(v * 100).toFixed(4)}%`;

    // --- Rendu : photo + zones pixelisées, puis cadres et croix ---
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

    // --- Zoom ---
    function computeBase() {
        const availW = wrap.clientWidth || canvas.width;
        // La barre d'outils et la consigne prennent leur place dans le même
        // budget de hauteur que le rognage, sinon le pied de modale défile.
        const chrome = tools.offsetHeight + hint.offsetHeight + 16;
        const availH = Math.max(160, Math.round(window.innerHeight * VIEW_MAX_VH) - chrome);
        const fit = Math.min(1, availW / canvas.width, availH / canvas.height);
        baseW = canvas.width * fit;
        baseH = canvas.height * fit;
        wrap.style.height = `${Math.round(baseH)}px`;
    }

    function updateZoomUi() {
        const z = ZOOMS[zoomIdx];
        zoomLabel.textContent = `×${String(z).replace('.', ',')}`;
        outBtn.disabled = zoomIdx === 0;
        fitBtn.disabled = zoomIdx === 0;
        inBtn.disabled = zoomIdx === ZOOMS.length - 1;
    }

    // Change de niveau en gardant sous le point (ax, ay) — coordonnées écran —
    // le même point de la photo. Sans point : le centre de la vue.
    function setZoom(idx, ax, ay) {
        idx = Math.max(0, Math.min(ZOOMS.length - 1, idx));
        if (idx === zoomIdx && canvas.style.width) return;
        const wb = wrap.getBoundingClientRect();
        if (ax === undefined) { ax = wb.left + wb.width / 2; ay = wb.top + wb.height / 2; }
        const sb = stage.getBoundingClientRect();
        const nx = sb.width ? Math.min(1, Math.max(0, (ax - sb.left) / sb.width)) : 0.5;
        const ny = sb.height ? Math.min(1, Math.max(0, (ay - sb.top) / sb.height)) : 0.5;

        zoomIdx = idx;
        const z = ZOOMS[zoomIdx];
        canvas.style.width = `${baseW * z}px`;
        canvas.style.height = `${baseH * z}px`;

        const sb2 = stage.getBoundingClientRect();
        wrap.scrollLeft += (sb2.left + nx * sb2.width) - ax;
        wrap.scrollTop += (sb2.top + ny * sb2.height) - ay;
        updateZoomUi();
    }

    outBtn.addEventListener('click', () => setZoom(zoomIdx - 1));
    inBtn.addEventListener('click', () => setZoom(zoomIdx + 1));
    fitBtn.addEventListener('click', () => setZoom(0));
    wrap.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.deltaY === 0) return;
        setZoom(zoomIdx + (e.deltaY < 0 ? 1 : -1), e.clientX, e.clientY);
    }, { passive: false });

    // --- Mode Tracer / Déplacer ---
    function updateModeUi() {
        const panning = mode === 'pan' || spaceHeld;
        drawBtn.classList.toggle('is-active', mode === 'draw');
        panBtn.classList.toggle('is-active', mode === 'pan');
        drawBtn.setAttribute('aria-pressed', String(mode === 'draw'));
        panBtn.setAttribute('aria-pressed', String(mode === 'pan'));
        stage.classList.toggle('is-pan', panning);
    }
    drawBtn.addEventListener('click', () => { mode = 'draw'; updateModeUi(); });
    panBtn.addEventListener('click', () => { mode = 'pan'; updateModeUi(); });

    function onKeyDown(e) {
        if (e.code !== 'Space' || e.repeat) {
            if (e.code === 'Space') e.preventDefault();
            return;
        }
        e.preventDefault(); // pas de défilement ni d'activation du bouton focalisé
        spaceHeld = true;
        updateModeUi();
    }
    function onKeyUp(e) {
        if (e.code !== 'Space') return;
        e.preventDefault();
        spaceHeld = false;
        updateModeUi();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // --- Pointeur : tracé d'un rectangle, ou déplacement ---
    let drag = null; // { kind: 'draw'|'pan', pointerId, ... }

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
        const middle = e.button === 1;
        if (e.button !== undefined && e.button !== 0 && !middle) return;
        if (drag) return;
        e.preventDefault();
        if (middle || mode === 'pan' || spaceHeld) {
            drag = { kind: 'pan', pointerId: e.pointerId, cx: e.clientX, cy: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
            stage.classList.add('is-panning');
        } else {
            const p = pointAt(e);
            const box = document.createElement('div');
            box.className = 'pb-blur-rect is-drawing';
            layer.appendChild(box);
            drag = { kind: 'draw', pointerId: e.pointerId, x0: p.x, y0: p.y, box };
        }
        try { stage.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    });

    stage.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        if (drag.kind === 'pan') {
            wrap.scrollLeft = drag.sl - (e.clientX - drag.cx);
            wrap.scrollTop = drag.st - (e.clientY - drag.cy);
            return;
        }
        const r = dragRect(pointAt(e));
        drag.box.style.left = pct(r.x);
        drag.box.style.top = pct(r.y);
        drag.box.style.width = pct(r.w);
        drag.box.style.height = pct(r.h);
    });

    function endDrag(e, keep) {
        if (!drag || e.pointerId !== drag.pointerId) return;
        if (drag.kind === 'pan') {
            drag = null;
            stage.classList.remove('is-panning');
            return;
        }
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
    // Le clic du milieu ouvre sinon le défilement automatique du navigateur.
    stage.addEventListener('auxclick', (e) => e.preventDefault());

    if (applyBtn) applyBtn.addEventListener('click', () => {
        if (rects.length === 0) return;
        applyBtn.disabled = true;
        // Le canvas affiché est déjà le rendu final (cf. en-tête).
        canvas.toBlob((blob) => {
            resultBlob = blob;
            closeHwModal();
        }, 'image/jpeg', 0.92);
    });

    render();
    computeBase();
    setZoom(0);
    updateModeUi();

    await closed;
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    URL.revokeObjectURL(objectUrl);
    return resultBlob;
}
