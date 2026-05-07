// topbar-v2.js
// Câblage du nouveau topbar (refonte Claude Design) :
// - Bouton "Filtres" unique avec compteur dynamique "Filtres (n)" (PR 3)
//   → ouvre le panneau de filtres unifié (cf. filter-panel.js)
// - Sélecteur de destination + dropdown des destinations disponibles (PR 4)
//   Djerba active ; Hammamet et Agadir présentés "Bientôt".
//
// Le compteur Filtres reflète le nombre de SECTIONS du panneau qui ont au
// moins un filtre actif (cf. spec : "comptage par section, pas par option").

import { state } from './state.js';
import { eventBus } from './events.js';
import { toggleFilterPanel } from './filter-panel.js';

const FILTERS_BTN_ID = 'hw-topbar-filters-btn';
const FILTERS_LABEL_ID = 'hw-topbar-filters-label';
const DEST_SELECTOR_ID = 'hw-dest-selector';
const DEST_MENU_ID = 'hw-dest-menu';

function isSectionActive(id) {
    const f = state.activeFilters || {};
    switch (id) {
        case 'localisation': return f.zone !== null && f.zone !== undefined;
        case 'categories':   return Array.isArray(f.categories) && f.categories.length > 0;
        case 'parcours':     return (f.vus && f.vus !== 'all')
                                  || (f.planifies && f.planifies !== 'all')
                                  || !!f.incontournablesOnly;
        case 'fiche':        return (f.verified && f.verified !== 'all')
                                  || (f.photo && f.photo !== 'all')
                                  || (f.description && f.description !== 'all');
        default:             return false;
    }
}

function countActiveSections() {
    return ['localisation', 'categories', 'parcours', 'fiche']
        .reduce((n, id) => n + (isSectionActive(id) ? 1 : 0), 0);
}

export function refreshFiltersButton() {
    const label = document.getElementById(FILTERS_LABEL_ID);
    const btn = document.getElementById(FILTERS_BTN_ID);
    if (!label || !btn) return;

    const n = countActiveSections();
    label.textContent = n > 0 ? `Filtres (${n})` : 'Filtres';
    btn.classList.toggle('is-active', n > 0);
}

// ─── Dropdown destination ──────────────────────────────────────────────────

function setDestMenuOpen(open) {
    const menu = document.getElementById(DEST_MENU_ID);
    const selector = document.getElementById(DEST_SELECTOR_ID);
    if (!menu || !selector) return;
    if (open) {
        menu.removeAttribute('hidden');
        selector.classList.add('is-open');
        selector.setAttribute('aria-expanded', 'true');
    } else {
        menu.setAttribute('hidden', '');
        selector.classList.remove('is-open');
        selector.setAttribute('aria-expanded', 'false');
    }
}

function isDestMenuOpen() {
    const menu = document.getElementById(DEST_MENU_ID);
    return !!menu && !menu.hasAttribute('hidden');
}

function toggleDestMenu() {
    setDestMenuOpen(!isDestMenuOpen());
}

function setupDestinationMenu() {
    const selector = document.getElementById(DEST_SELECTOR_ID);
    const menu = document.getElementById(DEST_MENU_ID);
    if (!selector || !menu) return;

    selector.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDestMenu();
    });

    // Fermeture sur clic extérieur
    document.addEventListener('click', (e) => {
        if (!isDestMenuOpen()) return;
        if (e.target.closest(`#${DEST_SELECTOR_ID}`)) return;
        if (e.target.closest(`#${DEST_MENU_ID}`)) return;
        setDestMenuOpen(false);
    });

    // Fermeture sur Échap
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isDestMenuOpen()) {
            setDestMenuOpen(false);
            selector.focus();
        }
    });
}

// ─── Population dynamique du dropdown destinations ──────────────────────────
// Génère le HTML du menu depuis state.destinations.maps. Appelée après
// loadDestinationsConfig() (cf. app-startup.js). Toute destination présente
// dans destinations.json devient cliquable. Plus de section "Bientôt" : si
// une dest est dans destinations.json, elle est utilisable.

