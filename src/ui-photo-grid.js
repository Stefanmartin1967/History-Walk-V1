import { state } from './state.js';
import { getPoiId, getPoiName, updatePoiData } from './data.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { compressImage, generatePhotoId, uploadPhotoForPoi, ADMIN_COMPRESSION, USER_COMPRESSION } from './photo-service.js';
import { getPoiPhotos, savePoiPhotos } from './database.js';
import { createIcons, icons } from 'lucide';

// --- STATE ---
let currentGridPoiId = null;
// Chaque entrée : { id, objectUrl, blob, isNew } pour photos locales (Blob)
//                 { id: null, src, isNew: false }  pour photos serveur (URL string admin)
let currentGridPhotos = [];
let isDirty = false;
let currentResolve = null;

// Object URLs actives — révoquées à la fermeture de la grille
let activeObjectUrls = [];

// Mode de compression admin : 'OPTIMIZED' | 'ORIGINAL'
let adminCompressionKey = 'OPTIMIZED';

// --- DOM ELEMENTS ---
let gridOverlay = null;
let gridContent = null;
let headerTitle = null;
let headerSubtitle = null;
let btnAdd = null;
let btnSave = null;
let btnClose = null;
let btnCompToggle = null;
let fileInput = null;

function initDOM() {
    if (gridOverlay) return;

    gridOverlay = document.createElement('div');
    gridOverlay.className = 'photo-grid-overlay';

    const header = document.createElement('div');
    header.className = 'photo-grid-header';

    // --- Left: Add ---
    const leftGroup = document.createElement('div');
    leftGroup.className = 'photo-grid-btn-group';

    // ADD BUTTON (Image Up)
    btnAdd = document.createElement('button');
    btnAdd.className = 'photo-grid-btn';
    btnAdd.title = "Ajouter des photos";
    btnAdd.innerHTML = `<i data-lucide="image-up"></i>`;
    btnAdd.onclick = () => fileInput.click();

    // TOGGLE COMPRESSION (admin uniquement — masqué par défaut)
    btnCompToggle = document.createElement('button');
    btnCompToggle.className = 'photo-grid-comp-toggle';
    btnCompToggle.style.display = 'none';
    btnCompToggle.onclick = () => {
        adminCompressionKey = adminCompressionKey === 'OPTIMIZED' ? 'ORIGINAL' : 'OPTIMIZED';
        _updateCompToggle();
    };

    leftGroup.appendChild(btnAdd);
    leftGroup.appendChild(btnCompToggle);

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

    // --- Right: Save + Close ---
    const rightGroup = document.createElement('div');
    rightGroup.className = 'photo-grid-btn-group';

    // SAVE/UPLOAD BUTTON
    btnSave = document.createElement('button');
    btnSave.className = 'photo-grid-btn save-btn';
    btnSave.onclick = handleSave;

    // CLOSE BUTTON
    btnClose = document.createElement('button');
    btnClose.className = 'photo-grid-btn close-btn';
    btnClose.title = "Fermer";
    btnClose.innerHTML = `<i data-lucide="x"></i>`;
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
    fileInput.className = 'photo-file-input';
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

        if (state.isAdmin) {
            adminCompressionKey = 'OPTIMIZED'; // Repart toujours sur Optimisée à l'ouverture
            btnCompToggle.style.display = 'flex';
            _updateCompToggle();
        } else {
            headerSubtitle.textContent = "";
            headerSubtitle.classList.remove('admin-mode');
            btnCompToggle.style.display = 'none';
        }

        updateSaveButton();
        renderGrid(); // rendu vide initial (spinner implicite via grille vide)
        gridOverlay.classList.add('active');
        createIcons({ icons, nameAttr: 'data-lucide', attrs: {class: "lucide"}, root: gridOverlay });

        // Chargement async des photos
        _loadPhotos(poiId, feature, preloadedPhotos).then(() => {
            renderGrid();
            createIcons({ icons, nameAttr: 'data-lucide', attrs: {class: "lucide"}, root: gridContent });
        });
    });
}

/**
 * Charge les photos selon le contexte (préchargées GPS, admin URL, ou blobs utilisateur).
 * Crée les Object URLs nécessaires et les enregistre dans activeObjectUrls.
 */
