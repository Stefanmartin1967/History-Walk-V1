import { state } from './state.js';
import { uploadFileToGitHub, getStoredToken } from './github-sync.js';
import { getPoiId } from './data.js';
import { showToast } from './toast.js';
import { updatePoiData } from './data.js';
import { openDetailsPanel } from './ui.js';

const REPO_OWNER = 'Stefanmartin1967';
const REPO_NAME = 'History-Walk-V1';
const PHOTOS_DIR = 'public/photos';

/**
 * Uploads a photo to GitHub for a specific POI.
 *
 * @param {File} file The image file to upload.
 * @param {string} poiId The ID of the POI this photo belongs to.
 * @returns {Promise<string>} The public URL of the uploaded photo.
 */
export async function uploadPhotoForPoi(file, poiId) {
    const token = getStoredToken();
    if (!token) {
        throw new Error("GitHub token not found. Please configure it in Admin Tools.");
    }

    // Generate a unique filename: poi_{id}_{timestamp}.jpg
    // sanitize poiId to be safe for filenames
    const safePoiId = poiId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const timestamp = Date.now();
    const filename = `poi_${safePoiId}_${timestamp}.jpg`;

    // We create a new File object to ensure the filename is correct for the upload
    // The input 'file' is already compressed/optimized (1200px) from local storage
    const uploadFile = new File([file], filename, { type: 'image/jpeg' });

    // 3. Upload to GitHub
    const path = `${PHOTOS_DIR}/${filename}`;
    const commitMessage = `Add photo for POI ${poiId}`;

    await uploadFileToGitHub(uploadFile, token, REPO_OWNER, REPO_NAME, path, commitMessage);

    // 4. Construct the public URL
    // We use the relative path "photos/..." which should work correctly with the app's base URL.
    // GitHub Pages URL: https://stefanmartin1967.github.io/History-Walk-V1/photos/...
    const publicUrl = `photos/${filename}`;
    return publicUrl;
}

/**
 * Adds an "Upload to GitHub" button to the photo section of the details panel
 * if the user is an admin.
 */
export function injectAdminPhotoUploadButton(poiId) {
    if (!state.isAdmin) return;

    // Target the photos section header
    const photosHeader = document.querySelector('.photos-section h3');
    if (!photosHeader) return;

    // Look for existing controls container or create it
    let controlsDiv = photosHeader.querySelector('.section-controls');
    if (!controlsDiv) {
        // Create a flex container for controls
        controlsDiv = document.createElement('div');
        controlsDiv.className = 'edit-controls section-controls';
        controlsDiv.style.display = 'flex';
        controlsDiv.style.alignItems = 'center';
        controlsDiv.style.gap = '8px'; // Space between buttons
        controlsDiv.style.marginLeft = 'auto'; // Push to the right
        photosHeader.style.display = 'flex'; // Ensure header is flex
        photosHeader.style.alignItems = 'center'; // Vertical align
        photosHeader.appendChild(controlsDiv);
    }

    // 1. Calculate pending uploads
    let feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    if (!feature && state.currentFeatureId !== null) {
        feature = state.loadedFeatures[state.currentFeatureId];
    }
    const photos = feature?.properties?.userData?.photos || [];
    const localCount = photos.filter(p => p.startsWith('data:image')).length;

    // 2. Create or Get button
    let uploadBtn = document.getElementById('btn-admin-upload-photos');

    if (!uploadBtn) {
        uploadBtn = document.createElement('button');
        uploadBtn.id = 'btn-admin-upload-photos';
        uploadBtn.className = 'action-button';

        // Icon (Cloud Upload)
        uploadBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-cloud-upload"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>`;
        uploadBtn.style.position = 'relative';

        uploadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await handleAdminPhotoUpload(poiId);
        });

        // Insert as first child (Left of Delete button if exists)
        controlsDiv.prepend(uploadBtn);
    }

    // Ensure badge exists
    let badge = document.getElementById('btn-admin-upload-badge');
    if (uploadBtn && !badge) {
        badge = document.createElement('span');
        badge.id = 'btn-admin-upload-badge';
        badge.style.cssText = "position: absolute; top: -5px; right: -5px; background: #e74c3c; color: white; border-radius: 10px; padding: 2px 5px; font-size: 10px; font-weight: bold; min-width: 15px; display: none;";
        uploadBtn.appendChild(badge);
    }

    // 3. Update Status (Visual feedback)
    // ALWAYS VISIBLE (Blue if pending, Grey if empty but visible)
    if (localCount > 0) {
        uploadBtn.style.color = 'var(--brand)';
        uploadBtn.style.opacity = '1';
        uploadBtn.style.cursor = 'pointer';
        uploadBtn.title = `Officialiser ${localCount} photo(s) locale(s) sur GitHub`;
        uploadBtn.disabled = false;

        if (badge) {
            badge.textContent = localCount;
            badge.style.display = 'block';
        }
    } else {
        uploadBtn.style.color = 'var(--ink-soft)'; // Grey
        uploadBtn.style.opacity = '0.5';
        uploadBtn.style.cursor = 'default';
        uploadBtn.title = 'Toutes les photos sont synchronisées';
        // We disable click action logic but keep button visible
        uploadBtn.disabled = true;

        if (badge) {
            badge.style.display = 'none';
        }
    }
}

