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

    // OVERRIDE VIEWER STYLES (Themed & High Z-Index)
    if (photoViewer) {
        photoViewer.style.cssText = `
            display: none;
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background-color: var(--bg); /* Theme Background */
            z-index: 21000; /* Highest Priority */
            flex-direction: column;
            justify-content: center;
            align-items: center;
        `;
    }

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
                padding: 10px 20px;
                background: var(--surface); /* Theme Surface */
                border-bottom: 1px solid var(--line);
                display: flex;
                justify-content: space-between;
                align-items: center;
                z-index: 21010; /* Above Viewer */
                color: var(--ink); /* Theme Ink */
                box-shadow: var(--shadow-soft);
            }
            .viewer-controls {
                display: flex;
                gap: 20px;
                align-items: center;
            }
            .viewer-title {
                font-weight: 700;
                font-size: 16px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 60%;
                color: var(--brand);
            }

            /* Close Button Styled */
            .close-viewer-btn {
                background: none;
                border: none;
                color: var(--ink);
                cursor: pointer;
                padding: 8px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            .close-viewer-btn:hover {
                background: var(--surface-muted);
                color: var(--danger);
            }
            .close-viewer-btn svg {
                width: 28px;
                height: 28px;
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
                <button class="close-viewer-btn" title="Fermer">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
        `;
        photoViewer.appendChild(toolbar);
    }

    // Now bind listeners
    const closeBtn = document.querySelector('.close-viewer-btn');
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
    if (photoViewer) {
        photoViewer.style.display = 'none';
        // Force restoration of grid opacity if needed,
        // though the grid listener handles it on close button click?
        // Actually, the grid sets opacity to 0 when opening viewer.
        // We need to restore it.
        // The grid attaches a listener to the close button in 'ui-photo-grid.js'.
        // BUT here we replaced the close button with a clone!
        // This BREAKS the grid restoration logic if grid attaches to the button directly.

        // CHECK ui-photo-grid.js:
        // "const closeBtn = document.getElementById('viewer-btn-close'); ... closeBtn.onclick = ..."
        // Wait, my updated ui-photo-viewer.js uses class 'close-viewer-btn'.
        // And I am cloning it here.

        // SOLUTION: Dispatch a custom event "viewer:closed" that the grid can listen to.
        // OR simply rely on the fact that I am not hiding the grid anymore in the new plan?
        // In the previous step thoughts, I said "Let's NOT hide it".
        // Let's check the code I wrote in `ui-photo-grid.js`.

        // I wrote:
        // "// We don't need to set opacity 0 anymore... Let's NOT hide it, but just rely on the new Viewer Z-Index (21000)."

        // So I don't need to restore anything! The grid stays visible underneath (z-index 10050) covered by the viewer (z-index 21000).
        // PERFECT. No conflict.
    }
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