async function _loadPhotos(poiId, feature, preloadedPhotos) {
    // Révoque toute session précédente si on re-ouvre
    activeObjectUrls.forEach(u => URL.revokeObjectURL(u));
    activeObjectUrls = [];
    currentGridPhotos = [];

    if (preloadedPhotos) {
        // Chemin GPS import : photos pré-compressées (base64 ou File)
        for (const p of preloadedPhotos) {
            let blob = p.blob || null;
            // Préfère le base64 existant (déjà compressé) pour éviter une double compression
            if (!blob && (p.src || p.base64)) {
                try { blob = await fetch(p.src || p.base64).then(r => r.blob()); } catch (_) { /* skip */ }
            }
            if (!blob && p.file) {
                try { blob = await compressImage(p.file); } catch (_) { /* skip */ }
            }
            if (blob) {
                const objectUrl = URL.createObjectURL(blob);
                activeObjectUrls.push(objectUrl);
                currentGridPhotos.push({ id: generatePhotoId(), objectUrl, blob, isNew: true });
            }
        }
        return;
    }

    if (state.isAdmin) {
        // Admin : photos = URL strings dans userData.photos (uploadées sur GitHub)
        const adminPhotos = feature?.properties?.userData?.photos || [];
        currentGridPhotos = adminPhotos.map(src => ({ id: null, src, isNew: false }));
        return;
    }

    // Utilisateur : blobs dans poiPhotos + URLs admin éventuelles dans userData.photos
    const storedItems = await getPoiPhotos(state.currentMapId, poiId);
    for (const item of storedItems) {
        const objectUrl = URL.createObjectURL(item.blob);
        activeObjectUrls.push(objectUrl);
        currentGridPhotos.push({ id: item.id, objectUrl, blob: item.blob, isNew: false });
    }

    // Ajoute les photos serveur admin (URL strings, non-base64) visibles pour l'utilisateur
    const adminUrls = (feature?.properties?.userData?.photos || [])
        .filter(p => typeof p === 'string' && p.startsWith('http'));
    for (const src of adminUrls) {
        currentGridPhotos.push({ id: null, src, isNew: false });
    }
}

export function closePhotoGrid(saved = false) {
    if (gridOverlay) gridOverlay.classList.remove('active');

    // Révocation des Object URLs pour libérer la mémoire
    activeObjectUrls.forEach(u => URL.revokeObjectURL(u));
    activeObjectUrls = [];
    currentGridPhotos = [];

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

    // Choix du profil de compression selon le contexte
    const profile = state.isAdmin
        ? ADMIN_COMPRESSION[adminCompressionKey]
        : USER_COMPRESSION;

    for (const file of files) {
        try {
            const blob = await compressImage(file, profile.targetMinSize, profile.quality);
            const objectUrl = URL.createObjectURL(blob);
            activeObjectUrls.push(objectUrl);
            currentGridPhotos.push({ id: generatePhotoId(), objectUrl, blob, isNew: true });
        } catch (err) {
            console.error("Image error", err);
        }
    }

    isDirty = true;
    renderGrid();
    createIcons({ icons, nameAttr: 'data-lucide', attrs: {class: "lucide"}, root: gridContent });
    fileInput.value = '';
}

