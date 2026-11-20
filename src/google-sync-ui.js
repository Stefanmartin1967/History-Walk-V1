// google-sync-ui.js — quand et comment la synchronisation Google se montre
// (PR 6 « synchro users », maquette écrans 35-42 validée par Stefan le 20/11/2026).
// Moteur : google-sync.js. Liaison : google-account.js, google-link-ui.js.
//
// QUAND (écran 38, choix de Stefan : « premier toucher ») — sans serveur,
// l'accès Google dure une heure et ne se renouvelle que dans un geste du user :
//  - accès valable : chaque modification part quelques secondes après ; au retour
//    dans l'appli, on va chercher ce qui a changé ailleurs ;
//  - accès absent ou écoulé (en général à l'ouverture) : au PREMIER TOUCHER dans
//    l'appli, la petite fenêtre Google s'ouvre un instant et se referme seule,
//    puis on reçoit et on envoie ;
//  - pas d'Internet : on n'essaie pas. Fenêtre bloquée ou fermée : on n'insiste
//    pas avant une heure ; la partie Google passe « en attente » (écran 37).
// Jamais en mode admin (ses données suivent par GitHub).
//
// Un texte modifié sur deux appareils (écrans 39-40) : toast ordinaire avec
// « Choisir », point ambre sur la roue dentée et entrée « À choisir »
// tant qu'il en reste ; en attendant, la version de l'appareil reste affichée.

import { state } from './state.js';
import { eventBus } from './events.js';
import { escapeXml, calculateDistance } from './utils.js';
import { openHwModal, closeHwModal } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { mergeTexts } from './text-merge.js';
import { renderSentences, syncSentenceBoxes, applySentenceBox } from './sentence-picker.js';
import { writeChosenText } from './restore-apply.js';
import { setAttention } from './attention.js';
import { getLinkedAccount, hasGoogleAccess, renewGoogleAccess } from './google-account.js';
import { syncMap, syncAllMaps, getSyncConflicts, resolveSyncConflict, resolveCircuitChoice } from './google-sync.js';
import { openCircuitTrash } from './circuit-trash-ui.js';
import L from 'leaflet';
import { FIELD_DATES_KEY, PART_DATES_KEY } from './field-dates.js';

const LAST_KEY = 'hw_google_last_sync';      // date de la dernière synchronisation réussie
const PENDING_KEY = 'hw_google_pending';     // modifications pas encore envoyées
const FAIL_KEY = 'hw_google_last_fail';      // dernier essai raté (fenêtre bloquée / fermée)
const AUTO_KEY = 'hw_sync_auto_newest';      // '1' : garder la plus récente sans demander
const AUTO_ASKED_KEY = 'hw_sync_auto_asked'; // la case a déjà été montrée
const RETRY_AFTER_FAIL_MS = 60 * 60 * 1000;
const CHANGE_DEBOUNCE_MS = 5000;
const FOREGROUND_MIN_MS = 30000;

const LABELS = { description: 'Description', notes: 'Note', 'Description courte': 'Description courte', 'Nom du site FR': 'Nom' };
const labelOf = (key) => LABELS[key] || key;
// Pour une phrase : « La note de… », « Le nom de… » (le toast nommait le lieu
// au féminin, « fiche » sous-entendue : faux pour « Restaurant chez Moktar »).
const SUBJECTS = {
    description: ['La description', 'modifiée'],
    notes: ['La note', 'modifiée'],
    'Description courte': ['La description courte', 'modifiée'],
    'Nom du site FR': ['Le nom', 'modifié'],
};
/** « La note de « X » a été modifiée », « Le nom de « X » a été modifié ». */
export function changedSentence(key, place) {
    const [subject, participle] = SUBJECTS[key] || [`Le champ « ${key} »`, 'modifié'];
    return `${subject} de « ${place} » a été ${participle} sur deux appareils.`;
}

