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
import { switchActiveDestination } from './destination-switch.js';
import { toggleFilterPanel, getActiveFilters } from './filter-panel.js';
import { showWelcomeAgain } from './welcome.js';
import { setTheme, getCurrentTheme } from './theme.js';
import { getCurrentPatrimonialLang, setPatrimonialLang } from './patrimonial-names.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { isDestinationPublished } from './utils.js';

const FILTERS_BTN_ID = 'hw-topbar-filters-btn';
const FILTERS_COUNT_ID = 'hw-topbar-filters-count';
const DEST_SELECTOR_ID = 'hw-dest-selector';
const DEST_MENU_ID = 'hw-dest-menu';
// Bascule de moment : segmenté persistant `.hw-moment-toggle` (plus de dropdown thème).

// n = nombre de FILTRES actifs (une puce de la bande = un filtre), lu dans la
// source unique getActiveFilters (filter-panel.js). Cette barre avait sa propre
// définition de « actif », qui comptait des sections et ignorait les filtres
// admin — remplacée le 11/10/2026.
export function refreshFiltersButton() {
    const count = document.getElementById(FILTERS_COUNT_ID);
    const btn = document.getElementById(FILTERS_BTN_ID);
    if (!btn) return;

    const n = getActiveFilters().length;
    if (count) {
        count.textContent = String(n);
        count.hidden = n === 0;
    }
    btn.classList.toggle('has-active', n > 0);
    btn.setAttribute('aria-label', n > 0 ? `Filtres, ${n} actif${n > 1 ? 's' : ''}` : 'Filtres');
    // a11y : aria-pressed reflète l'état "filtres appliqués". aria-expanded
    // reflète l'ouverture du panneau (mis à jour ailleurs).
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
// Convertit un drapeau émoji (indicateurs régionaux 🇹🇳) en code pays 2 lettres ("TN").
function flagToCode(flag) {
    if (!flag) return '';
    const cps = [...flag].map(ch => ch.codePointAt(0));
    if (cps.length >= 2 && cps[0] >= 0x1F1E6 && cps[0] <= 0x1F1FF) {
        return cps.slice(0, 2).map(cp => String.fromCharCode(cp - 0x1F1E6 + 65)).join('');
    }
    return '';
}

// Déduit { pays, drapeau, code 2 lettres }. On AFFICHE le `code` (carré terracotta)
// plutôt que l'émoji-drapeau, dont le rendu varie selon la plateforme (Windows ne
// dessine pas les drapeaux émoji → il affiche « TN », incohérent avec mobile/Mac).
function inferCountryAndFlag(dest) {
    if (dest?.country && dest?.flag) {
        return { country: dest.country, flag: dest.flag,
                 code: dest.code || flagToCode(dest.flag) || dest.country.slice(0, 2).toUpperCase() };
    }
    const center = dest?.startView?.center;
    if (Array.isArray(center) && center.length === 2) {
        const [lat, lon] = center;
        // Tunisie
        if (lat >= 30 && lat <= 38 && lon >= 7 && lon <= 12) return { country: 'Tunisie', flag: '🇹🇳', code: 'TN' };
        // Maroc
        if (lat >= 27 && lat <= 36 && lon >= -14 && lon <= 0) return { country: 'Maroc', flag: '🇲🇦', code: 'MA' };
    }
    const country = dest?.country || '';
    return { country, flag: dest?.flag || '🌍',
             code: dest?.code || flagToCode(dest?.flag) || (country ? country.slice(0, 2).toUpperCase() : '··') };
}

export function renderDestinationMenu(destinations, activeMapId) {
    const menu = document.getElementById(DEST_MENU_ID);
    const selectorName = document.getElementById('hw-dest-selector-name');
    const selectorFlagEl = document.querySelector('.hw-dest-selector-flag');
    if (!menu || !destinations) return;

    const maps = destinations.maps || {};
    const entries = Object.entries(maps);
    if (entries.length === 0) return;

    const isAdmin = state.isAdmin;
    // Badge admin-only signalant une destination non encore publiée (brouillon).
    const draftBadge = (dest) => (isAdmin && !isDestinationPublished(dest))
        ? '<span class="hw-dest-item-badge">Brouillon</span>' : '';

    // Met à jour la pastille du sélecteur (drapeau + nom de la dest active)
    const activeDest = maps[activeMapId];
    if (activeDest) {
        const { code } = inferCountryAndFlag(activeDest);
        if (selectorName) selectorName.textContent = activeDest.name || activeMapId;
        if (selectorFlagEl) selectorFlagEl.textContent = code;
    }

    // Génère le HTML du menu : entrée active en premier, puis les autres.
    const html = ['<div class="hw-dest-menu-section-title">Destinations disponibles</div>'];

    // Active en premier
    if (activeDest) {
        const { country, code } = inferCountryAndFlag(activeDest);
        html.push(`
            <button type="button" class="hw-dest-item is-active" role="menuitemradio"
                    aria-checked="true" data-dest="${activeMapId}">
                <span class="hw-dest-item-flag">${code}</span>
                <span class="hw-dest-item-info">
                    <span class="hw-dest-item-name">${escapeHtml(activeDest.name || activeMapId)}</span>
                    <span class="hw-dest-item-sub">${escapeHtml(country)}</span>
                    ${draftBadge(activeDest)}
                </span>
                <span class="hw-dest-item-check"><i data-lucide="check"></i></span>
            </button>
        `);
    }

    // Les autres
    const others = entries.filter(([id, dest]) =>
        id !== activeMapId && (isAdmin || isDestinationPublished(dest)));
    if (others.length > 0) {
        html.push('<div class="hw-dest-menu-section-title is-divided">Autres destinations</div>');
        for (const [id, dest] of others) {
            const { country, code } = inferCountryAndFlag(dest);
            html.push(`
                <button type="button" class="hw-dest-item" role="menuitemradio"
                        aria-checked="false" data-dest="${id}">
                    <span class="hw-dest-item-flag">${code}</span>
                    <span class="hw-dest-item-info">
                        <span class="hw-dest-item-name">${escapeHtml(dest.name || id)}</span>
                        <span class="hw-dest-item-sub">${escapeHtml(country)}</span>
                        ${draftBadge(dest)}
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
            // Bascule partagée avec le sélecteur mobile (localStorage hw_active_dest
            // — lu aussi par le DM — + reload ?map= consommé au boot).
            switchActiveDestination(targetId);
        });
    });
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Bascule de moment (segmenté persistant) ───────────────────────────────
// Remplace le dropdown thème : 4 moments (Matin / Plein soleil / Ombre / Nuit)
// en émojis, toujours visibles dans la lisière (affordance persistante, jamais
// un toast/popup). Émojis voulus pour la chaleur ; Lucide reste aux contrôles.

function updateMomentToggleActive() {
    const current = getCurrentTheme();
    document.querySelectorAll('.hw-moment-seg').forEach(seg => {
        const on = seg.dataset.theme === current;
        seg.classList.toggle('is-active', on);
        seg.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    updateLectureButton();
}

function setupMomentToggle() {
    const toggle = document.querySelector('.hw-moment-toggle');
    if (!toggle) return;
    toggle.querySelectorAll('.hw-moment-seg').forEach(seg => {
        seg.addEventListener('click', () => {
            const theme = seg.dataset.theme;
            if (theme && theme !== getCurrentTheme()) setTheme(theme);
            updateMomentToggleActive();
        });
    });
    updateMomentToggleActive();
}

// ─── Bascule de langue des noms (FR ⇄ AR) : segmenté persistant `.names-toggle`,
// jumeau du moment. DIFFÉRENCE : changer de langue doit re-rendre les noms déjà
// affichés → setPatrimonialLang émet 'patrimony:lang-changed' (écouté par
// ui-details pour rafraîchir la fiche, et ici pour resync le segmenté). ─────────
function updateNamesToggleActive() {
    const current = getCurrentPatrimonialLang();
    document.querySelectorAll('.names-btn').forEach(btn => {
        const on = btn.dataset.lang === current;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    updateLectureButton();
}

function setupNamesToggle() {
    const toggle = document.querySelector('.names-toggle');
    if (!toggle) return;
    toggle.querySelectorAll('.names-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const lang = btn.dataset.lang;
            if (lang && lang !== getCurrentPatrimonialLang()) setPatrimonialLang(lang);
            updateNamesToggleActive();
        });
    });
    // Resync quand la langue change ailleurs (menu mobile, restauration au boot).
    eventBus.on('patrimony:lang-changed', updateNamesToggleActive);
    updateNamesToggleActive();
}

// ─── Boutons directs topbar (« Que faire ? ») ───────────────────────────────
// Le bouton « Mon Espace » topbar a été retiré en PR2 dissolution (06/06/2026) —
// la Sauvegarde a migré dans le menu Outils, cf. ui.js btn-tools-backup.

// « Que faire ? » garde son libellé à toutes les largeurs : ce sont les
// paliers de la barre (fin de topbar-v2.css) qui font la place. Le repli
// mesuré du libellé (fitTourLabel, 11/10/2026) a été retiré le 12/11/2026.
function setupTourButton() {
    const btn = document.getElementById('btn-tour');
    if (btn) btn.addEventListener('click', () => showWelcomeAgain());
}

// ─── Palier étroit (barre < 932 px, fin de topbar-v2.css) ──────────────────
// Handoff Claude Design « écran bas » (12/11/2026). Le CSS décide QUAND ces
// boutons existent (container query) ; ici on ne gère que l'ouverture.

// Loupe : ouvre le champ de recherche sur toute la barre (.is-search-open).
// La croix ou Échap dans le champ la referment ; le focus revient à la loupe.
function setSearchOpen(open) {
    const bar = document.querySelector('.topbar');
    const toggle = document.getElementById('hw-search-toggle');
    if (!bar || !toggle) return;
    bar.classList.toggle('is-search-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) document.getElementById('search-input')?.focus();
    else toggle.focus();
}

export function setupSearchToggle() {
    const toggle = document.getElementById('hw-search-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => setSearchOpen(true));
    document.getElementById('hw-search-close')?.addEventListener('click', () => setSearchOpen(false));
    document.getElementById('search-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.querySelector('.topbar.is-search-open')) setSearchOpen(false);
    });
}

// « Lecture » : moment + langue des noms rangés dans un menu. Le bouton montre
// l'émoji du moment courant et la langue ; il est resynchronisé par les deux
// segmentés (updateMomentToggleActive / updateNamesToggleActive).
function updateLectureButton() {
    const emo = document.getElementById('hw-lecture-emo');
    const lng = document.getElementById('hw-lecture-lng');
    const seg = document.querySelector(`.hw-moment-seg[data-theme="${getCurrentTheme()}"]`);
    if (emo && seg) emo.textContent = seg.textContent.trim();
    if (lng) {
        const ar = getCurrentPatrimonialLang() === 'ar';
        lng.textContent = ar ? 'ع' : 'FR';
        lng.classList.toggle('scr', ar);
    }
}

function isLectureOpen() {
    return Boolean(document.getElementById('hw-prefs')?.classList.contains('is-open'));
}

function setLectureOpen(open) {
    const wrap = document.getElementById('hw-prefs');
    const btn = document.getElementById('hw-lecture-btn');
    if (!wrap || !btn) return;
    if (open) eventBus.emit('topbar:popup-opening', { id: 'lecture' });
    wrap.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

export function setupLectureMenu() {
    const wrap = document.getElementById('hw-prefs');
    const btn = document.getElementById('hw-lecture-btn');
    if (!wrap || !btn) return;
    btn.addEventListener('click', () => setLectureOpen(!isLectureOpen()));
    // Listeners du document : relire les éléments par id à chaque événement
    // (pas de référence figée à l'installation).
    document.addEventListener('click', (e) => {
        const current = document.getElementById('hw-prefs');
        if (isLectureOpen() && current && !current.contains(e.target)) setLectureOpen(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isLectureOpen()) {
            setLectureOpen(false);
            document.getElementById('hw-lecture-btn')?.focus();
        }
    });
    eventBus.on('topbar:popup-opening', ({ id }) => {
        if (id !== 'lecture' && isLectureOpen()) setLectureOpen(false);
    });
    updateLectureButton();
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
        // (le thème est désormais un segmenté persistant `.hw-moment-toggle`, pas un popup)
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

    // Boutons directs topbar (PR PC-2 — Thème, Visite ; Mon Espace retiré en PR2 dissolution)
    setupTourButton();
    setupMomentToggle();
    setupNamesToggle();
    setupSearchToggle();
    setupLectureMenu();

    // Coordination popups topbar : 1 seul ouvert à la fois (cf. fix #6).
    setupTopbarPopupCoordination();
}
