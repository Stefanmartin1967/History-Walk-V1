import { state } from './state.js';
import { changePhoto, setCurrentPhotos, handlePhotoDeletion, handleAllPhotosDeletion, currentPhotoList, currentPhotoIndex } from './photo-manager.js';
import { getPoiId, getPoiName, updatePoiData } from './data.js';
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
let isSummaryMode = false; // Track if we are in the "Upload Summary" view

export function initPhotoViewer() {
    const photoViewer = getEl('photo-viewer');

    // Create Toolbar if missing
    if (photoViewer && !document.getElementById('viewer-toolbar')) {
        const toolbar = document.createElement('div');
        toolbar.id = 'viewer-toolbar';
        toolbar.className = 'viewer-toolbar';

        // CSS Injection for Viewer Specifics (Toolbar + Summary)
        const style = document.createElement('style');
        style.textContent = `
            .viewer-toolbar {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                padding: 15px 25px; /* Increased padding */
                background: rgba(0,0,0,0.6);
                display: flex;
                justify-content: space-between;
                align-items: center;
                z-index: 10010; /* Highest priority */
                color: white;
            }
            .viewer-controls {
                display: flex;
                gap: 25px; /* Increased gap */
                align-items: center;
            }
            .viewer-summary-grid {
                display: none; /* Hidden by default */
                grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
                gap: 15px;
                padding: 20px;
                width: 100%;
                max-width: 900px;
                margin: 60px auto 0; /* Clear toolbar */
                overflow-y: auto;
                max-height: calc(100vh - 80px);
                z-index: 10002;
            }
            .viewer-summary-grid.active {
                display: grid;
            }
            .summary-item {
                position: relative;
                aspect-ratio: 1;
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                border: 2px solid rgba(255,255,255,0.1);
            }
            .summary-item img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            .summary-delete-btn {
                position: absolute;
                top: 5px;
                right: 5px;
                background: rgba(239, 68, 68, 0.9);
                color: white;
                border: none;
                border-radius: 50%;
                width: 24px;
                height: 24px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: transform 0.2s;
            }
            .summary-delete-btn:hover {
                background: #DC2626;
                transform: scale(1.1);
            }
            .viewer-title {
                font-weight: 600;
                font-size: 16px;
                text-shadow: 0 1px 2px black;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 60%;
            }
            /* Cloud Button Pulse Animation */
            @keyframes pulse-cloud {
                0% { transform: scale(1); }
                50% { transform: scale(1.1); }
                100% { transform: scale(1); }
            }
            .btn-cloud-upload:hover {
                animation: pulse-cloud 1s infinite;
                color: #60A5FA !important;
            }
        `;
        document.head.appendChild(style);

        toolbar.innerHTML = `
            <div class="viewer-title" id="viewer-title"></div>
            <div class="viewer-controls">
                <!-- Upload / Cloud Button (Hidden by default) -->
                <button id="viewer-btn-upload" class="btn-cloud-upload" title="Tout envoyer sur GitHub" style="background: none; border: none; color: #3B82F6; cursor: pointer; display: none;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>
                </button>

                <!-- Trash Button -->
                <button id="viewer-btn-delete" title="Supprimer cette photo" style="background: none; border: none; color: #EF4444; cursor: pointer; display: none;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                </button>

                <!-- Close / Cancel Button -->
                <button class="close-viewer" title="Fermer" style="background: none; border: none; color: white; cursor: pointer;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
            </div>
        `;
        photoViewer.appendChild(toolbar);

        // Summary Container
        const summaryGrid = document.createElement('div');
        summaryGrid.id = 'viewer-summary';
        summaryGrid.className = 'viewer-summary-grid';
        photoViewer.appendChild(summaryGrid);
    }

    // Now bind listeners
    const closeBtn = document.querySelector('.close-viewer');
    const viewerNext = getEl('viewer-next');
    const viewerPrev = getEl('viewer-prev');
    const deleteBtn = document.getElementById('viewer-btn-delete');
    const uploadBtn = document.getElementById('viewer-btn-upload');
    const summaryGrid = getEl('viewer-summary');

    // CLOSE LOGIC
    if (closeBtn) {
        // Clone to replace old listeners
        const newClose = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newClose, closeBtn);

        newClose.addEventListener('click', () => {
             closePhotoViewer();
        });
    }

    if (photoViewer) {
        // We need to remove old listener first if any (but we can't easily, so we just add a check)
        // Ideally we should use named functions for listeners to remove them, but for now:
        // Let's assume init is called once or handles re-init gracefully.
        photoViewer.onclick = (e) => {
            // Close if clicking overlay but NOT image or toolbar or summary
            if(e.target === photoViewer) closePhotoViewer();
        };
    }

    // NEXT LOGIC
    if(viewerNext) {
        // Reset listener
        const newNext = viewerNext.cloneNode(true);
        viewerNext.parentNode.replaceChild(newNext, viewerNext);

        newNext.addEventListener('click', (e) => {
            e.stopPropagation();

            // Logic: If Admin + Local Photos + Last Photo -> Trigger Summary
            const isLastPhoto = currentPhotoIndex === currentPhotoList.length - 1;
            const currentSrc = currentPhotoList[currentPhotoIndex];
            const isLocal = currentSrc && currentSrc.startsWith('data:image');

            if (state.isAdmin && isLocal && isLastPhoto && !isSummaryMode) {
                enterSummaryMode();
            } else {
                changePhoto(1);
                updateViewerUI();
            }
        });
    }

    // PREV LOGIC
    if(viewerPrev) {
        const newPrev = viewerPrev.cloneNode(true);
        viewerPrev.parentNode.replaceChild(newPrev, viewerPrev);

        newPrev.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isSummaryMode) {
                exitSummaryMode();
            } else {
                changePhoto(-1);
                updateViewerUI();
            }
        });
    }

    // DELETE LOGIC (Single Photo)
    if (deleteBtn) {
        const newDelete = deleteBtn.cloneNode(true);
        deleteBtn.parentNode.replaceChild(newDelete, deleteBtn);

        newDelete.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (currentViewerPoiId === null) return;

            // Standard confirmation for deletion
            if (await showConfirm("Suppression", "Voulez-vous supprimer cette photo ?", "Supprimer", "Annuler", true)) {
                const success = await handlePhotoDeletion(currentViewerPoiId, currentPhotoIndex);
                if (success) {
                    showToast("Photo supprimée.", "success");

                    // Refresh data
                    const feature = state.loadedFeatures.find(f => getPoiId(f) === currentViewerPoiId);
                    const photos = feature?.properties?.userData?.photos || [];

                    if (photos.length === 0) {
                         closePhotoViewer();
                    } else {
                        // Adjust index
                        let newIndex = currentPhotoIndex;
                        if (newIndex >= photos.length) newIndex = photos.length - 1;
                        setCurrentPhotos(photos, newIndex);
                        getEl('viewer-img').src = photos[newIndex];
                        updateViewerUI();
                    }
                    openDetailsPanel(state.currentFeatureId, state.currentCircuitIndex);
                }
            }
        });
    }

    // UPLOAD LOGIC (Summary Mode)
    if (uploadBtn) {
        const newUpload = uploadBtn.cloneNode(true);
        uploadBtn.parentNode.replaceChild(newUpload, uploadBtn);

        newUpload.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!state.isAdmin || currentViewerPoiId === null) return;

            // Trigger Bulk Upload
            await handleBulkUpload(currentViewerPoiId);
        });
    }

    document.onkeydown = (e) => {
        if (photoViewer && photoViewer.style.display !== 'none') {
            if (e.key === 'ArrowRight') {
                // Manually trigger click to reuse logic
                getEl('viewer-next')?.click();
            }
            if (e.key === 'ArrowLeft') {
                 getEl('viewer-prev')?.click();
            }
            if (e.key === 'Escape') closePhotoViewer();
        }
    };
}