// Heuristique drapeau / sous-titre basée sur les bounds (lat, lon) ou un
// override `country` dans destinations.json. Pour l'instant : Tunisie ou
// Maroc ou autre selon la lat/lon. Si on ouvre d'autres pays, ajouter un
// champ explicite `country` + `flag` dans destinations.json.
function inferCountryAndFlag(dest) {
    if (dest?.country && dest?.flag) return { country: dest.country, flag: dest.flag };
    const center = dest?.startView?.center;
    if (Array.isArray(center) && center.length === 2) {
        const [lat, lon] = center;
        // Tunisie
        if (lat >= 30 && lat <= 38 && lon >= 7 && lon <= 12) return { country: 'Tunisie', flag: '🇹🇳' };
        // Maroc
        if (lat >= 27 && lat <= 36 && lon >= -14 && lon <= 0) return { country: 'Maroc', flag: '🇲🇦' };
    }
    return { country: dest?.country || '', flag: dest?.flag || '🌍' };
}

export function renderDestinationMenu(destinations, activeMapId) {
    const menu = document.getElementById(DEST_MENU_ID);
    const selectorName = document.getElementById('hw-dest-selector-name');
    const selectorFlagEl = document.querySelector('.hw-dest-selector-flag');
    if (!menu || !destinations) return;

    const maps = destinations.maps || {};
    const entries = Object.entries(maps);
    if (entries.length === 0) return;

    // Met à jour la pastille du sélecteur (drapeau + nom de la dest active)
    const activeDest = maps[activeMapId];
    if (activeDest) {
        const { flag } = inferCountryAndFlag(activeDest);
        if (selectorName) selectorName.textContent = activeDest.name || activeMapId;
        if (selectorFlagEl) selectorFlagEl.textContent = flag;
    }

    // Génère le HTML du menu : entrée active en premier, puis les autres.
    const html = ['<div class="hw-dest-menu-section-title">Destinations disponibles</div>'];

    // Active en premier
    if (activeDest) {
        const { country, flag } = inferCountryAndFlag(activeDest);
        html.push(`
            <button type="button" class="hw-dest-item is-active" role="menuitemradio"
                    aria-checked="true" data-dest="${activeMapId}">
                <span class="hw-dest-item-flag">${flag}</span>
                <span class="hw-dest-item-info">
                    <span class="hw-dest-item-name">${escapeHtml(activeDest.name || activeMapId)}</span>
                    <span class="hw-dest-item-sub">${escapeHtml(country)}</span>
                </span>
                <span class="hw-dest-item-check"><i data-lucide="check"></i></span>
            </button>
        `);
    }

    // Les autres
    const others = entries.filter(([id]) => id !== activeMapId);
    if (others.length > 0) {
        html.push('<div class="hw-dest-menu-section-title is-divided">Autres destinations</div>');
        for (const [id, dest] of others) {
            const { country, flag } = inferCountryAndFlag(dest);
            html.push(`
                <button type="button" class="hw-dest-item" role="menuitemradio"
                        aria-checked="false" data-dest="${id}">
                    <span class="hw-dest-item-flag">${flag}</span>
                    <span class="hw-dest-item-info">
                        <span class="hw-dest-item-name">${escapeHtml(dest.name || id)}</span>
                        <span class="hw-dest-item-sub">${escapeHtml(country)}</span>
                    </span>
                </button>
            `);
        }
    }

    menu.innerHTML = html.join('');

    // Re-render des icônes lucide injectées
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons({ root: menu });
    }

    // Click sur n'importe quelle entrée : reload avec ?map={destId}.
    // L'entrée active ferme juste le menu.
    menu.querySelectorAll('.hw-dest-item').forEach(item => {
        item.addEventListener('click', () => {
            const targetId = item.dataset.dest;
            if (targetId === activeMapId) {
                setDestMenuOpen(false);
                return;
            }
            // Synchronise le localStorage avant le reload → le DM, ouvert
            // ensuite, prendra automatiquement la même destination active.
            try { localStorage.setItem('hw_active_dest', targetId); } catch (e) { /* ignore */ }
            // Reload avec param ?map=… (consommé par loadAndInitializeMap au boot)
            const url = new URL(window.location.href);
            url.searchParams.set('map', targetId);
            window.location.href = url.toString();
        });
    });
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Init ─────────────────────────────────────────────────────────────────

export function setupTopbarV2() {
    const filtersBtn = document.getElementById(FILTERS_BTN_ID);
    if (filtersBtn) {
        filtersBtn.addEventListener('click', toggleFilterPanel);
    }

    // Mise à jour du compteur à chaque changement de filtre.
    // Le filter-panel émet déjà data:filtered via applyFilters() après chaque
    // modif de filter, donc ce listener suffit.
    eventBus.on('data:filtered', refreshFiltersButton);

    // État initial (au cas où des filtres seraient restaurés au boot).
    refreshFiltersButton();

    // Dropdown des destinations (PR 4)
    setupDestinationMenu();
}