async function handleAdminPhotoUpload(poiId) {
    // Need to find feature to get photos
    // Since this is called from UI context, likely state.loadedFeatures has it
    // Find feature by ID
    let feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    if (!feature) {
        // Try currentFeatureId as fallback if poiId is just passed around
        if (state.currentFeatureId !== null) {
            feature = state.loadedFeatures[state.currentFeatureId];
        }
    }

    if (!feature) {
        console.error("Feature not found for upload");
        return;
    }

    // Access photos from userData (where local edits live)
    const userData = feature.properties.userData || {};
    const photos = userData.photos || [];

    if (photos.length === 0) {
        showToast("Aucune photo à uploader.", "info");
        return;
    }

    // Filter for base64 images only (local ones)
    // We assume http* images are already remote
    const localPhotos = photos.filter(p => p.startsWith('data:image'));

    if (localPhotos.length === 0) {
        showToast("Toutes les photos sont déjà en ligne.", "info");
        return;
    }

    if (!confirm(`Voulez-vous uploader ${localPhotos.length} photo(s) sur GitHub ?\nElles deviendront publiques et officielles.`)) {
        return;
    }

    showToast("Upload en cours...", "info");
    let successCount = 0;

    // We need to update the photo list in place
    // Iterate over original array to keep order
    let newPhotosList = [...photos];

    // Create array of promises for parallel or sequential upload
    // Sequential is safer for rate limits and feedback
    for (let i = 0; i < photos.length; i++) {
        const photoData = photos[i];
        if (photoData.startsWith('data:image')) {
            try {
                // Convert base64 back to Blob/File
                const response = await fetch(photoData);
                const blob = await response.blob();
                const file = new File([blob], "temp.jpg", { type: "image/jpeg" });

                // Upload
                const publicUrl = await uploadPhotoForPoi(file, poiId);

                // Update the URL in the list
                newPhotosList[i] = publicUrl;
                successCount++;

            } catch (err) {
                console.error("Failed to upload photo", err);
                showToast(`Erreur upload photo ${i+1}: ${err.message}`, "error");
            }
        }
    }

    if (successCount > 0) {
        // Update POI data
        await updatePoiData(poiId, 'photos', newPhotosList);

        showToast(`${successCount} photo(s) uploadée(s) !`, "success");
        alert("Les photos ont été envoyées sur GitHub.\nElles seront visibles publiquement dans quelques minutes (après le déploiement).\nSi l'image apparaît brisée, attendez un peu.");

        // Refresh UI
        // Assuming openDetailsPanel exists and refreshes the view
        openDetailsPanel(state.currentFeatureId, state.currentCircuitIndex);
    }
}
