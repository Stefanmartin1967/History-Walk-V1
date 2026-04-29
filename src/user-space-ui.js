// user-space-ui.js — Interface "Mon Espace" (côté utilisateur)
import { state, setHomeLocation } from './state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { openHwModal, closeHwModal } from './modal.js';
import { saveAppState } from './database.js';
import { showToast } from './toast.js';

export function openUserSpaceModal(callbacks) {
    // Migration V2 : openHwModal lg avec tabs intégrés au body (option B audit
    // Stefan : tabs inline plutôt qu'un nouveau pattern réutilisable).
    // La logique métier (renderUserTab) reste inchangée.

    const subheader = `
        <div class="ue-tabs">
            <button class="ue-tab is-active" type="button" data-tab="circuits">
                <i data-lucide="map"></i> Mes Circuits
            </button>
            <button class="ue-tab" type="button" data-tab="data">
                <i data-lucide="hard-drive"></i> Mes Données
            </button>
            <button class="ue-tab" type="button" data-tab="trash">
                <i data-lucide="trash-2"></i> Corbeille
            </button>
        </div>
    `;

    const body = `<div id="ue-content" class="ue-content"></div>`;

    openHwModal({
        size: 'lg',
        icon: 'briefcase',
        title: 'Mon Espace',
        subheader,
        body,
        footer: false,
    });

    // Bind après ouverture (DOM prêt)
    setTimeout(() => {
        const tabs = document.querySelectorAll('.hw-modal .ue-tab');
        tabs.forEach(t => {
            t.addEventListener('click', () => {
                tabs.forEach(x => x.classList.remove('is-active'));
                t.classList.add('is-active');
                renderUserTab(t.dataset.tab, callbacks);
            });
        });
        renderUserTab('circuits', callbacks);
    }, 30);
}

export function renderUserTab(tab, callbacks) {
    const container = document.getElementById('ue-content');
    if (!container) return;

    if (tab === 'circuits') renderCircuitsTab(container, callbacks);
    else if (tab === 'data') renderDataTab(container, callbacks);
    else if (tab === 'trash') renderTrashTab(container, callbacks);

    createIcons({ icons: appIcons, root: container });
}

// ─── ONGLET MES CIRCUITS ───────────────────────────────────────────────────

/**
 * Rendu HTML pour la section "Lieu de résidence" (tri par proximité).
 * Affiche soit un état vide avec un bouton de capture GPS, soit les coords
 * enregistrées avec bouton "Effacer".
 */
function renderHomeLocationSection() {
    const home = state.homeLocation;
    if (home && typeof home.lat === 'number' && typeof home.lng === 'number') {
        const savedDate = home.savedAt
            ? new Date(home.savedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : null;
        const coordsLabel = `${home.lat.toFixed(5)}, ${home.lng.toFixed(5)}`;
        return `
            <div class="ue-home-section ue-home-section--set">
                <div class="ue-home-header">
                    <i data-lucide="home"></i>
                    <span class="ue-home-title">Lieu de résidence</span>
                </div>
                <div class="ue-home-info">
                    <span class="ue-home-coords">${coordsLabel}</span>
                    ${savedDate ? `<span class="ue-home-date">Défini le ${savedDate}</span>` : ''}
                </div>
                <div class="ue-home-actions">
                    <button class="ue-pill-btn" id="btn-ue-home-update" title="Remplacer par la position actuelle">
                        <i data-lucide="locate-fixed"></i> Mettre à jour
                    </button>
                    <button class="ue-pill-btn" id="btn-ue-home-clear" title="Effacer le lieu de résidence">
                        <i data-lucide="x"></i> Effacer
                    </button>
                </div>
            </div>
        `;
    }
    return `
        <div class="ue-home-section">
            <div class="ue-home-header">
                <i data-lucide="home"></i>
                <span class="ue-home-title">Lieu de résidence</span>
            </div>
            <p class="ue-home-hint">
                Définissez votre lieu de résidence pour trier les circuits par proximité
                depuis votre hôtel (ou équivalent).
            </p>
            <button class="ue-action-btn primary" id="btn-ue-home-set">
                <i data-lucide="locate-fixed"></i> Définir depuis ma position actuelle
            </button>
        </div>
    `;
}

/**
 * Capture GPS one-shot et persiste dans state + IndexedDB.
 * @param {Function} onDone callback pour re-render la section
 */
function captureHomeLocation(onDone) {
    if (!navigator.geolocation) {
        showToast("Géolocalisation non disponible sur cet appareil.", 'error', 4000);
        return;
    }
    showToast("Localisation en cours…", 'info', 2000);
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const home = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                savedAt: Date.now()
            };
            setHomeLocation(home);
            try {
                await saveAppState('homeLocation', home);
                showToast("Lieu de résidence enregistré.", 'success', 2500);
                if (typeof onDone === 'function') onDone();
            } catch (err) {
                console.error('[user-space] saveAppState(homeLocation) failed', err);
                showToast("Erreur d'enregistrement du lieu.", 'error', 4000);
            }
        },
        (err) => {
            console.warn('[user-space] geolocation error', err);
            const msg = err.code === err.PERMISSION_DENIED
                ? "Permission de géolocalisation refusée."
                : "Impossible d'obtenir votre position.";
            showToast(msg, 'error', 4500);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

/**
 * Wire les listeners des boutons "Lieu de résidence" dans le container Mon Espace.
 * Idempotent : réattache à chaque render.
 */
function attachHomeLocationListeners(container, callbacks) {
    const rerender = () => renderCircuitsTab(container, callbacks);

    document.getElementById('btn-ue-home-set')?.addEventListener('click', () => {
        captureHomeLocation(rerender);
    });
    document.getElementById('btn-ue-home-update')?.addEventListener('click', () => {
        captureHomeLocation(rerender);
    });
    document.getElementById('btn-ue-home-clear')?.addEventListener('click', async () => {
        setHomeLocation(null);
        try {
            await saveAppState('homeLocation', null);
            showToast("Lieu de résidence effacé.", 'info', 2000);
        } catch (err) {
            console.error('[user-space] saveAppState(null) failed', err);
        }
        rerender();
    });
}

function renderCircuitsTab(container, callbacks) {
    const allOfficial = state.officialCircuits || [];

    if (allOfficial.length === 0) {
        container.innerHTML = `
            ${renderHomeLocationSection()}
            <div class="ue-empty-state">
                <div class="ue-empty-icon"><i data-lucide="wifi-off"></i></div>
                <p class="ue-empty-title">Aucun circuit disponible</p>
                <p class="ue-empty-sub">Les circuits officiels apparaîtront ici une fois chargés.</p>
            </div>`;
        createIcons({ icons: appIcons, root: container });
        attachHomeLocationListeners(container, callbacks);
        return;
    }

    const selected = state.selectedOfficialCircuitIds;
    const selectedSet = selected === null
        ? new Set(allOfficial.map(c => String(c.id)))
        : new Set((selected || []).map(String));

    const checkedCount = selectedSet.size;

    container.innerHTML = `
        ${renderHomeLocationSection()}

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

    attachHomeLocationListeners(container, callbacks);
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
                <button id="btn-ue-restore" class="ue-action-btn secondary">
                    <i data-lucide="folder-open"></i> Choisir un fichier…
                </button>
                <input type="file" id="ue-restore-loader" accept=".json,.txt" class="is-hidden">
            </div>
        </div>

        <div class="ue-hint-banner ue-hint-banner--spaced">
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
        createIcons({ icons: appIcons, root: container });
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
                createIcons({ icons: appIcons, root: item });
            }
        });
    });
}
