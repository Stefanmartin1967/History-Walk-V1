// work-photos.js
// Photos de travail — chantier 10/08/2026.
//
// Photos dont Stefan N'EST PAS l'auteur (captures Facebook, envois de contacts,
// extraits du répertoire PDF), servant à identifier un lieu pas encore visité.
// Règle absolue : rien de public qui ne soit de lui → ces photos ne doivent
// JAMAIS être publiées.
//
// Trois garanties structurelles plutôt qu'un simple drapeau :
//
//  1. Les octets vivent dans un dépôt GitHub PRIVÉ distinct (GITHUB_WORK_REPO).
//     Le pipeline de publication ne lit que GITHUB_REPO → il n'y a pas de filtre
//     à oublier. Privé = on ne republie pas le travail d'autrui.
//  2. Les références vivent dans `userData.workPhotos`, clé déclarée dans
//     PERSONAL_KEYS → purgée du geojson au publish par le mécanisme existant,
//     partagé par admin-geojson / admin-diff-engine / data.js.
//  3. Pas de watermark (cf. compressImage `skipWatermark`) : apposer
//     « © Stefan Martin » sur la photo d'un tiers serait une fausse attribution.
//
// Cycle de vie : une photo de travail est un PROVISOIRE. Dès que Stefan importe
// ses propres photos sur le lieu, les références sont retirées (cf.
// clearWorkPhotos, appelé à l'import). Les octets, eux, restent dans le dépôt
// privé — décision 10/08 : un import par erreur ne doit pas détruire le travail.
//
// Lecture : un dépôt privé n'est pas servible à un `<img src>` (il faut un
// en-tête d'autorisation). On rapatrie donc chaque photo une fois via l'API
// Contents authentifiée, puis on la sert depuis le cache IndexedDB — c'est ce
// qui la rend consultable hors-ligne sur le terrain.
//
// ⚠️ Conséquence à connaître : sur un appareil qui n'a jamais affiché la photo,
// le premier rendu exige du réseau. Préparer au bureau, ouvrir les lieux
// concernés une fois en wifi, puis partir sur le terrain.

import { state } from './state.js';
import { getStoredToken, uploadFileToGitHub } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_WORK_REPO, WORK_PATHS } from './config.js';
import { compressImage, PUBLISH_COMPRESSION, validatePhotoFile } from './photo-service.js';
import { getCachedWorkPhoto, setCachedWorkPhoto, deleteCachedWorkPhoto } from './database.js';
import { fetchWithTimeout } from './net.js';

/** Plafond volontaire : trois par lieu suffisent à identifier (validé 10/08). */
export const MAX_WORK_PHOTOS_PER_POI = 3;

/**
 * Chemins des photos de travail d'un POI.
 *
 * Lecture directe dans `state.userData` et non via `getPoiProp` : `workPhotos`
 * est une clé PERSONNELLE, elle n'existe jamais dans le geojson patrimonial.
 * Il n'y a donc pas d'overlay à arbitrer — la seule source possible est ici.
 *
 * @returns {string[]} toujours un tableau
 */
export function getWorkPhotosById(poiId) {
    const raw = state.userData?.[poiId]?.workPhotos;
    return Array.isArray(raw) ? raw.filter(p => typeof p === 'string' && p) : [];
}

/**
 * Envoie une photo de travail dans le dépôt privé et retourne son chemin.
 * Compression identique à la publication (1080 px suffisent largement pour
 * identifier une façade) mais SANS watermark.
 *
 * @param {File} file
 * @param {string} poiId
 * @returns {Promise<string>} chemin dans le dépôt privé, ex. « djerba/work_HW-12_1754.jpg »
 */
export async function uploadWorkPhoto(file, poiId) {
    const token = getStoredToken();
    if (!token) {
        throw new Error("Token GitHub introuvable. Configurez-le dans le Centre de Contrôle.");
    }
    const validation = validatePhotoFile(file);
    if (!validation.valid) throw new Error(validation.reason);

    const mapId = state.currentMapId;
    if (!mapId) throw new Error('Aucune destination active.');

    const blob = await compressImage(
        file,
        PUBLISH_COMPRESSION.targetMinSize,
        PUBLISH_COMPRESSION.quality,
        { skipWatermark: true }
    );

    const safePoiId = String(poiId).replace(/[^a-zA-Z0-9-_]/g, '_');
    const filename = `work_${safePoiId}_${Date.now()}.jpg`;
    const path = WORK_PATHS.photo(mapId, filename);

    await uploadFileToGitHub(
        new File([blob], filename, { type: 'image/jpeg' }),
        token,
        GITHUB_OWNER,
        GITHUB_WORK_REPO,
        path,
        `travail: photo de recherche pour ${poiId}`
    );

    // Cache immédiat : la photo vient d'être compressée ici, inutile de la
    // re-télécharger pour l'afficher sur cet appareil.
    await setCachedWorkPhoto(path, blob);

    return path;
}

/**
 * Blob d'une photo de travail : cache d'abord, réseau ensuite.
 *
 * Le dépôt étant privé, on passe par l'API Contents authentifiée qui renvoie le
 * contenu en base64 — `raw.githubusercontent` anonyme répondrait 404.
 *
 * @param {string} path
 * @returns {Promise<Blob|null>} null si absente du cache ET indisponible en ligne
 */
export async function loadWorkPhotoBlob(path) {
    if (!path) return null;

    const cached = await getCachedWorkPhoto(path);
    if (cached) return cached;

    const token = getStoredToken();
    if (!token) return null; // Sans token, rien à tenter : échec silencieux

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
        if (!res.ok) {
            console.warn('[WorkPhotos] Téléchargement impossible:', path, res.status);
            return null;
        }
        const data = await res.json();
        if (!data.content) return null;

        // L'API insère des retours à la ligne dans le base64 — atob les refuse.
        const binary = atob(String(data.content).replace(/\s/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'image/jpeg' });

        await setCachedWorkPhoto(path, blob);
        return blob;
    } catch (e) {
        console.warn('[WorkPhotos] Téléchargement échoué:', path, e.message);
        return null;
    }
}

/**
 * Retire TOUTES les références de photos de travail d'un POI.
 *
 * Appelé quand Stefan importe ses propres photos : le provisoire s'efface devant
 * le définitif. Les octets restent dans le dépôt privé (décision 10/08) — seul
 * l'accès disparaît, ce qui suffit à la règle « jamais mélangées aux publiables ».
 *
 * @param {string} poiId
 * @returns {Promise<number>} nombre de références retirées (0 = rien à faire)
 */
export async function clearWorkPhotos(poiId) {
    const paths = getWorkPhotosById(poiId);
    if (paths.length === 0) return 0;

    // Le cache local n'a plus lieu d'être : il ne sert qu'à l'affichage.
    for (const p of paths) {
        try { await deleteCachedWorkPhoto(p); } catch { /* cache : non critique */ }
    }

    const { updatePoiData } = await import('./data.js');
    await updatePoiData(poiId, 'workPhotos', []);
    return paths.length;
}
