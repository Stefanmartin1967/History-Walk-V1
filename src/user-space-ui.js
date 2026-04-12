// user-space-ui.js — Interface "Mon Espace" (côté utilisateur)
import { state } from './state.js';
import { createIcons, icons } from 'lucide';
import { showAlert } from './modal.js';

export function openUserSpaceModal(callbacks) {
    const html = `
        <div class="ue-container">
            <div class="ue-header">
                <div class="ue-header-top">
                    <div class="ue-header-brand">🧳 Mon Espace</div>
                </div>
                <div class="ue-tabs">
                    <div class="ue-tab active" data-tab="circuits">
                        <i data-lucide="map" width="15"></i> Mes Circuits
                    </div>
                    <div class="ue-tab" data-tab="data">
                        <i data-lucide="hard-drive" width="15"></i> Mes Données
                    </div>
                    <div class="ue-tab" data-tab="trash">
                        <i data-lucide="trash-2" width="15"></i> Corbeille
                    </div>
                </div>
            </div>

            <div class="ue-scroll-area">
                <div id="ue-content"></div>
            </div>

            <div class="ue-footer">
                <button class="custom-modal-btn secondary" data-action="close-ue">Fermer</button>
            </div>
        </div>
    `;

    showAlert('', html, null, 'user-space-mode');

    // Masquer les éléments par défaut du modal générique
    const defaultTitle = document.getElementById('custom-modal-title');
    if (defaultTitle) defaultTitle.style.display = 'none';
    const defaultActions = document.getElementById('custom-modal-actions');
    if (defaultActions) defaultActions.style.display = 'none';

    // Nettoyage à la fermeture
    const overlay = document.getElementById('custom-modal-overlay');
    const observer = new MutationObserver(() => {
        if (!overlay.classList.contains('active')) {
            document.querySelector('.custom-modal-box')?.classList.remove('user-space-mode');
            if (defaultTitle) defaultTitle.style.display = 'block';
            if (defaultActions) defaultActions.style.display = 'flex';
            observer.disconnect();
        }
    });
    observer.observe(overlay, { attributes: true });

    // Tabs
    const tabs = document.querySelectorAll('.ue-tab');
    tabs.forEach(t => {
        t.onclick = () => {
            tabs.forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            renderUserTab(t.dataset.tab, callbacks);
        };
    });

    // Fermer
    document.querySelector('.ue-footer')?.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="close-ue"]')) {
            overlay.classList.remove('active');
        }
    });

    createIcons({ icons, root: document.querySelector('.ue-header') });
    renderUserTab('circuits', callbacks);
}

export function renderUserTab(tab, callbacks) {
    const container = document.getElementById('ue-content');
    if (!container) return;

    if (tab === 'circuits') renderCircuitsTab(container, callbacks);
    else if (tab === 'data') renderDataTab(container, callbacks);
    else if (tab === 'trash') renderTrashTab(container, callbacks);

    createIcons({ icons, root: container });
}

// ─── ONGLET MES CIRCUITS ───────────────────────────────────────────────────

function renderCircuitsTab(container, callbacks) {
    const allOfficial = state.officialCircuits || [];

    if (allOfficial.length === 0) {
        container.innerHTML = `<div class="empty-state"><i data-lucide="wifi-off" width="48"></i><p>Aucun circuit officiel disponible.</p></div>`;
        createIcons({ icons, root: container });
        return;
    }

    const selected = state.selectedOfficialCircuitIds;
    const selectedSet = selected === null
        ? new Set(allOfficial.map(c => String(c.id)))
        : new Set((selected || []).map(String));

    container.innerHTML = `
        <div class="ue-circuits-top">
            <div class="ue-circuits-actions">
                <button class="ue-quick-btn" id="btn-ue-none">Aucun</button>
                <button class="ue-quick-btn" id="btn-ue-all">Tous</button>
            </div>
            <span class="ue-circuits-count" id="ue-circuits-count">
                ${selectedSet.size} / ${allOfficial.length} sélectionné${selectedSet.size > 1 ? 's' : ''}
            </span>
        </div>
        <p class="ue-circuits-hint">Les circuits sélectionnés apparaissent dans votre liste. Les POIs restent toujours visibles sur la carte.</p>
        <div class="ue-circuits-list">
            ${allOfficial.map(c => {
                const isChecked = selectedSet.has(String(c.id));
                const poiCount = (c.poiIds || []).length;
                return `
                <label class="ue-circuit-item ${isChecked ? 'is-checked' : ''}">
                    <div class="ue-circuit-info">
                        <span class="ue-circuit-name">${c.name || 'Circuit sans nom'}</span>
                        <span class="ue-circuit-meta">${poiCount} POI${poiCount > 1 ? 's' : ''}${c.zone ? ' · ' + c.zone : ''}</span>
                    </div>
                    <div class="ue-toggle-wrap">
                        <input type="checkbox" class="ue-circuit-check" data-circuit-id="${c.id}" ${isChecked ? 'checked' : ''}>
                        <span class="ue-toggle-slider"></span>
                    </div>
                </label>`;
            }).join('')}
        </div>
    `;

    const updateCount = () => {
        const checked = container.querySelectorAll('.ue-circuit-check:checked').length;
        const countEl = document.getElementById('ue-circuits-count');
        if (countEl) countEl.textContent = `${checked} / ${allOfficial.length} sélectionné${checked > 1 ? 's' : ''}`;
    };

    document.getElementById('btn-ue-none')?.addEventListener('click', () => {
        if (callbacks.setSelection) callbacks.setSelection([]);
        renderCircuitsTab(container, callbacks);
    });

    document.getElementById('btn-ue-all')?.addEventListener('click', () => {
        if (callbacks.setSelection) callbacks.setSelection(allOfficial.map(c => String(c.id)));
        renderCircuitsTab(container, callbacks);
    });

    container.querySelectorAll('.ue-circuit-check').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const currentIds = state.selectedOfficialCircuitIds === null
                ? allOfficial.map(c => String(c.id))
                : [...(state.selectedOfficialCircuitIds || [])];
            const id = String(checkbox.dataset.circuitId);
            const newIds = checkbox.checked
                ? [...new Set([...currentIds, id])]
                : currentIds.filter(x => x !== id);
            if (callbacks.setSelection) callbacks.setSelection(newIds);
            checkbox.closest('.ue-circuit-item')?.classList.toggle('is-checked', checkbox.checked);
            updateCount();
        });
    });
}

