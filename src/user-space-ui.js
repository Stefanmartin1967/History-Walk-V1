// user-space-ui.js — Interface "Mon Espace" (côté utilisateur)
// Refonte design (handoff Claude Design 10/05/2026, PR 1) : shell custom
// `.me-overlay` + `.me-modal` au lieu d'`openHwModal`, tabs accessibles
// ARIA + clavier, mapping classes `.ue-*` → `.me-*`. Logique métier et IDs
// DOM testés inchangés (cf. handoff §13 + tests/backup_auto_local.test.js).
import { state, setHomeLocation } from './state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { saveAppState } from './database.js';
import { showToast } from './toast.js';
import { forceBackup, getBackupStatusForUI } from './backup-auto-local.js';

// Shell singleton — un seul "Mon Espace" ouvert à la fois.
let _meOverlay = null;
let _meEscHandler = null;

// Onglets dans l'ordre validé Stefan : Circuits / Données / Sécurité / Corbeille
// (Sécurité passe en 3ᵉ — nouvelle valeur produit Phase 1 backup auto, à
// rendre plus visible que la Corbeille qui reste l'action la plus ponctuelle.)
const TABS = [
    { id: 'circuits', label: 'Mes Circuits', icon: 'map' },
    { id: 'data',     label: 'Mes Données', icon: 'hard-drive' },
    { id: 'security', label: 'Sécurité',    icon: 'shield' },
    { id: 'trash',    label: 'Corbeille',   icon: 'trash-2' },
];

export function openUserSpaceModal(callbacks) {
    // Si déjà ouvert (double-clic / race), on ne ré-ouvre pas.
    if (_meOverlay) return;

    const overlay = document.createElement('div');
    overlay.className = 'me-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'me-topbar-title');

    overlay.innerHTML = `
        <div class="me-modal" role="document">
            <header class="me-topbar">
                <div class="me-topbar-brand">
                    <div class="me-topbar-mark"><i data-lucide="luggage"></i></div>
                    <div class="me-topbar-text">
                        <h2 class="me-topbar-title" id="me-topbar-title">Mon Espace</h2>
                        <div class="me-topbar-sub">Vos circuits, données et sauvegardes</div>
                    </div>
                </div>
                <!-- Variante mobile (< 768px) : eyebrow + titre dynamique selon
                     l'onglet actif. Économise du vertical sans perdre le contexte.
                     Cachée en desktop par CSS, mise à jour par activateTab(). -->
                <div class="me-topbar-mobile" aria-hidden="true">
                    <div class="me-topbar-mobile-eyebrow">Mon Espace</div>
                    <div class="me-topbar-mobile-title" id="me-topbar-mobile-title">Mes Circuits</div>
                </div>
                <button class="me-close" type="button" id="me-close-btn"
                        aria-label="Fermer Mon Espace" title="Fermer">
                    <i data-lucide="x"></i>
                </button>
            </header>

            <div class="me-tabs" role="tablist" aria-label="Mon Espace — sections">
                ${TABS.map((t, i) => `
                    <button class="me-tab${i === 0 ? ' is-active' : ''}" type="button"
                            role="tab" id="me-tab-${t.id}"
                            aria-controls="me-panel-${t.id}"
                            aria-selected="${i === 0 ? 'true' : 'false'}"
                            tabindex="${i === 0 ? '0' : '-1'}"
                            data-tab="${t.id}">
                        <i data-lucide="${t.icon}"></i> ${t.label}
                    </button>
                `).join('')}
            </div>

            <section class="me-body" role="tabpanel"
                     id="me-panel-circuits"
                     aria-labelledby="me-tab-circuits">
                <div id="ue-content"></div>
            </section>
        </div>
    `;

    document.body.appendChild(overlay);
    _meOverlay = overlay;

    // Trigger CSS transition (paint avant ajout de la classe is-active).
    requestAnimationFrame(() => overlay.classList.add('is-active'));

    // Bind events après mise en DOM.
    setTimeout(() => {
        // — Close —
        overlay.querySelector('#me-close-btn')?.addEventListener('click', closeUserSpace);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeUserSpace();
        });

        // — ESC pour fermer —
        _meEscHandler = (e) => { if (e.key === 'Escape') closeUserSpace(); };
        document.addEventListener('keydown', _meEscHandler);

        // — Tabs : clic + clavier (manual activation, plus accessible que l'auto)
        const tabBtns = overlay.querySelectorAll('.me-tab');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => activateTab(btn.dataset.tab, callbacks));
            btn.addEventListener('keydown', (e) => handleTabKeydown(e, tabBtns, callbacks));
        });

        // Render initial onglet "circuits".
        renderUserTab('circuits', callbacks);
        createIcons({ icons: appIcons, root: overlay });
    }, 30);
}

