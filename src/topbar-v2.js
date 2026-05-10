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
import { openUserSpace } from './user-space.js';
import { showWelcomeAgain } from './welcome.js';
import { setTheme, getCurrentTheme, THEMES, THEME_LABELS } from './theme.js';
import { createIcons, appIcons } from './lucide-icons.js';

const FILTERS_BTN_ID = 'hw-topbar-filters-btn';
const FILTERS_LABEL_ID = 'hw-topbar-filters-label';
const DEST_SELECTOR_ID = 'hw-dest-selector';
const DEST_MENU_ID = 'hw-dest-menu';
const THEME_BTN_ID = 'btn-theme-topbar';
const THEME_MENU_ID = 'hw-theme-menu';

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
    // a11y : aria-pressed reflète l'état "filtres appliqués" (au moins 1 section
    // active). aria-expanded reflète l'ouverture du panneau (mis à jour ailleurs
    // — voir setupFiltersA11y).
    btn.setAttribute('aria-pressed', n > 0 ? 'true' : 'false');
}

// ─── Dropdown destination ──────────────────────────────────────────────────

function setDestMenuOpen(open) {
    const menu = document.getElementById(DEST_MENU_ID);
    const selector = document.getElementById(DEST_SELECTOR_ID);
    if (!menu || !selector) return;
    if (open) {
        // Avise les autres popups topbar de se fermer (cf. setupTopbarPopupCoordination).
        eventBus.emit('topbar:popup-opening', { id: 'dest' });
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

// ─── Dropdown thème (PR PC-2) ──────────────────────────────────────────────

function setThemeMenuOpen(open) {
    const menu = document.getElementById(THEME_MENU_ID);
    const btn = document.getElementById(THEME_BTN_ID);
    if (!menu || !btn) return;
    if (open) {
        // Avise les autres popups topbar de se fermer (cf. setupTopbarPopupCoordination).
        eventBus.emit('topbar:popup-opening', { id: 'theme' });
        renderThemeMenu();
        menu.removeAttribute('hidden');
        btn.setAttribute('aria-expanded', 'true');
    } else {
        menu.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
    }
}

function isThemeMenuOpen() {
    const menu = document.getElementById(THEME_MENU_ID);
    return !!menu && !menu.hasAttribute('hidden');
}

function toggleThemeMenu() {
    setThemeMenuOpen(!isThemeMenuOpen());
}

function renderThemeMenu() {
    const menu = document.getElementById(THEME_MENU_ID);
    if (!menu) return;
    const current = getCurrentTheme();

    menu.innerHTML = `
        <div class="hw-theme-menu-title">Thème</div>
        ${THEMES.map(theme => `
            <button type="button" class="hw-theme-item${theme === current ? ' is-active' : ''}"
                    role="menuitemradio" aria-checked="${theme === current ? 'true' : 'false'}"
                    data-theme="${theme}">
                <span class="hw-theme-swatch hw-theme-swatch--${theme}" aria-hidden="true"></span>
                <span class="hw-theme-name">${THEME_LABELS[theme] || theme}</span>
                ${theme === current ? '<span class="hw-theme-check"><i data-lucide="check"></i></span>' : ''}
            </button>
        `).join('')}
    `;

    // Render icons (check)
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons({ root: menu });
    } else {
        createIcons({ icons: appIcons, root: menu });
    }

    // Bind clicks
    menu.querySelectorAll('.hw-theme-item').forEach(item => {
        item.addEventListener('click', () => {
            const theme = item.dataset.theme;
            if (theme && theme !== getCurrentTheme()) setTheme(theme);
            setThemeMenuOpen(false);
        });
    });
}

function setupThemeDropdown() {
    const btn = document.getElementById(THEME_BTN_ID);
    const menu = document.getElementById(THEME_MENU_ID);
    if (!btn || !menu) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleThemeMenu();
    });

    document.addEventListener('click', (e) => {
        if (!isThemeMenuOpen()) return;
        if (e.target.closest(`#${THEME_BTN_ID}`)) return;
        if (e.target.closest(`#${THEME_MENU_ID}`)) return;
        setThemeMenuOpen(false);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isThemeMenuOpen()) {
            setThemeMenuOpen(false);
            btn.focus();
        }
    });
}

// ─── Boutons directs topbar Mon Espace + Visite guidée (PR PC-2) ────────────

function setupMonEspaceButton() {
    const btn = document.getElementById('btn-mon-espace-topbar');
    if (btn) btn.addEventListener('click', () => openUserSpace());
}

function setupTourButton() {
    const btn = document.getElementById('btn-tour');
    if (btn) btn.addEventListener('click', () => showWelcomeAgain());
}

// ─── Coordination des popups topbar (1 seul ouvert à la fois) ─────────────
// Quand un popup s'ouvre, il émet `topbar:popup-opening` avec son id. Tous
// les autres popups écoutent et se ferment s'ils ne sont pas l'émetteur.
// Couvre : sélecteur destination, dropdown thème, popover Légende, menus
// Outils / GOD MODE. Le panneau Filtres et Mon Espace ne sont PAS gérés ici
// (Filtres = panel large, Mon Espace = modale exclusive plein écran).

function setupTopbarPopupCoordination() {
    eventBus.on('topbar:popup-opening', ({ id }) => {
        if (id !== 'dest' && isDestMenuOpen()) setDestMenuOpen(false);
        if (id !== 'theme' && isThemeMenuOpen()) setThemeMenuOpen(false);
        // Les autres popups (info-popover, tools, god-mode) gèrent leur propre
        // listener — voir info-popover.js et events-desktop.js.
    });
}

// ─── Init ─────────────────────────────────────────────────────────────────

export function setupTopbarV2() {
    const filtersBtn = document.getElementById(FILTERS_BTN_ID);
    if (filtersBtn) {
        filtersBtn.addEventListener('click', toggleFilterPanel);
        // a11y : signaler que ce bouton ouvre un panneau (aria-expanded sera
        // mis à jour ailleurs si le panneau expose son état d'ouverture).
        filtersBtn.setAttribute('aria-haspopup', 'true');
        filtersBtn.setAttribute('aria-expanded', 'false');
    }

    // Mise à jour du compteur à chaque changement de filtre.
    // Le filter-panel émet déjà data:filtered via applyFilters() après chaque
    // modif de filter, donc ce listener suffit.
    eventBus.on('data:filtered', refreshFiltersButton);

    // État initial (au cas où des filtres seraient restaurés au boot).
    refreshFiltersButton();

    // Dropdown des destinations (PR 4)
    setupDestinationMenu();

    // Boutons directs topbar (PR PC-2 — promotion : Mon Espace, Thème, Visite)
    setupMonEspaceButton();
    setupTourButton();
    setupThemeDropdown();

    // Coordination popups topbar : 1 seul ouvert à la fois (cf. fix #6).
    setupTopbarPopupCoordination();
}
