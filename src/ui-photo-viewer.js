// ui-photo-viewer.js
// Lightbox photo en plein écran via le système V2 hw-modal.
// L'apparence "lightbox" (overlay noir, sans padding, image plein écran)
// est obtenue via la classe .hw-modal-overlay.is-photo-viewer qui neutralise
// les défauts visuels de hw-modal (padding, max-width, fond bleu nuit).
//
// Migration N4 (rapport v3) : remplace l'ancien <div id="photo-viewer">
// statique d'index.html + le pattern cloneNode/replaceChild de l'ancien
// initPhotoViewer.

import { openHwModal } from './modal.js';
import {
    changePhoto,
    setCurrentPhotos,
    currentPhotoList,
    currentPhotoIndex
} from './photo-service.js';

let arrowKeyHandler = null;

/**
 * Ouvre le viewer photo en plein écran.
 * @param {string[]} photos - liste des URLs/objectURLs des photos.
 * @param {number} startIndex - index de la photo initiale (défaut 0).
 * @returns {Promise<void>} - résout à la fermeture du viewer.
 */
export function openPhotoViewer(photos, startIndex = 0) {
    if (!photos || photos.length === 0) return Promise.resolve();
    setCurrentPhotos(photos, startIndex);

    const body = `
        <div class="hw-photo-viewer">
            <button class="hw-photo-viewer-nav is-prev" id="hw-viewer-prev" type="button" aria-label="Photo précédente">❮</button>
            <img class="hw-photo-viewer-img" id="hw-viewer-img" alt="Photo">
            <button class="hw-photo-viewer-nav is-next" id="hw-viewer-next" type="button" aria-label="Photo suivante">❯</button>
        </div>
    `;

    const promise = openHwModal({
        size: 'xl',
        title: getViewerTitle(),
        body,
        footer: false, // Lightbox info-only : la croix du header est l'unique fermeture explicite
    });

    // Patch CSS variant + listeners après injection DOM (V2 ajoute is-active
    // après reflow, et les data-listeners globaux n'incluent pas nos boutons custom).
    setTimeout(() => {
        const overlay = document.querySelector('.hw-modal-overlay.is-active');
        if (overlay) overlay.classList.add('is-photo-viewer');
        bindNavigation();
        renderCurrentPhoto();
    }, 30);

    // Navigation clavier (← →). Escape est géré nativement par hw-modal.
    arrowKeyHandler = (e) => {
        if (e.key === 'ArrowRight') changeAndUpdate(1);
        else if (e.key === 'ArrowLeft') changeAndUpdate(-1);
    };
    document.addEventListener('keydown', arrowKeyHandler);

    promise.finally(() => {
        if (arrowKeyHandler) {
            document.removeEventListener('keydown', arrowKeyHandler);
            arrowKeyHandler = null;
        }
    });

    return promise;
}

function bindNavigation() {
    document.getElementById('hw-viewer-prev')?.addEventListener('click', (e) => {
        e.stopPropagation();
        changeAndUpdate(-1);
        e.currentTarget.blur(); // évite que Espace/Enter ré-actionne le bouton focus
    });
    document.getElementById('hw-viewer-next')?.addEventListener('click', (e) => {
        e.stopPropagation();
        changeAndUpdate(1);
        e.currentTarget.blur();
    });
}

function changeAndUpdate(delta) {
    if (currentPhotoList.length <= 1) return;
    changePhoto(delta);
    renderCurrentPhoto();
}

function renderCurrentPhoto() {
    const img = document.getElementById('hw-viewer-img');
    if (img && currentPhotoList[currentPhotoIndex]) {
        img.src = currentPhotoList[currentPhotoIndex];
    }
    const titleEl = document.querySelector('.hw-modal-overlay.is-photo-viewer .hw-modal-title');
    if (titleEl) titleEl.textContent = getViewerTitle();
}

function getViewerTitle() {
    return `Photo ${currentPhotoIndex + 1} / ${currentPhotoList.length}`;
}
