// circuit-view.js — V2 Onglet Circuit (consultation + création)
import { DOM } from './ui-dom.js';
import { openDetailsPanel } from './ui-details.js';
import { getPoiName, getPoiId } from './data.js';
import { state, setCurrentCircuit } from './state.js';
import { sanitizeHTML, escapeXml } from './utils.js';
import { showToast } from './toast.js';
import { createIcons, appIcons } from './lucide-icons.js';
import Sortable from 'sortablejs';

/**
 * Mappe une catégorie POI vers une icône lucide + variante de couleur pour
 * la pastille step-cat. Defaut : map-pin (générique, gris).
 */
function getCategoryDisplay(feature) {
    const cat = feature?.properties?.['Catégorie']
        || feature?.properties?.userData?.['Catégorie']
        || '';

    const lower = cat.toLowerCase();
    // Cohérence avec Mes Circuits : pastilles toutes en gris (--surface-muted) par défaut.
    // Seuls resto et café gardent l'ambre (cohérent avec la pastille "Resto" de Mes Circuits).
    if (lower === 'restaurant') return { icon: 'utensils', label: 'Restaurant', cls: 'amber' };
    if (lower === 'café' || lower === 'cafe') return { icon: 'coffee', label: cat, cls: 'amber' };
    if (lower === 'mosquée' || lower === 'mosquee') return { icon: 'moon-star', label: cat, cls: '' };
    if (lower === 'synagogue') return { icon: 'moon-star', label: cat, cls: '' };
    if (lower === 'église' || lower === 'eglise') return { icon: 'landmark', label: cat, cls: '' };
    if (lower === 'fontaine') return { icon: 'droplets', label: cat, cls: '' };
    if (lower === 'place' || lower === 'place historique') return { icon: 'landmark', label: cat, cls: '' };
    if (lower === 'forteresse' || lower === 'borj' || lower === 'tour de guet') return { icon: 'castle', label: cat, cls: '' };
    if (lower === 'panorama' || lower === 'point de vue') return { icon: 'mountain', label: cat, cls: '' };
    if (lower === 'plage') return { icon: 'image', label: cat, cls: '' };
    if (lower === 'marché' || lower === 'marche' || lower === 'souk') return { icon: 'shopping-cart', label: cat, cls: '' };
    if (lower === 'phare') return { icon: 'lightbulb', label: cat, cls: '' };
    if (lower === 'caravansérail' || lower === 'fondouk' || lower === 'quartier') return { icon: 'building', label: cat, cls: '' };
    if (lower === 'artisanat') return { icon: 'wrench', label: cat, cls: '' };
    if (lower === 'nature' || lower === 'palmeraie') return { icon: 'sprout', label: cat, cls: '' };
    return { icon: 'map-pin', label: cat || 'Lieu', cls: '' };
}

/**
 * Génère une étape de timeline V2.
 * En consultation : juste num + body + cat (read-only)
 * En création : handle + num + body + cat + actions (chevrons + remove)
 */
function createStepElement(feature, index, totalPoints, callbacks, isOfficial) {
    const poiName = getPoiName(feature);
    const cat = getCategoryDisplay(feature);
    const isCreate = !state.activeCircuitId
        || (state.activeCircuitId && !isOfficial); // perso → édition possible

    const a = document.createElement('a');
    a.className = 'timeline-step';
    a.href = '#';
    a.dataset.index = String(index);

    let html = '';

    if (isCreate) {
        html += `<span class="step-handle" title="Faire glisser pour réordonner"><i data-lucide="grip-vertical"></i></span>`;
    }

    html += `<div class="step-num">${index + 1}</div>`;
    html += `<div class="step-body">`;
    html += `<div class="step-name">${escapeXml(poiName)}</div>`;
    html += `<span class="step-cat${cat.cls ? ' ' + cat.cls : ''}"><i data-lucide="${cat.icon}"></i>${escapeXml(cat.label)}</span>`;
    html += `</div>`;

    if (isCreate) {
        const upDisabled = index === 0 ? 'is-disabled' : '';
        const downDisabled = index === totalPoints - 1 ? 'is-disabled' : '';
        html += `<div class="step-actions">
            <button class="sa-btn ${upDisabled}" data-action="up" title="Monter" aria-label="Monter"><i data-lucide="chevron-up"></i></button>
            <button class="sa-btn ${downDisabled}" data-action="down" title="Descendre" aria-label="Descendre"><i data-lucide="chevron-down"></i></button>
            <button class="sa-btn danger" data-action="remove" title="Retirer du circuit" aria-label="Retirer du circuit"><i data-lucide="trash-2"></i></button>
        </div>`;
    }

    a.innerHTML = sanitizeHTML(html);

    // Listeners
    a.addEventListener('click', (e) => {
        // Ignore les clics sur les boutons d'action et le handle
        if (e.target.closest('.step-actions') || e.target.closest('.step-handle')) return;
        e.preventDefault();
        callbacks.onDetails(feature, index);
    });

    if (isCreate) {
        const actionsEl = a.querySelector('.step-actions');
        if (actionsEl) {
            actionsEl.addEventListener('click', (e) => {
                const btn = e.target.closest('.sa-btn');
                if (!btn || btn.classList.contains('is-disabled')) return;
                e.preventDefault();
                e.stopPropagation();
                callbacks.onAction(btn.dataset.action, index);
            });
        }
    }

    return a;
}

