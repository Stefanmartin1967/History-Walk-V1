// theme-bootstrap.js
// Script blocking chargé dans <head> AVANT le CSS pour poser data-theme dès le
// premier paint (anti-FOUC). Refonte « plein soleil » : 4 MOMENTS (matin /
// plein-soleil / ombre / nuit), DÉFAUT couplé à prefers-color-scheme, et
// migration des anciens noms de thèmes (maritime/desert/oasis/night).
//
// Source de vérité long terme = IndexedDB (cf. theme.js / main.js). On miroir le
// moment dans localStorage à chaque save pour le lire ici de façon synchrone.
(function () {
    var COLORS = { matin: '#FCF9F4', 'plein-soleil': '#FBF4E8', ombre: '#EFEFE0', nuit: '#14110D' };
    var LEGACY = { maritime: 'plein-soleil', desert: 'matin', oasis: 'ombre', night: 'nuit' };
    function norm(t) {
        if (!t) return null;
        if (COLORS[t]) return t;
        if (LEGACY[t]) return LEGACY[t];
        return null;
    }
    try {
        var raw = localStorage.getItem('hw_theme');
        var stored = norm(raw);
        var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        // Choix explicite de l'utilisateur > défaut OS (nuit si sombre, sinon plein soleil).
        var moment = stored || (prefersDark ? 'nuit' : 'plein-soleil');
        document.documentElement.setAttribute('data-theme', moment);
        // Migration persistante : un ancien nom stocké est réécrit en moment.
        if (stored && stored !== raw) { try { localStorage.setItem('hw_theme', stored); } catch (e) {} }
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta && COLORS[moment]) meta.setAttribute('content', COLORS[moment]);
    } catch (e) { /* localStorage indispo (mode privé) → fallback HTML data-theme="plein-soleil" */ }
})();
