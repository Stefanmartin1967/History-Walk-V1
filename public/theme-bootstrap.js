// theme-bootstrap.js
// Script blocking chargé dans <head> AVANT le CSS pour appliquer le thème
// utilisateur dès le premier paint (évite le FOUC maritime → desert/oasis/night).
//
// Source de vérité long terme = IndexedDB (cf. main.js:setupThemeSelector).
// On miroir le thème dans localStorage à chaque save pour pouvoir le lire
// ici de manière synchrone — IndexedDB est async et arriverait trop tard.
(function () {
    try {
        var t = localStorage.getItem('hw_theme');
        if (t === 'maritime' || t === 'desert' || t === 'oasis' || t === 'night') {
            document.documentElement.setAttribute('data-theme', t);
        }
    } catch (e) { /* localStorage indisponible (mode privé strict) → fallback HTML */ }
})();