/**
 * Rendu complet de la timeline POIs.
 * En empty state (mode création + 0 POI), affiche le placeholder "crosshair + CTA".
 */
export function renderCircuitList(points, callbacks, isOfficial = false) {
    if (!DOM.circuitStepsList) return;
    DOM.circuitStepsList.innerHTML = '';

    const isCreateMode = !state.activeCircuitId;

    if (points.length === 0) {
        if (isCreateMode) {
            // Empty state V2 : icône route + invitation à cliquer sur les POIs de la carte
            DOM.circuitStepsList.innerHTML = sanitizeHTML(`
                <div class="timeline-empty">
                    <div class="ico-bubble"><i data-lucide="route"></i></div>
                    <h4>Commençons par le premier lieu</h4>
                    <p>Cliquez sur un lieu de la carte pour ouvrir sa fiche, puis ajoutez-le au circuit depuis l'onglet Détails.</p>
                </div>
            `);
        } else {
            DOM.circuitStepsList.innerHTML = `<p class="empty-list-info">Aucun POI dans ce circuit.</p>`;
        }
    } else {
        // Étapes header
        const cap = document.createElement('div');
        cap.className = 'circuit-timeline-cap';
        cap.innerHTML = sanitizeHTML(`<span>Étapes</span><span class="count">${points.length} POI${points.length > 1 ? 's' : ''}</span>`);
        DOM.circuitStepsList.appendChild(cap);

        points.forEach((feature, index) => {
            const stepEl = createStepElement(feature, index, points.length, callbacks, isOfficial);
            DOM.circuitStepsList.appendChild(stepEl);
        });
    }

    createIcons({ icons: appIcons });

    // Drag and drop (Sortable.js) en mode création uniquement
    initTimelineDrag();
}

let _sortableInstance = null;

function initTimelineDrag() {
    // Mode création uniquement
    if (state.activeCircuitId) {
        if (_sortableInstance) {
            _sortableInstance.destroy();
            _sortableInstance = null;
        }
        return;
    }
    if (!DOM.circuitStepsList) return;

    // Détruire l'instance précédente avant de re-créer (chaque renderCircuitList crée
    // un nouveau DOM, l'ancienne instance pointe sur des nodes obsolètes)
    if (_sortableInstance) {
        try { _sortableInstance.destroy(); } catch (e) {}
        _sortableInstance = null;
    }

    _sortableInstance = Sortable.create(DOM.circuitStepsList, {
        handle: '.step-handle',
        animation: 180,
        chosenClass: 'is-dragging',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        // Empêche le drag sur la cap (.circuit-timeline-cap) et l'empty state
        filter: '.circuit-timeline-cap, .timeline-empty',
        preventOnFilter: false,
        onEnd: async (evt) => {
            const oldIdx = evt.oldIndex;
            const newIdx = evt.newIndex;
            if (oldIdx === undefined || newIdx === undefined || oldIdx === newIdx) return;

            // Compense le décalage du cap (premier child = .circuit-timeline-cap)
            // Si le cap est inclus dans les indices, ajuster.
            const cap = DOM.circuitStepsList.querySelector('.circuit-timeline-cap');
            const capIdx = cap ? Array.from(DOM.circuitStepsList.children).indexOf(cap) : -1;

            const adjOld = capIdx !== -1 && oldIdx > capIdx ? oldIdx - 1 : oldIdx;
            const adjNew = capIdx !== -1 && newIdx > capIdx ? newIdx - 1 : newIdx;

            // Réordonne state.currentCircuit
            const arr = [...state.currentCircuit];
            const [moved] = arr.splice(adjOld, 1);
            arr.splice(adjNew, 0, moved);
            setCurrentCircuit(arr);

            // Sauvegarde brouillon + re-render (renumérote les steps)
            const { saveCircuitDraft, renderCircuitPanel } = await import('./circuit.js');
            await saveCircuitDraft();
            renderCircuitPanel();
        },
    });
}

