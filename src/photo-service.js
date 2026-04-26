// photo-service.js
// Service unique pour la gestion des photos utilisateur et admin.
// Remplace photo-manager.js + photo-upload.js.
//
// Sections :
//   1. État viewer       — currentPhotoList, currentPhotoIndex, setCurrentPhotos, changePhoto
//   2. Compression       — compressImage, generatePhotoId, validatePhotoFile
//   3. CRUD local (Blob) — handlePhotoUpload, handlePhotoDeletion, handleAllPhotosDeletion
//   4. Upload GitHub     — uploadPhotoForPoi (admin uniquement)

import { DOM } from './ui-dom.js';
import { state } from './state.js';
import { getPoiPhotos, savePoiPhotos, deletePoiPhotos } from './database.js';
import { uploadFileToGitHub, getStoredToken } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, GITHUB_PATHS } from './config.js';
import { showToast } from './toast.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. ÉTAT VIEWER
// Partagé avec ui-photo-viewer.js pour la navigation dans le lightbox.
// ─────────────────────────────────────────────────────────────────────────────

export let currentPhotoList = [];
export let currentPhotoIndex = 0;

export function setCurrentPhotos(list, index) {
    currentPhotoList = list;
    currentPhotoIndex = index;
}

export function changePhoto(direction) {
    if (!currentPhotoList || currentPhotoList.length <= 1) return;
    currentPhotoIndex += direction;
    if (currentPhotoIndex >= currentPhotoList.length) currentPhotoIndex = 0;
    if (currentPhotoIndex < 0) currentPhotoIndex = currentPhotoList.length - 1;
    if (DOM.viewerImg) DOM.viewerImg.src = currentPhotoList[currentPhotoIndex];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. COMPRESSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Profils de compression disponibles pour l'admin.
 * - OPTIMIZED : redimentionne à 1920px, JPEG 85 % — bon compromis web.
 * - ORIGINAL  : résolution native, JPEG 95 % — quasi sans perte, taille maximale.
 */
export const ADMIN_COMPRESSION = {
    OPTIMIZED: { targetMinSize: 1920, quality: 0.85, label: 'Optimisée' },
    ORIGINAL:  { targetMinSize: 0,    quality: 0.95, label: 'Pleine qualité' },
};

/** Profil de compression par défaut pour les photos utilisateur. */
export const USER_COMPRESSION = { targetMinSize: 1200, quality: 0.8 };

/** Taille max acceptée en entrée (avant compression). 50 Mo couvre les RAW smartphones. */
export const MAX_PHOTO_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Valide qu'un fichier est une image acceptable (MIME image/* + taille ≤ MAX_PHOTO_SIZE_BYTES).
 * @param {File|Blob} file
 * @returns {{ valid: boolean, reason: string|null }}
 */
export function validatePhotoFile(file) {
    if (!file) return { valid: false, reason: 'Fichier manquant.' };
    if (!file.type || !file.type.startsWith('image/')) {
        return { valid: false, reason: `Format non supporté (${file.type || 'inconnu'}).` };
    }
    if (typeof file.size === 'number' && file.size > MAX_PHOTO_SIZE_BYTES) {
        const mb = (file.size / 1024 / 1024).toFixed(1);
        const maxMb = Math.round(MAX_PHOTO_SIZE_BYTES / 1024 / 1024);
        return { valid: false, reason: `Trop volumineux (${mb} Mo, max ${maxMb} Mo).` };
    }
    return { valid: true, reason: null };
}

/**
 * Compresse un fichier image en Blob JPEG.
 * @param {File}   file
 * @param {number} [targetMinSize=1200] Plus petit côté cible en px. 0 = pas de redimensionnement.
 * @param {number} [quality=0.8]        Qualité JPEG (0–1).
 * @returns {Promise<Blob>}
 */
export function compressImage(file, targetMinSize = 1200, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const validation = validatePhotoFile(file);
        if (!validation.valid) {
            reject(new Error(validation.reason));
            return;
        }
        const reader = new FileReader();
        reader.onerror = reject;
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.onerror = reject;
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                // targetMinSize === 0 → on conserve la résolution d'origine
                if (targetMinSize > 0) {
                    const smallestSide = Math.min(width, height);
                    if (smallestSide > targetMinSize) {
                        const ratio = targetMinSize / smallestSide;
                        width = Math.round(width * ratio);
                        height = Math.round(height * ratio);
                    }
                }
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                canvas.toBlob(blob => {
                    if (blob) resolve(blob);
                    else reject(new Error('canvas.toBlob returned null'));
                }, 'image/jpeg', quality);
            };
        };
    });
}

/** Génère un identifiant unique pour une photo locale. */
export function generatePhotoId() {
    return `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. CRUD LOCAL (Blob → poiPhotos store)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ajoute de nouvelles photos pour un POI : compression → Blob → store dédié.
 * Pré-filtre via validatePhotoFile (MIME image/* + cap taille). Toaste les rejets.
 */
export async function handlePhotoUpload(poiId, files) {
    const mapId = state.currentMapId;
    const existing = await getPoiPhotos(mapId, poiId);
    const newItems = [];
    let rejected = 0;

    for (const file of files) {
        const validation = validatePhotoFile(file);
        if (!validation.valid) {
            console.warn(`Photo rejetée (${file?.name || 'sans nom'}) :`, validation.reason);
            rejected++;
            continue;
        }
        try {
            const blob = await compressImage(file);
            newItems.push({ id: generatePhotoId(), blob });
        } catch (err) {
            console.error("Erreur compression image", err);
            rejected++;
        }
    }

    if (rejected > 0) {
        showToast(`${rejected} photo(s) ignorée(s) (format ou taille invalide).`, 'warning');
    }

    if (newItems.length === 0) return { success: false };

    await savePoiPhotos(mapId, poiId, [...existing, ...newItems]);
    return { success: true, count: newItems.length };
}

/**
 * Supprime une photo par son index dans la liste du POI.
 */
export async function handlePhotoDeletion(poiId, index) {
    const mapId = state.currentMapId;
    const photos = await getPoiPhotos(mapId, poiId);
    if (index < 0 || index >= photos.length) return false;

    await savePoiPhotos(mapId, poiId, photos.filter((_, i) => i !== index));
    return true;
}

/**
 * Supprime toutes les photos d'un POI.
 */
export async function handleAllPhotosDeletion(poiId) {
    await deletePoiPhotos(state.currentMapId, poiId);
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. UPLOAD GITHUB (admin uniquement)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uploade un fichier photo sur GitHub et retourne l'URL publique relative.
 * @param {File|Blob} file  Fichier image à uploader (déjà compressé).
 * @param {string} poiId   ID du POI associé (utilisé pour le nom de fichier).
 * @returns {Promise<string>} URL publique relative, ex. "photos/poi_HW-xxx_1234567890.jpg"
 */
export async function uploadPhotoForPoi(file, poiId) {
    const token = getStoredToken();
    if (!token) {
        throw new Error("Token GitHub introuvable. Configurez-le dans les Outils Admin.");
    }

    const safePoiId = poiId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const filename = `poi_${safePoiId}_${Date.now()}.jpg`;
    const uploadFile = new File([file], filename, { type: 'image/jpeg' });

    const path = GITHUB_PATHS.photo(filename);
    const commitMessage = `feat(photo): Ajout photo pour POI ${poiId}`;

    await uploadFileToGitHub(uploadFile, token, GITHUB_OWNER, GITHUB_REPO, path, commitMessage);

    return `photos/${filename}`;
}
