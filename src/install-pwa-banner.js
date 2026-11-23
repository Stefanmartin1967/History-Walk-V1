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
//
// Entrée « Installer Heripia » des menus Outils PC et téléphone (maquette
// écrans 57-60 validée par Stefan le 23/11/2026) : visible tant que Heripia
// n'est pas installée. Navigateur prêt → sa fenêtre d'installation ; iPhone →
// les 3 gestes ; sinon → où chercher dans le menu du navigateur.

import { openHwModal } from './modal.js';
import { getLinkedAccount } from './google-account.js';
import { closeAllDropdowns } from './ui-utils.js';

const DISMISS_KEY = 'hw_install_banner_dismissed_until';
const DISMISS_COOLDOWN_DAYS = 7;

let deferredPrompt = null;
let bannerEl = null;

function isStandalone() {
    // PWA déjà installée et lancée en mode standalone
    const mode = (m) => window.matchMedia?.(`(display-mode: ${m})`)?.matches === true;
    return mode('standalone') || mode('window-controls-overlay') || mode('minimal-ui')
        // iOS Safari historique
        || window.navigator.standalone === true;
}

// iPhone, iPod, iPad (iPadOS se présente comme un Mac, mais tactile).
export function isIOS(nav = window.navigator) {
    const ua = nav.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    return nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1;
}

// Firefox sur PC ne sait pas installer une app web (Firefox Android, si).
export function isDesktopFirefox(nav = window.navigator) {
    const ua = nav.userAgent || '';
    return /Firefox\//.test(ua) && !/Android|Mobile|Tablet/.test(ua);
}

// Safari sur Mac (pas iPad) : « Fichier > Ajouter au Dock ».
function isMacSafari(nav = window.navigator) {
    const ua = nav.userAgent || '';
    return /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|OPR\//.test(ua) && !isIOS(nav);
}

function isAndroid(nav = window.navigator) {
    return /Android/.test(nav.userAgent || '');
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

// ─── Entrée « Installer Heripia » des menus ─────────────────────────────────
// Heripia installée depuis ce navigateur, mais ouverte dans un onglet : le
// navigateur ne propose plus l'installation ; on le lui demande
// (getInstalledRelatedApps, manifest « related_applications »). Un autre
// navigateur ne le sait pas (installée par Chrome, vue dans Brave).
let installedHere = false;
export async function checkAlreadyInstalled(nav = window.navigator) {
    try {
        if (typeof nav.getInstalledRelatedApps !== 'function') return false;
        const apps = await nav.getInstalledRelatedApps();
        installedHere = Array.isArray(apps) && apps.length > 0;
    } catch { installedHere = false; }
    return installedHere;
}

export function installEntryVisible() {
    if (isStandalone() || installedHere) return false;
    if (deferredPrompt || isIOS()) return true;
    return !isDesktopFirefox();
}

export function installEntrySub(mobile) {
    if (isIOS()) return iosBannerSentence();
    return mobile ? SENTENCE_DEFAULT : 'Accès rapide, usage hors-ligne';
}

const MONITOR_DL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"></rect><path d="M8 21h8M12 17v4"></path><path d="M12 7v6M9 10l3 3 3-3"></path></svg>';

// Où chercher quand le navigateur n'ouvre pas sa fenêtre (écrans 58 et 60).
export function installHelpContent(kind) {
    if (kind === 'android') {
        // Ni place ni libellé exacts : ils changent d'un navigateur à l'autre
        // (essai sur S25 du 23/11/2026 : Brave et Samsung Internet ont ⋮ en bas,
        // Chrome en haut ; « Installer et créer un raccourci » chez Brave).
        const steps = [
            `Ouvrez le menu du navigateur ${chip('', '⋮')}, en haut ou en bas de l'écran.`,
            "Touchez l'option qui commence par « Installer ». Dans Samsung Internet : « Ajouter la page à », puis « Installer en tant qu'application Web ».",
            'Confirmez. Ouvrez ensuite Heripia depuis sa nouvelle icône.',
        ].map((s, i) => `<li><span class="ios-install-num">${i + 1}</span><span>${s}</span></li>`).join('');
        return `<p class="ios-install-why">Installée, Heripia s'ouvre depuis son icône, en plein écran, et marche même sans réseau.</p>
            <ol class="ios-install-steps">${steps}</ol>`;
    }
    const where = kind === 'mac-safari'
        ? 'Dans Safari, ouvrez le menu « Fichier », puis « Ajouter au Dock ».'
        : `Cliquez sur <span class="ios-install-chip">${MONITOR_DL}</span> au bout de la barre d'adresse. S'il n'y est pas, ouvrez le menu du navigateur (${chip('', '⋮')} ou ${chip('', '···')}) et cherchez « Installer ».`;
    return `<p class="ios-install-why">Installée, Heripia s'ouvre dans sa propre fenêtre, depuis le menu Démarrer ou la barre des tâches, et marche même sans réseau.</p>
        <p class="ios-install-why">${where}</p>`;
}

function openInstallHelp(kind) {
    return openHwModal({
        size: 'sm',
        icon: 'download',
        title: 'Installer Heripia',
        body: installHelpContent(kind),
        footer: `<button class="btn btn-primary ios-install-ok" data-hw-modal-action="close">J'ai compris</button>`,
    });
}

// Clic sur l'entrée du menu.
export function startInstallFromMenu() {
    if (deferredPrompt) return triggerInstall();
    if (isIOS()) return openIosInstallHelp();
    if (isAndroid()) return openInstallHelp('android');
    return openInstallHelp(isMacSafari() ? 'mac-safari' : 'desktop');
}

function refreshInstallEntry() {
    document.getElementById('btn-install-app')?.classList.toggle('is-hidden', !installEntryVisible());
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
    if (isStandalone() || installedHere) return;
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
    refreshInstallEntry();
});

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    console.log('[install-banner] app installed');
    hideBanner();
    document.getElementById('btn-install-app')?.classList.add('is-hidden');
});

export function initInstallBanner() {
    const entry = document.getElementById('btn-install-app');
    if (entry) {
        const sub = entry.querySelector('.tools-menu-sub');
        if (sub) sub.textContent = installEntrySub(false);
        entry.addEventListener('click', () => { closeAllDropdowns(); startInstallFromMenu(); });
        refreshInstallEntry();
    }
    checkAlreadyInstalled().then((yes) => {
        if (!yes) return;
        hideBanner();
        refreshInstallEntry();
    });

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
