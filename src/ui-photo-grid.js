import { state } from './state.js';
import { getPoiId, getPoiName, updatePoiData } from './data.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { uploadPhotoForPoi } from './photo-upload.js';
import { compressImage } from './photo-manager.js';
import { openDetailsPanel } from './ui.js';

// --- STYLES INJECTION ---
const styles = `
    .photo-grid-overlay {
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.8);
        z-index: 10050;
        display: flex;
        flex-direction: column;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s;
    }
    .photo-grid-overlay.active {
        opacity: 1;
        visibility: visible;
    }
    .photo-grid-header {
        background: var(--surface);
        padding: 10px 15px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--line);
        color: var(--ink);
        min-height: 50px;
    }
    .photo-grid-title {
        font-weight: 700;
        font-size: 16px;
        text-align: center;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .photo-grid-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 8px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--ink);
    }
    .photo-grid-btn:hover {
        background: var(--surface-muted);
    }
    .photo-grid-btn svg {
        width: 24px;
        height: 24px;
    }
    .photo-grid-btn.save-btn {
        color: var(--brand);
    }
    .photo-grid-btn.save-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .photo-grid-btn.close-btn {
        color: var(--ink-soft);
    }

    .photo-grid-content {
        flex: 1;
        overflow-y: auto;
        padding: 15px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 15px;
        align-content: start;
        background: #1a1a1a;
    }

    .photo-card {
        position: relative;
        background: #333;
        border-radius: 8px;
        overflow: hidden;
        aspect-ratio: 1;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        border: 2px solid transparent;
        cursor: grab;
        transition: transform 0.2s;
    }
    .photo-card:active {
        cursor: grabbing;
    }
    .photo-card.dragging {
        opacity: 0.5;
        border-color: var(--brand);
    }

    .photo-card img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }

    .photo-card-actions {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 5px;
        background: rgba(0,0,0,0.6);
        display: flex;
        justify-content: flex-end;
    }

    .photo-card-btn {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        padding: 4px;
    }
    .photo-card-btn.delete {
        color: #ef4444;
    }
    .photo-card-btn:hover {
        transform: scale(1.1);
    }

    /* Drag & Drop Placeholder */
    .photo-card-placeholder {
        border: 2px dashed #666;
        border-radius: 8px;
        background: transparent;
    }
`;

// Inject Styles
const styleEl = document.createElement('style');
styleEl.textContent = styles;
document.head.appendChild(styleEl);

// --- STATE ---
let currentGridPoiId = null;
let currentGridPhotos = [];
let isDirty = false;
let currentResolve = null; // For Promise

// --- DOM ELEMENTS ---
let gridOverlay = null;
let gridContent = null;
let headerTitle = null;
let btnAdd = null;
let btnSave = null;
let btnClose = null; // Added close button
let fileInput = null;

