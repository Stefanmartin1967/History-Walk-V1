// tested-sync.js
// Auto-publish du statut "Vérifié" des circuits sur GitHub.
//
// Quand l'admin coche "Fait" sur un circuit officiel, on push immédiatement
// le fichier `public/circuits/tested_{mapId}.json` sur GitHub afin que
// les users publics voient le bouclier vert sans attendre que l'admin
// clique manuellement "Tout publier" via le Control Center.
//
// Stratégie debounced : si l'admin coche plusieurs circuits en rafale,
// on n'envoie qu'un commit après TESTED_PUSH_DEBOUNCE_MS d'inactivité.
//
// Filet de sécurité : en cas d'échec (network, 401, rate limit), le
// `testedChanged` du diff engine reste détecté → l'admin peut toujours
// republier manuellement via "Tout publier".

import { state } from './state.js';
import { getStoredToken, uploadFileToGitHub } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, GITHUB_PATHS } from './config.js';

const TESTED_PUSH_DEBOUNCE_MS = 2000;

let _testedPushTimer = null;

/**
 * Push debounced — appelé à chaque clic admin "Fait" / "Pas fait" sur un
 * circuit officiel. Annule le timer précédent et planifie un push après
 * 2s d'inactivité (commit unique pour une rafale de coches).
 */
export function schedulePushTestedToGitHub() {
    if (_testedPushTimer) clearTimeout(_testedPushTimer);
    _testedPushTimer = setTimeout(() => {
        pushTestedToGitHub();
        _testedPushTimer = null;
    }, TESTED_PUSH_DEBOUNCE_MS);
}

/**
 * Push immédiat (utilisé en interne par schedulePushTestedToGitHub).
 * Silencieux côté UI en succès comme en échec — le filet de sécurité
 * du Control Center prendra le relais en cas de problème.
 */
export async function pushTestedToGitHub() {
    if (!state.isAdmin) return;

    const token = getStoredToken();
    if (!token) return;

    const mapId = state.currentMapId;
    if (!mapId) return;

    try {
        const payload = state.testedCircuits || {};
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const file = new File([blob], `tested_${mapId}.json`, { type: 'application/json' });
        const path = GITHUB_PATHS.tested(mapId);
        const trueCount = Object.values(payload).filter(v => v === true).length;
        const msg = `feat(verified): auto-update tested_${mapId}.json (${trueCount} circuits)`;

        await uploadFileToGitHub(file, token, GITHUB_OWNER, GITHUB_REPO, path, msg);
        console.log(`[TestedSync] Auto-pushed tested_${mapId}.json (${trueCount} circuits)`);
    } catch (e) {
        // Filet de sécurité : on log et on rend la main au CC.
        // Le diff engine détectera la divergence locale↔serveur au prochain
        // ouverture du CC, et l'admin pourra republier via "Tout publier".
        console.warn('[TestedSync] Auto-push failed (CC fallback available):', e.message);
    }
}
