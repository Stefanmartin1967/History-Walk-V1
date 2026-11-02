// photos-move.js
// Déménager les photos publiées d'une destination vers son dépôt de photos
// (3ᵉ PR du chantier « photos de Charleroi dans un dépôt séparé », plan validé
// par Stefan le 02/11/2026). Outil admin du Centre de Contrôle (Outils).
//
// Une destination qui reçoit un `photosRepo` (destinations.json) publie ses
// NOUVELLES photos dans ce dépôt (cf. photoStorage, config.js). Ses photos déjà
// publiées restent dans public/photos/ du dépôt principal, avec un chemin court
// `photos/…`. Cet outil les déménage, en trois temps :
//
//  1. copie : chaque fichier est relu sur le site et renvoyé TEL QUEL dans le
//     dépôt de photos, sous le même nom (mêmes octets : ni recompression, ni
//     second filigrane). Un fichier déjà présent avec le même contenu est
//     sauté ; un fichier DIFFÉRENT sous le même nom n'est jamais remplacé.
//  2. attente : la nouvelle adresse doit répondre (déploiement GitHub Pages du
//     dépôt de photos, environ une minute) avant qu'on l'écrive dans le data.
//  3. adresses : la liste de photos du lieu est réécrite dans les données
//     locales (overlay), ordre conservé. Le lieu apparaît alors dans les
//     modifications du Centre de Contrôle : c'est « Tout publier », relu par
//     l'admin, qui publie le data.
//
// Rien n'est effacé du dépôt principal. Relancer l'outil est sans risque : les
// fichiers déjà copiés sont sautés, les adresses déjà changées ne sont plus
// listées.

import { state } from './state.js';
import { getPoiId, getPoiProp } from './utils.js';
import { GITHUB_OWNER, photoStorage } from './config.js';
import { getStoredToken, uploadFileToGitHub, githubHttpError } from './github-sync.js';
import { fetchWithTimeout } from './net.js';
import { savePoiData } from './database.js';
import { eventBus } from './events.js';

