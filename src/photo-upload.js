import { uploadFileToGitHub, getStoredToken } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, GITHUB_PATHS } from './config.js';

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

    const path = GITHUB_PATHS.photo(filename);
    const commitMessage = `feat(photo): Ajout photo pour POI ${poiId}`;

    await uploadFileToGitHub(uploadFile, token, GITHUB_OWNER, GITHUB_REPO, path, commitMessage);

    // Relative path works correctly with the app's base URL.
    // GitHub Pages URL: https://stefanmartin1967.github.io/History-Walk-V1/photos/...
    const publicUrl = `photos/${filename}`;
    return publicUrl;
}