function renderGrid() {
    gridContent.innerHTML = '';

    if (currentGridPhotos.length === 0) {
        gridContent.innerHTML = `
            <div class="photo-grid-empty">
                <i data-lucide="image"></i>
                <div>Aucune photo</div>
                <div class="photo-grid-empty-hint">Utilisez le bouton + pour ajouter</div>
            </div>
        `;
        createIcons({ icons, nameAttr: 'data-lucide', attrs: {class: "lucide"}, root: gridContent });
        return;
    }

    const fragment = document.createDocumentFragment();

    currentGridPhotos.forEach((photo, index) => {
        const card = document.createElement('div');
        card.className = 'photo-card';
        card.draggable = true;
        card.dataset.index = index;

        const displaySrc = photo.objectUrl || photo.src;

        const img = document.createElement('img');
        img.src = displaySrc;

        // Badge "NEW" pour les photos fraîchement ajoutées
        if (photo.isNew) {
            const badge = document.createElement('div');
            badge.className = 'photo-card-new-badge';
            badge.textContent = "NEW";
            card.appendChild(badge);
        }

        // Click → viewer
        img.onclick = () => {
            import('./photo-service.js').then(pm => {
                pm.setCurrentPhotos(currentGridPhotos.map(p => p.objectUrl || p.src), index);
                const viewer = document.getElementById('photo-viewer');
                const viewerImg = document.getElementById('viewer-img');
                const toolbar = document.getElementById('viewer-toolbar');

                if (viewer && viewerImg) {
                    viewerImg.src = displaySrc;
                    viewer.style.display = 'flex';
                    viewer.style.zIndex = '21000';

                    if (toolbar) toolbar.style.display = 'flex';

                    const uploadBtn = document.getElementById('viewer-btn-upload');
                    const deleteBtn = document.getElementById('viewer-btn-delete');
                    if (uploadBtn) uploadBtn.style.display = 'none';
                    if (deleteBtn) deleteBtn.style.display = 'none';
                }
            });
        };

        // --- Actions ---
        const actions = document.createElement('div');
        actions.className = 'photo-card-actions';

        // Bouton supprimer seulement pour les photos locales (blob) — pas pour les URL serveur admin
        const isServerPhoto = !photo.blob;

        if (!isServerPhoto) {
            const btnDel = document.createElement('button');
            btnDel.className = 'photo-card-btn delete';
            btnDel.title = "Supprimer";
            btnDel.innerHTML = `<i data-lucide="trash-2"></i>`;
            btnDel.onclick = async (e) => {
                e.stopPropagation();
                const ok = await showConfirm("Supprimer la photo", "Supprimer définitivement cette photo ?", "Supprimer", "Annuler", true);
                if (ok) {
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

        fragment.appendChild(card);
    });

    gridContent.appendChild(fragment);

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
        btnSave.className = 'photo-grid-btn upload-btn';
        btnSave.innerHTML = `<i data-lucide="cloud-upload"></i>`;
    } else {
        btnSave.title = "Sauvegarder localement";
        btnSave.className = 'photo-grid-btn save-btn';
        btnSave.innerHTML = `<i data-lucide="save"></i>`;
    }
}

/** Met à jour l'apparence du bouton toggle et le sous-titre admin. */
function _updateCompToggle() {
    if (!btnCompToggle) return;
    const profile = ADMIN_COMPRESSION[adminCompressionKey];
    const isOptimized = adminCompressionKey === 'OPTIMIZED';

    btnCompToggle.className = `photo-grid-comp-toggle ${isOptimized ? 'comp-optimized' : 'comp-original'}`;
    btnCompToggle.title = isOptimized
        ? 'Mode Optimisée actif — cliquer pour Pleine qualité'
        : 'Mode Pleine qualité actif — cliquer pour Optimisée';
    btnCompToggle.innerHTML = isOptimized
        ? `<i data-lucide="image-down"></i><span>${profile.label}</span>`
        : `<i data-lucide="image"></i><span>${profile.label}</span>`;

    // Mise à jour du sous-titre
    if (headerSubtitle) {
        headerSubtitle.textContent = `Admin — ${profile.label}`;
        headerSubtitle.classList.add('admin-mode');
    }

    createIcons({ icons, nameAttr: 'data-lucide', attrs: { class: 'lucide' }, root: btnCompToggle });
}

async function handleSave() {
    btnSave.disabled = true;

    try {
        if (state.isAdmin) {
            // ─── Mode Admin : upload GitHub + save URL strings dans userData ───
            showToast("Upload en cours...", "info");

            const finalUrls = [];
            const uploads = currentGridPhotos.map(async (photo) => {
                const src = photo.objectUrl || photo.src;
                if (photo.blob) {
                    // Photo locale → upload GitHub
                    const file = new File([photo.blob], "photo.jpg", { type: "image/jpeg" });
                    const publicUrl = await uploadPhotoForPoi(file, currentGridPoiId);
                    finalUrls.push(publicUrl);
                    return true;
                } else {
                    // Déjà une URL serveur
                    finalUrls.push(src);
                    return false;
                }
            });

            const results = await Promise.all(uploads);
            const uploadCount = results.filter(Boolean).length;
            if (uploadCount > 0) showToast(`${uploadCount} photo(s) envoyée(s) !`, "success");

            await updatePoiData(currentGridPoiId, 'photos', finalUrls);

        } else {
            // ─── Mode Utilisateur : sauvegarde blobs dans poiPhotos ───
            const blobItems = currentGridPhotos
                .filter(p => p.blob)
                .map(p => ({ id: p.id || generatePhotoId(), blob: p.blob }));

            await savePoiPhotos(state.currentMapId, currentGridPoiId, blobItems);
        }

        showToast("Sauvegarde effectuée.", "success");
        closePhotoGrid(true);

    } catch (e) {
        console.error(e);
        showToast("Erreur: " + e.message, "error");
    } finally {
        btnSave.disabled = false;
    }
}
