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
import { getAppState, saveAppState } from './database.js';

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

// ─── Étapes parcourues : quand le badge doit sauter ─────────────────────────
// Règle (Stefan, 18/09/2026) : « Vérifié » atteste que le circuit PUBLIÉ a été
// marché. On ne le retire qu'à la publication d'une modification, et seulement
// si les étapes parcourues ont été ENRICHIES (lieu ajouté) ou RÉORDONNÉES.
// Retirer une étape le laisse : tout ce qui reste a bien été vu. Ouvrir
// « Modifier », annuler, renommer ou changer la description ne le touche pas.
//
// Les étapes de référence sont celles du circuit AU MOMENT où « fait » a été
// coché (mémorisées localement) : un circuit modifié, marché, coché PUIS publié
// garde ainsi son badge tout neuf. À défaut (coché avant ce mécanisme, ou sur un
// autre appareil), on se rabat sur la version publiée.

const stepsKey = (mapId) => `tested_steps_${mapId}`;

/**
 * Le passage de `walked` à `published` retire-t-il le badge « Vérifié » ?
 * Oui si un lieu a été ajouté, ou si l'ordre des lieux conservés a changé.
 * Non pour un simple retrait. Liste de référence vide = inconnue → non.
 * @param {string[]} walked Étapes parcourues (référence).
 * @param {string[]} published Étapes qui vont être publiées.
 * @returns {boolean}
 */
export function stepsInvalidateVerified(walked, published) {
    const before = (walked || []).map(String);
    const after = (published || []).map(String);
    if (before.length === 0) return false;
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    if (after.some(id => !beforeSet.has(id))) return true;
    // Ordre relatif des lieux conservés (une boucle répète son départ : les
    // doublons sont gardés des deux côtés, la comparaison reste cohérente).
    const keptBefore = before.filter(id => afterSet.has(id));
    return keptBefore.join('|') !== after.join('|');
}

/** Étapes mémorisées au moment où « fait » a été coché, par circuit. */
export async function getTestedSteps(mapId) {
    return (await getAppState(stepsKey(mapId))) || {};
}

/**
 * Mémorise (ou oublie, avec `poiIds` null) les étapes parcourues d'un circuit.
 * @param {string} mapId
 * @param {string} circuitId
 * @param {string[]|null} poiIds
 */
export async function rememberTestedSteps(mapId, circuitId, poiIds) {
    if (!mapId) return;
    const steps = await getTestedSteps(mapId);
    if (Array.isArray(poiIds)) steps[String(circuitId)] = poiIds.map(String);
    else delete steps[String(circuitId)];
    await saveAppState(stepsKey(mapId), steps);
}
