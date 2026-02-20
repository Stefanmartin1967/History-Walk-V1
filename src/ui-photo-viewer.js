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

export function initPhotoViewer() {
    const photoViewer = getEl('photo-viewer');

    // Create Toolbar if missing
    if (photoViewer && !document.getElementById('viewer-toolbar')) {
        const toolbar = document.createElement('div');
        toolbar.id = 'viewer-toolbar';
        toolbar.className = 'viewer-toolbar';

        // CSS Injection for Viewer Specifics
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
            .viewer-title {
                font-weight: 600;
                font-size: 16px;
                text-shadow: 0 1px 2px black;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 60%;
            }
        `;
        document.head.appendChild(style);

        toolbar.innerHTML = `
            <div class="viewer-title" id="viewer-title"></div>
            <div class="viewer-controls">
                <!-- Upload Button (For Admin Context from Grid - Initially Hidden) -->
                <button id="viewer-btn-upload" class="btn-cloud-upload" title="Tout envoyer sur GitHub" style="display: none;">
                    <!-- SVG Hidden/Unused but structure kept for potential future use if logic reverts -->
                </button>

                <!-- Trash Button (For Local Context from Grid - Initially Hidden) -->
                <button id="viewer-btn-delete" title="Supprimer cette photo" style="display: none;">
                    <!-- SVG Hidden/Unused -->
                </button>

                <!-- Close Button (ALWAYS VISIBLE) -->
                <button class="close-viewer" title="Fermer" style="background: none; border: none; color: white; cursor: pointer;">
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
            changePhoto(1);
            updateViewerUI();
        });
    }

    // PREV LOGIC
    if(viewerPrev) {
        const newPrev = viewerPrev.cloneNode(true);
        viewerPrev.parentNode.replaceChild(newPrev, viewerPrev);

        newPrev.addEventListener('click', (e) => {
            e.stopPropagation();
            changePhoto(-1);
            updateViewerUI();
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
}

function updateViewerUI() {
    // Basic Title Update only
    // Logic for delete/upload is now handled in the Grid, not here.
    // The viewer is "Read Only" + Navigation
    const titleEl = document.getElementById('viewer-title');

    // We assume currentViewerPoiId is set externally (by grid) or null
    // But since we use global state.loadedFeatures, we need the ID if we want to show POI Name
    // For now, simpler: "Photo X / Y"
    if (titleEl) {
        titleEl.textContent = `Photo ${currentPhotoIndex + 1} / ${currentPhotoList.length}`;
    }
}

// Deprecated or Empty function to satisfy imports if any
export function setupPhotoPanelListeners(poiId) {
    // No-op
}
