// photo-manager.js
import { DOM } from './ui.js';
import { getPoiId, updatePoiData } from './data.js';
import { state } from './state.js'; 

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

export async function compressImage(file, targetMinSize = 800) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const elem = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const smallestSide = Math.min(width, height);
                if (smallestSide > targetMinSize) {
                    const ratio = targetMinSize / smallestSide;
                    width *= ratio;
                    height *= ratio;
                }
                elem.width = width;
                elem.height = height;
                const ctx = elem.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(elem.toDataURL('image/jpeg', 0.8)); 
            };
        };
    });
}

/**
 * Gère l'ajout de nouvelles photos : compression + fusion + sauvegarde
 */
export async function handlePhotoUpload(poiId, files) {
    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    if (!feature) return { success: false };

    const poiData = feature.properties.userData || {};
    const currentPhotos = poiData.photos || [];
    const newPhotos = [];

    for (const file of files) {
        try {
            // On utilise la fonction de compression déjà présente dans ce fichier
            const compressed = await compressImage(file);
            newPhotos.push(compressed);
        } catch (err) {
            console.error("Erreur compression image", err);
        }
    }

    const updatedPhotos = [...currentPhotos, ...newPhotos];
    await updatePoiData(poiId, 'photos', updatedPhotos);
    
    return { success: true, count: newPhotos.length };
}

/**
 * Gère la suppression d'une photo spécifique
 */
export async function handlePhotoDeletion(poiId, index) {
    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    if (!feature) return false;

    const currentPhotos = feature.properties.userData.photos || [];
    const updatedPhotos = currentPhotos.filter((_, i) => i !== index);
    
    await updatePoiData(poiId, 'photos', updatedPhotos);
    return true;
}

/**
 * Gère la suppression de TOUTES les photos d'un POI
 */
export async function handleAllPhotosDeletion(poiId) {
    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    if (!feature) return false;

    // On remplace par un tableau vide
    await updatePoiData(poiId, 'photos', []);
    return true;
}
