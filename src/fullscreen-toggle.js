// fullscreen-toggle.js
// Entrée « Plein écran » du menu Outils, via Fullscreen API. Bascule l'icône
// maximize↔minimize, le libellé et l'aria-pressed selon l'état réel
// (resynchronisé via fullscreenchange, donc cohérent même si l'utilisateur
// sort via Échap ou F11). Bouton de la barre du haut jusqu'au 11/10/2026,
// déplacé dans le menu pour faire place à « Que faire ? ».
//
// PC-only : la PWA mobile est déjà plein écran (display: standalone), donc
// l'entrée n'a pas de sens là-bas. Le menu Outils n'est pas rendu sur mobile.

import { createIcons, appIcons } from './lucide-icons.js';

const BTN_ID = 'btn-fullscreen-toggle';

function isFullscreen() {
    return Boolean(document.fullscreenElement);
}

function updateButtonState(btn) {
    const on = isFullscreen();
    const icon = on ? 'minimize' : 'maximize';
    // Libellé visible (entrée de menu) : il porte aussi le nom accessible.
    btn.innerHTML = `<i data-lucide="${icon}"></i> ${on ? 'Quitter le plein écran' : 'Plein écran'}`;
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

export function setupFullscreenToggle() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    // Fullscreen API : support universel desktop (Chrome/Edge/Firefox/Safari).
    // Sur les rares navigateurs sans support, on masque le bouton.
    if (!document.documentElement.requestFullscreen) {
        btn.hidden = true;
        return;
    }

    btn.addEventListener('click', toggle);
    document.addEventListener('fullscreenchange', () => updateButtonState(btn));
}