// Morceaux d'un circuit perso (PR 7, écrans 43-45).
const CIRCUIT_SUBJECTS = {
    name: ['Le nom du circuit', 'a été modifié'],
    description: ['La description du circuit', 'a été modifiée'],
    steps: ['Les étapes du circuit', 'ont été modifiées'],
    trace: ['Le tracé du circuit', 'a été modifié'],
};
const CIRCUIT_LABELS = { name: 'nom', description: 'description', steps: 'étapes', trace: 'tracé' };

/** « Les étapes du circuit « X » ont été modifiées sur deux appareils. » */
export function circuitChangedSentence(part, name) {
    const [subject, verb] = CIRCUIT_SUBJECTS[part] || ['Le circuit', 'a été modifié'];
    return `${subject} « ${name} » ${verb} sur deux appareils.`;
}

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch { /* rien */ } };

let running = null;          // synchronisation en cours (promesse)
let changeTimer = null;
let conflictCount = 0;       // destination ouverte, pour le menu du téléphone
let bound = false;
let lastError = '';       // détail du dernier échec, montré dans l'encadré

const active = () => !state.isAdmin && !!getLinkedAccount();

// ─── État affiché dans l'écran Sauvegarder ─────────────────────────────────

/** @returns {{ syncing:boolean, lastAt:number|null, pending:number, error:string }} */
export function getSyncStatus() {
    return {
        syncing: !!running,
        lastAt: Number(read(LAST_KEY)) || null,
        pending: Number(read(PENDING_KEY)) || 0,
        error: lastError,
    };
}

export function autoNewest() { return read(AUTO_KEY) === '1'; }
export function setAutoNewest(on) { write(AUTO_KEY, on ? '1' : '0'); write(AUTO_ASKED_KEY, '1'); }

/** Oublie l'état de la synchronisation (Déconnecter, Effacer). */
export function resetSyncStatus() {
    write(LAST_KEY, null); write(PENDING_KEY, null); write(FAIL_KEY, null);
    clearTimeout(changeTimer);
}

function emitStatus() { eventBus.emit('google:sync-status', getSyncStatus()); }

// ─── Synchroniser ───────────────────────────────────────────────────────────

/**
 * Lance une synchronisation (une seule à la fois). L'accès doit être valable.
 * @param {{all?:boolean}} [opts] all : toutes les destinations (première liaison)
 * @returns {Promise<Array|object|null>} résultat(s) de google-sync.js, null si échec
 */
export function runSync({ all = false } = {}) {
    if (running) return running.then(() => runSync({ all }));
    running = (async () => {
        lastError = '';
        emitStatus();
        try {
            const results = all ? await syncAllMaps() : [await syncMap(state.currentMapId)];
            const mine = results.find(r => r.mapId === state.currentMapId) || results[0];
            if (mine?.newConflicts?.length && autoNewest()) await autoResolve(state.currentMapId, mine.newConflicts);
            write(LAST_KEY, Date.now());
            write(PENDING_KEY, 0);
            write(FAIL_KEY, null);
            if (mine?.changed) refreshApp();
            await refreshSyncIndicators();
            if (!all && mine?.newConflicts?.length && !autoNewest()) announceConflicts(mine.newConflicts);
            const survivors = (all ? results : [mine]).flatMap(r => r?.mapId === state.currentMapId ? (r.survivors || []) : []);
            if (survivors.length) announceSurvivors(survivors);
            return all ? results : mine;
        } catch (e) {
            console.warn('[google-sync] synchronisation :', e);
            lastError = e?.detail || e?.message || String(e);
            return null;
        } finally {
            running = null;
            emitStatus();
        }
    })();
    return running;
}

/** Après une réception : carte, listes et fiche ouverte se redessinent. */
function refreshApp() {
    eventBus.emit('data:apply-filters');
    eventBus.emit('circuit:list-updated');
    eventBus.emit('userdata:synced', { poiIds: Object.keys(state.userData || {}) });
}

