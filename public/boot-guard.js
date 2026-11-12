// boot-guard.js — Secours au démarrage : page d'une ancienne version servie
// alors que ses fichiers ont disparu.
//
// Constaté les 11 et 12/11/2026, juste après un déploiement : la page s'ouvrait
// sans style ni code. Chaque déploiement GitHub Pages remplace tout le site, et
// les fichiers hachés de la version d'avant (/assets/main-*.js, main-*.css)
// répondent 404 ; une ancienne index.html servie à ce moment (cache du
// navigateur, ou copie précachée par le service worker) ne trouve donc plus ses
// fichiers. Recharger suffisait.
//
// Ce script, chargé AVANT les fichiers principaux (index.html, <head>), guette
// l'échec de l'un d'eux. Il retire alors la copie précachée de la page
// (caches « workbox-precache »), désinscrit le service worker, puis recharge
// UNE fois : la page et ses fichiers reviennent du réseau, à jour. Les autres
// caches (tuiles, photos, données : le secours hors-ligne) ne sont pas touchés.
// Hors ligne, il ne fait rien : vider le précache n'y réparerait rien.
//
// Script classique de public/ (la CSP interdit le JavaScript en ligne), copié
// tel quel à la racine de dist/. tests/boot_guard.test.js le garde.
(function () {
    var KEY = 'hw_boot_guard';
    var MAIN = /\/assets\/main-[^/?#]+\.(js|css)(?:[?#]|$)/;
    var failed = false;

    function recover() {
        if (failed) return;
        failed = true;
        if (navigator.onLine === false) return;
        // Une seule tentative par onglet : si la page rechargée échoue encore,
        // on s'arrête (pas de boucle de rechargements).
        try {
            if (sessionStorage.getItem(KEY)) return;
            sessionStorage.setItem(KEY, String(Date.now()));
        } catch (e) {
            return; // stockage indisponible : impossible de garantir une seule tentative
        }
        var jobs = [];
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
            jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
                return Promise.all(regs.map(function (r) { return r.unregister(); }));
            }));
        }
        if (window.caches && caches.keys) {
            jobs.push(caches.keys().then(function (keys) {
                return Promise.all(keys.filter(function (k) { return /workbox-precache/.test(k); })
                    .map(function (k) { return caches.delete(k); }));
            }));
        }
        Promise.all(jobs).catch(function () { /* on recharge quand même */ }).then(function () {
            location.reload();
        });
    }

    // Les erreurs de chargement d'un <script> ou d'un <link> ne remontent pas :
    // écoute en phase de capture.
    window.addEventListener('error', function (e) {
        var t = e && e.target;
        if (!t || t === window || !t.tagName) return;
        var url = t.tagName === 'SCRIPT' ? t.src : (t.tagName === 'LINK' ? t.href : '');
        if (url && MAIN.test(url)) recover();
    }, true);

    // Démarrage réussi : la tentative est rendue, pour un prochain déploiement
    // dans le même onglet.
    window.addEventListener('load', function () {
        if (failed) return;
        try { sessionStorage.removeItem(KEY); } catch (e) { /* rien */ }
    });
})();
