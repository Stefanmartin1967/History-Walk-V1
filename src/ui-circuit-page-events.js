/**
 * ui-circuit-page-events.js
 * Handlers V2 pour l'onglet Circuit (consultation + création).
 * Branchés au boot via initCircuitPageEvents().
 *
 * Couvre :
 * - Toggle mode sélection (crosshair button + dismiss banner + empty state CTA)
 * - Toggle trace visible/masquée (eye/eye-off)
 * - Marquer fait (consultation)
 * - Bascule modifier (consultation perso → création)
 * - Transport accordion (toggle + summary auto)
 * - Édition inline titre (double-clic + bouton crayon)
 * - Édition inline description (placeholder + double-clic)
 */

import { state, setCustomDraftName, setHiddenCircuitIds } from './state.js';
import { saveCircuitDraft, isCircuitTested } from './circuit.js';
import { updateTransportSummary } from './circuit-view.js';
import { handleCircuitVisitedToggle } from './circuit-actions.js';
import { saveAppState } from './database.js';
import { applyFilters } from './data.js';
import { showToast } from './toast.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { eventBus } from './events.js';

let inited = false;

export function initCircuitPageEvents() {
    if (inited) return;
    inited = true;

    initTraceToggle();
    initMarkDone();
    initMaskListing();
    // initModifyCircuit() : déjà branché par ui-circuit-editor.js via convertToDraft()
    initTransportAccordion();
    initTitleEdit();
    initDescriptionEdit();
    initEmptyStateCTA();

    // Sync de l'UI quand l'état change
    eventBus.on('circuit:changed', updateMarkDoneState);
    eventBus.on('circuit:changed', updateMaskListingState);
    eventBus.on('circuit:list-updated', updateMarkDoneState);
    eventBus.on('circuit:list-updated', updateMaskListingState);
}

/* ============================================================
   1. TOGGLE TRACE VISIBLE
   ============================================================ */

function initTraceToggle() {
    const btn = document.getElementById('btn-toggle-trace');
    if (!btn) return;

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const isOn = btn.classList.toggle('is-on');
        // Update icon
        const icon = btn.querySelector('i[data-lucide]');
        if (icon) {
            icon.setAttribute('data-lucide', isOn ? 'eye' : 'eye-off');
            // Re-render lucide for that single icon
            import('./lucide-icons.js').then(({ createIcons, appIcons }) => {
                createIcons({ icons: appIcons });
            });
        }
        // Toggle de la trace côté carte
        eventBus.emit('circuit:toggle-trace-visibility', { visible: isOn });
    });
}

/* ============================================================
   3. MARQUER FAIT (consultation)
   ============================================================ */

function initMarkDone() {
    const btn = document.getElementById('btn-mark-done');
    if (!btn) return;

    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!state.activeCircuitId) return;

        const isCurrentlyTested = isCircuitTested(state.activeCircuitId);
        const result = await handleCircuitVisitedToggle(state.activeCircuitId, isCurrentlyTested);

        if (result.success) {
            updateMarkDoneState();
            eventBus.emit('circuit:list-updated');
        }
    });

    updateMarkDoneState();
}

function updateMarkDoneState() {
    const btn = document.getElementById('btn-mark-done');
    if (!btn) return;

    if (!state.activeCircuitId) {
        btn.classList.remove('is-done');
        return;
    }

    const tested = isCircuitTested(state.activeCircuitId);
    btn.classList.toggle('is-done', tested);
    btn.title = tested ? 'Marqué comme fait' : 'Marquer comme fait';
}

/* ============================================================
   3bis. CACHER / RÉAFFICHER LE CIRCUIT (consultation, toggle PR3)
   ============================================================ */

function initMaskListing() {
    const btn = document.getElementById('btn-mask-listing');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        if (!state.activeCircuitId) return;
        const id = String(state.activeCircuitId);
        const previousHidden = [...(state.hiddenCircuitIds || [])];
        const isCurrentlyHidden = previousHidden.includes(id);

        if (isCurrentlyHidden) {
            // RÉAFFICHER : retire de la blacklist
            const nextHidden = previousHidden.filter(x => x !== id);
            setHiddenCircuitIds(nextHidden);
            try {
                await saveAppState('hiddenCircuitIds', nextHidden);
            } catch (err) {
                console.error('[circuit-page-events] saveAppState (réafficher) failed', err);
            }
            eventBus.emit('circuit:list-updated');
            applyFilters();
            showToast('Circuit réaffiché dans la liste.', 'success', 2500);
        } else {
            // CACHER : ajoute à la blacklist, propose Undo 5s
            const allCircuits = [...(state.officialCircuits || []), ...(state.myCircuits || [])];
            const circuit = allCircuits.find(c => String(c.id) === id);
            const name = circuit?.name || 'circuit';

            const nextHidden = [...previousHidden, id];
            setHiddenCircuitIds(nextHidden);
            try {
                await saveAppState('hiddenCircuitIds', nextHidden);
            } catch (err) {
                console.error('[circuit-page-events] saveAppState (cacher) failed', err);
            }
            eventBus.emit('circuit:list-updated');
            applyFilters();

            showToast(`« ${name} » caché de la liste.`, 'success', 5000, {
                label: 'Annuler',
                onClick: async () => {
                    setHiddenCircuitIds(previousHidden);
                    try {
                        await saveAppState('hiddenCircuitIds', previousHidden);
                    } catch (err) {
                        console.error('[circuit-page-events] saveAppState undo failed', err);
                    }
                    eventBus.emit('circuit:list-updated');
                    applyFilters();
                }
            });
        }
    });

    updateMaskListingState();
}

