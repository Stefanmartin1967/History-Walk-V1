// fullscreen-toggle.js
// Bouton plein écran via Fullscreen API. Bascule l'icône maximize↔minimize
// et l'aria-pressed selon l'état réel (resynchronisé via fullscreenchange,
// donc cohérent même si l'utilisateur sort via Échap ou F11).
//
// PC-only : la PWA mobile est déjà plein écran (display: standalone), donc
// le bouton n'a pas de sens là-bas. Le HTML est dans la topbar PC qui n'est
// pas rendue sur mobile.

import { createIcons, appIcons } from './lucide-icons.js';

const BTN_ID = 'btn-fullscreen-toggle';

function isFullscreen() {
    return Boolean(document.fullscreenElement);
}

function updateButtonState(btn) {
    const on = isFullscreen();
    const icon = on ? 'minimize' : 'maximize';
    btn.innerHTML = `<i data-lucide="${icon}"></i>`;
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Quitter le plein écran' : 'Plein écran';
    btn.setAttribute('aria-label', on ? 'Quitter le plein écran' : 'Passer en plein écran');
    createIcons({ icons: appIcons });
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