/** « Synchroniser maintenant » (dans un clic). */
export async function syncNowFromGesture() {
    if (!hasGoogleAccess()) {
        try { await renewGoogleAccess(); }
        catch (e) { write(FAIL_KEY, Date.now()); emitStatus(); throw e; }
    }
    return runSync();
}

/** Juste après « Relier » : toutes les destinations, puis le résumé (écran 35). */
export async function firstSyncAfterLink() {
    const results = await runSync({ all: true });
    if (!results) return { ok: false };
    const mine = results.find(r => r.mapId === state.currentMapId);
    if (mine && !mine.created && mine.summary) openFirstSummary(mine);
    return { ok: true, created: !!mine?.created, empty: !mine || (!mine.created && !mine.summary) };
}

// ─── Déclencheurs ───────────────────────────────────────────────────────────

function onLocalChange() {
    if (!active()) return;
    write(PENDING_KEY, (Number(read(PENDING_KEY)) || 0) + 1);
    emitStatus();
    if (!hasGoogleAccess()) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { void runSync(); }, CHANGE_DEBOUNCE_MS);
}

// Premier toucher : la demande à Google part DANS le geste (sinon bloquée).
function onFirstTouch(e) {
    if (!active() || running || hasGoogleAccess()) return;
    if (e?.target?.closest?.('#gl-mount')) return; // la partie Google demande l'accès elle-même
    if (navigator.onLine === false) return;
    const failedAt = Number(read(FAIL_KEY)) || 0;
    if (Date.now() - failedAt < RETRY_AFTER_FAIL_MS) return;
    renewGoogleAccess()
        .then(() => runSync())
        .catch((e) => {
            console.warn('[google-sync] accès non renouvelé :', e?.kind || e);
            write(FAIL_KEY, Date.now());
            emitStatus();
        });
}

function onForeground() {
    if (document.visibilityState !== 'visible' || !active() || !hasGoogleAccess() || running) return;
    if (Date.now() - (Number(read(LAST_KEY)) || 0) < FOREGROUND_MIN_MS) return;
    void runSync();
}

/** Au démarrage (utilisateur relié, hors admin). */
export async function initGoogleSync() {
    bindToolsMenuEntry();
    if (state.isAdmin) return;
    await refreshSyncIndicators();
    if (bound) return;
    bound = true;
    eventBus.on('sync:local-change', onLocalChange);
    document.addEventListener('click', onFirstTouch, true);
    document.addEventListener('visibilitychange', onForeground);
}

// ─── À choisir (textes et circuits) ─────────────────────────────────────────

/** Nombre de textes à choisir (destination ouverte), pour le menu du téléphone. */
export function syncConflictCount() { return conflictCount; }

/** Point ambre sur la roue dentée et entrée « À choisir » (PC). */
export async function refreshSyncIndicators() {
    const list = state.isAdmin ? [] : await getSyncConflicts(state.currentMapId);
    conflictCount = list.length;
    setAttention('sync', conflictCount > 0, 'choose');
    const entry = document.getElementById('btn-sync-conflicts');
    if (entry) {
        entry.classList.toggle('is-hidden', conflictCount === 0);
        const badge = entry.querySelector('.tools-menu-badge');
        if (badge) badge.textContent = String(conflictCount);
        entry.setAttribute('aria-label', `À choisir : ${conflictCount}`);
    }
}

let entryBound = false;
function bindToolsMenuEntry() {
    if (entryBound) return;
    const entry = document.getElementById('btn-sync-conflicts');
    if (!entry) return;
    entryBound = true;
    entry.addEventListener('click', () => {
        document.getElementById('tools-menu-content')?.classList.remove('active');
        void openSyncConflictsList();
    });
}

function placeName(id) {
    const f = (state.loadedFeatures || []).find(x => x?.properties?.HW_ID === id);
    return f?.properties?.['Nom du site FR'] || id;
}

