// photo-service.js
// Service unique pour la gestion des photos utilisateur et admin.
// Remplace photo-manager.js + photo-upload.js.
//
// Sections :
//   1. État viewer       — currentPhotoList, currentPhotoIndex, setCurrentPhotos
//   2. Compression       — compressImage, generatePhotoId, validatePhotoFile
//   3. Upload GitHub     — uploadPhotoForPoi (admin uniquement)

import { state } from './state.js';
import { uploadFileToGitHub, getStoredToken } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, GITHUB_PATHS } from './config.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// 2. COMPRESSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Profils de compression.
 *
 * PUBLISH_COMPRESSION — LE profil unique de publication admin (photos poussées
 * dans public/photos/). Décision 11/06/2026, mesures comparateur sur vraies
 * photos publiées avec cet encodeur : ≈ −55/−65 % vs le stock historique
 * (produit par l'ex-compressFileToBlob 1600 px/q0.88 d'ui-photo-batch, fusionné
 * ici le même jour). Plus petit côté 1080 px = plein écran mobile (~1080 px) et
 * quasi 1:1 sur PC Full HD (paysage 1440×1080). NE PAS réintroduire un second
 * profil de publication : l'hétérogénéité du stock pré-06/2026 venait de
 * 3 chemins de compression concurrents.
 *
 * ADMIN_COMPRESSION — profils de la grille per-POI admin : OPTIMIZED suit
 * PUBLISH_COMPRESSION (même objet de base) ; ORIGINAL (natif, JPEG 95 %) reste
 * pour les cas exceptionnels via le toggle « Pleine qualité ».
 *
 * USER_COMPRESSION — photos perso (IndexedDB locale), INCHANGÉ volontairement :
 * pas de contrainte d'hébergement côté user (décision 11/06/2026).
 */
export const PUBLISH_COMPRESSION = { targetMinSize: 1080, quality: 0.75 };

export const ADMIN_COMPRESSION = {
    OPTIMIZED: { ...PUBLISH_COMPRESSION, label: 'Optimisée' },
    ORIGINAL:  { targetMinSize: 0, quality: 0.95, label: 'Pleine qualité' },
};

/** Profil de compression par défaut pour les photos utilisateur. */
export const USER_COMPRESSION = { targetMinSize: 1200, quality: 0.8 };

/** Taille max acceptée en entrée (avant compression). 50 Mo couvre les RAW smartphones. */
export const MAX_PHOTO_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Texte du watermark appliqué automatiquement aux photos importées en mode
 * admin (cf. compressImage). Sert de dissuadeur en complément du LICENSE et
 * d'un éventuel dépôt i-DEPOT — ce n'est pas une protection cryptographique.
 */
export const ADMIN_WATERMARK_TEXT = '© Stefan Martin — Heripia';

/**
 * Applique un watermark texte en bas à droite du canvas. Style : ombre noire
 * + texte blanc semi-transparent, taille de police adaptative à la largeur
 * de l'image (max 12px, sinon ~width/65) pour rester lisible sans dominer.
 */
export function applyWatermark(ctx, canvasWidth, canvasHeight, text) {
    const fontSize = Math.max(12, Math.round(canvasWidth / 65));
    const padding = Math.max(10, Math.round(fontSize * 0.8));

    ctx.save();
    ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';

    // Ombre noire (offset 1px) pour la lisibilité sur fonds clairs
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillText(text, canvasWidth - padding + 1, canvasHeight - padding + 1);

    // Texte principal en blanc semi-transparent
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillText(text, canvasWidth - padding, canvasHeight - padding);

    ctx.restore();
}

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
 * @param {object} [opts]
 * @param {boolean} [opts.skipWatermark=false] N'appose PAS le watermark, même en
 *        mode admin. Réservé aux images dont Stefan n'est PAS l'auteur (photos de
 *        travail : Facebook, envois de contacts, extraits de PDF). Sans ce garde-fou,
 *        `© Stefan Martin — Heripia` se graverait sur le travail d'autrui.
 * @returns {Promise<Blob>}
 */
export function compressImage(file, targetMinSize = 1200, quality = 0.8, opts = {}) {
    const { skipWatermark = false } = opts;
    return new Promise((resolve, reject) => {
        const validation = validatePhotoFile(file);
        if (!validation.valid) {
            reject(new Error(validation.reason));
            return;
        }
        // Filet anti-blocage (hérité de l'ex-compressFileToBlob, fusion 11/06/2026) :
        // un FileReader/Image qui ne rend jamais la main ne doit pas geler
        // l'enregistrement d'un groupe entier de photos.
        const timer = setTimeout(() => reject(new Error('Timeout compression image')), 15000);
        const reader = new FileReader();
        reader.onerror = (e) => { clearTimeout(timer); reject(e); };
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.onerror = (e) => { clearTimeout(timer); reject(e); };
            img.src = event.target.result;
            img.onload = () => {
                clearTimeout(timer);
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
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Watermark automatique pour les photos importées en mode
                // admin (cf. ADMIN_WATERMARK_TEXT). Cuit dans le JPEG → permanent.
                // Photos perso utilisateur : pas de watermark (c'est leur contenu).
                // `skipWatermark` : le test porte sur QUI EST ADMIN, pas sur qui a
                // pris la photo — sans cette échappatoire, une photo de tiers
                // importée en admin ressortirait signée au nom de Stefan.
                if (state.isAdmin && !skipWatermark) {
                    applyWatermark(ctx, width, height, ADMIN_WATERMARK_TEXT);
                }

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
// 3. UPLOAD GITHUB (admin uniquement)
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
