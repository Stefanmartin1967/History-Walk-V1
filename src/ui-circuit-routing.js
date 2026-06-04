// ui-circuit-routing.js — UI du routing in-app (BRouter) dans le panneau circuit.
//
// Rend le « bloc tracé » (#circuit-trace-block) selon l'état du circuit en
// création/édition :
//   • < 2 POIs           → rien
//   • ≥ 2 POIs, pas tracé → CTA primaire « Tracer l'itinéraire »
//   • tracé réel présent  → carte d'état + « Re-tracer l'itinéraire »
//
// « Tracer » appelle BRouter (circuit-routing.js), pose le realTrack et
// sauvegarde le circuit (en restant en mode création pour ajuster). Le vol
// d'oiseau reste le repli si BRouter échoue. Handoff Claude Design 04/06/2026.
import { state } from './state.js';
import { routeCircuit } from './circuit-routing.js';
import { saveAndExportCircuit } from './circuit-actions.js';
import { renderCircuitPanel } from './circuit.js';
import { updatePolylines } from './map.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';

const BLOCK_ID = 'circuit-trace-block';
let tracing = false; // calcul BRouter en cours (évite les doubles clics)

function inCreation() {
    return state.isCircuitCreationMode || state.editingMode;
}
function activeCircuit() {
    return state.myCircuits.find(c => c.id === state.activeCircuitId) || null;
}
function hasRealTrack() {
    const c = activeCircuit();
    return !!(c && Array.isArray(c.realTrack) && c.realTrack.length >= 2);
}

export function updateTraceBlock() {
    const el = document.getElementById(BLOCK_ID);
    if (!el) return;

    // Le bloc tracé n'a de sens qu'en création / édition.
    if (!inCreation()) { el.innerHTML = ''; return; }

    if (tracing) {
        el.innerHTML = `
            <button class="btn-trace" disabled>
                <span class="spin"></span><span>BRouter calcule l'itinéraire…</span>
            </button>`;
        return;
    }

    if (hasRealTrack()) {
        const distTxt = (document.getElementById('circuit-distance')?.textContent || '').trim();
        el.innerHTML = `
            <div class="trace-status">
                <div class="trace-status-head">
                    <div class="trace-status-ico"><i data-lucide="check-circle-2"></i></div>
                    <div class="trace-status-txt">
                        <h4>Itinéraire tracé <span class="trace-pill">Tracé réel</span></h4>
                        <p>${distTxt ? distTxt + ' · ' : ''}suit les chemins piétons</p>
                    </div>
                </div>
                <div class="trace-status-actions">
                    <button class="btn-retrace" id="btn-retrace" type="button">
                        <i data-lucide="repeat"></i> Re-tracer l'itinéraire
                    </button>
                </div>
            </div>`;
    } else if ((state.currentCircuit ? state.currentCircuit.length : 0) >= 2) {
        el.innerHTML = `
            <button class="btn-trace" id="btn-trace" type="button">
                <i data-lucide="navigation"></i><span>Tracer l'itinéraire</span>
            </button>
            <p class="trace-hint">
                <i data-lucide="info"></i>
                <span>BRouter suit les chemins piétons pour transformer le vol d'oiseau en trace marchable.</span>
            </p>`;
    } else {
        el.innerHTML = '';
        return;
    }
    createIcons({ icons: appIcons, root: el });
}

async function runTrace() {
    if (tracing) return;
    if (!state.currentCircuit || state.currentCircuit.length < 2) {
        showToast('Ajoutez au moins 2 lieux pour tracer un itinéraire.', 'warning');
        return;
    }
    tracing = true;
    updateTraceBlock(); // spinner

    try {
        const { realTrack } = await routeCircuit(state.currentCircuit);
        // Sauvegarde le circuit AVEC son tracé réel, en restant en création.
        await saveAndExportCircuit(realTrack, { stayInCreation: true });
        tracing = false;
        updatePolylines();    // dessine le tracé bleu (real-track-polyline)
        renderCircuitPanel(); // breadcrumb (distance réelle) + déclenche updateTraceBlock via 'circuit:updated'
        showToast('Itinéraire tracé ✓', 'success');
    } catch (e) {
        tracing = false;
        console.error('[routing] runTrace a échoué :', e);
        showToast(e && e.message ? e.message : "BRouter n'a pas pu tracer l'itinéraire.", 'error');
        updateTraceBlock(); // restaure le bouton
    }
}

async function confirmRetrace() {
    const ok = await showConfirm(
        'Remplacer le tracé ?',
        'Ce circuit a déjà un tracé. Le re-tracer avec BRouter remplacera le tracé actuel.',
        'Remplacer', 'Conserver'
    );
    if (ok) runTrace();
}

export function initCircuitRoutingUI() {
    const el = document.getElementById(BLOCK_ID);
    if (el) {
        // Délégation : le conteneur est stable, seul son innerHTML est re-rendu.
        el.addEventListener('click', (e) => {
            if (e.target.closest('#btn-trace')) runTrace();
            else if (e.target.closest('#btn-retrace')) confirmRetrace();
        });
    }
    // Re-render à chaque changement du circuit (ajout/retrait POI, chargement,
    // tracé). notifyCircuitChanged() émet 'circuit:updated' sur window.
    window.addEventListener('circuit:updated', updateTraceBlock);
    updateTraceBlock();
}