function closeUserSpace() {
    if (!_meOverlay) return;
    _meOverlay.classList.remove('is-active');
    if (_meEscHandler) {
        document.removeEventListener('keydown', _meEscHandler);
        _meEscHandler = null;
    }
    // Attendre la fin de la transition (200ms) avant de retirer du DOM.
    const ov = _meOverlay;
    _meOverlay = null;
    setTimeout(() => ov.remove(), 220);
}

function activateTab(tabId, callbacks) {
    if (!_meOverlay) return;
    const tabBtns = _meOverlay.querySelectorAll('.me-tab');
    let activeBtn = null;
    tabBtns.forEach(btn => {
        const isTarget = btn.dataset.tab === tabId;
        btn.classList.toggle('is-active', isTarget);
        btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        btn.setAttribute('tabindex', isTarget ? '0' : '-1');
        if (isTarget) activeBtn = btn;
    });
    // Mettre à jour aussi les attributs du panel (un seul panel — on met à jour
    // ses id et aria-labelledby pour pointer sur le tab actif).
    const panel = _meOverlay.querySelector('.me-body[role="tabpanel"]');
    if (panel) {
        panel.id = `me-panel-${tabId}`;
        panel.setAttribute('aria-labelledby', `me-tab-${tabId}`);
    }
    // Titre mobile dynamique (visible uniquement sous 768px, cf. me-userspace.css).
    const mobileTitle = _meOverlay.querySelector('#me-topbar-mobile-title');
    if (mobileTitle) {
        const tab = TABS.find(t => t.id === tabId);
        if (tab) mobileTitle.textContent = tab.label;
    }
    // Scroll-into-view du tab actif sur mobile (tabs scrollables horizontalement).
    if (activeBtn) {
        activeBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
    renderUserTab(tabId, callbacks);
}

function handleTabKeydown(e, tabBtns, callbacks) {
    const list = Array.from(tabBtns);
    const i = list.indexOf(e.target);
    if (i === -1) return;
    let next = null;
    if (e.key === 'ArrowRight') next = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activateTab(e.target.dataset.tab, callbacks);
        return;
    }
    if (next !== null) {
        e.preventDefault();
        list[next].focus();
    }
}

export function renderUserTab(tab, callbacks) {
    const container = document.getElementById('ue-content');
    if (!container) return;

    if (tab === 'circuits') renderCircuitsTab(container, callbacks);
    else if (tab === 'data') renderDataTab(container, callbacks);
    else if (tab === 'trash') renderTrashTab(container, callbacks);
    else if (tab === 'security') renderSecurityTab(container, callbacks);

    createIcons({ icons: appIcons, root: container });
}

// ─── ONGLET MES CIRCUITS ───────────────────────────────────────────────────

/**
 * Rendu HTML pour la section "Lieu de résidence" (tri par proximité).
 * Affiche soit un état invitatif (hero ambre + CTA capture), soit l'état
 * défini (hero vert + actions Mettre à jour / Effacer).
 */