/**
 * Détermine le mode + flag du panneau et pose les data-attrs.
 * Cette fonction est le pivot V2 : elle décide quoi afficher.
 */
export function applyCircuitMode(opts = {}) {
    const panel = document.getElementById('circuit-panel');
    if (!panel) return;

    // Mode : consult (circuit chargé) ou create (brouillon en cours)
    const isConsult = !!state.activeCircuitId && !opts.forceCreate;
    panel.setAttribute('data-mode', isConsult ? 'consult' : 'create');

    // Flag : determine selon le circuit actif
    let flag = 'perso';
    if (isConsult) {
        const isOfficial = state.officialCircuits
            && state.officialCircuits.some(c => c.id === state.activeCircuitId);
        if (isOfficial) {
            const isTested = state.testedCircuits && state.testedCircuits[state.activeCircuitId];
            flag = isTested ? 'verified' : 'official';
        } else {
            flag = 'perso';
        }
    }
    panel.setAttribute('data-flag', flag);
}

/**
 * Met à jour l'identité du circuit dans l'UI V2 :
 * cp-mode-tag, cp-breadcrumb (zone, n POI, distance, fait), cp-title, cp-flag.
 */
export function updateCircuitHeader(data) {
    // 1. Pose data-mode/data-flag
    applyCircuitMode();

    const panel = document.getElementById('circuit-panel');
    const isConsult = panel?.getAttribute('data-mode') === 'consult';
    const flag = panel?.getAttribute('data-flag') || 'perso';

    // 2. Tag mode (Brouillon / Édition / -)
    const tagText = document.getElementById('cp-mode-tag-text');
    if (tagText) {
        if (isConsult) {
            // Tag masqué via CSS data-mode="consult"
            tagText.textContent = '';
        } else {
            tagText.textContent = state.activeCircuitId
                ? 'Édition · auto-sauvegardé'
                : 'Brouillon · auto-sauvegardé';
        }
    }

    // 3. Breadcrumb : zone · n POI · X km
    const zoneText = document.getElementById('cp-zone-text');
    const zoneSep = document.getElementById('cp-zone-sep');
    const zoneName = data.zoneName || '';
    if (zoneText) {
        zoneText.textContent = zoneName;
        if (zoneSep) zoneSep.hidden = !zoneName;
    }
    if (DOM.circuitPoiCount) {
        const n = state.currentCircuit.length;
        DOM.circuitPoiCount.textContent = `${n} POI${n > 1 ? 's' : ''}`;
    }
    if (DOM.circuitDistance) {
        DOM.circuitDistance.textContent = data.distanceText || '0 km';
    }

    // 4. Titre — placeholder "Sans titre" en italique si pas de vrai titre
    if (DOM.circuitTitleText) {
        const isPlaceholder = !data.title || data.title === 'Nouveau Circuit';
        const display = isPlaceholder ? 'Sans titre' : data.title;
        DOM.circuitTitleText.textContent = display;
        DOM.circuitTitleText.title = display;
        DOM.circuitTitleText.classList.toggle('is-empty', isPlaceholder);
    }

    // 5. Flag textuel (Officiel · Vérifié)
    const flagEl = document.getElementById('cp-flag');
    const flagText = document.getElementById('cp-flag-text');
    if (flagEl && flagText) {
        if (flag === 'official') {
            flagText.textContent = 'Officiel';
            flagEl.hidden = false;
        } else if (flag === 'verified') {
            flagText.textContent = 'Officiel · vérifié';
            flagEl.hidden = false;
        } else {
            flagEl.hidden = true;
        }
    }

    // 6. Description : si on a une description en consultation, on l'affiche.
    const descDisplay = document.getElementById('circuit-description-display');
    const descPlaceholder = document.getElementById('circuit-desc-placeholder');
    const descTextarea = document.getElementById('circuit-description');
    if (descDisplay && descPlaceholder && descTextarea) {
        const description = (data.description || '').trim();
        if (isConsult) {
            // Consultation : affiche le <p>, masque placeholder + textarea
            descDisplay.textContent = description;
            descDisplay.hidden = !description;
            descPlaceholder.hidden = true;
            descTextarea.hidden = true;
        } else {
            // Création : si description vide → placeholder, sinon → desc-text cliquable
            descTextarea.value = description;
            if (description) {
                descDisplay.textContent = description;
                descDisplay.hidden = false;
                descPlaceholder.hidden = true;
            } else {
                descDisplay.hidden = true;
                descPlaceholder.hidden = false;
            }
            descTextarea.hidden = true;
        }
    }

    // 7. Bouton "Supprimer ce circuit" (consultation perso)
    const btnDelete = document.getElementById('btn-delete-active-circuit');
    if (btnDelete) {
        btnDelete.classList.toggle('is-hidden', !state.activeCircuitId);
    }

    createIcons({ icons: appIcons });
}

