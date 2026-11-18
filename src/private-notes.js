// private-notes.js
// Note privée sourcée — chantier 10/08/2026.
//
// Remplace la synchronisation Gist du champ `notes` par heripia-travail (le
// dépôt privé déjà en place pour les photos de travail — même token, même
// API Contents). Motif : 3 bugs de sync sur le Gist en une session (cf.
// project_gist_phantom_bug_fixed) venaient d'un identifiant OPAQUE (gistId) à
// découvrir et qui pouvait pointer dans le vide. Un chemin FIXE et connu
// (`<mapId>/note_<poiId>.txt`) n'a pas ce problème : pas d'ID à perdre.
//
// ⚠️ CE MODULE NE TOUCHE PAS AU STOCKAGE LOCAL. `notes` reste exactement où
// il était (`state.userData[poiId].notes`, persisté par `updatePoiData` →
// `savePoiData`, inclus dans la sauvegarde Lite/Complète comme avant, pour
// TOUT visiteur — admin ou non). Ce module gère UNIQUEMENT le transport vers
// heripia-travail, une étape EN PLUS de la sauvegarde locale, réservée à qui
// a un token configuré. Sans token, le comportement est identique à avant :
// la note reste sur l'appareil, point (cf. l'aide « Mes notes... Restent sur
// votre appareil »).
//
// 18/11/2026 : transport seulement. La décision (prendre, envoyer, conflit)
// et la passe de synchronisation sont dans note-plan.js et note-sync.js.
// Retirés : loadPrivateNote / savePrivateNote / shouldSyncPrivateNote /
// migrateExistingNotes (lecture seulement si la note locale était vide,
// écriture et migration qui écrasaient le dépôt sans regarder sa version).

import { getStoredToken, uploadFileToGitHub, deleteFileFromGitHub } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_WORK_REPO } from './config.js';
import { fetchWithTimeout } from './net.js';

function notePath(mapId, poiId) {
    const safePoiId = String(poiId).replace(/[^a-zA-Z0-9-_]/g, '_');
    return `${mapId}/note_${safePoiId}.txt`;
}

// ─── Synchronisation par version (18/11/2026, point 3 des conflits) ───────────
// Chaque note locale retient la VERSION du fichier du dépôt sur laquelle elle
// est basée (note-sync.js). Ces fonctions donnent la version avec le contenu,
// et n'écrivent ou ne suppriment qu'à partir d'une version connue : si un autre
// appareil a changé le fichier entre-temps, GitHub refuse (409 / 422) au lieu
// d'écraser.

function decodeBase64Utf8(b64) {
    const binary = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Note du dépôt avec sa version. null = pas de note (404). LÈVE si la lecture
 * échoue (pas de jeton, réseau, 5xx) : « absente » et « inconnue » ne se
 * confondent pas.
 * @returns {Promise<{text: string, sha: string}|null>}
 */
export async function readNoteFile(mapId, poiId) {
    const token = getStoredToken();
    if (!token) throw new Error('Jeton GitHub manquant');
    const res = await fetchWithTimeout(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_WORK_REPO}/contents/${notePath(mapId, poiId)}`,
        { cache: 'no-store', headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Note illisible (HTTP ${res.status})`);
    const data = await res.json();
    return { text: data.content ? decodeBase64Utf8(data.content) : '', sha: data.sha };
}

/**
 * Versions de toutes les notes d'une destination, en UNE requête (dossier).
 * Map(poiId → sha) ; Map vide si le dossier n'existe pas encore. LÈVE si la
 * lecture échoue.
 * @returns {Promise<Map<string, string>>}
 */
export async function listNoteFiles(mapId) {
    const token = getStoredToken();
    if (!token) throw new Error('Jeton GitHub manquant');
    const res = await fetchWithTimeout(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_WORK_REPO}/contents/${mapId}`,
        { cache: 'no-store', headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (res.status === 404) return new Map();
    if (!res.ok) throw new Error(`Notes illisibles (HTTP ${res.status})`);
    const items = await res.json();
    const out = new Map();
    (Array.isArray(items) ? items : []).forEach(it => {
        const m = it?.type === 'file' && /^note_(.+)\.txt$/.exec(it.name || '');
        if (m) out.set(m[1], it.sha);
    });
    return out;
}

/**
 * Écrit la note à partir d'une version connue (expectedSha) ou en création
 * (expectedSha null : le fichier ne doit pas exister). Renvoie la nouvelle version.
 * @returns {Promise<string>}
 */
export async function writeNoteFile(mapId, poiId, text, expectedSha) {
    const token = getStoredToken();
    if (!token) throw new Error('Jeton GitHub manquant');
    const bytes = new TextEncoder().encode(String(text ?? '').trim());
    const result = await uploadFileToGitHub(
        new File([bytes], `note_${poiId}.txt`, { type: 'text/plain' }),
        token, GITHUB_OWNER, GITHUB_WORK_REPO, notePath(mapId, poiId),
        `travail: note pour ${poiId}`,
        expectedSha ? { expectedSha } : { create: true }
    );
    return result?.content?.sha || null;
}

/** Supprime la note du dépôt, CETTE version seulement (expectedSha). */
export async function removeNoteFile(mapId, poiId, expectedSha) {
    const token = getStoredToken();
    if (!token) throw new Error('Jeton GitHub manquant');
    await deleteFileFromGitHub(token, GITHUB_OWNER, GITHUB_WORK_REPO, notePath(mapId, poiId),
        `travail: note supprimée pour ${poiId}`, expectedSha ? { expectedSha } : {});
}