function updateMaskListingState() {
    const btn = document.getElementById('btn-mask-listing');
    if (!btn) return;

    const id = state.activeCircuitId ? String(state.activeCircuitId) : null;
    const isHidden = id ? (state.hiddenCircuitIds || []).includes(id) : false;

    btn.classList.toggle('is-hidden-circuit', isHidden);
    btn.title = isHidden ? 'Réafficher ce circuit' : 'Cacher ce circuit';

    const icon = btn.querySelector('i[data-lucide]');
    if (icon) {
        // PR4 (15/05/2026) : paire eye-off (cacher) / eye (réafficher) — plus
        // sémantique que la paire bookmark-x / bookmark utilisée en PR3 qui
        // évoquait un favori plutôt qu'une action d'affichage.
        icon.setAttribute('data-lucide', isHidden ? 'eye' : 'eye-off');
        createIcons({ icons: appIcons, root: btn });
    }
}

/* ============================================================
   4. (Modifier) — déjà géré par ui-circuit-editor.js via convertToDraft()
   ============================================================ */

/* ============================================================
   5. TRANSPORT ACCORDION
   ============================================================ */

function initTransportAccordion() {
    const head = document.getElementById('transport-toggle');
    const transport = document.getElementById('circuit-transport');
    if (!head || !transport) return;

    head.addEventListener('click', (e) => {
        e.preventDefault();
        const open = transport.getAttribute('data-open') === 'true';
        transport.setAttribute('data-open', open ? 'false' : 'true');
    });

    // Update summary quand les inputs changent
    const ids = ['transport-aller-temps', 'transport-aller-cout', 'transport-retour-temps', 'transport-retour-cout'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                updateTransportSummary();
                saveCircuitDraft();
            });
        }
    });

    updateTransportSummary();
}

/* ============================================================
   6. ÉDITION INLINE TITRE (double-clic + bouton crayon)
   ============================================================ */

function initTitleEdit() {
    const titleEl = document.getElementById('circuit-title-text');
    const editBtn = document.getElementById('cp-title-edit-btn');
    if (!titleEl) return;

    const enterEdit = (e) => {
        if (e) e.preventDefault();
        // Mode création uniquement
        const panel = document.getElementById('circuit-panel');
        if (panel?.getAttribute('data-mode') !== 'create') return;
        if (titleEl.tagName === 'INPUT') return; // Déjà en édition

        const currentText = titleEl.classList.contains('is-empty') ? '' : titleEl.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentText;
        input.placeholder = 'Titre du circuit…';
        input.className = 'cp-title-input';
        input.id = 'circuit-title-text';
        titleEl.replaceWith(input);
        input.focus();
        input.select();

        const finish = (cancel = false) => {
            const newValue = cancel ? currentText : input.value.trim();
            const h2 = document.createElement('h2');
            h2.id = 'circuit-title-text';
            h2.className = 'cp-title' + (newValue ? '' : ' is-empty');
            h2.textContent = newValue || 'Sans titre';
            h2.title = newValue || 'Sans titre';
            input.replaceWith(h2);

            if (!cancel && newValue !== currentText) {
                setCustomDraftName(newValue || null);
                saveCircuitDraft();
            }
        };

        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); finish(false); }
            else if (ev.key === 'Escape') { ev.preventDefault(); finish(true); }
        });
        input.addEventListener('blur', () => finish(false));
    };

    titleEl.addEventListener('dblclick', enterEdit);
    if (editBtn) editBtn.addEventListener('click', enterEdit);
}

/* ============================================================
   7. ÉDITION INLINE DESCRIPTION
   ============================================================ */

function initDescriptionEdit() {
    const placeholder = document.getElementById('circuit-desc-placeholder');
    const display = document.getElementById('circuit-description-display');
    const textarea = document.getElementById('circuit-description');
    if (!textarea) return;

    const enterEdit = (e) => {
        if (e) e.preventDefault();
        const panel = document.getElementById('circuit-panel');
        if (panel?.getAttribute('data-mode') !== 'create') return;

        if (placeholder) placeholder.hidden = true;
        if (display) display.hidden = true;
        textarea.hidden = false;
        textarea.focus();
    };

    const exitEdit = () => {
        const value = textarea.value.trim();
        textarea.hidden = true;
        if (value) {
            if (display) {
                display.textContent = value;
                display.hidden = false;
            }
            if (placeholder) placeholder.hidden = true;
        } else {
            if (display) display.hidden = true;
            if (placeholder) placeholder.hidden = false;
        }
        saveCircuitDraft();
    };

    if (placeholder) placeholder.addEventListener('click', enterEdit);
    if (display) display.addEventListener('dblclick', enterEdit);

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            textarea.blur();
        }
    });
    textarea.addEventListener('blur', exitEdit);
    textarea.addEventListener('input', saveCircuitDraft);
}

/* ============================================================
   8. EMPTY STATE — pas de CTA puisque toggle supprimé
   ============================================================ */

function initEmptyStateCTA() {
    // No-op : le mode sélection est désactivé. L'utilisateur clique un POI sur
    // la carte → ouvre l'onglet Détails → bouton "Ajouter au circuit" dedans.
}
