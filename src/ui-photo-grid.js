import { state } from './state.js';
import { getPoiId, getPoiName, updatePoiData } from './data.js';
import { showToast } from './toast.js';
import { uploadPhotoForPoi } from './photo-upload.js';
import { compressImage } from './photo-manager.js';
import { createIcons, icons } from 'lucide';

// --- STYLES INJECTION ---
const styles = `
    .photo-grid-overlay {
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: var(--bg); /* Theme Aware Background */
        z-index: 10050;
        display: flex;
        flex-direction: column;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s, visibility 0.2s;
    }
    .photo-grid-overlay.active {
        opacity: 1;
        visibility: visible;
    }

    .photo-grid-header {
        background: var(--surface);
        padding: 8px 16px; /* Reduced Padding */
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--line);
        color: var(--ink);
        min-height: 50px; /* Reduced Height */
        box-shadow: var(--shadow-soft);
    }

    .photo-grid-title-container {
        flex: 1;
        text-align: center;
        overflow: hidden;
    }

    .photo-grid-title {
        font-weight: 800;
        font-size: 18px; /* Slightly Smaller Title */
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.2;
        color: var(--brand);
    }

    .photo-grid-subtitle {
        font-size: 12px;
        color: var(--ink-soft);
        font-weight: 500;
        margin-top: 2px;
    }

    .photo-grid-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 8px; /* Reduced Padding */
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--brand);
        transition: background 0.2s;
    }
    .photo-grid-btn:hover {
        background: var(--surface-muted);
    }
    .photo-grid-btn .lucide {
        width: 24px; /* Slightly Smaller Icons */
        height: 24px;
    }

    .photo-grid-btn.save-btn {
        color: var(--brand);
    }
    .photo-grid-btn.upload-btn {
        color: #ef4444;
    }
    .photo-grid-btn.close-btn {
        color: var(--brand);
    }

    .photo-grid-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .photo-grid-content {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        grid-auto-rows: 1fr;
        gap: 10px;
        align-content: start;
        background: var(--bg); /* Theme Match */
    }

    @media (min-width: 1024px) {
        .photo-grid-content {
            grid-template-columns: repeat(4, 1fr);
        }
    }

    .photo-card {
        position: relative;
        background: var(--surface-muted);
        border-radius: 4px;
        overflow: hidden;
        aspect-ratio: 1;
        border: 2px solid transparent;
        cursor: grab;
        transition: transform 0.1s;
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

    /* Photo Overlay Actions */
    .photo-card-actions {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 8px;
        background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
        display: flex;
        justify-content: flex-end;
        align-items: flex-end;
        height: 40px;
    }

    .photo-card-btn {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        cursor: pointer;
        padding: 6px;
        border-radius: 4px;
        backdrop-filter: blur(2px);
    }
    .photo-card-btn:hover {
        background: #ef4444;
    }
    .photo-card-btn .lucide {
        width: 18px;
        height: 18px;
    }

    /* Placeholders/Status */
    .photo-card-new-badge {
        position: absolute;
        top: 5px;
        left: 5px;
        background: var(--brand);
        color: white;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: bold;
        z-index: 2;
    }

    /* Message Empty */
    .photo-grid-empty {
        grid-column: 1 / -1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--ink-soft);
        padding: 50px;
        text-align: center;
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
let currentResolve = null;

// --- DOM ELEMENTS ---
let gridOverlay = null;
let gridContent = null;
let headerTitle = null;
let headerSubtitle = null;
let btnAdd = null;
let btnSave = null;
let btnClose = null;
let fileInput = null;

function initDOM() {
    if (gridOverlay) return;

    gridOverlay = document.createElement('div');
    gridOverlay.className = 'photo-grid-overlay';

    const header = document.createElement('div');
    header.className = 'photo-grid-header';

    // --- Left: Add + Close ---
    const leftGroup = document.createElement('div');
    leftGroup.style.display = 'flex';
    leftGroup.style.gap = '10px';

    // ADD BUTTON (Image Up)
    btnAdd = document.createElement('button');
    btnAdd.className = 'photo-grid-btn';
    btnAdd.title = "Ajouter des photos";
    btnAdd.innerHTML = `<i data-lucide="image-up"></i>`;
    btnAdd.onclick = () => fileInput.click();

    leftGroup.appendChild(btnAdd);

    // --- Center: Title ---
    const titleContainer = document.createElement('div');
    titleContainer.className = 'photo-grid-title-container';

    headerTitle = document.createElement('div');
    headerTitle.className = 'photo-grid-title';
    headerTitle.textContent = "Titre du Lieu";

    headerSubtitle = document.createElement('div');
    headerSubtitle.className = 'photo-grid-subtitle';
    // Default empty, populated only for Admin

    titleContainer.appendChild(headerTitle);
    titleContainer.appendChild(headerSubtitle);

    // --- Right: Save ---
    const rightGroup = document.createElement('div');
    rightGroup.style.display = 'flex';
    rightGroup.style.gap = '10px';

    // SAVE/UPLOAD BUTTON
    btnSave = document.createElement('button');
    btnSave.className = 'photo-grid-btn save-btn';
    btnSave.onclick = handleSave;

    // CLOSE BUTTON
    btnClose = document.createElement('button');
    btnClose.className = 'photo-grid-btn close-btn';
    btnClose.title = "Fermer";
    btnClose.innerHTML = `<i data-lucide="x"></i>`; // Standard X icon
    btnClose.onclick = () => closePhotoGrid(false);

    rightGroup.appendChild(btnSave);
    rightGroup.appendChild(btnClose);

    header.appendChild(leftGroup);
    header.appendChild(titleContainer);
    header.appendChild(rightGroup);

    gridContent = document.createElement('div');
    gridContent.className = 'photo-grid-content';

    // Drag & Drop
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

// --- MAIN FUNCTIONS ---

export function openPhotoGrid(poiId, preloadedPhotos = null) {
    return new Promise((resolve) => {
        initDOM();
        currentGridPoiId = poiId;
        isDirty = false;
        currentResolve = resolve;

        const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
        if (!feature && !preloadedPhotos) {
            resolve({ saved: false });
            return;
        }

        const poiName = feature ? getPoiName(feature) : "Nouveau Lieu";
        headerTitle.textContent = poiName;

        // Determine Mode Title
        if (state.isAdmin) {
             headerSubtitle.textContent = "(Mode GOD / Admin)";
             headerSubtitle.style.color = "#ef4444";
             headerSubtitle.style.display = "block";
        } else {
             // User requested to remove "(Mode Édition)"
             headerSubtitle.textContent = "";
             headerSubtitle.style.display = "none";
        }

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

        updateSaveButton();
        renderGrid();

        // Refresh Icons
        createIcons({ icons, nameAttr: 'data-lucide', attrs: {class: "lucide"}, root: gridOverlay });

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

    if (currentGridPhotos.length === 0) {
        gridContent.innerHTML = `
            <div class="photo-grid-empty">
                <i data-lucide="image" style="width:48px; height:48px; opacity:0.5; margin-bottom:10px;"></i>
                <div>Aucune photo</div>
                <div style="font-size:12px; margin-top:5px;">Utilisez le bouton + pour ajouter</div>
            </div>
        `;
        createIcons({ icons, nameAttr: 'data-lucide', attrs: {class: "lucide"}, root: gridContent });
        return;
    }

    currentGridPhotos.forEach((photo, index) => {
        const card = document.createElement('div');
        card.className = 'photo-card';
        card.draggable = true;
        card.dataset.index = index;

        const img = document.createElement('img');
        img.src = photo.src;

        // --- Badge New ---
        if (photo.isNew || photo.src.startsWith('data:')) {
            const badge = document.createElement('div');
            badge.className = 'photo-card-new-badge';
            badge.textContent = "NEW";
            card.appendChild(badge);
        }

        // --- Click to View ---
        img.onclick = () => {
            // HIDE GRID WHEN OPENING VIEWER
            // But we keep it active in DOM, just hidden visually to avoid Z-index mess if we want
            // Actually, best practice is to keep it there but rely on Z-index.
            // But user complained about "Black Hole".
            // Since we set bg to var(--bg), it's opaque now.

            // We don't need to set opacity 0 anymore if the Viewer covers everything perfectly.
            // But to be safe and avoid double scrollbars or weird interactions:
            // Let's NOT hide it, but just rely on the new Viewer Z-Index (21000).

            import('./photo-manager.js').then(pm => {
                pm.setCurrentPhotos(currentGridPhotos.map(p => p.src), index);
                const viewer = document.getElementById('photo-viewer');
                const viewerImg = document.getElementById('viewer-img');
                const toolbar = document.getElementById('viewer-toolbar');

                // Viewer Open Logic is in ui-photo-viewer.js mostly but we trigger display here
                if (viewer && viewerImg) {
                    viewerImg.src = photo.src;
                    viewer.style.display = 'flex';
                    // We rely on CSS update for Z-Index (next step) or force it here:
                    viewer.style.zIndex = '21000';

                    if (toolbar) toolbar.style.display = 'flex';

                    // Hide Edit Actions in Viewer when opened from Grid
                    const uploadBtn = document.getElementById('viewer-btn-upload');
                    const deleteBtn = document.getElementById('viewer-btn-delete');
                    if(uploadBtn) uploadBtn.style.display = 'none';
                    if(deleteBtn) deleteBtn.style.display = 'none';
                }
            });
        };

        // --- Actions ---
        const actions = document.createElement('div');
        actions.className = 'photo-card-actions';

        // CONDITIONAL DELETE BUTTON
        // Only show if it's a local photo (data:image) OR if we are NOT in Admin Mode?
        // User said: "Simplification : Tu retires la poubelle des photos qui sont sur le serveur"

        const isServerPhoto = !photo.src.startsWith('data:image');

        if (!isServerPhoto) {
            const btnDel = document.createElement('button');
            btnDel.className = 'photo-card-btn delete';
            btnDel.title = "Supprimer";
            btnDel.innerHTML = `<i data-lucide="trash-2"></i>`;
            btnDel.onclick = (e) => {
                e.stopPropagation();
                if(confirm("Supprimer cette photo ?")) {
                    currentGridPhotos.splice(index, 1);
                    isDirty = true;
                    renderGrid();
                }
            };
            actions.appendChild(btnDel);
        }

        card.appendChild(img);
        card.appendChild(actions);

        // --- Drag Events ---
        card.addEventListener('dragstart', () => {
            card.classList.add('dragging');
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            updateArrayOrderFromDOM();
        });

        gridContent.appendChild(card);
    });

    // Refresh Icons for new elements
    createIcons({ icons, nameAttr: 'data-lucide', attrs: {class: "lucide"}, root: gridContent });
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

function updateSaveButton() {
    if (state.isAdmin) {
        btnSave.title = "Uploader sur GitHub";
        btnSave.className = 'photo-grid-btn upload-btn'; // Red/Admin class
        btnSave.innerHTML = `<i data-lucide="cloud-upload"></i>`;
    } else {
        btnSave.title = "Sauvegarder localement";
        btnSave.className = 'photo-grid-btn save-btn'; // Brand/User class
        btnSave.innerHTML = `<i data-lucide="save"></i>`;
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
        showToast("Sauvegarde effectuée.", "success");

        closePhotoGrid(true); // Resolve promise with saved=true

    } catch (e) {
        console.error(e);
        showToast("Erreur: " + e.message, "error");
    } finally {
        btnSave.disabled = false;
    }
}