// Chemin court d'une photo du dépôt principal (public/photos/, servi sous /photos/).
const SITE_PHOTO = /^photos\/([^/?#]+\.jpe?g)$/i;

/**
 * Lieux de la destination active dont des photos publiées sont encore dans le
 * dépôt principal.
 * @returns {Array<{poiId: string, paths: string[]}>}
 */
export function listPhotosToMove() {
    const places = [];
    for (const feature of state.loadedFeatures || []) {
        const poiId = getPoiId(feature);
        if (state.userData?.[poiId]?._deleted) continue;
        const photos = getPoiProp(feature, 'photos');
        const paths = Array.isArray(photos) ? photos.filter((p) => typeof p === 'string' && SITE_PHOTO.test(p)) : [];
        if (paths.length > 0) places.push({ poiId, paths });
    }
    return places;
}

/**
 * Déménage les photos de la destination active vers son dépôt de photos.
 * @param {string} mapId  destination active
 * @param {(msg: string) => void} [onProgress]
 * @param {{pollMs?: number, deadlineMs?: number}} [timing]  attente de la mise en ligne
 * @returns {Promise<{places: number, copied: number, alreadyThere: number, notOnline: string[], failed: Array<{path: string, error: string}>}>}
 */
export async function movePhotosToRepo(mapId, onProgress = () => {}, { pollMs = 5000, deadlineMs = 4 * 60 * 1000 } = {}) {
    if (mapId !== state.currentMapId) throw new Error('Cette destination n\'est pas active.');
    const photosRepo = state.destinations?.maps?.[mapId]?.photosRepo;
    if (!photosRepo) throw new Error('Cette destination n\'a pas de dépôt de photos (photosRepo).');
    const token = getStoredToken();
    if (!token) throw new Error('Aucun token GitHub connecté (onglet Connexion du Centre de Contrôle).');

    const places = listPhotosToMove();
    const paths = [...new Set(places.flatMap((p) => p.paths))];
    const moved = new Map(); // chemin court → adresse dans le dépôt de photos
    const failed = [];
    let copied = 0;
    let alreadyThere = 0;

    // 1. Copie, une photo à la fois (chaque envoi est un commit du dépôt).
    for (const [i, path] of paths.entries()) {
        onProgress(`Copie des photos ${i + 1}/${paths.length}…`);
        try {
            const filename = path.match(SITE_PHOTO)[1];
            const target = photoStorage(filename, photosRepo);
            const blob = await readSitePhoto(path);
            const existingSha = await readRepoFileSha(token, target.repo, target.path);
            if (existingSha) {
                if (existingSha !== await gitBlobSha(blob)) {
                    throw new Error('un fichier différent porte déjà ce nom dans le dépôt de photos');
                }
                alreadyThere++;
            } else {
                await uploadFileToGitHub(new File([blob], filename, { type: 'image/jpeg' }), token, GITHUB_OWNER,
                    target.repo, target.path, `feat(photo): déménagement depuis le dépôt principal — ${filename}`);
                copied++;
            }
            moved.set(path, target.url);
        } catch (e) {
            failed.push({ path, error: e.message });
        }
    }

    // 2. Attente de la mise en ligne.
    const online = await waitOnline([...moved.values()], onProgress, pollMs, deadlineMs);
    const notOnline = [...moved.values()].filter((url) => !online.has(url));

    // 3. Adresses, lieu par lieu, ordre conservé.
    let changedPlaces = 0;
    for (const { poiId } of places) {
        const feature = state.loadedFeatures.find((f) => getPoiId(f) === poiId);
        const photos = getPoiProp(feature, 'photos');
        const next = photos.map((p) => (online.has(moved.get(p)) ? moved.get(p) : p));
        if (next.every((p, i) => p === photos[i])) continue;

        if (!state.userData[poiId]) state.userData[poiId] = {};
        state.userData[poiId].photos = next;
        feature.properties.userData = state.userData[poiId];
        await savePoiData(mapId, poiId, state.userData[poiId]);
        eventBus.emit('admin:poi-edited', { id: poiId, type: 'update' });
        changedPlaces++;
    }

    return { places: changedPlaces, copied, alreadyThere, notOnline, failed };
}

// Relit une photo sur le site (même origine).
async function readSitePhoto(path) {
    const response = await fetchWithTimeout(new URL(path, document.baseURI).href);
    if (!response.ok) throw new Error(`photo introuvable sur le site (HTTP ${response.status})`);
    return response.blob();
}

// SHA du fichier dans le dépôt (Contents API), ou null s'il n'existe pas.
async function readRepoFileSha(token, repo, path) {
    const response = await fetchWithTimeout(`https://api.github.com/repos/${GITHUB_OWNER}/${repo}/contents/${path}`, {
        headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await githubHttpError(response, `Lecture de ${path}`);
    return (await response.json()).sha;
}

// SHA d'un contenu tel que Git le calcule (objet « blob »), pour comparer sans
// télécharger le fichier du dépôt.
async function gitBlobSha(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const data = new Uint8Array(header.length + bytes.length);
    data.set(header);
    data.set(bytes, header.length);
    const digest = await crypto.subtle.digest('SHA-1', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Attend que chaque adresse réponde. HEAD : hors service worker (ses routes ne
// prennent que GET), sans cache.
async function waitOnline(urls, onProgress, pollMs, deadlineMs) {
    const online = new Set();
    const deadline = Date.now() + deadlineMs;
    while (online.size < urls.length) {
        for (const url of urls) {
            if (online.has(url)) continue;
            try {
                const response = await fetchWithTimeout(url, { method: 'HEAD', cache: 'no-store' });
                if (response.ok) online.add(url);
            } catch {
                // Pas encore en ligne (ou réseau) : repris au tour suivant.
            }
        }
        if (online.size === urls.length || Date.now() >= deadline) break;
        onProgress(`Mise en ligne des photos ${online.size}/${urls.length}…`);
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return online;
}
