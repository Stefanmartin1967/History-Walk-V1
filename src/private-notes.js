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
// Puisque `notes` reste local en premier lieu, il n'y a pas besoin d'un cache
// séparé ici : `loadPrivateNote` n'est appelée QUE quand le local est vide
// (nouvel appareil qui n'a jamais vu cette note) — si elle trouve du contenu,
// l'appelant l'écrit dans `userData` via `updatePoiData`, qui devient dès
// lors la seule copie qui compte sur cet appareil.

import { state } from './state.js';
import { getStoredToken, uploadFileToGitHub, deleteFileFromGitHub } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_WORK_REPO } from './config.js';
import { fetchWithTimeout } from './net.js';

function notePath(mapId, poiId) {
    const safePoiId = String(poiId).replace(/[^a-zA-Z0-9-_]/g, '_');
    return `${mapId}/note_${safePoiId}.txt`;
}

/**
 * Contenu de la note privée d'un POI sur heripia-travail.
 * @returns {Promise<string|null>} null si aucune note (jamais créée, 404, ou
 *   pas de token) — TOUJOURS silencieux : l'appelant décide s'il s'agit d'une
 *   vraie absence ou d'un échec réseau, il n'y a rien d'actionnable ici.
 */
export async function loadPrivateNote(mapId, poiId) {
    const token = getStoredToken();
    if (!token) return null;

    const path = notePath(mapId, poiId);
    try {
        const res = await fetchWithTimeout(
            `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_WORK_REPO}/contents/${path}`,
            {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );
        if (res.status === 404) return null; // Cas normal : pas de note pour ce lieu
        if (!res.ok) {
            console.warn('[PrivateNotes] Lecture impossible:', path, res.status);
            return null;
        }
        const data = await res.json();
        if (!data.content) return null;

        // L'API insère des retours à la ligne dans le base64 (comme pour les
        // photos de travail) — décodage UTF-8 explicite (atob seul mutile les
        // accents : le texte n'est pas ASCII pur).
        const binary = atob(String(data.content).replace(/\s/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
        console.warn('[PrivateNotes] Lecture échouée:', path, e.message);
        return null;
    }
}

/**
 * Pousse (ou efface) la note privée d'un POI vers heripia-travail.
 *
 * Un texte vide SUPPRIME le fichier distant plutôt que d'écrire un fichier
 * vide — cohérent avec « pas de fichier » comme signal d'absence de note, et
 * ça évite d'accumuler des fichiers vides au fil des brouillons effacés.
 *
 * @throws si aucun token n'est configuré — l'appelant (qui a déjà persisté en
 *   local avant d'appeler ceci) décide comment présenter l'échec de l'envoi
 *   distant, qui n'est JAMAIS une perte de donnée.
 */
export async function savePrivateNote(mapId, poiId, text) {
    const token = getStoredToken();
    if (!token) {
        throw new Error("Token GitHub introuvable. Configurez-le dans le Centre de Contrôle.");
    }
    const path = notePath(mapId, poiId);
    const trimmed = (text || '').trim();

    if (!trimmed) {
        try {
            await deleteFileFromGitHub(token, GITHUB_OWNER, GITHUB_WORK_REPO, path, `travail: note supprimée pour ${poiId}`);
        } catch (e) {
            // Rien à supprimer (note jamais créée sur ce dépôt) : pas une erreur.
            if (!/introuvable/i.test(e.message)) throw e;
        }
        return;
    }

    const bytes = new TextEncoder().encode(trimmed);
    await uploadFileToGitHub(
        new File([bytes], `note_${poiId}.txt`, { type: 'text/plain' }),
        token,
        GITHUB_OWNER,
        GITHUB_WORK_REPO,
        path,
        `travail: note pour ${poiId}`
    );
}

/**
 * Migration one-shot : pousse vers heripia-travail toutes les notes déjà
 * présentes en LOCAL (userData), pour qu'elles deviennent visibles sur les
 * autres appareils — remplace le rôle que jouait le Gist pour ce champ.
 *
 * N'écrit JAMAIS dans `userData` ni ne touche au Gist : purement additif côté
 * heripia-travail. Déclenchée depuis le Centre de Contrôle par Stefan
 * lui-même (pas automatique) — cf. project_gist_to_private_repo_migration.
 *
 * @param {string} mapId
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<{total: number, success: number, failed: Array<{poiId: string, error: string}>}>}
 */
export async function migrateExistingNotes(mapId, onProgress) {
    const entries = Object.entries(state.userData || {})
        .filter(([, data]) => typeof data?.notes === 'string' && data.notes.trim());

    const result = { total: entries.length, success: 0, failed: [] };
    let done = 0;
    for (const [poiId, data] of entries) {
        try {
            await savePrivateNote(mapId, poiId, data.notes);
            result.success++;
        } catch (e) {
            result.failed.push({ poiId, error: e.message });
        }
        done++;
        if (onProgress) onProgress(done, result.total);
    }
    return result;
}
