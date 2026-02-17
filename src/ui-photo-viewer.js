import { state } from './state.js';
import { changePhoto, setCurrentPhotos, handlePhotoUpload, handlePhotoDeletion, handleAllPhotosDeletion } from './photo-manager.js';
import { getPoiId } from './data.js';
import { showToast } from './toast.js';
import { openDetailsPanel } from './ui.js';
import { showConfirm } from './modal.js';

const els = {};
function getEl(id) {
    if (!els[id]) els[id] = document.getElementById(id);
    return els[id];
}

export function initPhotoViewer() {
    const photoViewer = getEl('photo-viewer');
    const closeViewer = document.querySelector('.close-viewer');
    const viewerNext = getEl('viewer-next');
    const viewerPrev = getEl('viewer-prev');

    if (closeViewer) {
        closeViewer.addEventListener('click', () => {
            if(photoViewer) photoViewer.style.display = 'none';
        });
    }

    if (photoViewer) {
        photoViewer.addEventListener('click', (e) => {
            if(e.target === photoViewer) photoViewer.style.display = 'none';
        });
    }

    if(viewerNext) viewerNext.addEventListener('click', (e) => { e.stopPropagation(); changePhoto(1); });
    if(viewerPrev) viewerPrev.addEventListener('click', (e) => { e.stopPropagation(); changePhoto(-1); });

    document.addEventListener('keydown', (e) => {
        if (photoViewer && photoViewer.style.display !== 'none') {
            if (e.key === 'ArrowRight') changePhoto(1);
            if (e.key === 'ArrowLeft') changePhoto(-1);
            if (e.key === 'Escape') photoViewer.style.display = 'none';
        }
    });
}

export function setupPhotoPanelListeners(poiId) {
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
            const photos = feature?.properties?.userData?.photos || [];

            const deleteBtn = e.target.closest('.photo-item').querySelector('.photo-delete-btn');
            const photoIndex = parseInt(deleteBtn.dataset.index, 10);

            setCurrentPhotos(photos, photoIndex);

            const viewerImg = getEl('viewer-img');
            const photoViewer = getEl('photo-viewer');
            const viewerNext = getEl('viewer-next');
            const viewerPrev = getEl('viewer-prev');

            if (viewerImg) viewerImg.src = photos[photoIndex];
            if (photoViewer) photoViewer.style.display = 'flex';

            const displayNav = photos.length > 1 ? 'block' : 'none';
            if(viewerNext) viewerNext.style.display = displayNav;
            if(viewerPrev) viewerPrev.style.display = displayNav;
        });
    });

    document.querySelectorAll('.photo-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation(); // Empêche le clic de remonter

            // On récupère l'index
            const index = parseInt(e.currentTarget.dataset.index, 10);

            if(!await showConfirm("Suppression", "Voulez-vous vraiment supprimer cette photo ?", "Supprimer", "Conserver", true)) return;

            const success = await handlePhotoDeletion(poiId, index);

            if (success) {
                openDetailsPanel(state.currentFeatureId, state.currentCircuitIndex);
            } else {
                showToast("Erreur lors de la suppression", "error");
            }
        });
    });
}
