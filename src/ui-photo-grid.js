import { state } from './state.js';
import { getPoiId, getPoiName, updatePoiData } from './data.js';
import { showToast } from './toast.js';
import { showConfirm, openHwModal, closeHwModal } from './modal.js';
import { compressImage, generatePhotoId, ADMIN_COMPRESSION, USER_COMPRESSION } from './photo-service.js';
import { getPoiPhotos, savePoiPhotos, getPendingAdminPhotos, setPendingAdminPhotos } from './database.js';
import { createIcons, appIcons } from './lucide-icons.js';

// --- STATE ---
let currentGridPoiId = null;
// Chaque entrée : { id, objectUrl, blob, isNew } pour photos locales (Blob)
//                 { id: null, src, isNew: false }  pour photos serveur (URL string admin)
let currentGridPhotos = [];
let isDirty = false;

// Object URLs actives — révoquées à la fermeture de la grille
let activeObjectUrls = [];

// Mode de compression admin : 'OPTIMIZED' | 'ORIGINAL'
let adminCompressionKey = 'OPTIMIZED';

// --- DOM REFS (réinitialisés à chaque ouverture de modale V2) ---
let gridContentEl = null;
let fileInputEl = null;
let btnSaveEl = null;
let btnCompToggleEl = null;
let subtitleEl = null;

// --- MAIN FUNCTIONS ---

