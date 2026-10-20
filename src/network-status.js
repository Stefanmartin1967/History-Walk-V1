// network-status.js
// Source unique de « réseau revenu » : bandeau « Hors-ligne », tracé et carte
// complétés (circuit.js, map.js), synchronisation Gist rejouée (gist-sync.js).
//
// Pourquoi pas les seuls événements online/offline du navigateur : sur Android,
// quand le réseau revient pendant que Heripia est en arrière-plan (téléphone en
// poche), Chrome met la page en pause et le signal « online » est PERDU.
// Constaté par Stefan sur son S25 le 20/10/2026 (v3.7.444) : de retour dans
// Heripia, bandeau resté plus de 3 minutes, tracé en vol d'oiseau, carte grise.
// Reproduit en local : réseau rétabli sans signal → rien ne bougeait, même
// avec navigator.onLine revenu à vrai.
//
// Principe : on passe « hors-ligne » quand le navigateur l'annonce, ou au
// démarrage sans réseau. Tant qu'on y est, on VÉRIFIE la connexion en demandant
// un petit fichier du site : au signal « online », au retour de Heripia au
// premier plan, et toutes les 15 s. Sans réseau, la demande échoue tout de
// suite, sans données consommées. Dès qu'elle aboutit : bandeau retiré, abonnés
// prévenus. En ligne, aucune vérification.

import { fetchWithTimeout } from './net.js';

const CHECK_INTERVAL_MS = 15000;
const CHECK_TIMEOUT_MS = 5000;

// Fichier de vérification : petit, et servi par le RÉSEAU seulement — ni
// précaché ni pris par une route du service worker, sinon on se croirait en
// ligne en lisant le cache. tests/network_status.test.js le garde.
export const CHECK_PATH = 'robots.txt';

let offline = false;
let checkTimer = null;
let checking = null;
const listeners = [];

export function isOffline() {
    return offline;
}

/** Abonne `fn` au retour du réseau (à chaque passage hors-ligne → en ligne). */
export function onNetworkBack(fn) {
    listeners.push(fn);
}

/** Vérifie la connexion, une demande à la fois. Ne fait rien en ligne. */
function checkNetwork() {
    if (!offline) return Promise.resolve();
    if (!checking) {
        const base = import.meta.env?.BASE_URL || '/';
        checking = fetchWithTimeout(`${base}${CHECK_PATH}?verif=${Date.now()}`,
            { method: 'HEAD', cache: 'no-store' }, CHECK_TIMEOUT_MS)
            .then(goOnline, () => { /* toujours hors-ligne */ })
            .finally(() => { checking = null; });
    }
    return checking;
}

function goOffline() {
    if (offline) return;
    offline = true;
    updateBanner();
    checkTimer = setInterval(checkNetwork, CHECK_INTERVAL_MS);
}

function goOnline() {
    if (!offline) return;
    offline = false;
    clearInterval(checkTimer);
    checkTimer = null;
    updateBanner();
    for (const fn of listeners) {
        Promise.resolve().then(fn).catch((e) => console.error('[Réseau] abonné en échec :', e));
    }
}

function updateBanner() {
    document.getElementById('offline-banner')?.classList.toggle('visible', offline);
}

/** À appeler une fois au chargement (main.js). */
export function initNetworkStatus() {
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', checkNetwork);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkNetwork();
    });
    if (navigator.onLine === false) {
        goOffline();
        checkNetwork(); // un navigator.onLine faux à tort se corrige tout de suite
    }
}
