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
// « Choisir », point ambre sur la roue dentée et entrée « Textes à choisir »
// tant qu'il en reste ; en attendant, la version de l'appareil reste affichée.

import { state } from './state.js';
import { eventBus } from './events.js';
import { escapeXml } from './utils.js';
import { openHwModal, closeHwModal } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { mergeTexts } from './text-merge.js';
import { renderSentences, syncSentenceBoxes, applySentenceBox } from './sentence-picker.js';
import { writeChosenText } from './restore-apply.js';
import { setAttention } from './attention.js';
import { getLinkedAccount, hasGoogleAccess, renewGoogleAccess } from './google-account.js';
import { syncMap, syncAllMaps, getSyncConflicts, resolveSyncConflict } from './google-sync.js';
import { FIELD_DATES_KEY } from './field-dates.js';

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

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch { /* rien */ } };

let running = null;          // synchronisation en cours (promesse)
let changeTimer = null;
let conflictCount = 0;       // destination ouverte, pour le menu du téléphone
let bound = false;

const active = () => !state.isAdmin && !!getLinkedAccount();

// ─── État affiché dans l'écran Sauvegarder ─────────────────────────────────

/** @returns {{ syncing:boolean, lastAt:number|null, pending:number }} */
export function getSyncStatus() {
    return {
        syncing: !!running,
        lastAt: Number(read(LAST_KEY)) || null,
        pending: Number(read(PENDING_KEY)) || 0,
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
        emitStatus();
        try {
            const results = all ? await syncAllMaps() : [await syncMap(state.currentMapId)];
            const mine = results.find(r => r.mapId === state.currentMapId) || results[0];
            if (mine?.conflicts?.length && autoNewest()) await autoResolve(state.currentMapId, mine.conflicts);
            write(LAST_KEY, Date.now());
            write(PENDING_KEY, 0);
            write(FAIL_KEY, null);
            if (mine?.changed) refreshApp();
            await refreshSyncIndicators();
            if (!all && mine?.conflicts?.length && !autoNewest()) announceConflicts(mine.conflicts);
            return all ? results : mine;
        } catch (e) {
            console.warn('[google-sync] synchronisation :', e);
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

// ─── Textes à choisir ───────────────────────────────────────────────────────

/** Nombre de textes à choisir (destination ouverte), pour le menu du téléphone. */
export function syncConflictCount() { return conflictCount; }

/** Point ambre sur la roue dentée et entrée « Textes à choisir » (PC). */
export async function refreshSyncIndicators() {
    const list = state.isAdmin ? [] : await getSyncConflicts(state.currentMapId);
    conflictCount = list.length;
    setAttention('sync', conflictCount > 0, 'choose');
    const entry = document.getElementById('btn-sync-conflicts');
    if (entry) {
        entry.classList.toggle('is-hidden', conflictCount === 0);
        const badge = entry.querySelector('.tools-menu-badge');
        if (badge) badge.textContent = String(conflictCount);
        entry.setAttribute('aria-label', `Textes à choisir : ${conflictCount}`);
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

function announceConflicts(conflicts) {
    if (conflicts.length === 1) {
        const c = conflicts[0];
        showToast(`« ${placeName(c.id)} » a été modifiée sur deux appareils. Choisissez le texte à garder.`, 'warning', 10000,
            { label: 'Choisir', onClick: () => openChoose(c) });
        return;
    }
    showToast(`${conflicts.length} textes ont été modifiés sur deux appareils. Choisissez ceux à garder.`, 'warning', 10000,
        { label: 'Choisir', onClick: () => { void openSyncConflictsList(); } });
}

/** Fenêtre « Textes à choisir » : un nom → la fenêtre de choix. */
export async function openSyncConflictsList() {
    const list = await getSyncConflicts(state.currentMapId);
    if (!list.length) { showToast('Aucun texte à choisir.', 'info'); return; }
    const body = `<div class="official-list">${list.map((c, i) => `
        <button class="official-list-row" type="button" data-sync-choose="${i}">
            <span class="official-list-text">
                <span class="official-list-name">${escapeXml(placeName(c.id))}</span>
                <span class="official-list-meta">${escapeXml(labelOf(c.key))} · modifié sur deux appareils</span>
            </span>
            <i data-lucide="chevron-right"></i>
        </button>`).join('')}</div>`;
    openHwModal({ size: 'md', icon: 'split', title: 'Textes à choisir', body, footer: false, closeOnBackdrop: true });
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
    if (c.kind === 'place') {
        const f = (state.customFeatures || []).find(x => x?.properties?.HW_ID === c.id);
        return f?.properties?.[FIELD_DATES_KEY]?.[c.key];
    }
    return state.userData?.[c.id]?.[FIELD_DATES_KEY]?.[c.key];
}

/** Fenêtre de choix (écran 40), même forme que pour la restauration. */
function openChoose(conflict, onDone) {
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
    openHwModal({ size: 'lg', icon: 'split', title: `${placeName(conflict.id)} · ${labelOf(conflict.key)}`, body, footer, closeOnBackdrop: false });
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
        const text = (c.fileDate || 0) > hereAt ? String(c.file ?? '') : String(c.here ?? '');
        await writeChosenText(mapId, c, text);
        await resolveSyncConflict(mapId, c, text);
    }
    await syncMap(mapId); // envoie les textes choisis
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
    ].filter(Boolean);
    const sentList = [
        sent.visits ? plural(sent.visits, 'visite', 'visites') : '',
        sent.notes ? plural(sent.notes, 'note', 'notes') : '',
        sent.places ? plural(sent.places, 'lieu créé', 'lieux créés') : '',
        sent.updated ? plural(sent.updated, 'fiche modifiée', 'fiches modifiées') : '',
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
                <span class="rs-conflicts-head"><i data-lucide="alert-triangle"></i><span><b>${plural(conflicts.length, 'texte modifié', 'textes modifiés')} des deux côtés</b><span>En attendant votre choix, la version de cet appareil est gardée.</span></span></span>
                ${conflicts.map((c, i) => `
                <div class="rs-conflict">
                    <span><b>${escapeXml(placeName(c.id))}</b> · ${escapeXml(labelOf(c.key))}</span>
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