const circuitOf = (id) => (state.myCircuits || []).find(c => String(c.id) === String(id));
const nameOf = (c) => (c.kind === 'circuit' ? (circuitOf(c.id)?.name || 'Circuit') : placeName(c.id));
const sentenceOf = (c) => (c.kind === 'circuit' ? circuitChangedSentence(c.key, nameOf(c)) : changedSentence(c.key, nameOf(c)));
const isTextChoice = (c) => c.kind !== 'circuit' || c.key === 'name' || c.key === 'description';

function announceConflicts(conflicts) {
    if (conflicts.length === 1) {
        const c = conflicts[0];
        const ask = isTextChoice(c) ? 'Choisissez le texte à garder.' : 'Choisissez la version à garder.';
        showToast(`${sentenceOf(c)} ${ask}`, 'warning', 10000,
            { label: 'Choisir', onClick: () => openChoose(c) });
        return;
    }
    showToast(`${conflicts.length} éléments ont été modifiés sur deux appareils. Choisissez ceux à garder.`, 'warning', 10000,
        { label: 'Choisir', onClick: () => { void openSyncConflictsList(); } });
}

/** Circuits gardés dans la Corbeille : supprimés ailleurs, modifiés ici après (écran 46). */
function announceSurvivors(survivors) {
    for (const c of survivors) {
        showToast(`Le circuit « ${c.name} » a été supprimé sur un autre appareil. Vous l'aviez modifié ici depuis : il est gardé dans la Corbeille.`, 'warning', 12000,
            { label: 'Voir', onClick: () => openCircuitTrash() });
    }
}

/** Fenêtre « À choisir » (écran 43) : textes et circuits ; un nom → la fenêtre de choix. */
export async function openSyncConflictsList() {
    const list = await getSyncConflicts(state.currentMapId);
    if (!list.length) { showToast('Plus rien à choisir.', 'info'); return; }
    const meta = (c) => (c.kind === 'circuit' ? `Circuit · ${CIRCUIT_LABELS[c.key] || c.key}` : labelOf(c.key));
    const body = `<div class="official-list">${list.map((c, i) => `
        <button class="official-list-row" type="button" data-sync-choose="${i}">
            <span class="official-list-text">
                <span class="official-list-name">${escapeXml(nameOf(c))}</span>
                <span class="official-list-meta">${escapeXml(meta(c))} · sur deux appareils</span>
            </span>
            <i data-lucide="chevron-right"></i>
        </button>`).join('')}</div>`;
    openHwModal({ size: 'md', icon: 'split', title: 'À choisir', body, footer: false, closeOnBackdrop: true });
    const root = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    createIcons({ icons: appIcons, root });
    root.querySelectorAll('[data-sync-choose]').forEach(b => b.addEventListener('click', () => openChoose(list[Number(b.dataset.syncChoose)])));
}

