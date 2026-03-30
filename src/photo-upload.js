import { uploadFileToGitHub, getStoredToken } from './github-sync.js';

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

