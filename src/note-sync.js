// note-sync.js — notes privées entre appareils (18/11/2026, point 3 des
// conflits, maquette « notes privées » validée par Stefan).
//
// Avant : une note n'était relue du dépôt que si l'appareil n'en avait pas ;
// le dernier qui enregistrait écrasait l'autre ; un envoi raté (terrain sans
// réseau) n'était jamais refait, malgré le message « réessayé plus tard ».
//
// Maintenant (décision : note-plan.js) :
//  - chaque note retient la version du dépôt sur laquelle elle est basée ;
//  - au démarrage et au retour du réseau, UNE lecture du dossier de la
//    destination donne toutes les versions ; seules les notes concernées sont
//    relues ou envoyées ;
//  - un envoi ne part que depuis une version connue : un fichier changé
//    ailleurs entre-temps est refusé par GitHub, et devient un conflit ;
//  - conflit : la note d'ici est gardée, la version du dépôt est mise de côté
//    (noteSync.remote) ; la fiche affiche un bandeau « Résoudre » (PC et téléphone).
// Réservé à qui a un jeton (l'admin) ; sans jeton, rien ne change.

import { state } from './state.js';
import { savePoiData } from './database.js';
import { getStoredToken } from './github-sync.js';
import { eventBus } from './events.js';
import { isOffline, onNetworkBack } from './network-status.js';
import { readNoteFile, listNoteFiles, writeNoteFile, removeNoteFile } from './private-notes.js';
import { decideNote, isPreRuleLegacyConflict } from './note-plan.js';

const KEY = 'noteSync';

const syncOf = (poiId) => state.userData?.[poiId]?.[KEY];
const localOf = (poiId) => String(state.userData?.[poiId]?.notes ?? '');

async function writeLocal(poiId, patch) {
    if (!state.userData[poiId]) state.userData[poiId] = {};
    Object.assign(state.userData[poiId], patch);
    const feature = state.loadedFeatures?.find(f => f?.properties?.HW_ID === poiId);
    if (feature) feature.properties.userData = state.userData[poiId];
    await savePoiData(state.currentMapId, poiId, patch);
}

const canSync = () => !!state.isAdmin && !!getStoredToken() && !!state.currentMapId;

/** Notes en conflit de la destination : [{ poiId, name }]. */
export function notesInConflict() {
    return Object.entries(state.userData || {})
        .filter(([, d]) => d?.[KEY]?.remote !== undefined)
        .map(([poiId]) => {
            const f = state.loadedFeatures?.find(x => x?.properties?.HW_ID === poiId);
            return { poiId, name: f?.properties?.['Nom du site FR'] || poiId };
        });
}

/**
 * Synchronise UNE note avec le dépôt : relit le fichier, décide, agit.
 * Ne lève pas : un échec réseau laisse la note « à envoyer » (dirty).
 * @returns {Promise<string>} l'action faite (ou 'error' / 'skipped')
 */
export async function syncNote(poiId, { retried = false } = {}) {
    if (!canSync()) return 'skipped';
    const mapId = state.currentMapId;
    if (syncOf(poiId)?.remote !== undefined) return 'conflict'; // en attente de résolution
    let remote;
    try { remote = await readNoteFile(mapId, poiId); }
    catch (e) { console.warn('[NoteSync] lecture impossible :', poiId, e.message); return 'error'; }

    const local = localOf(poiId);
    const sync = syncOf(poiId);
    const { action, base } = decideNote(local, sync, remote);
    try {
        if (action === 'adopt' || action === 'none') {
            await writeLocal(poiId, { [KEY]: { sha: remote?.sha ?? null, base: remote ? remote.text : '', dirty: false } });
        } else if (action === 'take') {
            await writeLocal(poiId, { notes: remote.text, [KEY]: { sha: remote.sha, base: remote.text, dirty: false } });
        } else if (action === 'clear') {
            await writeLocal(poiId, { notes: '', [KEY]: { sha: null, base: '', dirty: false } });
        } else if (action === 'push') {
            const text = local.trim();
            if (text) {
                const sha = await writeNoteFile(mapId, poiId, text, remote?.sha ?? null);
                await writeLocal(poiId, { [KEY]: { sha, base: text, dirty: false } });
            } else if (remote) {
                await removeNoteFile(mapId, poiId, remote.sha);
                await writeLocal(poiId, { [KEY]: { sha: null, base: '', dirty: false } });
            }
        } else if (action === 'conflict') {
            await writeLocal(poiId, { [KEY]: { ...(sync || {}), sha: sync?.sha ?? null, base: base ?? '', dirty: true, remote: remote.text, remoteSha: remote.sha, legacy: false } });
        }
    } catch (e) {
        // Fichier changé ailleurs entre la lecture et l'écriture : on recommence une fois.
        if (!retried && (e.status === 409 || e.status === 422)) return syncNote(poiId, { retried: true });
        console.warn('[NoteSync] envoi impossible (réessayé au retour du réseau) :', poiId, e.message);
        return 'error';
    }
    if (action !== 'none' && action !== 'adopt') eventBus.emit('notes:synced', { poiIds: [poiId] });
    return action;
}