function closePhotoViewer() {
    const photoViewer = getEl('photo-viewer');
    if (photoViewer) photoViewer.style.display = 'none';
    exitSummaryMode(); // Reset state
}

function enterSummaryMode() {
    isSummaryMode = true;
    const summaryGrid = getEl('viewer-summary');
    const viewerImg = getEl('viewer-img');
    const viewerNext = getEl('viewer-next');
    const viewerPrev = getEl('viewer-prev');

    if (summaryGrid) summaryGrid.classList.add('active');
    if (viewerImg) viewerImg.style.display = 'none';
    if (viewerNext) viewerNext.style.display = 'none'; // Hide next arrow
    if (viewerPrev) viewerPrev.style.display = 'block'; // Keep prev to go back

    renderSummaryGrid();
    updateViewerUI();
}

function exitSummaryMode() {
    isSummaryMode = false;
    const summaryGrid = getEl('viewer-summary');
    const viewerImg = getEl('viewer-img');
    const viewerNext = getEl('viewer-next');

    if (summaryGrid) summaryGrid.classList.remove('active');
    if (viewerImg) viewerImg.style.display = 'block';
    if (viewerNext) viewerNext.style.display = 'block';

    updateViewerUI();
}

function renderSummaryGrid() {
    const summaryGrid = getEl('viewer-summary');
    if (!summaryGrid) return;

    summaryGrid.innerHTML = ''; // Clear

    currentPhotoList.forEach((src, index) => {
        // Only show valid images (local mainly, but show all for completeness in summary?)
        // User said: "Montre toutes les photos du POI non effacées"
        // And specifically for upload context.
        // Assuming we only want to upload local ones.

        const item = document.createElement('div');
        item.className = 'summary-item';

        const img = document.createElement('img');
        img.src = src;
        item.appendChild(img);

        // Delete button (Small X)
        const delBtn = document.createElement('button');
        delBtn.className = 'summary-delete-btn';
        delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
        delBtn.onclick = async (e) => {
            e.stopPropagation();
            if (await showConfirm("Supprimer", "Retirer cette photo ?", "Oui", "Non", true)) {
                await handlePhotoDeletion(currentViewerPoiId, index);
                // Refresh list
                const feature = state.loadedFeatures.find(f => getPoiId(f) === currentViewerPoiId);
                const photos = feature?.properties?.userData?.photos || [];
                setCurrentPhotos(photos, 0); // Reset index safely
                if (photos.length === 0) {
                    closePhotoViewer();
                } else {
                    renderSummaryGrid(); // Re-render grid
                }
            }
        };

        item.appendChild(delBtn);
        summaryGrid.appendChild(item);
    });
}