function formatWhen(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function hereDateOf(c) {
    if (c.kind === 'circuit') return circuitOf(c.id)?.[PART_DATES_KEY]?.[c.key] ?? circuitOf(c.id)?.updatedAt;
    if (c.kind === 'place') {
        const f = (state.customFeatures || []).find(x => x?.properties?.HW_ID === c.id);
        return f?.properties?.[FIELD_DATES_KEY]?.[c.key];
    }
    return state.userData?.[c.id]?.[FIELD_DATES_KEY]?.[c.key];
}

/** Fenêtre de choix (écran 40), même forme que pour la restauration. */
function openChoose(conflict, onDone) {
    if (conflict.kind === 'circuit' && conflict.key === 'steps') return openStepsChoose(conflict, onDone);
    if (conflict.kind === 'circuit' && conflict.key === 'trace') return openTraceChoose(conflict, onDone);
    const here = String(conflict.here ?? '');
    const theirs = String(conflict.file ?? '');
    const merged = mergeTexts('', here, theirs);
    const hereWhen = formatWhen(hereDateOf(conflict));
    const theirWhen = formatWhen(conflict.fileDate);
    const askAuto = read(AUTO_ASKED_KEY) !== '1';
    const body = `
        <section class="cc-conflict-field cc-note-conflict" data-kind="text">
            <p class="cc-conflict-intro">Ce texte a été modifié sur deux appareils. Cochez les phrases à garder.</p>
            <div class="cc-conflict-texts">
                <div class="cc-conflict-text">
                    <div class="cc-conflict-text-head"><span class="cc-conflict-swatch cc-conflict-swatch--local"></span>Sur cet appareil${hereWhen ? ` · ${escapeXml(hereWhen)}` : ''}</div>
                    <p class="cc-conflict-text-body cc-conflict-text-body--local">${renderSentences('', here, merged.text)}</p>
                    <button class="cc-diff-btn" type="button" data-sync-take="here">Tout reprendre de celle-ci</button>
                </div>
                <div class="cc-conflict-text">
                    <div class="cc-conflict-text-head"><span class="cc-conflict-swatch cc-conflict-swatch--online"></span>Autre appareil${theirWhen ? ` · ${escapeXml(theirWhen)}` : ''}</div>
                    <p class="cc-conflict-text-body cc-conflict-text-body--online">${renderSentences('', theirs, merged.text)}</p>
                    <button class="cc-diff-btn" type="button" data-sync-take="file">Tout reprendre de celle-ci</button>
                </div>
            </div>
            <div class="cc-conflict-final">
                <label class="cc-conflict-final-label" for="sync-final">Ce qui sera affiché</label>
                <textarea id="sync-final" class="cc-conflict-textarea" rows="5">${escapeXml(merged.text)}</textarea>
            </div>
            ${askAuto ? `<label class="sync-auto-ask"><input type="checkbox" id="sync-auto">La prochaine fois, garder automatiquement la version la plus récente</label>` : ''}
        </section>`;
    const footer = `
        <button class="btn btn-secondary" type="button" data-sync-later>Plus tard</button>
        <button class="btn btn-primary" type="button" data-sync-keep>Garder ce texte</button>`;
    const fieldName = conflict.kind === 'circuit' ? (conflict.key === 'name' ? 'Nom' : 'Description') : labelOf(conflict.key);
    openHwModal({ size: 'lg', icon: 'split', title: `${nameOf(conflict)} · ${fieldName}`, body, footer, closeOnBackdrop: false });
    const root = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    const field = root.querySelector('.cc-note-conflict');
    const ta = root.querySelector('#sync-final');
    if (!field || !ta) return;
    createIcons({ icons: appIcons, root: field });
    field.addEventListener('change', (e) => {
        if (!e.target.matches('input.cc-conflict-sentence')) return;
        applySentenceBox(e.target, ta);
        syncSentenceBoxes(field, ta);
    });
    ta.addEventListener('input', () => syncSentenceBoxes(field, ta));
    field.querySelectorAll('[data-sync-take]').forEach(b => b.addEventListener('click', () => {
        ta.value = b.dataset.syncTake === 'file' ? theirs : here;
        syncSentenceBoxes(field, ta);
    }));
    root.querySelector('[data-sync-later]')?.addEventListener('click', () => { closeHwModal(); onDone?.(); });
    root.querySelector('[data-sync-keep]')?.addEventListener('click', async () => {
        const auto = root.querySelector('#sync-auto');
        if (auto) setAutoNewest(auto.checked);
        await keepChoice(state.currentMapId, conflict, ta.value);
        closeHwModal();
        onDone?.();
    });
}

/** Écrit le texte choisi, le retire de la liste, et l'envoie si l'accès est là. */
async function keepChoice(mapId, conflict, text) {
    await writeChosenText(mapId, conflict, text);
    await resolveSyncConflict(mapId, conflict, text);
    await refreshSyncIndicators();
    write(PENDING_KEY, (Number(read(PENDING_KEY)) || 0) + 1);
    emitStatus();
    if (hasGoogleAccess()) void runSync();
}

/** « Garder automatiquement la plus récente » : chaque texte prend la version la plus récente. */
async function autoResolve(mapId, conflicts) {
    for (const c of conflicts) {
        const hereAt = hereDateOf(c) || 0;
        if (!isTextChoice(c)) {
            await resolveCircuitChoice(mapId, c, (c.fileDate || 0) > hereAt ? 'file' : 'here');
            continue;
        }
        const text = (c.fileDate || 0) > hereAt ? String(c.file ?? '') : String(c.here ?? '');
        await writeChosenText(mapId, c, text);
        await resolveSyncConflict(mapId, c, text);
    }
    await syncMap(mapId); // envoie les textes choisis
}

// ─── Étapes et tracé d'un circuit (écrans 44-45) ───────────────────────────

function trackKm(track) {
    if (!Array.isArray(track) || track.length < 2) return null;
    let m = 0;
    for (let i = 1; i < track.length; i++) m += calculateDistance(track[i - 1][0], track[i - 1][1], track[i][0], track[i][1]);
    return m;
}
const kmLabel = (m) => (m == null ? '' : ` · ${(m / 1000).toFixed(1).replace('.', ',')} km`);

/** Choix « cet appareil / l'autre / les deux » : écrit, retire de la liste, envoie. */
async function keepCircuitChoice(mapId, conflict, choice) {
    await resolveCircuitChoice(mapId, conflict, choice);
    await refreshSyncIndicators();
    eventBus.emit('circuit:list-updated');
    write(PENDING_KEY, (Number(read(PENDING_KEY)) || 0) + 1);
    emitStatus();
    if (hasGoogleAccess()) void runSync();
}

function bindCircuitFooter(root, conflict, onDone) {
    root.querySelector('[data-sync-later]')?.addEventListener('click', () => { closeHwModal(); onDone?.(); });
    root.querySelectorAll('[data-sync-pick]').forEach(b => b.addEventListener('click', async () => {
        const auto = root.querySelector('#sync-auto');
        if (auto) setAutoNewest(auto.checked);
        await keepCircuitChoice(state.currentMapId, conflict, b.dataset.syncPick);
        closeHwModal();
        onDone?.();
    }));
}

const autoAskHtml = () => (read(AUTO_ASKED_KEY) !== '1'
    ? '<label class="sync-auto-ask"><input type="checkbox" id="sync-auto">La prochaine fois, garder automatiquement la version la plus récente</label>' : '');

/**
 * Étapes modifiées des deux côtés (écran 44) : une version entière, pas étape par
 * étape ; le tracé suit. Une étape absente de l'autre version est marquée « en
 * plus » (sans la version de départ, on ne peut pas dire ajoutée ou retirée).
 */
function openStepsChoose(conflict, onDone) {
    const here = conflict.here || [];
    const theirs = conflict.file || [];
    const col = (list, other, cls, title, when, track) => `
        <section class="sync-steps-col">
            <h3 class="sync-steps-head sync-steps-head--${cls}">${title}${when ? ` · ${escapeXml(when)}` : ''}</h3>
            <ol class="sync-steps-list">${list.map(id => `
                <li class="${other.includes(id) ? '' : 'is-extra'}"><span>${escapeXml(placeName(id))}</span>${other.includes(id) ? '' : '<em>en plus</em>'}</li>`).join('')}</ol>
            <p class="sync-steps-sum">${list.length} étape${list.length > 1 ? 's' : ''}${kmLabel(trackKm(track))}</p>
        </section>`;
    const body = `
        <p class="cc-conflict-intro">Les étapes ont été modifiées sur deux appareils. Choisissez la version à garder ; le tracé suit.</p>
        <div class="sync-steps">
            ${col(here, theirs, 'here', 'Sur cet appareil', formatWhen(hereDateOf(conflict)), circuitOf(conflict.id)?.realTrack)}
            ${col(theirs, here, 'theirs', 'Autre appareil', formatWhen(conflict.fileDate), conflict.fileCircuit?.realTrack)}
        </div>
        ${autoAskHtml()}`;
    const footer = `
        <button class="btn btn-secondary sync-later" type="button" data-sync-later>Plus tard</button>
        <button class="btn btn-secondary" type="button" data-sync-pick="both">Garder les deux</button>
        <button class="btn btn-secondary" type="button" data-sync-pick="file">Garder celle de l'autre appareil</button>
        <button class="btn btn-primary" type="button" data-sync-pick="here">Garder celle de cet appareil</button>`;
    openHwModal({ size: 'lg', icon: 'split', title: `${nameOf(conflict)} · Étapes`, body, footer, closeOnBackdrop: false });
    const root = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    bindCircuitFooter(root, conflict, onDone);
}

/** Tracé retracé des deux côtés, mêmes étapes (écran 45) : les deux superposés. */
function openTraceChoose(conflict, onDone) {
    const here = circuitOf(conflict.id)?.realTrack || conflict.here || [];
    const theirs = conflict.file || [];
    const body = `
        <p class="cc-conflict-intro">Mêmes étapes, mais le chemin a été retracé sur deux appareils. Choisissez celui à garder.</p>
        <div class="sync-trace-map" id="sync-trace-map"></div>
        <div class="sync-trace-legend">
            <span><i class="sync-trace-key sync-trace-key--here"></i><b>Sur cet appareil</b>${hereDateOf(conflict) ? ` · ${escapeXml(formatWhen(hereDateOf(conflict)))}` : ''}${kmLabel(trackKm(here))}</span>
            <span><i class="sync-trace-key sync-trace-key--theirs"></i><b>Autre appareil</b>${conflict.fileDate ? ` · ${escapeXml(formatWhen(conflict.fileDate))}` : ''}${kmLabel(trackKm(theirs))}</span>
        </div>
        ${autoAskHtml()}`;
    const footer = `
        <button class="btn btn-secondary sync-later" type="button" data-sync-later>Plus tard</button>
        <button class="btn btn-secondary" type="button" data-sync-pick="file">Garder celui de l'autre appareil</button>
        <button class="btn btn-primary" type="button" data-sync-pick="here">Garder celui de cet appareil</button>`;
    openHwModal({ size: 'lg', icon: 'split', title: `${nameOf(conflict)} · Tracé`, body, footer, closeOnBackdrop: false });
    const root = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    bindCircuitFooter(root, conflict, onDone);
    const el = root.querySelector('#sync-trace-map');
    if (!el || (here.length < 2 && theirs.length < 2)) return;
    const mini = L.map(el, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap', maxZoom: 19, crossOrigin: true,
    }).addTo(mini);
    const lines = [];
    if (here.length >= 2) lines.push(L.polyline(here, { color: '#E0874F', weight: 5, opacity: 0.95 }).addTo(mini));
    if (theirs.length >= 2) lines.push(L.polyline(theirs, { color: '#4A90D9', weight: 5, opacity: 0.95, dashArray: '10 8' }).addTo(mini));
    const bounds = L.featureGroup(lines).getBounds();
    // La fenêtre vient de s'ouvrir : la carte mesure sa place, puis cadre les deux tracés.
    requestAnimationFrame(() => { mini.invalidateSize(); mini.fitBounds(bounds, { padding: [24, 24] }); });
}

