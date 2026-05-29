// info-popover.js
// Popover compact "Légende" ancré sur l'icône book-open du header (renommé
// "Légende" en PR PC-3, anciennement "Informations").
//
// Contenu (PR PC-3) :
//   - Tracés de circuits : Vol d'oiseau (pointillé) / Tracé réel / Terminé
//   - Catégories de POI : 15 marqueurs avec icônes (lus dynamiquement de
//     poi-icons.js iconMap, donc auto-sync si on ajoute/retire une catégorie)
//   - Clusters : explication du cercle avec chiffre au zoom out
//
// La "Visite guidée" a été extraite en bouton dédié dans la topbar
// (PR PC-2, 10/05/2026) pour visibilité immédiate aux nouveaux users.
//
// Toggle : un clic sur l'icône ouvre, un nouveau clic ferme.
// Fermeture aussi : clic à l'extérieur, touche Échap.

import { getLegendGroups } from './poi-icons.js';
import { eventBus } from './events.js';

const POPOVER_ID = 'info-popover';

// Listener pour fermer la popover si un autre popup topbar s'ouvre.
// Stocké en module-level pour pouvoir le retirer dans closePopover.
let _onOtherPopupOpening = null;

export function showInfoPopover() {
    const existing = document.getElementById(POPOVER_ID);
    if (existing) {
        closePopover();
        return;
    }
    openPopover();
}

function openPopover() {
    const anchor = (document.getElementById('leaflet-btn-legend') || document.getElementById('btn-legend'));
    if (!anchor) return;

    // Coordination popups topbar (cf. fix #6 PR R3) : avise les autres,
    // et écoute pour se fermer si un autre s'ouvre.
    eventBus.emit('topbar:popup-opening', { id: 'info' });
    _onOtherPopupOpening = ({ id }) => {
        if (id !== 'info') closePopover();
    };
    eventBus.on('topbar:popup-opening', _onOtherPopupOpening);

    // Légende exhaustive (chantier 21/05/2026) : on liste TOUTES les icônes
    // distinctes, sous-types inclus, à partir de POI_ICONS via getLegendGroups().
    //  - Catégories mono → grille plate (pas d'en-tête redondant).
    //  - Catégories à sous-types (Mosquée/Église/Artisanat) → en-tête + variantes.
    // Auto-sync : ajouter une catégorie/sous-type dans poi-icons.js suffit.
    const legendGroups = getLegendGroups();

    const itemHtml = (label, svg) => `
        <div class="info-popover-cat-item">
            <div class="info-popover-cat-marker">${svg}</div>
            <span class="info-popover-cat-name">${label}</span>
        </div>
    `;

    const monoHtml = legendGroups
        .filter(g => !g.isMulti)
        .map(g => itemHtml(g.category, g.variants[0].svg))
        .join('');

    const multiHtml = legendGroups
        .filter(g => g.isMulti)
        .map(g => `
            <div class="info-popover-cat-subgroup">
                <div class="info-popover-cat-subgroup-title">${g.category}</div>
                <div class="info-popover-cat-grid">
                    ${g.variants.map(v => itemHtml(v.label, v.svg)).join('')}
                </div>
            </div>
        `).join('');

    const popover = document.createElement('div');
    popover.id = POPOVER_ID;
    popover.className = 'info-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Légende');
    popover.innerHTML = `
        <div class="info-popover-header">
            <span class="info-popover-title">Légende</span>
            <button type="button" class="info-popover-close" aria-label="Fermer">×</button>
        </div>

        <div class="info-popover-section">
            <div class="info-popover-section-title">Tracés de circuits</div>
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

        <div class="info-popover-section">
            <div class="info-popover-section-title">Catégories de lieux</div>
            <div class="info-popover-cat-grid">
                ${monoHtml}
            </div>
            ${multiHtml}
        </div>

        <div class="info-popover-section">
            <div class="info-popover-section-title">Regroupements</div>
            <p class="info-popover-cluster-intro">
                Plusieurs lieux proches sont groupés en un cercle. Sa couleur indique
                combien — zoomez pour les voir séparément.
            </p>
            <div class="info-popover-cluster-grid">
                <div class="info-popover-cluster-item">
                    <div class="info-popover-cluster-sample info-popover-cluster-sample--small">5</div>
                    <span class="info-popover-cluster-label">Quelques lieux</span>
                </div>
                <div class="info-popover-cluster-item">
                    <div class="info-popover-cluster-sample info-popover-cluster-sample--medium">25</div>
                    <span class="info-popover-cluster-label">Plusieurs</span>
                </div>
                <div class="info-popover-cluster-item">
                    <div class="info-popover-cluster-sample info-popover-cluster-sample--large">75</div>
                    <span class="info-popover-cluster-label">Beaucoup</span>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(popover);

    positionPopover(popover, anchor);

    popover.querySelector('.info-popover-close').addEventListener('click', closePopover);

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
    if (_onOtherPopupOpening) {
        eventBus.off('topbar:popup-opening', _onOtherPopupOpening);
        _onOtherPopupOpening = null;
    }
}

function onOutsideClick(e) {
    const popover = document.getElementById(POPOVER_ID);
    const anchor = (document.getElementById('leaflet-btn-legend') || document.getElementById('btn-legend'));
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