async function handleBulkUpload(poiId) {
    const uploadBtn = document.getElementById('viewer-btn-upload');
    if(uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.style.opacity = 0.5;
    }

    showToast("Envoi des photos en cours...", "info");

    // Filter local photos
    const localPhotos = currentPhotoList.filter(p => p.startsWith('data:image'));

    if (localPhotos.length === 0) {
        showToast("Aucune photo locale à envoyer.", "warning");
        if(uploadBtn) uploadBtn.disabled = false;
        return;
    }

    try {
        let successCount = 0;
        let newPhotosList = [...currentPhotoList];

        for (let i = 0; i < currentPhotoList.length; i++) {
            const photoData = currentPhotoList[i];
            if (photoData.startsWith('data:image')) {
                // Convert base64 to File
                const response = await fetch(photoData);
                const blob = await response.blob();
                const file = new File([blob], "temp.jpg", { type: "image/jpeg" });

                // Upload
                const publicUrl = await uploadPhotoForPoi(file, poiId);

                // Update list with new URL
                newPhotosList[i] = publicUrl;
                successCount++;
            }
        }

        if (successCount > 0) {
            // Update POI Data
            await updatePoiData(poiId, 'photos', newPhotosList);

            showToast(`${successCount} photo(s) envoyée(s) avec succès !`, "success");

            // Close viewer or switch to view mode?
            // "on en revient à une visionneuse 'de base'"

            // Refresh global data
            openDetailsPanel(state.currentFeatureId, state.currentCircuitIndex);

            // Reload viewer with new data (online photos)
            setCurrentPhotos(newPhotosList, 0);
            exitSummaryMode();
            // Trigger UI update to hide tools
            updateViewerUI();
            getEl('viewer-img').src = newPhotosList[0];
        }

    } catch (err) {
        console.error(err);
        showToast("Erreur lors de l'envoi: " + err.message, "error");
    } finally {
        if(uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.style.opacity = 1;
        }
    }
}

