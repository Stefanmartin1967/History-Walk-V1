import { state } from './state.js';
import { getPoiId, getPoiName } from './data.js';
import { escapeXml } from './utils.js';
import { showToast } from './toast.js';
import { showAlert, showConfirm } from './modal.js';
import { deletePoi } from './data.js';
import { applyFilters } from './data.js'; // Assuming applyFilters is exported from data.js or wherever it resides.
import { closeDetailsPanel } from './ui-details.js';
import { switchMobileView, isMobileView } from './mobile.js';
import { eventBus } from './events.js';
import { saveAppState, restoreCircuit } from './database.js';
import { createIcons, icons } from 'lucide';

export function showLegendModal() {
    const title = "Légende";
    const message = `
    <div class="legend-list">
        <div class="legend-section-header">Marqueurs</div>
        <div class="legend-item">
            <div class="legend-marker-circle legend-marker-circle--visited"></div>
            <span><strong>Visité</strong> (Lieu marqué comme vu)</span>
        </div>
        <div class="legend-item">
            <div class="legend-marker-circle legend-marker-circle--planned"></div>
            <span><strong>Planifié</strong> (Ajouté à un circuit)</span>
        </div>
        <div class="legend-item">
            <div class="legend-marker-star-wrapper">
                <div class="legend-marker-star"></div>
            </div>
            <span><strong>Incontournable</strong> (Lieu VIP à ne pas manquer)</span>
        </div>

        <div class="legend-section-header mt">Lignes des Circuits</div>
        <div class="legend-item">
            <div class="legend-line-sample legend-line-sample--straight"></div>
            <span><strong>Vol d'oiseau</strong> (Trajet direct non précis)</span>
        </div>
        <div class="legend-item">
            <div class="legend-line-sample legend-line-sample--gps"></div>
            <span><strong>Tracé réel</strong> (Chemin GPS précis à suivre)</span>
        </div>
        <div class="legend-item">
            <div class="legend-line-sample legend-line-sample--done"></div>
            <span><strong>Circuit terminé</strong> (Marqué comme fait)</span>
        </div>
    </div>`;

    showAlert(title, message, "Fermer").catch(() => {});

    // Force l'affichage des icônes dans la modale
    const modalMessage = document.getElementById('custom-modal-message');
    if (modalMessage) {
        createIcons({ icons, root: modalMessage });
    }
}

export function openRestoreModal() {
    const deletedCircuits = state.myCircuits.filter(c => c.isDeleted);

    if (deletedCircuits.length === 0) {
        showToast("Aucun circuit dans la corbeille.", "info");
        return;
    }

    const html = `
        <div class="modal-list">
            ${deletedCircuits.map(c => `
                <div class="modal-list-item">
                    <span class="modal-list-item-name">${escapeXml(c.name)}</span>
                    <button class="restore-btn" data-id="${c.id}">Restaurer</button>
                </div>
            `).join('')}
        </div>
    `;

    const modal = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('custom-modal-title');
    const msgEl = document.getElementById('custom-modal-message');
    const actionsEl = document.getElementById('custom-modal-actions');

    if (!modal) return;

    titleEl.textContent = "Corbeille (Circuits)";
    msgEl.innerHTML = html;
    actionsEl.innerHTML = `<button class="custom-modal-btn secondary" id="btn-close-restore">Fermer</button>`;

    modal.classList.add('active');

    const closeBtn = document.getElementById('btn-close-restore');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('active');

    msgEl.querySelectorAll('.restore-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const id = e.currentTarget.dataset.id;
            await restoreCircuit(id);
            const c = state.myCircuits.find(cir => cir.id === id);
            if(c) c.isDeleted = false;

            modal.classList.remove('active');
            eventBus.emit('circuit:list-updated');
        };
    });
}

export function openTrashModal() {
    if (!state.hiddenPoiIds || state.hiddenPoiIds.length === 0) {
        showToast("Corbeille vide.", "info");
        return;
    }

    const deletedFeatures = state.loadedFeatures.filter(f =>
        state.hiddenPoiIds.includes(getPoiId(f))
    );

    const html = `
        <div class="modal-list">
            ${deletedFeatures.map(f => {
                const name = getPoiName(f);
                const id = getPoiId(f);
                return `
                <div class="modal-list-item">
                    <span class="modal-list-item-name">${escapeXml(name)}</span>
                    <button class="restore-poi-btn" data-id="${id}">Restaurer</button>
                </div>
                `;
            }).join('')}
            ${deletedFeatures.length === 0 ? '<div class="modal-list-empty">Les lieux supprimés de la carte actuelle sont listés ici.</div>' : ''}
        </div>
    `;

    const modal = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('custom-modal-title');
    const msgEl = document.getElementById('custom-modal-message');
    const actionsEl = document.getElementById('custom-modal-actions');

    if (!modal) return;

    titleEl.textContent = "Corbeille (Lieux)";
    msgEl.innerHTML = html;
    actionsEl.innerHTML = `<button class="custom-modal-btn secondary" id="btn-close-trash">Fermer</button>`;

    modal.classList.add('active');

    const closeBtn = document.getElementById('btn-close-trash');
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('active');

    msgEl.querySelectorAll('.restore-poi-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const id = e.currentTarget.dataset.id;

            // Restore logic
            if (state.hiddenPoiIds) {
                state.hiddenPoiIds = state.hiddenPoiIds.filter(hid => hid !== id);
                await saveAppState(`hiddenPois_${state.currentMapId}`, state.hiddenPoiIds);
            }

            // Refresh UI
            applyFilters();

            modal.classList.remove('active');
            showToast("Lieu restauré !", "success");
        };
    });
}

// --- FONCTION DE SUPPRESSION DOUCE (Déplacée de main.js) ---
export async function requestSoftDelete(idOrIndex) {
    let feature;
    if (typeof idOrIndex === 'number' && state.loadedFeatures[idOrIndex]) {
        feature = state.loadedFeatures[idOrIndex];
    } else {
        feature = state.loadedFeatures[state.currentFeatureId];
    }
    if (!feature) return;

    let poiId;
    try { poiId = getPoiId(feature); } catch (e) { poiId = feature.properties.HW_ID || feature.id; }
    const poiName = getPoiName(feature);

    const msg = isMobileView()
        ? `ATTENTION !\n\nVoulez-vous vraiment placer "${poiName}" dans la corbeille ?`
        : `ATTENTION !\n\nVoulez-vous vraiment signaler "${poiName}" pour suppression ?`;

    if (await showConfirm("Suppression", msg, "Supprimer", "Garder", true)) {
        await deletePoi(poiId);

        // On ferme le panneau
        closeDetailsPanel(true);

        // Refresh selon mode
        if (isMobileView()) {
            switchMobileView('circuits'); // Refresh liste
        }
    }
}
