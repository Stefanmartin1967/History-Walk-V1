// theme.js
// Module dédié au switch de thème (refonte topbar PC-2, 10/05/2026).
// Extrait de main.js pour pouvoir être appelé depuis le bouton topbar dropdown
// (`topbar-v2.js`) et le bouton mobile (`mobile-menu.js`) sans dupliquer la
// logique. Les 4 thèmes sont définis dans `style/tokens.css`.

import { saveAppState } from './database.js';

export const THEMES = ['maritime', 'desert', 'oasis', 'night'];

export const THEME_LABELS = {
    maritime: 'Maritime',
    desert: 'Désert',
    oasis: 'Oasis',
    night: 'Nuit',
};

// Couleur principale par thème (utilisée pour la meta theme-color du browser
// — barre d'adresse, status bar mobile PWA, title bar Windows standalone).
const THEME_COLORS = {
    maritime: '#0D3B66',
    desert: '#7a5230',
    oasis: '#065f46',
    night: '#111827',
};

export function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'maritime';
}

function applyThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLORS[theme] || THEME_COLORS.maritime);
}

/**
 * Applique le thème (DOM + persistance IndexedDB + miroir localStorage pour
 * theme-bootstrap.js + meta theme-color). Idempotent — peut être appelé
 * sans risque même si le thème est déjà actif.
 */
export function setTheme(theme) {
    if (!THEMES.includes(theme)) return;
    document.documentElement.setAttribute('data-theme', theme);
    saveAppState('currentTheme', theme);
    // Mirror localStorage pour que theme-bootstrap.js (script blocking dans
    // <head>) puisse l'appliquer dès le 1er paint au prochain F5.
    try { localStorage.setItem('hw_theme', theme); } catch (_) {}
    applyThemeColor(theme);
}

/**
 * Cycle au thème suivant : maritime → desert → oasis → night → maritime.
 * Utilisé par le bouton mobile (cycle simple) et tout fallback qui n'a pas
 * de UI de sélection visuelle.
 */
export function cycleTheme() {
    const current = getCurrentTheme();
    const idx = THEMES.indexOf(current);
    const next = THEMES[(idx + 1) % THEMES.length];
    setTheme(next);
}

// Init au boot — applique la meta theme-color pour le thème déjà défini par
// theme-bootstrap.js (l'attribut data-theme est déjà sur <html> avant ce module).
export function initThemeColorMeta() {
    applyThemeColor(getCurrentTheme());
}