function initDOM() {
    if (gridOverlay) return;

    gridOverlay = document.createElement('div');
    gridOverlay.className = 'photo-grid-overlay';

    const header = document.createElement('div');
    header.className = 'photo-grid-header';

    // Left: Add Photo + Close (New Layout)
    const leftGroup = document.createElement('div');
    leftGroup.style.display = 'flex';
    leftGroup.style.gap = '5px';

    btnClose = document.createElement('button');
    btnClose.className = 'photo-grid-btn close-btn';
    btnClose.title = "Fermer";
    btnClose.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
    btnClose.onclick = () => closePhotoGrid(false);

    btnAdd = document.createElement('button');
    btnAdd.className = 'photo-grid-btn';
    btnAdd.title = "Ajouter des photos";
    btnAdd.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="12" x2="12" y1="8" y2="16"/><line x1="8" x2="16" y1="12" y2="12"/></svg>`;
    btnAdd.onclick = () => fileInput.click();

    leftGroup.appendChild(btnClose);
    leftGroup.appendChild(btnAdd);

    // Center: Title
    headerTitle = document.createElement('div');
    headerTitle.className = 'photo-grid-title';

    // Right: Save/Upload
    btnSave = document.createElement('button');
    btnSave.className = 'photo-grid-btn save-btn';
    btnSave.onclick = handleSave;

    header.appendChild(leftGroup);
    header.appendChild(headerTitle);
    header.appendChild(btnSave);

    gridContent = document.createElement('div');
    gridContent.className = 'photo-grid-content';

    // Drag & Drop Container Events
    gridContent.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(gridContent, e.clientY, e.clientX);
        const draggable = document.querySelector('.dragging');
        if (draggable) {
            if (afterElement == null) {
                gridContent.appendChild(draggable);
            } else {
                gridContent.insertBefore(draggable, afterElement);
            }
        }
    });

    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    fileInput.onchange = handleFileSelect;

    gridOverlay.appendChild(header);
    gridOverlay.appendChild(gridContent);
    gridOverlay.appendChild(fileInput);

    document.body.appendChild(gridOverlay);
}

// --- MAIN FUNCTION ---

export function openPhotoGrid(poiId, preloadedPhotos = null) {
    return new Promise((resolve) => {
        initDOM();
        currentGridPoiId = poiId;
        isDirty = false;
        currentResolve = resolve; // Store promise resolver

        const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
        if (!feature && !preloadedPhotos) {
            resolve({ saved: false });
            return;
        }

        const poiName = feature ? getPoiName(feature) : "Nouveau Lieu";
        headerTitle.textContent = poiName;

        // Load Photos
        if (preloadedPhotos) {
            currentGridPhotos = preloadedPhotos.map(p => ({
                src: p.base64 || p.src,
                file: p.file,
                isNew: true
            }));
        } else {
            const props = { ...feature?.properties, ...feature?.properties?.userData };
            const photos = props.photos || [];
            currentGridPhotos = photos.map(src => ({
                src: src,
                isNew: false
            }));
        }

        updateSaveButtonIcon();
        renderGrid();
        gridOverlay.classList.add('active');
    });
}

export function closePhotoGrid(saved = false) {
    if (gridOverlay) gridOverlay.classList.remove('active');
    if (currentResolve) {
        currentResolve({ saved });
        currentResolve = null;
    }
}

// --- LOGIC ---

async function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    showToast("Traitement...", "info");

    for (const file of files) {
        try {
            const compressed = await compressImage(file);
            currentGridPhotos.push({
                src: compressed,
                file: file,
                isNew: true
            });
        } catch (err) {
            console.error("Image error", err);
        }
    }

    isDirty = true;
    renderGrid();
    fileInput.value = '';
}

function renderGrid() {
    gridContent.innerHTML = '';

    currentGridPhotos.forEach((photo, index) => {
        const card = document.createElement('div');
        card.className = 'photo-card';
        card.draggable = true;
        card.dataset.index = index;

        const img = document.createElement('img');
        img.src = photo.src;

        // Launch Viewer on Click (Read-only mode effectively)
        img.onclick = () => {
            import('./photo-manager.js').then(pm => {
                pm.setCurrentPhotos(currentGridPhotos.map(p => p.src), index);

                const viewer = document.getElementById('photo-viewer');
                const viewerImg = document.getElementById('viewer-img');
                const toolbar = document.getElementById('viewer-toolbar');

                if (viewer && viewerImg) {
                    viewerImg.src = photo.src;
                    // Important: Z-Index Fix via CSS update or Inline
                    viewer.style.zIndex = '10100'; // Higher than Grid (10050)
                    viewer.style.display = 'flex';

                    if (toolbar) {
                        // Hide Action buttons, KEEP Close button
                        const uploadBtn = document.getElementById('viewer-btn-upload');
                        const deleteBtn = document.getElementById('viewer-btn-delete');
                        // const titleEl = document.getElementById('viewer-title');

                        if(uploadBtn) uploadBtn.style.display = 'none';
                        if(deleteBtn) deleteBtn.style.display = 'none';

                        // We must ensure toolbar is visible
                        toolbar.style.display = 'flex';
                    }
                }
            });
        };

        const actions = document.createElement('div');
        actions.className = 'photo-card-actions';

        const btnDel = document.createElement('button');
        btnDel.className = 'photo-card-btn delete';
        btnDel.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
        btnDel.onclick = (e) => {
            e.stopPropagation();
            currentGridPhotos.splice(index, 1);
            isDirty = true;
            renderGrid();
        };

        actions.appendChild(btnDel);
        card.appendChild(img);
        card.appendChild(actions);

        // Drag Events
        card.addEventListener('dragstart', () => {
            card.classList.add('dragging');
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            updateArrayOrderFromDOM();
        });

        gridContent.appendChild(card);
    });
}

function updateArrayOrderFromDOM() {
    const newOrder = [];
    const cards = gridContent.querySelectorAll('.photo-card');
    cards.forEach(card => {
        const oldIndex = parseInt(card.dataset.index);
        newOrder.push(currentGridPhotos[oldIndex]);
    });
    currentGridPhotos = newOrder;
    renderGrid();
    isDirty = true;
}

function getDragAfterElement(container, y, x) {
    const draggableElements = [...container.querySelectorAll('.photo-card:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offsetX = x - (box.left + box.width / 2);
        const offsetY = y - (box.top + box.height / 2);

        const dist = Math.hypot(offsetX, offsetY);

        if (closest === null || dist < closest.dist) {
            return { offset: dist, element: child, dist: dist };
        } else {
            return closest;
        }
    }, null).element;
}

function updateSaveButtonIcon() {
    if (state.isAdmin) {
        btnSave.title = "Tout envoyer sur GitHub";
        btnSave.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>`;
    } else {
        btnSave.title = "Sauvegarder";
        btnSave.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
    }
}

async function handleSave() {
    btnSave.disabled = true;
    const finalPhotos = currentGridPhotos.map(p => p.src);

    try {
        if (state.isAdmin) {
            let uploadCount = 0;
            showToast("Upload en cours...", "info");

            for (let i = 0; i < finalPhotos.length; i++) {
                if (finalPhotos[i].startsWith('data:image')) {
                    const response = await fetch(finalPhotos[i]);
                    const blob = await response.blob();
                    const file = new File([blob], "temp.jpg", { type: "image/jpeg" });

                    const publicUrl = await uploadPhotoForPoi(file, currentGridPoiId);
                    finalPhotos[i] = publicUrl;
                    uploadCount++;
                }
            }
            if (uploadCount > 0) showToast(`${uploadCount} photo(s) envoyée(s) !`, "success");
        }

        await updatePoiData(currentGridPoiId, 'photos', finalPhotos);
        showToast("Photos sauvegardées.", "success");

        closePhotoGrid(true); // Resolve promise with saved=true

    } catch (e) {
        console.error(e);
        showToast("Erreur: " + e.message, "error");
    } finally {
        btnSave.disabled = false;
    }
}
