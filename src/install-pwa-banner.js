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
// iPhone / iPad : pas de `beforeinstallprompt`, on ne peut pas installer à la
// place du user. Le bandeau dit « Comment ? » et ouvre les 3 gestes à faire
// (audit du 23/11/2026, maquette écrans 55-56 validée par Stefan) : Safari
// efface les données d'un site non ouvert pendant 7 jours, sauf une fois
// installé sur l'écran d'accueil.

import { openHwModal } from './modal.js';
import { getLinkedAccount } from './google-account.js';

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

// iPhone, iPod, iPad (iPadOS se présente comme un Mac, mais tactile).
export function isIOS(nav = window.navigator) {
    const ua = nav.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    return nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1;
}

// Safari, ou un autre navigateur iPhone (Chrome, Edge, Firefox… : CriOS, EdgiOS, FxiOS).
function isIOSSafari(nav = window.navigator) {
    return !/CriOS|EdgiOS|FxiOS|OPiOS|GSA\//.test(nav.userAgent || '');
}

const SENTENCE_DEFAULT = "Accès rapide depuis l'écran d'accueil, usage hors-ligne.";
const SENTENCE_IOS = "Sur iPhone, c'est le seul moyen de garder vos visites et vos circuits.";

// Phrase du bandeau sur iPhone : compte Google relié → les données sont gardées
// ailleurs, on reprend la phrase d'Android.
export function iosBannerSentence(linked = getLinkedAccount()) {
    return linked ? SENTENCE_DEFAULT : SENTENCE_IOS;
}

const chip = (icon, label) => `<span class="ios-install-chip">${icon ? `<i data-lucide="${icon}"></i>` : ''}${label}</span>`;

export function iosInstallSteps(safari = true) {
    const share = chip('share', 'Partager');
    const step1 = safari
        ? `Touchez ${share}, en bas de l'écran. S'il n'y est pas, touchez d'abord ${chip('', '···')}.`
        : `Touchez ${share}, dans la barre d'adresse ou dans le menu ${chip('', '···')}.`;
    return [
        step1,
        `Choisissez ${chip('square-plus', "Sur l'écran d'accueil")} (faites défiler la liste si besoin).`,
        "Touchez « Ajouter ». Ouvrez ensuite Heripia depuis sa nouvelle icône.",
    ];
}

export function openIosInstallHelp() {
    const steps = iosInstallSteps(isIOSSafari())
        .map((s, i) => `<li><span class="ios-install-num">${i + 1}</span><span>${s}</span></li>`).join('');
    return openHwModal({
        size: 'sm',
        icon: 'download',
        title: "Installer Heripia sur l'iPhone",
        body: `<p class="ios-install-why">Sur iPhone, Safari efface ce qu'un site a enregistré quand vous ne l'ouvrez pas pendant 7 jours. Installée sur l'écran d'accueil, Heripia garde vos visites, vos notes et vos circuits, et s'ouvre même sans réseau.</p>
            <ol class="ios-install-steps">${steps}</ol>`,
        footer: `<button class="btn btn-primary ios-install-ok" data-hw-modal-action="close">J'ai compris</button>`,
    });
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

let iosMode = false;

function showBanner() {
    if (!bannerEl) return;
    if (isStandalone()) return;
    if (isDismissedRecently()) return;
    if (!deferredPrompt && !iosMode) return;
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

    if (isIOS()) {
        iosMode = true;
        const btn = bannerEl.querySelector('#install-banner-install');
        if (btn) btn.textContent = 'Comment ?';
        const sentence = bannerEl.querySelector('.install-banner-text span');
        if (sentence) sentence.textContent = iosBannerSentence();
        bannerEl.querySelector('#install-banner-install')
            ?.addEventListener('click', () => openIosInstallHelp());
        bannerEl.querySelector('#install-banner-dismiss')
            ?.addEventListener('click', () => dismissBanner());
        showBanner();
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
