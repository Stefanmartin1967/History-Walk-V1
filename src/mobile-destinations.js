// mobile-destinations.js
// Sélecteur de destination MOBILE (admin uniquement). Bottom-sheet calquée sur le
// pattern partagé `.hw-sheet-*` (mêmes styles que la filter-sheet, sans la toucher),
// listant les destinations ; au choix d'une autre → `switchActiveDestination`
// (localStorage `hw_active_dest` + reload `?map=`). Déclenchée depuis le Menu admin.
//
// Réservé admin (l'entrée du Menu est dans la section admin) → on liste TOUTES les
// destinations, avec un badge « Brouillon » sur les `status:draft`. Aucune fuite
// possible vers un visiteur (il n'a jamais l'entrée).
import { state } from './state.js';
import { escapeHtml, isDestinationPublished } from './utils.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { switchActiveDestination } from './destination-switch.js';

// Drapeau emoji depuis le code pays ISO (`dest.country`, posé par le Modèle C).
// Repli 🌍 si le pays est absent/inconnu — affichage seulement, pas de logique.
const COUNTRY_FLAG = { tn: '🇹🇳', ma: '🇲🇦', dz: '🇩🇿' };
function flagFor(dest) {
    return COUNTRY_FLAG[(dest?.country || '').toLowerCase()] || '🌍';
}

let sheetEl = null;
let sheetOpen = false;

export function openDestinationSheet() {
    if (sheetOpen) return;
    const maps = state.destinations?.maps || {};
    const activeId = state.currentMapId;
    const entries = Object.entries(maps);
    if (!entries.length) return;

    // Active en tête, puis les autres (admin → toutes, badge Brouillon sur les drafts).
    const ordered = entries.sort(([a], [b]) => (a === activeId ? -1 : b === activeId ? 1 : 0));
    const rowsHtml = ordered.map(([id, dest]) => {
        const isActive = id === activeId;
        const draft = !isDestinationPublished(dest);
        return `
            <button type="button" class="dest-row${isActive ? ' is-active' : ''}" data-dest="${escapeHtml(id)}">
                <span class="dest-row-flag">${flagFor(dest)}</span>
                <span class="dest-row-info">
                    <span class="dest-row-name">${escapeHtml(dest.name || id)}${draft ? '<span class="dest-row-badge">Brouillon</span>' : ''}</span>
                    <span class="dest-row-sub">${isActive ? 'Destination active' : 'Toucher pour basculer'}</span>
                </span>
                ${isActive ? '<span class="dest-row-check"><i data-lucide="check"></i></span>' : ''}
            </button>`;
    }).join('');

    sheetOpen = true;
    const overlay = document.createElement('div');
    overlay.className = 'hw-sheet-scrim';
    overlay.id = 'dest-sheet-scrim';
    overlay.innerHTML = `
        <div class="hw-sheet" role="dialog" aria-modal="true" aria-labelledby="dest-sheet-title">
            <div class="hw-sheet-handle"></div>
            <div class="hw-sheet-head">
                <div class="ttl" id="dest-sheet-title"><i data-lucide="map"></i>Changer de destination</div>
                <button class="x" id="dest-sheet-close" aria-label="Fermer"><i data-lucide="x"></i></button>
            </div>
            <div class="hw-sheet-body">${rowsHtml}</div>
        </div>`;
    document.body.appendChild(overlay);
    sheetEl = overlay;
    createIcons({ icons: appIcons, root: overlay });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDestinationSheet(); });
    overlay.querySelector('#dest-sheet-close')?.addEventListener('click', closeDestinationSheet);
    document.addEventListener('keydown', onEscClose);

    overlay.querySelectorAll('.dest-row').forEach(row => {
        row.addEventListener('click', () => {
            const targetId = row.dataset.dest;
            if (targetId === activeId) { closeDestinationSheet(); return; }
            switchActiveDestination(targetId); // localStorage + ?map= + reload
        });
    });

    requestAnimationFrame(() => overlay.classList.add('is-open'));
}

function closeDestinationSheet() {
    if (!sheetOpen || !sheetEl) return;
    sheetEl.classList.remove('is-open');
    document.removeEventListener('keydown', onEscClose);
    const el = sheetEl;
    setTimeout(() => { el.remove(); if (sheetEl === el) sheetEl = null; sheetOpen = false; }, 240);
}

function onEscClose(e) {
    if (e.key === 'Escape' && sheetOpen) closeDestinationSheet();
}
