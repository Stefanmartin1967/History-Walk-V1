/**
 * ui-circuit-page-events.js
 * Handlers V2 pour l'onglet Circuit (consultation + création).
 * Branchés au boot via initCircuitPageEvents().
 *
 * Couvre :
 * - Toggle mode sélection (crosshair button + dismiss banner + empty state CTA)
 * - Marquer fait (consultation)
 * - Cacher / Réafficher le circuit (toggle eye-off/eye)
 * - Télécharger GPX (consultation)
 * - Bascule modifier (consultation perso → création)
 * - Transport accordion (toggle + summary auto)
 * - Édition inline titre (double-clic + bouton crayon)
 * - Édition inline description (placeholder + double-clic)
 */

import { state, setCustomDraftName, updateMyCircuit, setOfficialCircuits } from './state.js';
import { saveCircuitDraft, isCircuitTested } from './circuit.js';
import { updateTransportSummary } from './circuit-view.js';
import { handleCircuitVisitedToggle } from './circuit-actions.js';
import { saveCircuit } from './database.js';
import { getPoiId } from './data.js';
import { setCircuitHidden } from './circuit-actions.js';
import { generateAndDownloadGPX } from './gpx.js';
import { showToast } from './toast.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { eventBus } from './events.js';
import { getActiveCircuit } from './circuit-lookup.js';

let inited = false;

export function initCircuitPageEvents() {
    if (inited) return;
    inited = true;

    initMarkDone();
    initMaskListing();
    initDownloadGpx();
    initGpxStudioConsultVisibility();
    // initModifyCircuit() : déjà branché par ui-circuit-editor.js via convertToDraft()
    initTransportAccordion();
    initTitleEdit();
    initDescriptionEdit();
    initEmptyStateCTA();

    // Sync de l'UI quand l'état change. Note : les anciens listeners
    // `circuit:changed` ont été retirés 15/05/2026 (event jamais émis nulle
    // part dans le code — listener fantôme). Le refresh des boutons passe
    // exclusivement par `circuit:list-updated`, qui est largement émis
    // (chargement de circuit, modification, suppression, mark-done, etc.).
    eventBus.on('circuit:list-updated', updateMarkDoneState);
    eventBus.on('circuit:list-updated', updateMaskListingState);
    // Bouton « Ouvrir dans GPX Studio » consult : à toggler dès qu'un circuit
    // change d'état (réel ↔ vol d'oiseau). circuit:updated est aussi émis sur
    // chaque ajout/retrait de POI mais c'est OK (lecture cheap d'un attribut).
    eventBus.on('circuit:list-updated', updateGpxStudioConsultVisibility);
    window.addEventListener('circuit:updated', updateGpxStudioConsultVisibility);
}

/* ============================================================
   (Section "Toggle trace visible/masquée" retirée 15/05/2026 : btn-toggle-trace
   émettait `circuit:toggle-trace-visibility` mais aucun listener n'écoutait
   cet event — le clic n'avait aucun effet observable malgré l'apparence d'un
   bouton câblé. Feature jugée sans utilité par Stefan, supprimée intégralement
   HTML + handler en cleanup A6.)
   ============================================================ */

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
        const isCurrentlyHidden = (state.hiddenCircuitIds || []).includes(id);

        if (isCurrentlyHidden) {
            await setCircuitHidden(id, false);
            showToast('Circuit réaffiché dans la liste.', 'success', 2500);
        } else {
            const circuit = getActiveCircuit();
            const name = circuit?.name || 'circuit';

            await setCircuitHidden(id, true);
            showToast(`« ${name} » caché de la liste.`, 'success', 5000, {
                label: 'Annuler',
                onClick: () => setCircuitHidden(id, false)
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
   3ter. TÉLÉCHARGER GPX (consultation, A3 — 15/05/2026)
   Câble btn-download-gpx précédemment orphelin. Réutilise
   generateAndDownloadGPX(gpx.js) qui gère :
   - Le cas avec realTrack chargé (officiel après loadCircuitById, ou perso)
   - Le cas « vol d'oiseau » si realTrack absent (rare en consultation car la
     fiche a chargé la trace via loadCircuitById) : <trkpt> aux vraies coords
     des POIs, GPX Studio route ensuite (plus de pré-snap routier)
   ============================================================ */

function initDownloadGpx() {
    const btn = document.getElementById('btn-download-gpx');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        if (!state.activeCircuitId) return;

        const circuit = getActiveCircuit();
        if (!circuit) {
            showToast('Circuit introuvable.', 'error');
            return;
        }

        // Reconstruit l'array de features POIs (même ordre que circuit.poiIds)
        const features = (circuit.poiIds || [])
            .map(pid => state.loadedFeatures.find(f => getPoiId(f) === pid))
            .filter(Boolean);

        if (features.length === 0) {
            showToast('Aucun POI trouvé pour ce circuit.', 'error');
            return;
        }

        try {
            await generateAndDownloadGPX(
                features,
                circuit.id,
                circuit.name || 'Circuit',
                circuit.description || '',
                circuit.realTrack
            );
        } catch (err) {
            console.error('[circuit-page-events] generateAndDownloadGPX failed', err);
            showToast('Erreur lors du téléchargement du GPX.', 'error');
        }
    });
}

