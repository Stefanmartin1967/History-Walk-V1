// ui-circuit-routing.js — UI du routing in-app (BRouter) dans le panneau circuit.
//
// Rend le « bloc tracé » (#circuit-trace-block) selon l'état du circuit en
// création/édition. UN seul bouton d'itinéraire contextuel (fusion validée
// 05/06/2026) :
//   • < 2 POIs            → rien
//   • ≥ 2 POIs, pas tracé → CTA « Tracer l'itinéraire » (auto-route BRouter)
//   • tracé réel présent  → carte d'état + « Éditer l'itinéraire » (focus mode)
//   • tracé PÉRIMÉ        → la séquence de POIs a changé → « Re-tracer » (le tracé
//                           est conservé mais signalé « à mettre à jour »)
//
// « Tracer » route le circuit SEGMENT PAR SEGMENT (circuit-routing.js), pose le
// realTrack et sauvegarde (en restant en création). Un segment non routable
// retombe en ligne droite (échec partiel) → note furet + segment pointillé.
// « Éditer l'itinéraire » ouvre le focus mode niveau 2 (circuit-focus.js).
// Handoff Claude Design 04/06/2026 + modèle cycle de vie du tracé 05/06/2026.
import { state } from './state.js';
import { routeCircuit } from './circuit-routing.js';
import { enterCircuitFocus, refreshFailOverlay } from './circuit-focus.js';
import { removeReferenceLayer, toggleReferenceLayer, hasReferenceLayer, isReferenceVisible, referenceLayerName } from './circuit-reference-layer.js';
import { saveAndExportCircuit } from './circuit-actions.js';
import { handleExportWithContribution } from './fileManager.js';
import { renderCircuitPanel, currentPoiKey } from './circuit.js';
import { updatePolylines } from './map.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { eventBus } from './events.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { configureHelp, helpInline } from './help-popover.js';
import { HELP_TRACER, HELP_CALQUE, HELP_STALE, HELP_WAYPOINT } from './help-content.js';

// Aide « ? » inline du bloc tracé : le patron rend l'icône via createIcons
// (idempotent — déjà configuré par ui-circuit-list / ui-photo-batch).
configureHelp({ renderIcons: (root) => createIcons({ icons: appIcons, root }) });

const BLOCK_ID = 'circuit-trace-block';
let tracing = false; // calcul BRouter en cours (évite les doubles clics)

function inCreation() {
    return state.isCircuitCreationMode || state.editingMode;
}
function activeCircuit() {
    if (!state.activeCircuitId) return null;
    // Les 2 listes : un officiel édité (convertToDraft) reste accessible côté
    // tracé même s'il n'est pas (encore) dans myCircuits.
    return [...(state.officialCircuits || []), ...(state.myCircuits || [])]
        .find(c => c.id === state.activeCircuitId) || null;
}
function hasRealTrack() {
    const c = activeCircuit();
    return !!(c && Array.isArray(c.realTrack) && c.realTrack.length >= 2);
}
// Segments en échec connus de la SESSION courante (Tracer/focus). Vide sur un
// circuit simplement chargé (l'état d'échec n'est pas persisté → « trace finale seule »).
function failedCount() {
    const segs = state.routeSegments;
    return Array.isArray(segs) ? segs.filter(s => s && !s.ok).length : 0;
}
// Tracé PÉRIMÉ : il existe mais la séquence de POIs a changé depuis qu'il a été
// posé (state.routeBasisKey, posé au Tracer / à l'entrée en édition).
function isStale() {
    return hasRealTrack() && state.routeBasisKey != null && currentPoiKey() !== state.routeBasisKey;
}

