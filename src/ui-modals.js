import { state } from './state.js';
import { getPoiId, getPoiName } from './data.js';
import { escapeXml, isMobileView } from './utils.js';
import { showToast } from './toast.js';
import { showAlert, showConfirm } from './modal.js';
import { restoreCircuit, deletePoi } from './circuit.js';
import { applyFilters } from './data.js'; // Assuming applyFilters is exported from data.js or wherever it resides.
import { closeDetailsPanel } from './ui.js';
import { switchMobileView } from './mobile.js';
import { eventBus } from './events.js';
import { saveAppState } from './database.js';
import { createIcons, icons } from 'lucide';

export function showLegendModal() {
    const title = "Légende";
    const message = `
    <div style="text-align: left; display: flex; flex-direction: column; gap: 15px;">
        <div style="font-weight: 600; border-bottom: 1px solid var(--line); padding-bottom: 4px; margin-bottom: 4px;">Marqueurs</div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 24px; height: 24px; background: #FFFFFF; border-radius: 50%; border: 3px solid #10B981; box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.3);"></div>
            <span><strong>Visité</strong> (Lieu marqué comme vu)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 24px; height: 24px; background: #FFFFFF; border-radius: 50%; border: 3px solid #3B82F6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);"></div>
            <span><strong>Planifié</strong> (Ajouté à un circuit)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 28px; height: 28px; display: flex; justify-content: center; align-items: center;">
                <div style="width: 100%; height: 100%; background: #FEF08A; clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%); display: flex; justify-content: center; align-items: center; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.25));">
                </div>
            </div>
            <span><strong>Incontournable</strong> (Lieu VIP à ne pas manquer)</span>
        </div>

        <div style="font-weight: 600; border-bottom: 1px solid var(--line); padding-bottom: 4px; margin-bottom: 4px; margin-top: 10px;">Lignes des Circuits</div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 40px; height: 4px; background: #EF4444; border-radius: 2px;"></div>
            <span><strong>Vol d'oiseau</strong> (Trajet direct non précis)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 40px; height: 4px; background: #3B82F6; border-radius: 2px;"></div>
            <span><strong>Tracé réel</strong> (Chemin GPS précis à suivre)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 40px; height: 4px; background: #10B981; border-radius: 2px;"></div>
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
        <div style="display: flex; flex-direction: column; gap: 10px; max-height: 300px; overflow-y: auto;">
            ${deletedCircuits.map(c => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: var(--surface-muted); border-radius: 8px;">
                    <span style="font-weight: 500; color: var(--ink); text-align: left;">${escapeXml(c.name)}</span>
                    <button class="restore-btn" data-id="${c.id}" style="background: transparent; color: var(--ok); border: 1px solid var(--ok); border-radius: 6px; padding: 6px 12px; cursor: pointer; font-weight: 600;">
                        Restaurer
                    </button>
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
        <div style="display: flex; flex-direction: column; gap: 10px; max-height: 300px; overflow-y: auto;">
            ${deletedFeatures.map(f => {
                const name = getPoiName(f);
                const id = getPoiId(f);
                return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: var(--surface-muted); border-radius: 8px;">
                    <span style="font-weight: 500; color: var(--ink); text-align: left;">${escapeXml(name)}</span>
                    <button class="restore-poi-btn" data-id="${id}" style="background: transparent; color: var(--ok); border: 1px solid var(--ok); border-radius: 6px; padding: 6px 12px; cursor: pointer; font-weight: 600;">
                        Restaurer
                    </button>
                </div>
                `;
            }).join('')}
            ${deletedFeatures.length === 0 ? '<div style="padding:10px; color:var(--ink-soft);">Les lieux supprimés de la carte actuelle sont listés ici.</div>' : ''}
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
