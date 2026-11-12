// fullscreen-toggle.js
// Bouton « Plein écran » (Fullscreen API), carré de la pile de contrôles de la
// carte (map.js FullscreenControl). Bascule l'icône maximize↔minimize,
// l'info-bulle / nom accessible et l'aria-pressed selon l'état réel
// (resynchronisé via fullscreenchange, donc cohérent même si l'utilisateur
// sort via Échap ou F11).
//
// Historique : bouton de la barre du haut jusqu'au 11/10/2026, puis entrée du
// menu Outils (place pour « Que faire ? »), puis la pile de la carte le
// 12/11/2026 (handoff Claude Design « écran bas ») : c'est un réglage de la
// vue, et sur un petit portable il est le plus gros gain de hauteur.
//
// PC-only : la PWA mobile est déjà plein écran (display: standalone) ; map.js
// n'ajoute pas le bouton sur mobile.

import { createIcons, appIcons } from './lucide-icons.js';

function isFullscreen() {
    return Boolean(document.fullscreenElement);
}

export function isFullscreenSupported() {
    return typeof document.documentElement.requestFullscreen === 'function';
}

function updateButtonState(btn) {
    const on = isFullscreen();
    const label = on ? 'Quitter le plein écran' : 'Plein écran';
    btn.innerHTML = `<i data-lucide="${on ? 'minimize' : 'maximize'}"></i>`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(on));
    createIcons({ icons: appIcons, root: btn });
}

async function toggle() {
    try {
        if (isFullscreen()) {
            await document.exitFullscreen();
        } else {
            await document.documentElement.requestFullscreen();
        }
    } catch {
        // L'utilisateur peut refuser (rare) ou le navigateur peut bloquer
        // (iframe sans allow="fullscreen"). On échoue silencieusement : le
        // bouton reste utilisable au prochain clic.
    }
}

// Câble un bouton existant (le lien Leaflet de la pile). Appelé une fois.
export function bindFullscreenButton(btn) {
    if (!btn) return;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        toggle();
    });
    document.addEventListener('fullscreenchange', () => updateButtonState(btn));
    updateButtonState(btn);
}