export function updateTraceBlock() {
    const el = document.getElementById(BLOCK_ID);
    if (!el) return;

    // Le bloc tracé n'a de sens qu'en création / édition.
    if (!inCreation()) { el.innerHTML = ''; updateRefButton(); return; }

    // Le chip « Calque de référence » s'affiche dans TOUS les états dès qu'un
    // calque est chargé (même à 0 POI : il guide la construction du circuit).
    const chip = referenceChipHtml();

    if (tracing) {
        el.innerHTML = `
            <button class="btn-trace" disabled>
                <span class="spin"></span><span>BRouter calcule l'itinéraire…</span>
            </button>` + chip;
    } else if (hasRealTrack()) {
        el.innerHTML = traceStatusHtml() + chip;
    } else if ((state.currentCircuit ? state.currentCircuit.length : 0) >= 2) {
        el.innerHTML = `
            <button class="btn-trace" id="btn-trace" type="button">
                <i data-lucide="navigation"></i><span>Tracer l'itinéraire</span>
            </button>
            <p class="trace-hint">
                <i data-lucide="info"></i>
                <span>BRouter suit les chemins piétons pour transformer le vol d'oiseau en trace marchable.</span>
            </p>` + chip;
    } else {
        el.innerHTML = chip; // 0-1 POI : juste le calque s'il est chargé
    }
    createIcons({ icons: appIcons, root: el });
    attachTraceHelp(el);
    updateRefButton();
}

// Synchronise le bouton « Calque » de la barre d'actions (état actif + tooltip).
function updateRefButton() {
    const btn = document.getElementById('btn-reference-layer');
    if (!btn) return;
    btn.classList.toggle('is-on', isReferenceVisible()); // .cp-act.is-on = teinte brand
    btn.title = hasReferenceLayer()
        ? `Calque : ${referenceLayerName()}${isReferenceVisible() ? '' : ' (masqué)'}`
        : 'Calque de référence (guide Wikiloc…)';
}

// Pose les « ? » contextuels du bloc tracé selon l'état rendu : chaque ancre
// n'apparaît que si son élément est présent. Ré-appelé à chaque updateTraceBlock
// (le bloc est re-rendu par innerHTML → les boutons sont recréés à chaque fois).
function attachTraceHelp(el) {
    const hint = el.querySelector('.trace-hint');
    if (hint) hint.appendChild(helpInline(HELP_TRACER, { size: 'sm' }));

    const stalePill = [...el.querySelectorAll('.trace-pill')]
        .find(p => /séquence modifiée/i.test(p.textContent || ''));
    if (stalePill) stalePill.insertAdjacentElement('afterend', helpInline(HELP_STALE, { size: 'sm' }));

    const failH5 = el.querySelector('.fail-note h5');
    if (failH5) failH5.appendChild(helpInline(HELP_WAYPOINT, { size: 'sm' }));

    const lcTxt = el.querySelector('.layer-chip .lc-txt');
    if (lcTxt) lcTxt.appendChild(helpInline(HELP_CALQUE, { size: 'sm' }));
}

// Menu « Plus » (⋮) — items = [{act,icon,t,d} | {sep:true}].
function morePopHtml(items) {
    const rows = items.map(it => it.sep
        ? '<div class="mp-sep"></div>'
        : `<button class="mp-item" type="button" data-act="${it.act}"><i data-lucide="${it.icon}"></i>` +
          `<span><span class="mp-t">${it.t}</span><span class="mp-d">${it.d}</span></span></button>`).join('');
    return `
        <div class="trace-more">
            <button class="btn-more" id="btn-more" type="button" title="Plus d'actions"><i data-lucide="more-vertical"></i></button>
            <div class="more-pop" id="more-pop">${rows}</div>
        </div>`;
}

const MP_GPX = { act: 'gpx', icon: 'external-link', t: 'Affiner dans GPX Studio', d: "Repli : montages spéciaux dans l'outil externe" };
const MP_EXPORT = { act: 'export', icon: 'download', t: 'Exporter le GPX', d: 'Fichier .gpx du tracé réel' };

