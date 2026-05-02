// theme-bootstrap.js
// Script blocking chargé dans <head> AVANT le CSS pour appliquer le thème
// utilisateur dès le premier paint (évite le FOUC maritime → desert/oasis/night).
//
// Source de vérité long terme = IndexedDB (cf. main.js:setupThemeSelector).
// On miroir le thème dans localStorage à chaque save pour pouvoir le lire
// ici de manière synchrone — IndexedDB est async et arriverait trop tard.
//
// On met à jour 2 choses :
//   1. <html data-theme> → contrôle les vars CSS (couleurs app, topbar, sidebar)
//   2. <meta name="theme-color"> → contrôle la titlebar Chrome en mode PWA installé
(function () {
    var THEME_COLORS = {
        maritime: '#0D3B66',
        desert: '#7a5230',
        oasis: '#065f46',
        night: '#111827',
    };
    try {
        var t = localStorage.getItem('hw_theme');
        if (t && THEME_COLORS[t]) {
            document.documentElement.setAttribute('data-theme', t);
            var meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', THEME_COLORS[t]);
        }
    } catch (e) { /* localStorage indisponible (mode privé strict) → fallback HTML */ }
})();