export function openPhotoGrid(poiId, preloadedPhotos = null) {
    return new Promise((resolve) => {
        currentGridPoiId = poiId;
        isDirty = false;
        adminCompressionKey = 'OPTIMIZED';

        const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
        if (!feature && !preloadedPhotos) {
            resolve({ saved: false });
            return;
        }

        const poiName = feature ? getPoiName(feature) : "Nouveau Lieu";
        const isAdmin = state.isAdmin;

        const subheader = `
            <div class="photo-grid-toolbar">
                <button class="photo-grid-toolbar-btn" id="pg-btn-add" type="button" title="Ajouter des photos">
                    <i data-lucide="image-up"></i>
                    <span>Ajouter</span>
                </button>
                ${isAdmin ? `
                    <button class="photo-grid-comp-toggle" id="pg-btn-comp" type="button"></button>
                    <div class="photo-grid-subtitle" id="pg-subtitle"></div>
                ` : ''}
            </div>
        `;

        const body = `
            <div class="photo-grid-content" id="pg-content"></div>
            <input type="file" accept="image/*" multiple class="photo-file-input" id="pg-file-input">
        `;

        const footer = `
            <button class="hw-btn hw-btn-ghost" id="pg-btn-cancel" type="button">Annuler</button>
            <button class="hw-btn hw-btn-primary" id="pg-btn-save" type="button">
                <i data-lucide="save"></i>
                <span>Enregistrer</span>
            </button>
        `;

        const promise = openHwModal({
            size: 'xl',
            icon: 'image',
            title: poiName,
            subheader,
            body,
            footer,
        });

        // Bind après ouverture (DOM prêt)
        setTimeout(() => {
            gridContentEl = document.getElementById('pg-content');
            fileInputEl = document.getElementById('pg-file-input');
            btnSaveEl = document.getElementById('pg-btn-save');
            btnCompToggleEl = document.getElementById('pg-btn-comp');
            subtitleEl = document.getElementById('pg-subtitle');

            const btnAdd = document.getElementById('pg-btn-add');
            const btnCancel = document.getElementById('pg-btn-cancel');

            if (btnAdd) btnAdd.onclick = () => fileInputEl.click();
            if (btnCancel) btnCancel.onclick = () => closeHwModal({ saved: false });
            if (btnSaveEl) btnSaveEl.onclick = handleSave;
            if (fileInputEl) fileInputEl.onchange = handleFileSelect;

            if (btnCompToggleEl) {
                btnCompToggleEl.onclick = () => {
                    adminCompressionKey = adminCompressionKey === 'OPTIMIZED' ? 'ORIGINAL' : 'OPTIMIZED';
                    _updateCompToggle();
                };
                _updateCompToggle();
            }

            // Drag & drop sur la grille
            if (gridContentEl) {
                gridContentEl.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    const afterElement = getDragAfterElement(gridContentEl, e.clientY, e.clientX);
                    const draggable = gridContentEl.querySelector('.dragging');
                    if (draggable) {
                        if (afterElement == null) {
                            gridContentEl.appendChild(draggable);
                        } else {
                            gridContentEl.insertBefore(draggable, afterElement);
                        }
                    }
                });
            }

            renderGrid();
            createIcons({ icons: appIcons, root: document.querySelector('.hw-modal') });

            // Chargement async des photos
            _loadPhotos(poiId, feature, preloadedPhotos).then(() => {
                renderGrid();
                if (gridContentEl) createIcons({ icons: appIcons, root: gridContentEl });
            });
        }, 30);

        // Cleanup à la fermeture (peu importe la cause : croix, Escape, backdrop, bouton)
        promise.then((result) => {
            activeObjectUrls.forEach(u => URL.revokeObjectURL(u));
            activeObjectUrls = [];
            currentGridPhotos = [];
            gridContentEl = null;
            fileInputEl = null;
            btnSaveEl = null;
            btnCompToggleEl = null;
            subtitleEl = null;

            const saved = !!(result && result.saved === true);
            resolve({ saved });
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
                const src = p.src || p.base64;
                try {
                    if (src.startsWith('data:')) {
                        // Conversion manuelle : fetch(data:...) est bloqué par CSP connect-src
                        const [header, data] = src.split(',');
                        const mime = (header.match(/:(.*?);/) || [])[1] || 'image/jpeg';
                        const binary = atob(data);
                        const bytes = new Uint8Array(binary.length);
                        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                        blob = new Blob([bytes], { type: mime });
                    } else {
                        blob = await fetch(src).then(r => r.blob());
                    }
                } catch (_) { /* skip */ }
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

    // Fusionne les photos "publiques" du geojson (properties.photos, visibles
    // par tout le monde après publication) et les photos "draft" admin
    // (userData.photos, pas encore publiées). On déduplique, et on ignore
    // les anciens base64 éventuels qui traîneraient.
    const pool = [
        ...(feature?.properties?.photos || []),
        ...(feature?.properties?.userData?.photos || []),
    ];
    const seen = new Set();
    const adminUrls = pool.filter(p => {
        if (typeof p !== 'string') return false;
        if (p.startsWith('data:')) return false;
        if (seen.has(p)) return false;
        seen.add(p);
        return true;
    });

    if (state.isAdmin) {
        // URLs déjà publiées (relues du geojson + draft userData)
        currentGridPhotos = adminUrls.map(src => ({ id: null, src, isNew: false }));

        // Photos en attente de publication (Blob locaux, pas encore uploadés)
        const pending = await getPendingAdminPhotos(state.currentMapId, poiId);
        for (const item of pending) {
            const objectUrl = URL.createObjectURL(item.blob);
            activeObjectUrls.push(objectUrl);
            currentGridPhotos.push({
                id: item.id,
                objectUrl,
                blob: item.blob,
                isNew: false,
                isPending: true,
            });
        }
        return;
    }

    // Utilisateur : blobs locaux + URLs admin publiques (relatives OU http).
    const storedItems = await getPoiPhotos(state.currentMapId, poiId);
    for (const item of storedItems) {
        const objectUrl = URL.createObjectURL(item.blob);
        activeObjectUrls.push(objectUrl);
        currentGridPhotos.push({ id: item.id, objectUrl, blob: item.blob, isNew: false });
    }
    for (const src of adminUrls) {
        currentGridPhotos.push({ id: null, src, isNew: false });
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
    if (gridContentEl) createIcons({ icons: appIcons, root: gridContentEl });
    if (fileInputEl) fileInputEl.value = '';
}

function renderGrid() {
    if (!gridContentEl) return;
    gridContentEl.innerHTML = '';

    if (currentGridPhotos.length === 0) {
        gridContentEl.innerHTML = `
            <div class="photo-grid-empty">
                <i data-lucide="image"></i>
                <div>Aucune photo</div>
                <div class="photo-grid-empty-hint">Utilisez le bouton « Ajouter » pour en intégrer</div>
            </div>
        `;
        createIcons({ icons: appIcons, root: gridContentEl });
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
                    // Au-dessus de la modale V2 (overlay z-index 100000)
                    viewer.style.zIndex = '100001';

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

    gridContentEl.appendChild(fragment);

    // Refresh Icons for new elements
    createIcons({ icons: appIcons, root: gridContentEl });
}

function updateArrayOrderFromDOM() {
    if (!gridContentEl) return;
    const newOrder = [];
    const cards = gridContentEl.querySelectorAll('.photo-card');
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

/** Met à jour l'apparence du bouton toggle et le sous-titre admin. */
function _updateCompToggle() {
    if (!btnCompToggleEl) return;
    const profile = ADMIN_COMPRESSION[adminCompressionKey];
    const isOptimized = adminCompressionKey === 'OPTIMIZED';

    btnCompToggleEl.className = `photo-grid-comp-toggle ${isOptimized ? 'comp-optimized' : 'comp-original'}`;
    btnCompToggleEl.title = isOptimized
        ? 'Mode Optimisée actif — cliquer pour Pleine qualité'
        : 'Mode Pleine qualité actif — cliquer pour Optimisée';
    btnCompToggleEl.innerHTML = isOptimized
        ? `<i data-lucide="image-down"></i><span>${profile.label}</span>`
        : `<i data-lucide="image"></i><span>${profile.label}</span>`;

    if (subtitleEl) {
        subtitleEl.textContent = `Admin — ${profile.label}`;
    }

    createIcons({ icons: appIcons, root: btnCompToggleEl });
}

async function handleSave() {
    if (!btnSaveEl) return;
    btnSaveEl.disabled = true;

    try {
        if (state.isAdmin) {
            // ─── Mode Admin : stockage LOCAL uniquement ───
            // Les URLs déjà publiées sont conservées dans userData.photos.
            // Les nouveaux blobs partent dans pendingAdminPhotos et seront
            // uploadés sur GitHub au prochain "Publier" du Centre de Contrôle.
            const keptUrls = [];
            const pendingItems = [];

            for (const photo of currentGridPhotos) {
                if (photo.blob) {
                    pendingItems.push({
                        id: photo.id || generatePhotoId(),
                        blob: photo.blob,
                    });
                } else if (photo.src) {
                    keptUrls.push(photo.src);
                }
            }

            await updatePoiData(currentGridPoiId, 'photos', keptUrls);
            await setPendingAdminPhotos(state.currentMapId, currentGridPoiId, pendingItems);

            const pendingCount = pendingItems.length;
            if (pendingCount > 0) {
                showToast(`${pendingCount} photo(s) en attente de publication (CC).`, "info");
            } else {
                showToast("Enregistré.", "success");
            }

        } else {
            // ─── Mode Utilisateur : sauvegarde blobs dans poiPhotos ───
            const blobItems = currentGridPhotos
                .filter(p => p.blob)
                .map(p => ({ id: p.id || generatePhotoId(), blob: p.blob }));

            await savePoiPhotos(state.currentMapId, currentGridPoiId, blobItems);
            showToast("Sauvegarde effectuée.", "success");
        }

        closeHwModal({ saved: true });

    } catch (e) {
        console.error(e);
        showToast("Erreur: " + e.message, "error");
        btnSaveEl.disabled = false;
    }
}