/**
 * Après un enregistrement de la note ICI (fiche ou éditeur) : marquée « à
 * envoyer », puis envoyée si possible. La copie locale est déjà sauve.
 */
export async function noteEdited(poiId, text) {
    const sync = syncOf(poiId);
    // `text` : lieu tout juste créé, dont la note n'est encore que dans ses
    // propriétés → recopiée dans l'overlay, où vivent les notes.
    const patch = text !== undefined ? { notes: String(text) } : {};
    await writeLocal(poiId, { ...patch, [KEY]: { ...(sync || {}), dirty: true } });
    if (!canSync() || isOffline()) return 'pending';
    return syncNote(poiId);
}

/**
 * Conflit résolu : la version finale remplace la note, puis part vers le
 * dépôt depuis la version en conflit (qui devient le départ).
 */
export async function resolveNoteConflict(poiId, finalText) {
    const sync = syncOf(poiId);
    if (!sync || sync.remote === undefined) return 'none';
    await writeLocal(poiId, { notes: finalText, [KEY]: { sha: sync.remoteSha ?? null, base: sync.remote, dirty: true } });
    eventBus.emit('notes:synced', { poiIds: [poiId] }); // la fiche quitte le bandeau tout de suite
    if (!canSync() || isOffline()) return 'pending';
    return syncNote(poiId);
}

/**
 * Passe complète sur la destination : une lecture du dossier, puis seulement
 * les notes concernées (changées d'un côté, en attente d'envoi, jamais
 * synchronisées). Au démarrage et au retour du réseau.
 */
/**
 * Empreinte Git d'un texte (SHA-1 de « blob <taille>\0<contenu> ») : celle que
 * GitHub donne au fichier. Une note d'avant ce chantier identique au dépôt est
 * ainsi reconnue sans la relire (premier démarrage : une requête au lieu d'une
 * par note). null si le calcul n'est pas disponible.
 */
export async function gitBlobSha(text) {
    try {
        const body = new TextEncoder().encode(String(text ?? '').trim());
        const head = new TextEncoder().encode(`blob ${body.length}\0`);
        const all = new Uint8Array(head.length + body.length);
        all.set(head); all.set(body, head.length);
        const digest = await crypto.subtle.digest('SHA-1', all);
        return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
        return null;
    }
}

let _running = false;
export async function syncAllNotes() {
    const summary = { checked: 0, changed: 0, conflicts: 0, errors: 0, failed: false };
    if (!canSync() || isOffline() || _running) return { ...summary, failed: true };
    _running = true;
    try {
        let remoteShas;
        try { remoteShas = await listNoteFiles(state.currentMapId); }
        catch (e) { console.warn('[NoteSync] dossier illisible :', e.message); return { ...summary, failed: true }; }
        const ids = new Set([...remoteShas.keys()]);
        Object.entries(state.userData || {}).forEach(([id, d]) => { if (d?.notes || d?.[KEY]) ids.add(id); });
        const changed = [];
        for (const id of ids) {
            // Conflit d'une ancienne note, enregistré avant la règle « le dépôt
            // gagne » (19/11/2026) : rejoué avec elle (une fois).
            if (isPreRuleLegacyConflict(syncOf(id))) await writeLocal(id, { [KEY]: undefined });
            const sync = syncOf(id);
            if (sync?.remote !== undefined) continue;                     // conflit en attente
            const remoteSha = remoteShas.get(id) ?? null;
            const known = sync && sync.sha !== undefined;
            if (known && !sync.dirty && sync.sha === remoteSha) continue; // à jour
            if (!known && !localOf(id).trim() && !remoteSha) continue;   // rien des deux côtés
            // Note d'avant ce chantier, identique au dépôt : retenue sans relecture.
            if (!known && remoteSha && localOf(id).trim() && await gitBlobSha(localOf(id)) === remoteSha) {
                await writeLocal(id, { [KEY]: { sha: remoteSha, base: localOf(id).trim(), dirty: false } });
                summary.checked++;
                continue;
            }
            const action = await syncNote(id);
            summary.checked++;
            if (action === 'error') summary.errors++;
            else if (action === 'conflict') summary.conflicts++;
            else if (action !== 'none' && action !== 'adopt') summary.changed++;
            if (action !== 'none' && action !== 'adopt' && action !== 'error') changed.push(id);
        }
        if (changed.length) eventBus.emit('notes:synced', { poiIds: changed });
        return summary;
    } finally {
        _running = false;
    }
}

/** Note d'un candidat rejeté : retirée du dépôt (sans quoi elle y resterait orpheline). */
export async function forgetNote(poiId) {
    if (!canSync()) return;
    const sync = syncOf(poiId);
    if (!localOf(poiId).trim() && !sync?.sha) return;
    try { await removeNoteFile(state.currentMapId, poiId, sync?.sha || undefined); }
    catch (e) { if (e.status !== 404) console.warn('[NoteSync] note du candidat rejeté non retirée :', poiId, e.message); }
}

let _bound = false;
/** À appeler une fois au démarrage : passe immédiate + à chaque retour du réseau. */
export function initNoteSync() {
    if (!_bound) { _bound = true; onNetworkBack(() => { void syncAllNotes(); }); }
    void syncAllNotes();
}
