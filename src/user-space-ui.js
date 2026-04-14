// user-space-ui.js — Interface "Mon Espace" (côté utilisateur)
import { state } from './state.js';
import { createIcons, icons } from 'lucide';
import { showAlert } from './modal.js';

export function openUserSpaceModal(callbacks) {
    const html = `
        <div class="ue-container">
            <div class="ue-header">
                <div class="ue-header-top">
                    <div class="ue-header-brand">
                        <span class="ue-brand-icon">🧳</span>
                        Mon Espace
                        <span class="ue-brand-subtitle">/ Mon voyage</span>
                    </div>
                    <button class="ue-close-icon-btn" id="btn-ue-close" title="Fermer">
                        <i data-lucide="x"></i>
                    </button>
                </div>
                <div class="ue-tabs">
                    <div class="ue-tab active" data-tab="circuits">
                        <i data-lucide="map"></i> Mes Circuits
                    </div>
                    <div class="ue-tab" data-tab="data">
                        <i data-lucide="hard-drive"></i> Mes Données
                    </div>
                    <div class="ue-tab" data-tab="trash">
                        <i data-lucide="trash-2"></i> Corbeille
                    </div>
                </div>
            </div>

            <div class="ue-scroll-area">
                <div id="ue-content"></div>
            </div>

            <div class="ue-footer">
                <button class="custom-modal-btn secondary" id="btn-ue-footer-close">Fermer</button>
            </div>
        </div>
    `;

    showAlert('', html, null, 'user-space-mode');

    // Masquer les éléments par défaut du modal générique
    const defaultTitle = document.getElementById('custom-modal-title');
    if (defaultTitle) defaultTitle.style.display = 'none';
    const defaultActions = document.getElementById('custom-modal-actions');
    if (defaultActions) defaultActions.style.display = 'none';

    const overlay = document.getElementById('custom-modal-overlay');

    // Nettoyage à la fermeture
    const observer = new MutationObserver(() => {
        if (!overlay.classList.contains('active')) {
            document.querySelector('.custom-modal-box')?.classList.remove('user-space-mode');
            if (defaultTitle) defaultTitle.style.display = 'block';
            if (defaultActions) defaultActions.style.display = 'flex';
            observer.disconnect();
        }
    });
    observer.observe(overlay, { attributes: true });

    // Boutons fermer (header ✕ + footer)
    const closeModal = () => overlay.classList.remove('active');
    document.getElementById('btn-ue-close')?.addEventListener('click', closeModal);
    document.getElementById('btn-ue-footer-close')?.addEventListener('click', closeModal);

    // Tabs
    const tabs = document.querySelectorAll('.ue-tab');
    tabs.forEach(t => {
        t.onclick = () => {
            tabs.forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            renderUserTab(t.dataset.tab, callbacks);
        };
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
        container.innerHTML = `
            <div class="ue-empty-state">
                <div class="ue-empty-icon"><i data-lucide="wifi-off"></i></div>
                <p class="ue-empty-title">Aucun circuit disponible</p>
                <p class="ue-empty-sub">Les circuits officiels apparaîtront ici une fois chargés.</p>
            </div>`;
        createIcons({ icons, root: container });
        return;
    }

    const selected = state.selectedOfficialCircuitIds;
    const selectedSet = selected === null
        ? new Set(allOfficial.map(c => String(c.id)))
        : new Set((selected || []).map(String));

    const checkedCount = selectedSet.size;

    container.innerHTML = `
        <div class="ue-section-header">
            <div class="ue-section-title">
                Circuits officiels
                <span class="ue-badge ue-badge-amber" id="ue-circuits-count">${checkedCount} / ${allOfficial.length}</span>
            </div>
            <div class="ue-section-actions">
                <button class="ue-pill-btn" id="btn-ue-none">Aucun</button>
                <button class="ue-pill-btn" id="btn-ue-all">Tous</button>
            </div>
        </div>

        <div class="ue-hint-banner">
            <i data-lucide="info"></i>
            <span>Les circuits masqués n'apparaissent plus dans la liste, mais leurs POIs restent toujours visibles sur la carte.</span>
        </div>

        <div class="ue-circuits-list">
            ${allOfficial.map(c => {
                const isChecked = selectedSet.has(String(c.id));
                const poiCount = (c.poiIds || []).length;
                const meta = [
                    `${poiCount} POI${poiCount > 1 ? 's' : ''}`,
                    c.zone || null,
                    c.distance || null
                ].filter(Boolean).join(' · ');
                return `
                <label class="ue-circuit-item ${isChecked ? 'is-checked' : ''}">
                    <div class="ue-circuit-icon-box">
                        <i data-lucide="route"></i>
                    </div>
                    <div class="ue-circuit-info">
                        <span class="ue-circuit-name">${c.name || 'Circuit sans nom'}</span>
                        <span class="ue-circuit-meta">${meta}</span>
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
        if (countEl) countEl.textContent = `${checked} / ${allOfficial.length}`;
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
        <div class="ue-section-header">
            <div class="ue-section-title">Gestion des données</div>
        </div>

        <div class="ue-data-grid">
            <div class="ue-data-card">
                <div class="ue-data-card-icon">
                    <i data-lucide="download"></i>
                </div>
                <div class="ue-data-card-title">Sauvegarder</div>
                <p class="ue-data-card-desc">
                    Exportez vos notes, lieux visités, circuits et préférences dans un fichier portable.
                </p>
                <label class="ue-photo-label">
                    <input type="checkbox" id="ue-include-photos">
                    <span>Inclure les photos</span>
                </label>
                <button id="btn-ue-backup" class="ue-action-btn primary">
                    <i data-lucide="download"></i> Télécharger
                </button>
            </div>

            <div class="ue-data-card">
                <div class="ue-data-card-icon secondary">
                    <i data-lucide="upload"></i>
                </div>
                <div class="ue-data-card-title">Restaurer</div>
                <p class="ue-data-card-desc">
                    Rechargez un fichier de sauvegarde pour retrouver votre progression sur cet appareil.
                </p>
                <button id="btn-ue-restore" class="ue-action-btn secondary" style="margin-top:auto;">
                    <i data-lucide="folder-open"></i> Choisir un fichier…
                </button>
                <input type="file" id="ue-restore-loader" accept=".json,.txt" style="display:none;">
            </div>
        </div>

        <div class="ue-hint-banner" style="margin-top: 16px;">
            <i data-lucide="shield-check"></i>
            <span>Vos données restent sur votre appareil. Aucune information n'est envoyée à nos serveurs.</span>
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
            <div class="ue-empty-state">
                <div class="ue-empty-icon green"><i data-lucide="package-check"></i></div>
                <p class="ue-empty-title">Corbeille vide</p>
                <p class="ue-empty-sub">Les circuits supprimés apparaîtront ici et pourront être restaurés.</p>
            </div>`;
        createIcons({ icons, root: container });
        return;
    }

    container.innerHTML = `
        <div class="ue-section-header">
            <div class="ue-section-title">
                Circuits supprimés
                <span class="ue-badge ue-badge-red">${deletedCircuits.length}</span>
            </div>
        </div>

        <div class="ue-hint-banner">
            <i data-lucide="info"></i>
            <span>Ces circuits ont été supprimés mais peuvent être restaurés à tout moment.</span>
        </div>

        <div class="ue-circuits-list">
            ${deletedCircuits.map(c => `
                <div class="ue-trash-item" id="ue-trash-${c.id}">
                    <div class="ue-circuit-icon-box muted">
                        <i data-lucide="route"></i>
                    </div>
                    <div class="ue-circuit-info">
                        <span class="ue-circuit-name">${c.name || 'Circuit sans nom'}</span>
                        <span class="ue-circuit-meta">${(c.poiIds || []).length} POI${(c.poiIds || []).length > 1 ? 's' : ''} · Supprimé</span>
                    </div>
                    <button class="ue-restore-btn" data-action="restore-circuit" data-id="${c.id}">
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
