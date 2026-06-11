// net.js
// Helper réseau partagé : un fetch borné dans le temps.
//
// Problème couvert (audit R3, 11/06/2026) : un fetch sans timeout peut rester
// suspendu indéfiniment face à un serveur lent ou un réseau « zombie » (connecté
// mais sans débit). Les appels concernés sont les API externes — BRouter, GitHub
// (Contents/Gist), Nominatim, raw.githubusercontent — qui ne bénéficient PAS de
// la protection NetworkFirst du service worker (réservée au même-origine).
//
// Implémentation : AbortController + setTimeout (même patron que osm-overpass.js),
// volontairement choisi plutôt que AbortSignal.timeout()/any() trop récents pour
// la cible navigateur. Un éventuel signal appelant est respecté (combiné).

/** Timeout réseau par défaut (ms). Couvre une API qui répond normalement en < 2 s. */
export const NET_TIMEOUT_MS = 12000;

/**
 * fetch borné dans le temps. Identique à fetch(), mais rejette avec un message
 * lisible si le serveur ne répond pas dans le délai imparti.
 *
 * @param {string|URL} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs=NET_TIMEOUT_MS] Délai max avant abandon.
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = NET_TIMEOUT_MS) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);

    // Respecte un signal fourni par l'appelant (rare ici) : on relaie son abort.
    if (options.signal) {
        if (options.signal.aborted) controller.abort();
        else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (e) {
        // L'abort sur timeout remonte en AbortError → on le traduit en message clair.
        // (Un abort du signal appelant remonte aussi ici ; rare et tout aussi valide.)
        if (e && e.name === 'AbortError') {
            throw new Error(`Délai réseau dépassé (${Math.round(timeoutMs / 1000)} s).`);
        }
        throw e;
    } finally {
        clearTimeout(tid);
    }
}
