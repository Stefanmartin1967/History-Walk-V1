// theme.js
// Bascule des 4 MOMENTS (refonte « plein soleil / papier méditerranéen », 13/06/2026).
// Les moments sont définis dans style/tokens.css : matin / plein-soleil / ombre / nuit
// (axe de la lumière du jour — un arc de journée de marche). Appelé depuis le dropdown
// topbar (`topbar-v2.js`) et le bouton mobile (`mobile-menu.js`).

import { saveAppState } from './database.js';

export const THEMES = ['matin', 'plein-soleil', 'ombre', 'nuit'];

export const THEME_LABELS = {
    matin: 'Matin',
    'plein-soleil': 'Plein soleil',
    ombre: 'Ombre',
    nuit: 'Nuit',
};

// Couleur principale par moment (meta theme-color — barre d'adresse, status bar
// mobile PWA, titlebar Windows standalone). En clair = papier ; en nuit = noir chaud.
const THEME_COLORS = {
    matin: '#FCF9F4',
    'plein-soleil': '#FBF4E8',
    ombre: '#EFEFE0',
    nuit: '#14110D',
};

// Migration des anciens noms (maritime/desert/oasis/night) → 4 moments, pour ne
// pas perdre la préférence des utilisateurs existants (IndexedDB + localStorage).
const LEGACY_MOMENTS = {
    maritime: 'plein-soleil',
    desert: 'matin',
    oasis: 'ombre',
    night: 'nuit',
};

function normalizeMoment(value) {
    if (!value) return null;
    if (THEME_LABELS[value]) return value;
    if (LEGACY_MOMENTS[value]) return LEGACY_MOMENTS[value];
    return null;
}

export function getCurrentTheme() {
    return normalizeMoment(document.documentElement.getAttribute('data-theme')) || 'plein-soleil';
}

function applyThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLORS[theme] || THEME_COLORS['plein-soleil']);
}

/**
 * Applique le moment (DOM + persistance IndexedDB + miroir localStorage pour
 * theme-bootstrap.js + meta theme-color). Idempotent. Migre un ancien nom reçu.
 */
export function setTheme(theme) {
    const moment = normalizeMoment(theme);
    if (!moment) return;
    document.documentElement.setAttribute('data-theme', moment);
    saveAppState('currentTheme', moment);
    // Miroir localStorage pour que theme-bootstrap.js l'applique au 1er paint au prochain F5.
    try { localStorage.setItem('hw_theme', moment); } catch (_) {}
    applyThemeColor(moment);
}

/**
 * Cycle au moment suivant : matin → plein-soleil → ombre → nuit → matin
 * (l'arc de la journée). Utilisé par le bouton mobile (cycle simple).
 */
export function cycleTheme() {
    const current = getCurrentTheme();
    const idx = THEMES.indexOf(current);
    const next = THEMES[(idx + 1) % THEMES.length];
    setTheme(next);
}

// Init au boot — applique la meta theme-color pour le moment déjà posé sur <html>
// par theme-bootstrap.js (avant ce module).
export function initThemeColorMeta() {
    applyThemeColor(getCurrentTheme());
}