// ─── ONGLET MES DONNÉES ────────────────────────────────────────────────────

function renderDataTab(container, callbacks) {
    container.innerHTML = `
        <div class="cc-card">
            <h3 class="cc-card-title-flex">
                <i data-lucide="save" class="icon-amber"></i> Sauvegarder mes données
            </h3>
            <p style="color:var(--hw-ink-soft); font-size:0.88rem; margin-bottom:14px;">
                Exportez vos notes, lieux visités, circuits et préférences.
                Rechargez ce fichier pour retrouver votre état sur n'importe quel appareil.
            </p>
            <label class="ue-photo-label">
                <input type="checkbox" id="ue-include-photos">
                <span>Inclure mes photos <small style="color:var(--hw-ink-soft)">(fichier plus volumineux)</small></span>
            </label>
            <button id="btn-ue-backup" class="cc-save-btn" style="margin-top:14px; width:100%;">
                <i data-lucide="download"></i> Télécharger la sauvegarde
            </button>
        </div>

        <div class="cc-card">
            <h3 class="cc-card-title-flex">
                <i data-lucide="folder-open" class="icon-amber"></i> Charger une sauvegarde
            </h3>
            <p style="color:var(--hw-ink-soft); font-size:0.88rem; margin-bottom:14px;">
                Restaurez vos données depuis un fichier de sauvegarde précédemment exporté.
            </p>
            <button id="btn-ue-restore" class="custom-modal-btn secondary" style="width:100%;">
                <i data-lucide="upload"></i> Choisir un fichier…
            </button>
            <input type="file" id="ue-restore-loader" accept=".json,.txt" style="display:none;">
        </div>
    `;

    document.getElementById('btn-ue-backup')?.addEventListener('click', () => {
        const includePhotos = document.getElementById('ue-include-photos')?.checked || false;
        if (callbacks.exportData) callbacks.exportData(includePhotos);
    });

    document.getElementById('btn-ue-restore')?.addEventListener('click', () => {
        document.getElementById('ue-restore-loader')?.click();
    });

    document.getElementById('ue-restore-loader')?.addEventListener('change', (e) => {
        if (callbacks.restoreData) callbacks.restoreData(e);
    });
}

// ─── ONGLET CORBEILLE ──────────────────────────────────────────────────────

function renderTrashTab(container, callbacks) {
    const deletedCircuits = (state.myCircuits || []).filter(c => c.isDeleted);

    if (deletedCircuits.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i data-lucide="trash-2" width="48"></i>
                <p>La corbeille est vide.</p>
            </div>`;
        createIcons({ icons, root: container });
        return;
    }

    container.innerHTML = `
        <p class="ue-trash-intro">
            <i data-lucide="info"></i>
            Les circuits supprimés restent ici jusqu'à leur restauration.
        </p>
        <div class="ue-trash-list">
            ${deletedCircuits.map(c => `
                <div class="ue-trash-item" id="ue-trash-${c.id}">
                    <div class="ue-trash-name">
                        <i data-lucide="route"></i>
                        <span>${c.name || 'Circuit sans nom'}</span>
                    </div>
                    <button class="cc-btn-edit" data-action="restore-circuit" data-id="${c.id}">
                        <i data-lucide="rotate-ccw"></i> Restaurer
                    </button>
                </div>
            `).join('')}
        </div>
    `;

    container.querySelectorAll('[data-action="restore-circuit"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            if (callbacks.restoreCircuit) callbacks.restoreCircuit(id);
            const item = document.getElementById(`ue-trash-${id}`);
            if (item) {
                item.style.opacity = '0.5';
                item.style.pointerEvents = 'none';
                btn.innerHTML = `<i data-lucide="check"></i> Restauré`;
                createIcons({ icons, root: item });
            }
        });
    });
}