/**
 * Compat : hook pour la mise à jour des boutons de contrôle.
 * Avec la V2, le show/hide est piloté par CSS data-mode/data-show — donc
 * on n'a plus besoin de gérer manuellement loop/clear/modify, etc.
 * Reste seulement à griser les actions disabled selon l'état.
 */
export function updateControlButtons(uiState) {
    // Boucler désactivé si <2 POIs ou >=MAX
    const btnLoop = document.getElementById('btn-loop-circuit');
    if (btnLoop) {
        btnLoop.classList.toggle('is-disabled', uiState.cannotLoop);
    }

    // Sauver+Exporter désactivé si vide
    const btnExport = document.getElementById('btn-export-gpx');
    if (btnExport) {
        btnExport.classList.toggle('is-disabled', uiState.isEmpty);
    }

    // Importer GPX désactivé si vide (besoin d'un circuit pour matcher la trace)
    const btnImport = document.getElementById('btn-import-gpx');
    if (btnImport) {
        btnImport.classList.toggle('is-disabled', uiState.isEmpty);
    }
}

/**
 * Compat : updateCircuitForm (utilisée pour remplir les inputs en mode édition)
 */
export function updateCircuitForm(data) {
    if (DOM.circuitTitleText) DOM.circuitTitleText.textContent = data.name || 'Sans titre';
    if (DOM.circuitDescription) DOM.circuitDescription.value = data.description || '';

    const fields = {
        'transport-aller-temps': data.transport?.allerTemps,
        'transport-aller-cout': data.transport?.allerCout,
        'transport-retour-temps': data.transport?.retourTemps,
        'transport-retour-cout': data.transport?.retourCout
    };

    for (const [id, value] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    }

    updateTransportSummary();
}

/**
 * Calcule et met à jour le résumé "X min · Y TND" en haut de l'accordion transport.
 */
export function updateTransportSummary() {
    const summary = document.getElementById('transport-summary');
    if (!summary) return;

    const get = (id) => Number(document.getElementById(id)?.value) || 0;
    const allerMin = get('transport-aller-temps');
    const retourMin = get('transport-retour-temps');
    const allerCost = get('transport-aller-cout');
    const retourCost = get('transport-retour-cout');

    const totalMin = allerMin + retourMin;
    const totalCost = allerCost + retourCost;

    if (totalMin === 0 && totalCost === 0) {
        summary.classList.add('is-empty');
        summary.textContent = '— non renseigné';
    } else {
        summary.classList.remove('is-empty');
        const currency = getCurrentCurrency();
        const parts = [];
        if (totalMin > 0) parts.push(`${totalMin} min`);
        if (totalCost > 0) parts.push(`${totalCost}${currency ? ' ' + currency : ''}`);
        summary.textContent = parts.join(' · ');
    }
}

function getCurrentCurrency() {
    if (!state.currentMapId || !state.destinations || !state.destinations.maps?.[state.currentMapId]) {
        return '';
    }
    return state.destinations.maps[state.currentMapId].currency || '';
}

/**
 * Met à jour les unités de devise (data-currency-unit) selon la destination.
 * Appelé au boot et quand on change de destination.
 */
export function updateCurrencyUnits() {
    const currency = getCurrentCurrency();
    if (!currency) return;
    document.querySelectorAll('[data-currency-unit]').forEach(el => {
        el.textContent = currency;
    });
}
