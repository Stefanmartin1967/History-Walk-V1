// install-pwa-banner.js
// Bandeau dismissible "Installer cette app" qui intercepte l'événement
// natif `beforeinstallprompt` du browser et le re-déclenche depuis un bouton
// custom (UX bien plus simple que de chercher dans le menu Chrome).
//
// Comportement :
// - Bandeau visible quand : navigateur supporte l'install PWA, app pas déjà
//   installée, et user n'a pas dismiss récemment (cooldown 7 jours).
// - Clic "Installer" : déclenche le prompt natif Android/Desktop.
// - Clic "Plus tard" : bandeau caché pour 7 jours (localStorage).
// - Si user installe : bandeau caché et `appinstalled` détecté.
//
// Compatibilité : Chrome/Edge/Brave/Samsung Internet (Android + Desktop).
// iOS Safari ne supporte PAS `beforeinstallprompt` → bandeau ne s'affichera pas
// (à traiter plus tard avec une page d'instructions dédiée iOS).

const DISMISS_KEY = 'hw_install_banner_dismissed_until';
const DISMISS_COOLDOWN_DAYS = 7;

let deferredPrompt = null;
let bannerEl = null;

function isStandalone() {
    // PWA déjà installée et lancée en mode standalone
    return window.matchMedia('(display-mode: standalone)').matches
        || window.matchMedia('(display-mode: window-controls-overlay)').matches
        || window.matchMedia('(display-mode: minimal-ui)').matches
        // iOS Safari historique
        || window.navigator.standalone === true;
}

function isDismissedRecently() {
    try {
        const until = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
        return Date.now() < until;
    } catch {
        return false;
    }
}

function dismissBanner() {
    hideBanner();
    try {
        const until = Date.now() + DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
        localStorage.setItem(DISMISS_KEY, String(until));
    } catch { /* quota ou storage off : tant pis */ }
}

async function triggerInstall() {
    if (!deferredPrompt) return;
    const promptEvent = deferredPrompt;
    // Le prompt ne peut être déclenché qu'une fois ; on le consomme immédiatement.
    deferredPrompt = null;
    promptEvent.prompt();
    try {
        const { outcome } = await promptEvent.userChoice;
        if (outcome === 'accepted') {
            // L'event `appinstalled` se chargera de cacher le banner et de cleanup.
        } else {
            // L'utilisateur a refusé : on dismiss pour ne pas re-proposer immédiatement.
            dismissBanner();
        }
    } catch {
        // userChoice peut rejeter sur certains browsers ; on ne casse pas l'app.
    }
}

function showBanner() {
    if (!bannerEl) return;
    if (isStandalone()) return;
    if (isDismissedRecently()) return;
    if (!deferredPrompt) return;
    bannerEl.classList.remove('is-hidden');
    document.body.classList.add('has-install-banner');
}

function hideBanner() {
    bannerEl?.classList.add('is-hidden');
    document.body.classList.remove('has-install-banner');
}

// ⚠️ Listener attaché au top-level du module, dès l'import.
// Chrome/Edge peuvent émettre `beforeinstallprompt` très tôt (juste après que
// la page atteigne hw-ready ou même avant), et si le listener est attaché trop
// tard (ex : depuis une fonction d'init appelée après loadAndInitializeMap),
// l'event est perdu et le banner ne s'affiche jamais. C'est exactement ce
// qui s'est passé en test sur Brave / Chrome Android : import dynamique tardif
// → event émis avant → listener attaché → trop tard.
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[install-banner] beforeinstallprompt captured', e);
    // Si l'UI est déjà initialisée (banner element trouvé), on l'affiche tout de suite.
    if (bannerEl) showBanner();
});

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    console.log('[install-banner] app installed');
    hideBanner();
});

export function initInstallBanner() {
    bannerEl = document.getElementById('install-banner');
    if (!bannerEl) return;

    // Si déjà en mode standalone, le banner reste caché par défaut.
    if (isStandalone()) {
        console.log('[install-banner] already in standalone mode, banner stays hidden');
        return;
    }

    // Si l'event a déjà été reçu (avant init UI), afficher maintenant.
    if (deferredPrompt) {
        console.log('[install-banner] event already captured, showing banner');
        showBanner();
    } else {
        console.log('[install-banner] init OK, waiting for beforeinstallprompt event…');
    }

    bannerEl.querySelector('#install-banner-install')
        ?.addEventListener('click', () => triggerInstall());
    bannerEl.querySelector('#install-banner-dismiss')
        ?.addEventListener('click', () => dismissBanner());
}