/* ============================================================
   3quater. OUVRIR DANS GPX STUDIO (consultation, conditionnel vol d'oiseau)
   PR 5/5 chantier drapeaux v2 — remet le lien disparu d'une refonte
   antérieure (cf. reference_no_gpx_studio_link). Visible UNIQUEMENT si le
   circuit en consultation n'a pas de realTrack (= vol d'oiseau à router).
   Le bouton est un <a href="https://gpx.studio/fr/app" target="_blank">,
   pas besoin de handler click — juste toggle de visibilité.

   GPX Studio reste un outil EXTERNE (pas d'intégration logicielle, cf.
   reference_no_gpx_studio_link). L'admin télécharge son GPX via le bouton
   voisin « Télécharger GPX » puis le drag-and-drop dans GPX Studio.
   ============================================================ */

function initGpxStudioConsultVisibility() {
    // Setup initial : caché par défaut (is-hidden dans le HTML).
    updateGpxStudioConsultVisibility();
}

function updateGpxStudioConsultVisibility() {
    const btn = document.getElementById('btn-open-gpx-studio-consult');
    if (!btn) return;

    // Visible UNIQUEMENT en consultation d'un circuit actif sans realTrack.
    // Hors consultation, data-show="consult" + le CSS du panneau circuit
    // gèrent déjà le hiding via data-mode. Mais on garantit is-hidden si
    // realTrack présent (cas où data-show="consult" serait actif).
    let shouldHide = true;
    if (state.activeCircuitId) {
        const circuit = getActiveCircuit();
        // Vol d'oiseau = realTrack absent ou vide → on AFFICHE le bouton.
        if (circuit && (!circuit.realTrack || circuit.realTrack.length === 0)) {
            shouldHide = false;
        }
    }
    btn.classList.toggle('is-hidden', shouldHide);
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

// Renomme un circuit DÉJÀ CHARGÉ (consultation) en préservant son ID. Persiste
// dans la bonne liste (officiel ou perso) + IDB, puis rafraîchit la liste.
// La trace réelle reste intacte (on ne passe pas par convertToDraft) → le CC
// Admin détecte le changement de nom et peut le publier sans re-tracer.
async function renameLoadedCircuit(id, name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return; // un circuit chargé garde toujours un nom

    const offIdx = (state.officialCircuits || []).findIndex(c => c.id === id);
    if (offIdx > -1) {
        const updated = { ...state.officialCircuits[offIdx], name: trimmed };
        const list = [...state.officialCircuits];
        list[offIdx] = updated;
        setOfficialCircuits(list);
        await saveCircuit(updated);
        eventBus.emit('circuit:list-updated');
        showToast('Circuit renommé.', 'success', 1500);
        return;
    }

    const myIdx = (state.myCircuits || []).findIndex(c => c.id === id);
    if (myIdx > -1) {
        const updated = { ...state.myCircuits[myIdx], name: trimmed };
        updateMyCircuit(updated);
        await saveCircuit(updated);
        eventBus.emit('circuit:list-updated');
        showToast('Circuit renommé.', 'success', 1500);
    }
}

function initTitleEdit() {
    const titleEl = document.getElementById('circuit-title-text');
    const editBtn = document.getElementById('cp-title-edit-btn');
    if (!titleEl) return;

    const enterEdit = (e) => {
        if (e) e.preventDefault();
        const panel = document.getElementById('circuit-panel');
        const mode = panel?.getAttribute('data-mode');
        // Édition autorisée : en création (brouillon), OU en consultation pour
        // l'admin (renommage inline d'un officiel/perso chargé, sans re-tracer).
        const isCreate = mode === 'create';
        const isAdminConsult = mode === 'consult' && state.isAdmin && !!state.activeCircuitId;
        if (!isCreate && !isAdminConsult) return;
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
            let newValue = cancel ? currentText : input.value.trim();
            // En consultation, un nom vide n'est pas autorisé (le circuit chargé
            // garde son nom) → on retombe sur l'ancien.
            if (!isCreate && !newValue) newValue = currentText;

            const h2 = document.createElement('h2');
            h2.id = 'circuit-title-text';
            h2.className = 'cp-title' + (newValue ? '' : ' is-empty');
            h2.textContent = newValue || 'Sans titre';
            h2.title = newValue || 'Sans titre';
            input.replaceWith(h2);

            if (!cancel && newValue !== currentText) {
                if (isCreate) {
                    setCustomDraftName(newValue || null);
                    saveCircuitDraft();
                } else {
                    // Consultation admin : renommage du circuit chargé (même ID).
                    renameLoadedCircuit(state.activeCircuitId, newValue);
                }
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
    if (display) {
        display.addEventListener('dblclick', enterEdit);
        // Bug 3 (07/06/2026) : sur mobile, le dblclick n'est pas un geste
        // naturel → on ajoute aussi un simple click. enterEdit teste de toute
        // façon `data-mode === 'create'` donc pas d'effet en consultation.
        display.addEventListener('click', enterEdit);
    }

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
