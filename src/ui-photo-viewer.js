import { state } from './state.js';
import { changePhoto, setCurrentPhotos, handlePhotoUpload, handlePhotoDeletion, handleAllPhotosDeletion, currentPhotoList, currentPhotoIndex } from './photo-manager.js';
import { getPoiId, getPoiName } from './data.js';
import { showToast } from './toast.js';
import { openDetailsPanel } from './ui.js';
import { showConfirm } from './modal.js';
import { injectAdminPhotoUploadButton, uploadPhotoForPoi } from './photo-upload.js';

const els = {};
function getEl(id) {
    if (!els[id]) els[id] = document.getElementById(id);
    return els[id];
}

// Global viewer state
let currentViewerPoiId = null;

export function initPhotoViewer() {
    const photoViewer = getEl('photo-viewer');

    // Create Toolbar if missing
    if (photoViewer && !document.getElementById('viewer-toolbar')) {
        const toolbar = document.createElement('div');
        toolbar.id = 'viewer-toolbar';
        toolbar.className = 'viewer-toolbar';
        // Basic style, ideally should be in CSS
        toolbar.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            padding: 15px;
            background: rgba(0,0,0,0.6);
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 10001;
            color: white;
        `;

        toolbar.innerHTML = `
            <div style="font-weight: 600; font-size: 16px; text-shadow: 0 1px 2px black;" id="viewer-title"></div>
            <div style="display: flex; gap: 15px; align-items: center;">
                <button id="viewer-btn-upload" title="Uploader cette photo (Admin)" style="background: none; border: none; color: #3B82F6; cursor: pointer; display: none;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>
                </button>
                <button id="viewer-btn-delete" title="Supprimer cette photo" style="background: none; border: none; color: #EF4444; cursor: pointer; display: none;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                </button>
                <button class="close-viewer" style="background: none; border: none; color: white; cursor: pointer;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
            </div>
        `;
        photoViewer.appendChild(toolbar);
    }

    // Now bind listeners
    const closeBtn = document.querySelector('.close-viewer');
    const viewerNext = getEl('viewer-next');
    const viewerPrev = getEl('viewer-prev');
    const deleteBtn = document.getElementById('viewer-btn-delete');
    const uploadBtn = document.getElementById('viewer-btn-upload');

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            if(photoViewer) photoViewer.style.display = 'none';
        });
    }

    if (photoViewer) {
        photoViewer.addEventListener('click', (e) => {
            // Close if clicking overlay but NOT image or toolbar
            if(e.target === photoViewer) photoViewer.style.display = 'none';
        });
    }

    if(viewerNext) viewerNext.addEventListener('click', (e) => {
        e.stopPropagation();
        changePhoto(1);
        updateViewerUI();
    });

    if(viewerPrev) viewerPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        changePhoto(-1);
        updateViewerUI();
    });

    if (deleteBtn) {
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (currentViewerPoiId === null) return;

            if (await showConfirm("Suppression", "Voulez-vous vraiment supprimer cette photo ?", "Supprimer", "Annuler", true)) {
                // Delete current photo
                const success = await handlePhotoDeletion(currentViewerPoiId, currentPhotoIndex);
                if (success) {
                    showToast("Photo supprimée.", "success");
                    // Refresh data in viewer
                    const feature = state.loadedFeatures.find(f => getPoiId(f) === currentViewerPoiId);
                    const photos = feature?.properties?.userData?.photos || [];

                    if (photos.length === 0) {
                         photoViewer.style.display = 'none';
                    } else {
                        // Stay on index or go to prev if last
                        let newIndex = currentPhotoIndex;
                        if (newIndex >= photos.length) newIndex = photos.length - 1;
                        setCurrentPhotos(photos, newIndex);
                        getEl('viewer-img').src = photos[newIndex];
                        updateViewerUI();
                    }
                    // Refresh background details panel
                    openDetailsPanel(state.currentFeatureId, state.currentCircuitIndex);
                }
            }
        });
    }

    if (uploadBtn) {
        uploadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!state.isAdmin || currentViewerPoiId === null) return;

            const currentSrc = currentPhotoList[currentPhotoIndex];
            if (!currentSrc || !currentSrc.startsWith('data:image')) return;

            showToast("Envoi en cours...", "info");
            try {
                 // Convert DataURL to File
                const response = await fetch(currentSrc);
                const blob = await response.blob();
                const file = new File([blob], "temp.jpg", { type: "image/jpeg" });

                // Upload
                const publicUrl = await uploadPhotoForPoi(file, currentViewerPoiId);

                // Update local data
                // We need to update specifically the array item at current index
                // But handlePhotoDeletion/Update logic in photo-manager might be simpler to reuse if we had a "replacePhoto"
                // For now, let's manually update
                const feature = state.loadedFeatures.find(f => getPoiId(f) === currentViewerPoiId);
                const photos = [...(feature?.properties?.userData?.photos || [])];
                photos[currentPhotoIndex] = publicUrl;

                // Save
                import('./data.js').then(async m => {
                     await m.updatePoiData(currentViewerPoiId, 'photos', photos);
                     showToast("Photo envoyée !", "success");

                     // Refresh UI
                     setCurrentPhotos(photos, currentPhotoIndex);
                     getEl('viewer-img').src = publicUrl;
                     updateViewerUI();
                     openDetailsPanel(state.currentFeatureId, state.currentCircuitIndex);
                });

            } catch (err) {
                console.error(err);
                showToast("Erreur: " + err.message, "error");
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (photoViewer && photoViewer.style.display !== 'none') {
            if (e.key === 'ArrowRight') { changePhoto(1); updateViewerUI(); }
            if (e.key === 'ArrowLeft') { changePhoto(-1); updateViewerUI(); }
            if (e.key === 'Escape') photoViewer.style.display = 'none';
        }
    });
}

function updateViewerUI() {
    const currentSrc = currentPhotoList[currentPhotoIndex];
    const isLocal = currentSrc && typeof currentSrc === 'string' && currentSrc.startsWith('data:image');

    const deleteBtn = document.getElementById('viewer-btn-delete');
    const uploadBtn = document.getElementById('viewer-btn-upload');
    const titleEl = document.getElementById('viewer-title');

    if (deleteBtn) deleteBtn.style.display = isLocal ? 'block' : 'none';

    // Upload button only for Admin AND Local photo
    if (uploadBtn) uploadBtn.style.display = (state.isAdmin && isLocal) ? 'block' : 'none';

    // Update Title if needed (e.g. "Photo 1/5")
    if (titleEl && currentViewerPoiId) {
        const feature = state.loadedFeatures.find(f => getPoiId(f) === currentViewerPoiId);
        const name = getPoiName(feature);
        titleEl.textContent = `${name} (${currentPhotoIndex + 1}/${currentPhotoList.length})`;
    }
}

export function setupPhotoPanelListeners(poiId) {
    // Inject Admin Upload Button first
    injectAdminPhotoUploadButton(poiId);

    const photoInput = document.getElementById('panel-photo-input');
    const photoBtn = document.querySelector('.photo-placeholder');

    // Listener pour suppression totale
    const deleteAllBtn = document.getElementById('btn-delete-all-photos');
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if(!await showConfirm("Suppression totale", "Voulez-vous vraiment supprimer TOUTES les photos de ce lieu ?", "Tout supprimer", "Annuler", true)) return;

            const success = await handleAllPhotosDeletion(poiId);
            if (success) {
                openDetailsPanel(state.currentFeatureId, state.currentCircuitIndex);
            } else {
                showToast("Erreur lors de la suppression", "error");
            }
        });
    }

    if(photoBtn && photoInput) photoBtn.addEventListener('click', () => photoInput.click());

    if(photoInput) {
        photoInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if(files.length === 0) return;

            showToast("Traitement des photos...", "info");

            const result = await handlePhotoUpload(poiId, files);

            if (result.success) {
                showToast(`${result.count} photo(s) ajoutée(s).`, "success");
                openDetailsPanel(state.currentFeatureId, state.currentCircuitIndex);
            }
        });
    }

    document.querySelectorAll('.photo-item .img-preview').forEach(img => {
        img.addEventListener('click', (e) => {
            const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
            // CORRECTION : On doit fusionner les propriétés comme dans templates.js pour voir les photos officielles
            const props = { ...feature?.properties, ...feature?.properties?.userData };
            const photos = props.photos || [];

            // Utilisation directe de l'index stocké sur l'image (plus robuste que de chercher le bouton delete)
            const photoIndex = parseInt(e.currentTarget.dataset.index, 10);

            if (isNaN(photoIndex) || !photos[photoIndex]) {
                console.error("Erreur index photo:", photoIndex);
                return;
            }

            setCurrentPhotos(photos, photoIndex);
            currentViewerPoiId = poiId; // Store for viewer actions

            const viewerImg = getEl('viewer-img');
            const photoViewer = getEl('photo-viewer');
            const viewerNext = getEl('viewer-next');
            const viewerPrev = getEl('viewer-prev');

            if (viewerImg) viewerImg.src = photos[photoIndex];
            if (photoViewer) photoViewer.style.display = 'flex';

            const displayNav = photos.length > 1 ? 'block' : 'none';
            if(viewerNext) viewerNext.style.display = displayNav;
            if(viewerPrev) viewerPrev.style.display = displayNav;

            // Initial UI Update
            updateViewerUI();
        });
    });
}