function renderHomeLocationSection() {
    const home = state.homeLocation;
    if (home && typeof home.lat === 'number' && typeof home.lng === 'number') {
        const savedDate = home.savedAt
            ? new Date(home.savedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : null;
        const coordsLabel = `${home.lat.toFixed(5)}, ${home.lng.toFixed(5)}`;
        return `
            <div class="me-hero is-set">
                <div class="me-hero-mark"><i data-lucide="home"></i></div>
                <div class="me-hero-text">
                    <div class="me-hero-eyebrow">Lieu de résidence</div>
                    <div class="me-hero-coords">${coordsLabel}</div>
                    ${savedDate ? `<div class="me-hero-sub">Défini le ${savedDate} — circuits triés par proximité</div>` : ''}
                </div>
                <div class="me-hero-actions">
                    <button class="me-hero-cta" id="btn-ue-home-update" title="Remplacer par la position actuelle">
                        <i data-lucide="locate-fixed"></i> Mettre à jour
                    </button>
                    <button class="me-hero-cta" id="btn-ue-home-clear" title="Effacer le lieu de résidence">
                        <i data-lucide="x"></i> Effacer
                    </button>
                </div>
            </div>
        `;
    }
    return `
        <div class="me-hero">
            <div class="me-hero-mark"><i data-lucide="home"></i></div>
            <div class="me-hero-text">
                <div class="me-hero-eyebrow">Astuce</div>
                <div class="me-hero-title">Triez vos circuits par proximité</div>
                <div class="me-hero-sub">Définissez votre lieu de résidence (hôtel ou équivalent) pour voir d'abord ce qui est le plus proche.</div>
            </div>
            <div class="me-hero-actions">
                <button class="me-hero-cta" id="btn-ue-home-set">
                    <i data-lucide="locate-fixed"></i> Définir depuis ma position
                </button>
            </div>
        </div>
    `;
}

/**
 * Capture GPS one-shot et persiste dans state + IndexedDB.
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

// Refonte Mon Espace V2 (14/05/2026 PR1) : la section "Circuits officiels"
// (checklist + pills Aucun/Tous) a été retirée. La sélection par cochage est
// remplacée par le bouton "Cacher ce circuit" sur la fiche circuit (câblé en
// PR2) qui pilote state.hiddenCircuitIds. Cet onglet n'affiche désormais que
// le hero "Lieu de résidence" — sa structure d'ensemble (label, icône, place
// dans les TABS) sera retravaillée en PR2.
function renderCircuitsTab(container, callbacks) {
    container.innerHTML = renderHomeLocationSection();
    createIcons({ icons: appIcons, root: container });
    attachHomeLocationListeners(container, callbacks);
}

// ─── ONGLET MES DONNÉES ────────────────────────────────────────────────────

function renderDataTab(container, callbacks) {
    container.innerHTML = `
        <div class="me-section-h">
            <div class="me-section-title">Gestion des données</div>
        </div>

        <div class="me-data-grid">
            <div class="me-data-card">
                <div class="me-data-card-ico">
                    <i data-lucide="download"></i>
                </div>
                <div class="me-data-card-title">Sauvegarder</div>
                <p class="me-data-card-desc">
                    Exportez vos notes, lieux visités, circuits et préférences dans un fichier portable.
                </p>
                <label class="me-cb">
                    <input type="checkbox" id="ue-include-photos">
                    <span class="me-cb-box"></span>
                    <span>Inclure les photos</span>
                </label>
                <button id="btn-ue-backup" class="me-btn primary">
                    <i data-lucide="download"></i> Télécharger
                </button>
            </div>

            <div class="me-data-card">
                <div class="me-data-card-ico info">
                    <i data-lucide="upload"></i>
                </div>
                <div class="me-data-card-title">Restaurer</div>
                <p class="me-data-card-desc">
                    Rechargez un fichier de sauvegarde pour retrouver votre progression sur cet appareil.
                </p>
                <button id="btn-ue-restore" class="me-btn secondary">
                    <i data-lucide="folder-open"></i> Choisir un fichier…
                </button>
                <input type="file" id="ue-restore-loader" accept=".json,.txt" class="is-hidden">
            </div>
        </div>

        <div class="me-hint me-hint--spaced">
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
            <div class="me-empty">
                <div class="me-empty-mark green"><i data-lucide="package-check"></i></div>
                <p class="me-empty-title">Corbeille vide</p>
                <p class="me-empty-sub">Les circuits supprimés apparaîtront ici et pourront être restaurés à tout moment.</p>
            </div>`;
        createIcons({ icons: appIcons, root: container });
        return;
    }

    container.innerHTML = `
        <div class="me-section-h">
            <div class="me-section-title">
                Circuits supprimés
                <span class="badge red">${deletedCircuits.length}</span>
            </div>
        </div>

        <div class="me-hint">
            <i data-lucide="info"></i>
            <span>Ces circuits ont été supprimés mais peuvent être restaurés à tout moment.</span>
        </div>

        <div class="me-trash">
            ${deletedCircuits.map(c => `
                <div class="me-trash-item" id="ue-trash-${c.id}">
                    <div class="me-card-ico muted">
                        <i data-lucide="route"></i>
                    </div>
                    <div class="me-card-text">
                        <span class="me-card-title">${c.name || 'Circuit sans nom'}</span>
                        <span class="me-card-sub">${(c.poiIds || []).length} POI${(c.poiIds || []).length > 1 ? 's' : ''} · Supprimé</span>
                    </div>
                    <button class="me-trash-restore" data-action="restore-circuit" data-id="${c.id}">
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

// ─── ONGLET SÉCURITÉ ───────────────────────────────────────────────────────
//
// Phase 1 du chantier protection des données user (Couche 1 + Couche 2).
// Affiche le statut de l'auto-backup local, propose un backup forcé / partage
// natif (Web Share API), et annonce la sync cloud à venir (Phase 2).
//
// Architecture en cards modulaires (.me-sec-card) — Phase 2 = ajouter une
// 4ᵉ carte "Sync GitHub Device Flow" sans refactor structurel.

function formatRelativeDate(date) {
    if (!date) return null;
    const days = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
    if (days === 0) return "aujourd'hui";
    if (days === 1) return "hier";
    if (days < 7) return `il y a ${days} jours`;
    if (days < 30) return `il y a ${Math.floor(days / 7)} semaine${days >= 14 ? 's' : ''}`;
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function renderSecurityTab(container, callbacks) {
    const status = await getBackupStatusForUI();

    const lastLabel = status.lastDate
        ? `Dernier : <strong>${formatRelativeDate(status.lastDate)}</strong>`
        : 'Aucun backup auto encore créé';
    const sinceLabel = status.count > 0
        ? `${status.count} modification${status.count > 1 ? 's' : ''} depuis`
        : 'Aucune modification depuis';

    container.innerHTML = `
        <div class="me-sec">
            <p class="me-sec-intro">
                Tes données restent sur cet appareil. Pour ne rien perdre en cas de
                changement de téléphone ou de vidage du cache, sauvegarde régulièrement.
            </p>

            <div class="me-sec-card active">
                <div class="me-sec-head">
                    <i data-lucide="hard-drive-download"></i>
                    <div class="me-sec-title">Backup auto local</div>
                    <span class="me-sec-status on">Actif</span>
                </div>
                <div class="me-sec-stat">${lastLabel}</div>
                <div class="me-sec-stat sub">${sinceLabel}</div>
                <div class="me-sec-hint">
                    Téléchargement automatique tous les ${status.modifsThreshold} changements
                    ou ${status.daysThreshold} jours. Le fichier arrive dans ton dossier
                    Téléchargements.
                </div>
                <div class="me-sec-actions">
                    <button class="me-btn primary" id="ue-btn-force-backup">
                        <i data-lucide="download"></i> Forcer un backup maintenant
                    </button>
                </div>
            </div>

            <div class="me-sec-card">
                <div class="me-sec-head">
                    <i data-lucide="share-2"></i>
                    <div class="me-sec-title">Sauvegarder ailleurs</div>
                </div>
                <div class="me-sec-hint">
                    Envoie ton backup vers un email, Drive, Telegram… Sur mobile, tu auras
                    la palette de partage native. Sur ordinateur, le fichier est téléchargé
                    et tu peux l'envoyer toi-même.
                </div>
                <div class="me-sec-actions">
                    <button class="me-btn secondary" id="ue-btn-share-backup">
                        <i data-lucide="send"></i> Sauvegarder / partager
                    </button>
                </div>
            </div>

            <div class="me-sec-card soon">
                <div class="me-sec-head">
                    <i data-lucide="cloud"></i>
                    <div class="me-sec-title">Sync entre appareils</div>
                    <span class="me-sec-status soon">Bientôt</span>
                </div>
                <div class="me-sec-hint">
                    Pour retrouver tes données automatiquement sur tous tes appareils.
                    Disponible dans une prochaine version.
                </div>
            </div>
        </div>
    `;

    const btnForce = document.getElementById('ue-btn-force-backup');
    if (btnForce) {
        btnForce.addEventListener('click', async () => {
            btnForce.disabled = true;
            btnForce.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Création…';
            createIcons({ icons: appIcons, root: btnForce });
            await forceBackup();
            // Re-render pour rafraîchir le statut (count remis à 0, date courante).
            renderUserTab('security', callbacks);
        });
    }

    const btnShare = document.getElementById('ue-btn-share-backup');
    if (btnShare) {
        btnShare.addEventListener('click', async () => {
            btnShare.disabled = true;
            const originalHTML = btnShare.innerHTML;
            btnShare.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Préparation…';
            createIcons({ icons: appIcons, root: btnShare });
            try {
                // saveUserData utilise déjà Web Share API + fallback download.
                const { saveUserData } = await import('./fileManager.js');
                await saveUserData(false);
            } catch (err) {
                console.error('[security] share backup failed:', err);
                showToast("Impossible de préparer le backup.", 'error');
            } finally {
                btnShare.disabled = false;
                btnShare.innerHTML = originalHTML;
                createIcons({ icons: appIcons, root: btnShare });
            }
        });
    }
}