const escHtml = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Chip « Calque de référence » (sous la carte d'état), si un GPX guide est chargé.
function referenceChipHtml() {
    if (!hasReferenceLayer()) return '';
    return `
        <div class="layer-chip">
            <span class="lc-dot"></span>
            <span class="lc-txt">Calque de référence<small>${escHtml(referenceLayerName())} · guide visuel</small></span>
            <button class="lc-remove" id="lc-remove" type="button" title="Retirer le calque"><i data-lucide="x"></i></button>
        </div>`;
}

// Carte d'état du tracé, selon 3 cas : périmé / échec partiel / OK.
function traceStatusHtml() {
    const distTxt = (document.getElementById('circuit-distance')?.textContent || '').trim();

    // ① Tracé PÉRIMÉ : la séquence de POIs a changé → re-tracer (le tracé est conservé).
    if (isStale()) {
        return `
        <div class="trace-status is-warn">
            <div class="trace-status-head">
                <div class="trace-status-ico"><i data-lucide="alert-triangle"></i></div>
                <div class="trace-status-txt">
                    <h4>Tracé à mettre à jour <span class="trace-pill">séquence modifiée</span></h4>
                    <p>La liste des lieux a changé — re-tracez pour mettre l'itinéraire à jour.</p>
                </div>
            </div>
            <div class="trace-status-actions">
                <button class="btn-adjust" id="btn-retrace-stale" type="button">
                    <i data-lucide="repeat"></i> Re-tracer l'itinéraire
                </button>
                ${morePopHtml([
                    { act: 'edit', icon: 'move', t: "Éditer l'itinéraire", d: 'Ajuster le tracé actuel sans re-tracer' },
                    { sep: true }, MP_GPX, MP_EXPORT,
                ])}
            </div>
        </div>`;
    }

    // ② Échec partiel (un/des segment(s) en ligne droite) · ③ Tracé OK.
    const nFail = failedCount();
    const warn = nFail > 0;
    const failTxt = nFail > 1 ? `${nFail} segments droits` : '1 segment droit';
    const subFail = nFail > 1 ? ` — sauf ${nFail} passages` : ' — sauf un passage';
    return `
        <div class="trace-status${warn ? ' is-warn' : ''}">
            <div class="trace-status-head">
                <div class="trace-status-ico"><i data-lucide="${warn ? 'info' : 'check-circle-2'}"></i></div>
                <div class="trace-status-txt">
                    <h4>${warn ? 'Tracé presque complet' : 'Itinéraire tracé'}
                        <span class="trace-pill">${warn ? failTxt : 'Tracé réel'}</span></h4>
                    <p>${distTxt ? distTxt + ' · ' : ''}suit les chemins piétons${warn ? subFail : ''}</p>
                </div>
            </div>
            <div class="trace-status-actions">
                <button class="btn-adjust" id="btn-adjust" type="button">
                    <i data-lucide="move"></i> Éditer l'itinéraire
                </button>
                ${morePopHtml([
                    { act: 'retrace', icon: 'repeat', t: "Re-tracer l'itinéraire", d: 'Recalcule depuis la séquence de POIs' },
                    { sep: true }, MP_GPX, MP_EXPORT,
                ])}
            </div>
        </div>
        ${warn ? failNote() : ''}`;
}

// Note furet « un passage est resté en ligne droite » (échec partiel).
function failNote() {
    return `
        <div class="fail-note">
            <img class="furet-mini" src="icons/icon-512-maskable.png" alt="">
            <div class="fn-body">
                <h5>Un passage est resté en ligne droite</h5>
                <p>BRouter n'a pas pu tracer un segment — il reste en ligne droite. Ajoutez un point de passage pour le guider, ou affinez dans GPX Studio.</p>
                <div class="fn-actions">
                    <button class="fn-link" type="button" data-act="fix"><i data-lucide="waypoints"></i> Ajouter un point de passage</button>
                    <button class="fn-link muted" type="button" data-act="gpx"><i data-lucide="external-link"></i> GPX Studio</button>
                </div>
            </div>
        </div>`;
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
        const { realTrack, segments, ascend } = await routeCircuit(state.currentCircuit);
        state.routeSegments = segments; // mémorise le découpage (focus + échec partiel)
        // Sauvegarde le circuit AVEC son tracé réel + son D+ BRouter, en création.
        await saveAndExportCircuit(realTrack, { stayInCreation: true, ascend });
        // Base de péremption posée APRÈS la sauvegarde : sur un 1er tracé,
        // saveAndExportCircuit crée le circuit et appelle setActiveCircuitId(), qui
        // remet routeBasisKey à null (state.js:212). La poser AVANT la rendait
        // inopérante → le badge « à re-tracer » / « séquence modifiée » ne sortait
        // jamais quand on changeait les lieux après coup. Même ordre que
        // circuit-focus.js (pose après l'édition du tracé).
        state.routeBasisKey = currentPoiKey(); // le tracé correspond à cette séquence
        tracing = false;
        updatePolylines();    // dessine le tracé bleu (real-track-polyline)
        refreshFailOverlay(); // segments en échec en pointillé (le cas échéant)
        renderCircuitPanel(); // breadcrumb (distance réelle) + déclenche updateTraceBlock via 'circuit:updated'
        const nFail = failedCount();
        if (nFail > 0) showToast(`Tracé calculé — ${nFail > 1 ? nFail + ' passages' : '1 passage'} en ligne droite`, 'info');
        else showToast('Itinéraire tracé ✓', 'success');
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

// Ouvre GPX Studio via l'ancre existante (deeplink conditionnel, cf.
// reference_no_gpx_studio_link) ; repli sur l'URL directe si absente.
function openGpxStudio() {
    const a = document.getElementById('btn-open-gpx-studio-consult');
    if (a) a.click();
    else window.open('https://gpx.studio/fr/app', '_blank', 'noopener');
}

function closeMorePop() {
    document.getElementById('more-pop')?.classList.remove('open');
}

export function initCircuitRoutingUI() {
    const el = document.getElementById(BLOCK_ID);
    if (el) {
        // Délégation : le conteneur est stable, seul son innerHTML est re-rendu.
        el.addEventListener('click', (e) => {
            if (e.target.closest('#btn-trace')) { runTrace(); return; }
            if (e.target.closest('#btn-adjust')) { enterCircuitFocus(); return; }
            // Tracé périmé : re-tracer directement (mise à jour attendue, pas de
            // confirmation « Remplacer ? » qui n'aurait pas de sens ici).
            if (e.target.closest('#btn-retrace-stale')) { runTrace(); return; }
            if (e.target.closest('#btn-more')) {
                e.stopPropagation();
                document.getElementById('more-pop')?.classList.toggle('open');
                return;
            }
            if (e.target.closest('#lc-remove')) { removeReferenceLayer(updateTraceBlock); return; }
            const mp = e.target.closest('.mp-item');
            if (mp) {
                closeMorePop();
                const act = mp.dataset.act;
                if (act === 'retrace') confirmRetrace();
                else if (act === 'edit') enterCircuitFocus();
                else if (act === 'export') handleExportWithContribution('gpx', () => eventBus.emit('request-export-gpx'));
                else if (act === 'gpx') openGpxStudio();
                return;
            }
            const fn = e.target.closest('.fn-link');
            if (fn) {
                if (fn.dataset.act === 'fix') enterCircuitFocus();
                else if (fn.dataset.act === 'gpx') openGpxStudio();
            }
        });
    }
    // Bouton « Calque de référence » de la barre d'actions (toujours visible en
    // création, même à 0 POI) : importe un GPX guide, ou bascule sa visibilité
    // s'il est déjà chargé. Le retrait définitif se fait via le ✕ du chip.
    const refBtn = document.getElementById('btn-reference-layer');
    if (refBtn) refBtn.addEventListener('click', () => toggleReferenceLayer(updateTraceBlock));

    // Ferme le menu « Plus » au clic extérieur.
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.trace-more')) closeMorePop();
    });
    // Re-render à chaque changement du circuit (ajout/retrait POI, chargement,
    // tracé). notifyCircuitChanged() émet 'circuit:updated' sur window.
    window.addEventListener('circuit:updated', updateTraceBlock);
    updateTraceBlock();
}