function updateViewerUI() {
    const currentSrc = currentPhotoList[currentPhotoIndex];
    // Check if current photo is local
    const isLocal = currentSrc && typeof currentSrc === 'string' && currentSrc.startsWith('data:image');

    const deleteBtn = document.getElementById('viewer-btn-delete');
    const uploadBtn = document.getElementById('viewer-btn-upload');
    const titleEl = document.getElementById('viewer-title');

    if (isSummaryMode) {
        // SUMMARY MODE UI
        if (titleEl) titleEl.textContent = "Prêt à envoyer ?";
        if (deleteBtn) deleteBtn.style.display = 'none'; // Hide main trash

        // Show Cloud Upload Button
        if (uploadBtn) {
            uploadBtn.style.display = 'block';
            uploadBtn.title = `Envoyer ${currentPhotoList.length} photo(s)`;
        }
    } else {
        // VIEWING MODE UI
        if (titleEl && currentViewerPoiId) {
            const feature = state.loadedFeatures.find(f => getPoiId(f) === currentViewerPoiId);
            const name = getPoiName(feature);
            titleEl.textContent = `${name} (${currentPhotoIndex + 1}/${currentPhotoList.length})`;
        }

        // Trash: Only if local
        if (deleteBtn) deleteBtn.style.display = isLocal ? 'block' : 'none';

        // Upload: Hide in view mode (moved to summary)
        if (uploadBtn) uploadBtn.style.display = 'none';
    }
}

export function setupPhotoPanelListeners(poiId) {
    // Inject Admin Upload Button first - actually we want to DISABLE it here as per plan
    // injectAdminPhotoUploadButton(poiId); // REMOVED to enforce viewer workflow

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
            const props = { ...feature?.properties, ...feature?.properties?.userData };
            const photos = props.photos || [];

            const photoIndex = parseInt(e.currentTarget.dataset.index, 10);

            if (isNaN(photoIndex) || !photos[photoIndex]) {
                console.error("Erreur index photo:", photoIndex);
                return;
            }

            setCurrentPhotos(photos, photoIndex);
            currentViewerPoiId = poiId;

            const viewerImg = getEl('viewer-img');
            const photoViewer = getEl('photo-viewer');
            const viewerNext = getEl('viewer-next');
            const viewerPrev = getEl('viewer-prev');

            if (viewerImg) {
                viewerImg.src = photos[photoIndex];
                viewerImg.style.display = 'block'; // Ensure visible if coming from summary
            }
            if (photoViewer) photoViewer.style.display = 'flex';

            const displayNav = photos.length > 1 ? 'block' : 'none';
            if(viewerNext) viewerNext.style.display = displayNav;
            if(viewerPrev) viewerPrev.style.display = displayNav;

            // Reset summary mode
            isSummaryMode = false;
            const summaryGrid = getEl('viewer-summary');
            if(summaryGrid) summaryGrid.classList.remove('active');

            // Initial UI Update
            updateViewerUI();
        });
    });
}
