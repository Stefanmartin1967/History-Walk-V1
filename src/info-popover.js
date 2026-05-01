// info-popover.js
// Popover compact ancré sur l'icône "Informations" du header (anciennement
// "Afficher la légende"). Remplace la modale Légende plein écran.
//
// Contenu :
//   - Légende des polylines de circuits (Vol d'oiseau / Tracé réel / Terminé)
//   - Bouton "Visite guidée" qui rouvre la modal d'accueil en mode 4 cartes
//
// Toggle : un clic sur l'icône ouvre, un nouveau clic ferme.
// Fermeture aussi : clic à l'extérieur, touche Échap.

import { showWelcomeAgain } from './welcome.js';

const POPOVER_ID = 'info-popover';

export function showInfoPopover() {
    const existing = document.getElementById(POPOVER_ID);
    if (existing) {
        closePopover();
        return;
    }
    openPopover();
}

function openPopover() {
    const anchor = document.getElementById('btn-legend');
    if (!anchor) return;

    const popover = document.createElement('div');
    popover.id = POPOVER_ID;
    popover.className = 'info-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Informations');
    popover.innerHTML = `
        <div class="info-popover-header">
            <span class="info-popover-title">Informations</span>
            <button type="button" class="info-popover-close" aria-label="Fermer">×</button>
        </div>

        <div class="info-popover-section">
            <div class="info-popover-section-title">Légende des circuits</div>
            <div class="info-popover-legend-item">
                <div class="legend-line-sample legend-line-sample--straight"></div>
                <div class="info-popover-legend-text">
                    <span class="info-popover-legend-label">Vol d'oiseau</span>
                    <span class="info-popover-legend-desc">Trajet direct non précis</span>
                </div>
            </div>
            <div class="info-popover-legend-item">
                <div class="legend-line-sample legend-line-sample--gps"></div>
                <div class="info-popover-legend-text">
                    <span class="info-popover-legend-label">Tracé réel</span>
                    <span class="info-popover-legend-desc">Chemin GPS précis à suivre</span>
                </div>
            </div>
            <div class="info-popover-legend-item">
                <div class="legend-line-sample legend-line-sample--done"></div>
                <div class="info-popover-legend-text">
                    <span class="info-popover-legend-label">Circuit terminé</span>
                    <span class="info-popover-legend-desc">Marqué comme fait</span>
                </div>
            </div>
        </div>

        <div class="info-popover-divider"></div>

        <button type="button" class="info-popover-btn-tour" id="info-popover-btn-tour">
            🧭 Visite guidée
        </button>
    `;
    document.body.appendChild(popover);

    positionPopover(popover, anchor);

    popover.querySelector('.info-popover-close').addEventListener('click', closePopover);
    popover.querySelector('#info-popover-btn-tour').addEventListener('click', () => {
        closePopover();
        showWelcomeAgain();
    });

    // Fermeture clic extérieur (différé pour éviter de capturer le clic d'ouverture)
    setTimeout(() => {
        document.addEventListener('click', onOutsideClick, true);
        document.addEventListener('keydown', onEscapeKey);
    }, 0);
}

function closePopover() {
    const popover = document.getElementById(POPOVER_ID);
    if (popover) popover.remove();
    document.removeEventListener('click', onOutsideClick, true);
    document.removeEventListener('keydown', onEscapeKey);
}

function onOutsideClick(e) {
    const popover = document.getElementById(POPOVER_ID);
    const anchor = document.getElementById('btn-legend');
    if (!popover) return;
    if (popover.contains(e.target)) return;
    if (anchor && anchor.contains(e.target)) return; // l'anchor gère son toggle
    closePopover();
}

function onEscapeKey(e) {
    if (e.key === 'Escape') closePopover();
}

function positionPopover(popover, anchor) {
    const rect = anchor.getBoundingClientRect();
    const popoverWidth = 320; // doit matcher CSS max-width
    const margin = 8;

    // Aligné à droite du bouton, juste en-dessous
    let left = rect.right - popoverWidth;
    if (left < margin) left = margin;

    popover.style.position = 'fixed';
    popover.style.top = `${rect.bottom + 6}px`;
    popover.style.left = `${left}px`;
}