// ─── Résumé de la première synchronisation (écran 35) ──────────────────────

function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }

function openFirstSummary(r) {
    const s = r.summary || {};
    const sent = r.sent || {};
    const added = [
        s.visits ? plural(s.visits, 'visite', 'visites') : '',
        s.notes ? plural(s.notes, 'note', 'notes') : '',
        s.places?.length ? `${plural(s.places.length, 'lieu créé', 'lieux créés')} (${escapeXml(s.places.slice(0, 3).join(', '))}${s.places.length > 3 ? '…' : ''})` : '',
        s.circuits?.length ? plural(s.circuits.length, 'circuit perso', 'circuits perso') : '',
    ].filter(Boolean);
    const sentList = [
        sent.visits ? plural(sent.visits, 'visite', 'visites') : '',
        sent.notes ? plural(sent.notes, 'note', 'notes') : '',
        sent.places ? plural(sent.places, 'lieu créé', 'lieux créés') : '',
        sent.updated ? plural(sent.updated, 'fiche modifiée', 'fiches modifiées') : '',
        sent.circuits ? plural(sent.circuits, 'circuit perso', 'circuits perso') : '',
    ].filter(Boolean);
    const updated = s.updated || [];
    const names = updated.slice(0, 3).map(placeName).join(', ') + (updated.length > 3 ? '…' : '');
    const row = (cls, icon, title, text) => `
        <section class="rs-row rs-row--${cls}">
            <span class="rs-ico"><i data-lucide="${icon}"></i></span>
            <span class="rs-row-text"><b>${title}</b><span>${text}</span></span>
        </section>`;
    const conflicts = r.conflicts || [];
    const body = `
        <div class="rs-stack">
            ${added.length ? row('added', 'plus', 'Ajouté depuis votre compte', added.join(' · ')) : ''}
            ${sentList.length ? row('updated', 'upload', 'Envoyé depuis cet appareil', sentList.join(' · ')) : ''}
            ${updated.length ? row('kept', 'refresh-cw', 'Mis à jour : plus récent dans votre compte', `${plural(updated.length, 'fiche', 'fiches')} · ${escapeXml(names)}`) : ''}
            ${!added.length && !sentList.length && !updated.length && !conflicts.length ? '<p class="rs-text">Rien de nouveau : cet appareil et votre compte avaient déjà les mêmes données.</p>' : ''}
            ${conflicts.length ? `
            <section class="rs-conflicts">
                <span class="rs-conflicts-head"><i data-lucide="alert-triangle"></i><span><b>${plural(conflicts.length, 'élément modifié', 'éléments modifiés')} des deux côtés</b><span>En attendant votre choix, la version de cet appareil est gardée.</span></span></span>
                ${conflicts.map((c, i) => `
                <div class="rs-conflict">
                    <span><b>${escapeXml(nameOf(c))}</b> · ${escapeXml(c.kind === 'circuit' ? `Circuit · ${CIRCUIT_LABELS[c.key] || c.key}` : labelOf(c.key))}</span>
                    <button class="btn btn-primary" type="button" data-sync-first-choose="${i}">Choisir</button>
                </div>`).join('')}
            </section>` : ''}
        </div>`;
    const footer = '<button class="btn btn-secondary" type="button" data-sync-done>Terminer</button>';
    const email = getLinkedAccount()?.email || '';
    openHwModal({
        size: 'md', icon: 'check-circle', title: 'Vos données sont réunies',
        subheader: `<p class="rs-sub">Cet appareil et votre compte Google${email ? ` · ${escapeXml(email)}` : ''}</p>`,
        body, footer, closeOnBackdrop: false,
    });
    const root = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    createIcons({ icons: appIcons, root });
    root.querySelector('[data-sync-done]')?.addEventListener('click', () => closeHwModal());
    root.querySelectorAll('[data-sync-first-choose]').forEach(b => b.addEventListener('click', () => {
        const c = conflicts[Number(b.dataset.syncFirstChoose)];
        openChoose(c, () => openFirstSummary({ ...r, conflicts: conflicts.filter(x => x !== c) }));
    }));
}
