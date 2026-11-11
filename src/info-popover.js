// info-popover.js
// Popover compact "Légende" ancré sur l'icône book-open du header (renommé
// "Légende" en PR PC-3, anciennement "Informations").
//
// Contenu :
//   - Tracés de circuits : Vol d'oiseau (pointillé) / Tracé réel / Fait
//   - Catégories de lieux, rangées dans les six familles du panneau Filtres
//     (taxonomy.js). Seules les icônes présentes dans la destination ouverte
//     sont montrées ; une catégorie à sous-types tient sur sa propre ligne
//     (refonte du 11/11/2026, maquette validée par Stefan).
//   - Regroupements : explication du cercle avec chiffre au zoom out
//
// La "Visite guidée" a été extraite en bouton dédié dans la topbar
// (PR PC-2, 10/05/2026) pour visibilité immédiate aux nouveaux users.
//
// Toggle : un clic sur l'icône ouvre, un nouveau clic ferme.
// Fermeture aussi : clic à l'extérieur, touche Échap.

import { getLegendGroups, getIconForFeature } from './poi-icons.js';
import { getGroups, getGroupForCategory } from './taxonomy.js';
import { isShownToUser } from './poi-visibility.js';
import { state } from './state.js';
import { eventBus } from './events.js';

const POPOVER_ID = 'info-popover';

// Listener pour fermer la popover si un autre popup topbar s'ouvre.
// Stocké en module-level pour pouvoir le retirer dans closePopover.
let _onOtherPopupOpening = null;
let _onResize = null;

// Variante sans sous-type d'une catégorie qui en a (son libellé interne est le
// nom de la catégorie, déjà écrit en tête de ligne).
const OTHER_LABEL = 'Autre';

/**
 * Catégories de la légende, par famille (ordre de taxonomy.js).
 * - Une icône n'est montrée que si un lieu VISIBLE de la destination la porte
 *   (même lecture que la carte : getIconForFeature). Sans lieu chargé, tout
 *   est montré.
 * - Catégorie avec plusieurs variantes présentes → `rows` (une ligne à elle) ;
 *   une seule icône présente → `singles`, sous le nom de la catégorie.
 * @param {object[]} features lieux chargés (state.loadedFeatures)
 * @returns {{family: string, rows: {category: string, variants: {label: string, svg: string}[]}[], singles: {label: string, svg: string}[]}[]}
 */
export function getLegendFamilies(features) {
    const shown = (features || []).filter(isShownToUser);
    const used = shown.length ? new Set(shown.map(getIconForFeature)) : null;
    const groups = getLegendGroups();
    return getGroups().map(family => {
        const rows = [];
        const singles = [];
        for (const g of groups) {
            if (getGroupForCategory(g.category) !== family) continue;
            const present = used ? g.variants.filter(v => used.has(v.svg)) : g.variants;
            if (present.length === 0) continue;
            if (present.length === 1) {
                singles.push({ label: g.category, svg: present[0].svg });
            } else {
                rows.push({
                    category: g.category,
                    variants: present.map(v => ({ label: v.label === g.category ? OTHER_LABEL : v.label, svg: v.svg })),
                });
            }
        }
        return { family, rows, singles };
    }).filter(f => f.rows.length > 0 || f.singles.length > 0);
}

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

    const itemHtml = (label, svg) => `
        <div class="info-popover-cat-item">
            <div class="info-popover-cat-marker">${svg}</div>
            <span class="info-popover-cat-name">${label}</span>
        </div>
    `;
    const rowHtml = (name, items) => `
        <div class="info-popover-cat-row">
            <div class="info-popover-cat-rowname">${name}</div>
            <div class="info-popover-cat-grid">
                ${items.map(i => itemHtml(i.label, i.svg)).join('')}
            </div>
        </div>
    `;
    const familiesHtml = getLegendFamilies(state.loadedFeatures).map(f => `
        <div class="info-popover-family">
            <div class="info-popover-family-title">${f.family}</div>
            ${f.rows.map(r => rowHtml(r.category, r.variants)).join('')}
            ${f.singles.length ? rowHtml('', f.singles) : ''}
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
            <div class="info-popover-lines">
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
                    <span class="info-popover-legend-label">Circuit fait</span>
                    <span class="info-popover-legend-desc">Coché par vous</span>
                </div>
            </div>
            </div>
        </div>

        <div class="info-popover-section">
            <div class="info-popover-section-title">Catégories de lieux</div>
            ${familiesHtml}
        </div>

        <div class="info-popover-section">
            <div class="info-popover-section-title">Regroupements</div>
            <div class="info-popover-clusters">
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
        </div>
    `;
    document.body.appendChild(popover);

    positionPopover(popover, anchor);
    centerIcons(popover);
    _onResize = () => positionPopover(popover, anchor);
    window.addEventListener('resize', _onResize);
    // Le bouton Légende de la carte suit l'ouverture (état « ouvert » visible,
    // et annoncé aux lecteurs d'écran).
    anchor.setAttribute('aria-expanded', 'true');

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
    (document.getElementById('leaflet-btn-legend') || document.getElementById('btn-legend'))
        ?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick, true);
    document.removeEventListener('keydown', onEscapeKey);
    if (_onResize) {
        window.removeEventListener('resize', _onResize);
        _onResize = null;
    }
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

// Marge entre la légende et les bords (pile de boutons, haut de carte, bas d'écran).
const EDGE = 12;

/**
 * Place la légende à DROITE de la pile de boutons de la carte, à partir du haut
 * de la carte, et borne sa hauteur au bas de l'écran (elle défile au-delà).
 * Avant le 11/11/2026 elle s'ouvrait sous le bouton avec une hauteur fixée à
 * « écran − 100 px » : son bas sortait de l'écran, inatteignable.
 * Sans carte autour du bouton (ancre hors Leaflet) : sous le bouton.
 */
function positionPopover(popover, anchor) {
    const rect = anchor.getBoundingClientRect();
    const mapRect = anchor.closest('.leaflet-container')?.getBoundingClientRect();
    const left = mapRect ? rect.right + EDGE : Math.max(EDGE, rect.left);
    const top = mapRect ? mapRect.top + EDGE : rect.bottom + 6;
    const room = window.innerWidth - left - EDGE;

    popover.style.position = 'fixed';
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.style.maxWidth = `${room}px`;
    popover.style.maxHeight = `${window.innerHeight - top - EDGE}px`;
}

/**
 * Centre chaque dessin face à son libellé. Les icônes du pack sont posées sur
 * leur ligne de sol dans un carré 96 × 96, pas centrées : dans une liste,
 * « Artisanat » tombait 5 px sous son texte et « Curiosité » 3 px au-dessus
 * (mesuré le 11/11/2026). La carte, elle, garde les icônes sur leur sol.
 */
function centerIcons(popover) {
    popover.querySelectorAll('.info-popover-cat-marker svg').forEach(svg => {
        if (typeof svg.getBBox !== 'function') return;
        try {
            const box = svg.getBBox();
            const view = svg.viewBox.baseVal;
            if (!view || !view.height || !box.height) return;
            const shift = (view.y + view.height / 2) - (box.y + box.height / 2);
            const px = shift * svg.getBoundingClientRect().height / view.height;
            svg.style.transform = `translateY(${px.toFixed(2)}px)`;
        } catch { /* dessin non mesurable (pas encore rendu) : laissé tel quel */ }
    });
}
