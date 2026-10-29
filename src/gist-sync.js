// gist-sync.js
// Synchronisation du userData personnel via GitHub Gist.
// Chaque utilisateur stocke son propre Gist ID dans localStorage.
// Le token PAT (scope "gist") est partagé avec github-sync.js.
//
// Format 2 (29/10/2026) : UNE SECTION PAR DESTINATION, `{ format: 2, maps: {
// djerba: {...}, charleroi: {...} } }`. Le format 1 ne portait qu'une
// destination (`mapId` à la racine) : chaque envoi depuis une autre destination
// remplaçait tout le contenu du Gist. Désormais l'envoi RELIT le Gist et ne
// réécrit que la section de la destination active ; les autres sont recopiées
// telles quelles. Un Gist au format 1 est lu comme la section de son `mapId`.

import { state, setOfficialCircuitStatus, setOfficialCircuitsStatusUpdatedAt, setHiddenPoiIds, setHiddenCircuitIds } from './state.js';
import { getStoredToken } from './github-sync.js';
import { getPoiId } from './utils.js';
import { showToast } from './toast.js';
import { savePoiData, batchSavePoiData, saveAppState } from './database.js';
import { eventBus } from './events.js';
import { fetchWithTimeout } from './net.js';
import { isOffline, onNetworkBack } from './network-status.js';
import { mergeVisited, mergeCircuitDone, computeVu } from './visited-state.js';

const GIST_ID_KEY    = 'hw_gist_id';
const GIST_FILE_NAME = 'history_walk_userdata.json';

// Délai de debounce pour le push automatique (ms)
const PUSH_DEBOUNCE_MS = 3000;

let _pushTimer = null;

// Sync « en attente » : passe à true quand un push n'a pas pu être confirmé
// (hors-ligne, ou échec réseau en cours de route). Le retour du réseau le rejoue
// alors (cf. initGistReconnectSync). C'est ce qui rend VRAIE la réassurance
// « vos modifications restent enregistrées et repartiront au retour du réseau ».
let _pendingPush = false;
let _reconnectBound = false;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getGistId()   { return localStorage.getItem(GIST_ID_KEY) || null; }
function setGistId(id) { localStorage.setItem(GIST_ID_KEY, id); }

function getHeaders(token) {
    return {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
    };
}

// ─── SÉRIALISATION ────────────────────────────────────────────────────────────

const GIST_FORMAT = 2;

/**
 * Section du document Gist qui concerne `mapId`, ou null s'il n'y en a pas.
 * Format 1 (une seule destination) : le document lui-même si son `mapId` est
 * absent (Gists les plus anciens, lus comme avant) ou égal à `mapId`.
 */
export function sectionFor(doc, mapId) {
    if (!doc || typeof doc !== 'object') return null;
    if (doc.maps && typeof doc.maps === 'object') return doc.maps[mapId] || null;
    if (!doc.mapId || doc.mapId === mapId) return doc;
    return null;
}

/** Sections des AUTRES destinations, à recopier telles quelles à l'envoi. */
function otherSections(doc, mapId) {
    if (!doc || typeof doc !== 'object') return {};
    if (doc.maps && typeof doc.maps === 'object') {
        const others = { ...doc.maps };
        delete others[mapId];
        return others;
    }
    // Format 1 d'une autre destination : il devient sa section, sans perte.
    if (doc.mapId && doc.mapId !== mapId) {
        const { mapId: legacyMapId, appVersion, ...section } = doc;
        return { [legacyMapId]: section };
    }
    return {};
}

/**
 * Document complet à écrire dans le Gist : la section de la destination active
 * (buildSection) + celles des autres destinations reprises de `remote`, le
 * contenu lu juste avant l'envoi (null pour un Gist neuf).
 */
export function buildPayload(remote = null) {
    const mapId = state.currentMapId;
    return {
        format: GIST_FORMAT,
        maps: { ...otherSections(remote, mapId), [mapId]: buildSection() },
        lastSync: new Date().toISOString(),
        appVersion: '2.0'
    };
}

/** Section de la destination active (contenu synchronisé de cette destination). */
export function buildSection() {
    // On ne sync que les champs utiles (pas les blobs photos).
    // 'planifie' retiré 14/05/2026 (refonte Mon Espace V2) : valeur calculée à
    // la volée via computePlanifieCounter, plus stockée dans userData depuis
    // 03/05/2026 — clé legacy qui n'envoyait que des `undefined` filtrés.
    // workPhotos : ce sont des CHEMINS (quelques dizaines d'octets), jamais les
    // images — les octets vivent dans le dépôt privé. C'est ce qui permet de
    // préparer au bureau et de retrouver ses repères sur le terrain sans alourdir
    // le Gist, dont le contenu est tronqué par l'API GitHub au-delà de 1 Mo.
    //
    // 'notes' RETIRÉ (10/08/2026) : synchronisé désormais via heripia-travail
    // (cf. private-notes.js), pas le Gist — même motif que workPhotos (chemin
    // FIXE et connu, pas d'ID opaque à découvrir). `notes` reste dans
    // PERSONAL_KEYS (config.js) : toujours exclu de la publication, juste plus
    // de ce Gist. Voir project_gist_to_private_repo_migration.
    // vuUpdatedAt : date du dernier changement du statut visité — la fusion fait
    // gagner le plus récent (visited-state.js, fix 17/09/2026).
    const SYNC_KEYS = ['vu', 'vuManual', 'visitedByCircuits', 'vuUpdatedAt', 'incontournable', 'workPhotos', 'keptWorkPhotos'];
    const filtered = {};
    for (const [poiId, data] of Object.entries(state.userData || {})) {
        const slim = {};
        SYNC_KEYS.forEach(k => { if (data[k] !== undefined) slim[k] = data[k]; });
        if (Object.keys(slim).length > 0) filtered[poiId] = slim;
    }
    return {
        userData: filtered,
        circuitsStatus: state.officialCircuitsStatus || {},
        // Dates des changements de statut « fait », par circuit (même règle).
        circuitsStatusUpdatedAt: state.officialCircuitsStatusUpdatedAt || {},
        // testedCircuits (« vérifié ») RETIRÉ du Gist (07/06/2026) : statut
        // AUTORITAIRE publié par l'admin sur GitHub (tested_<map>.json), pas une
        // préférence par-appareil. Le Gist (par-user, à la traîne) ne doit pas en
        // être une 2ᵉ source, sinon un Gist périmé ré-écrase l'autorité serveur.
        // Ajout 03/05/2026 : sync admin des POIs masqués entre appareils.
        // Stratégie merge : UNION (cf. mergeRemoteIntoLocal).
        // Cf. mémoire project_admin_sync_history.md.
        hiddenPoiIds: state.hiddenPoiIds || [],
        // Ajout 15/05/2026 (refonte Mon Espace V2 PR4) : sync user des circuits
        // cachés via le bouton "Cacher ce circuit". Stratégie merge : UNION
        // (cohérent avec hiddenPoiIds, validé Stefan).
        hiddenCircuitIds: state.hiddenCircuitIds || [],
        lastSync: new Date().toISOString()
    };
}

// ─── MERGE ────────────────────────────────────────────────────────────────────

export function mergeRemoteIntoLocal(remote) {
    if (!remote || !remote.userData) return { updates: [] };
    const updates = [];

    for (const [poiId, remoteData] of Object.entries(remote.userData)) {
        const local = state.userData[poiId] || {};
        let changed = false;
        const merged = { ...local };

        // Statut visité : la modification la plus récente gagne ; sans date des
        // deux côtés (données antérieures au 17/09/2026), « visité » gagne comme
        // avant. Cf. visited-state.js — l'ancienne règle ré-écrasait un « non
        // visité » posé sur un autre appareil.
        const visitedPatch = mergeVisited(local, remoteData);
        if (visitedPatch) {
            Object.assign(merged, visitedPatch);
            merged.vu = computeVu(merged);
            changed = true;
        }
        // incontournable : true gagne
        if (remoteData.incontournable === true && !local.incontournable) {
            merged.incontournable = true;
            changed = true;
        }
        // workPhotos : le DISTANT gagne, y compris une liste vide.
        //
        // Seule clé en « dernier écrivain gagne » plutôt qu'en union, et c'est
        // délibéré : les photos de travail s'ajoutent au bureau et se consultent
        // sur le terrain, jamais l'inverse. Une union ferait RESSUSCITER sur le
        // téléphone des références effacées au bureau par un import de vraies
        // photos — exactement ce que la règle « le provisoire s'efface » interdit.
        //
        // Le garde `!== undefined` est indispensable : un payload ancien (écrit
        // avant ce chantier) ne porte pas la clé et ne doit rien effacer.
        //
        // keptWorkPhotos (25/09/2026) suit la MÊME règle : c'est une marque sur
        // workPhotos, les deux doivent venir du même écrivain pour rester cohérents.
        for (const key of ['workPhotos', 'keptWorkPhotos']) {
            if (remoteData[key] === undefined) continue;
            const remoteList = Array.isArray(remoteData[key]) ? remoteData[key] : [];
            const localList = Array.isArray(local[key]) ? local[key] : [];
            if (remoteList.join('|') !== localList.join('|')) {
                merged[key] = remoteList;
                changed = true;
            }
        }

        if (changed) {
            // Mise à jour mémoire
            state.userData[poiId] = merged;
            const feature = state.loadedFeatures?.find(f => getPoiId(f) === poiId);
            if (feature) feature.properties.userData = merged;
            updates.push({ poiId, data: merged });
        }
    }

    // circuitsStatus : le changement le plus récent gagne (sinon true gagne,
    // pour des données sans date). Un « pas fait » doit pouvoir se propager.
    let circuitsChanged = false;
    const remoteStatus = remote.circuitsStatus || {};
    const remoteStamps = remote.circuitsStatusUpdatedAt || {};
    const localStatus = state.officialCircuitsStatus || {};
    let stamps = state.officialCircuitsStatusUpdatedAt || {};
    for (const [cId, val] of Object.entries(remoteStatus)) {
        const res = mergeCircuitDone(localStatus[cId], stamps[cId], val, remoteStamps[cId]);
        if (!res) continue;
        if (res.value !== (localStatus[cId] === true)) setOfficialCircuitStatus(cId, res.value);
        if (res.stamp !== null) stamps = { ...stamps, [cId]: res.stamp };
        circuitsChanged = true;
    }
    if (stamps !== state.officialCircuitsStatusUpdatedAt) setOfficialCircuitsStatusUpdatedAt(stamps);

    // testedCircuits (« vérifié ») n'est PLUS synchronisé via le Gist : autorité
    // serveur (tested_<map>.json), appliquée au boot (app-startup.js). Le retirer
    // ici évite qu'un Gist périmé ré-injecte un vérifié retiré côté serveur.

    // hiddenPoiIds : UNION (admin peut masquer différents POIs sur PC vs mobile).
    // Cf. mémoire project_admin_sync_history.md — décision Stefan 03/05/2026
    // d'inclure hiddenPoiIds au Gist sync (revient sur la décision du 02/05).
    let hiddenChanged = false;
    if (Array.isArray(remote.hiddenPoiIds) && remote.hiddenPoiIds.length > 0) {
        const localList = Array.isArray(state.hiddenPoiIds) ? state.hiddenPoiIds : [];
        const union = Array.from(new Set([...localList, ...remote.hiddenPoiIds]));
        if (union.length !== localList.length) {
            setHiddenPoiIds(union);
            hiddenChanged = true;
        }
    }

    // hiddenCircuitIds : UNION (user peut cacher différents circuits sur PC
    // vs mobile). Refonte Mon Espace V2 PR4 (15/05/2026) — même stratégie que
    // hiddenPoiIds, validée par Stefan.
    if (Array.isArray(remote.hiddenCircuitIds) && remote.hiddenCircuitIds.length > 0) {
        const localList = Array.isArray(state.hiddenCircuitIds) ? state.hiddenCircuitIds : [];
        const union = Array.from(new Set([...localList, ...remote.hiddenCircuitIds]));
        if (union.length !== localList.length) {
            setHiddenCircuitIds(union);
            hiddenChanged = true;
        }
    }

    return { updates, circuitsChanged, hiddenChanged };
}

/**
 * Applique un payload distant reçu du Gist : fusion en mémoire (mergeRemoteIntoLocal),
 * puis persistance IndexedDB + rafraîchissement UI. Factorisé pour être appelé aussi
 * bien par un pull normal (boot) que par un push qui vient de RETROUVER un Gist
 * jusque-là inconnu (cf. pushToGist) — dans les deux cas, ce que le Gist distant
 * porte seul ne doit jamais être perdu avant d'écraser avec l'état local.
 */
async function applyRemoteMerge(remote) {
    const { updates, circuitsChanged, hiddenChanged } = mergeRemoteIntoLocal(remote);
    if (updates.length > 0) {
        await batchSavePoiData(state.currentMapId, updates);
    }
    if (circuitsChanged) {
        await saveAppState(`official_circuits_status_${state.currentMapId}`, state.officialCircuitsStatus);
        await saveAppState(`official_circuits_status_updated_${state.currentMapId}`, state.officialCircuitsStatusUpdatedAt || {});
    }
    if (hiddenChanged) {
        await saveAppState(`hiddenPois_${state.currentMapId}`, state.hiddenPoiIds);
    }
    if (updates.length > 0 || circuitsChanged || hiddenChanged) {
        eventBus.emit('data:apply-filters');
        eventBus.emit('circuit:list-updated');
    }
    return { updates, circuitsChanged, hiddenChanged };
}

// ─── API GIST ─────────────────────────────────────────────────────────────────

async function fetchGist(token, gistId) {
    const res = await fetchWithTimeout(`https://api.github.com/gists/${gistId}`, {
        headers: getHeaders(token)
    });
    if (!res.ok) throw new Error(`Gist fetch failed: ${res.status}`);
    const data = await res.json();
    const content = data.files?.[GIST_FILE_NAME]?.content;
    if (!content) {
        const err = new Error('Fichier introuvable dans le Gist');
        err.noFile = true;
        throw err;
    }
    return JSON.parse(content);
}

/**
 * Lecture avant envoi : le contenu actuel du Gist, dont l'envoi recopiera les
 * sections des autres destinations. Un Gist sans fichier n'a rien à préserver
 * (null). Toute autre erreur remonte : écrire sans avoir lu effacerait les
 * autres destinations.
 */
async function fetchGistForPush(token, gistId) {
    try {
        return await fetchGist(token, gistId);
    } catch (e) {
        if (e.noFile) return null;
        throw e;
    }
}

/**
 * Cherche le Gist de synchro de l'utilisateur (nouvel appareil, ID mort…).
 * Prend le plus récemment modifié s'il en existe plusieurs.
 *
 * TROIS issues, à ne JAMAIS confondre (fix 25/09/2026) :
 *  - trouvé → son id ;
 *  - GitHub CONFIRME qu'il n'y en a aucun → null : seul cas où créer est légitime ;
 *  - la recherche a échoué (réseau, délai, 401/403/5xx) → exception : on ne
 *    sait pas, donc on ne crée rien. Avant, cet échec renvoyait null comme
 *    « aucun Gist » et l'appelant en créait un — un Gist vide de plus.
 *
 * @param {string} token - PAT GitHub avec scope gist
 * @returns {Promise<string|null>} - gistId trouvé, ou null si GitHub confirme qu'il n'y en a aucun
 */
async function discoverGistId(token) {
    const res = await fetchWithTimeout('https://api.github.com/gists?per_page=100', {
        headers: getHeaders(token)
    });
    if (!res.ok) throw new Error(`Gist discovery failed: ${res.status}`);
    const gists = await res.json();
    const matching = gists.filter(g => g.files && g.files[GIST_FILE_NAME]);
    if (matching.length === 0) return null;
    matching.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    return matching[0].id;
}

/**
 * Retrouve le Gist existant et FUSIONNE son contenu dans l'état local, puis
 * seulement le mémorise. Renvoie `{ id, remote }` (le contenu lu, dont l'envoi
 * recopie les autres destinations), ou null si GitHub confirme qu'il n'y en a
 * aucun. Jette si la recherche ou la lecture échoue : l'id n'est alors PAS
 * mémorisé et l'appelant ne pousse rien. Pousser un état local non fusionné
 * (appareil neuf, presque vide) écraserait le vrai Gist ; et un id mémorisé sans
 * fusion ferait sauter la lecture au push suivant, avec le même résultat.
 */
async function adoptExistingGist(token) {
    const found = await discoverGistId(token);
    if (!found) return null;
    const remote = await fetchGist(token, found);
    const section = sectionFor(remote, state.currentMapId);
    if (section) await applyRemoteMerge(section);
    setGistId(found);
    showToast('Gist existant retrouvé, sync réactivée.', 'info', 4000);
    return { id: found, remote };
}

async function createGist(token, payload) {
    const res = await fetchWithTimeout('https://api.github.com/gists', {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
            description: 'History Walk – User Data Sync',
            public: false,
            files: { [GIST_FILE_NAME]: { content: JSON.stringify(payload, null, 2) } }
        })
    });
    if (!res.ok) throw new Error(`Gist create failed: ${res.status}`);
    const data = await res.json();
    return data.id;
}

/** Création — appelée SEULEMENT quand GitHub a confirmé qu'aucun Gist n'existe. */
async function createFreshGist(token, message) {
    const id = await createGist(token, buildPayload());
    setGistId(id);
    showToast(message, 'success', 4000);
    _pendingPush = false;
}

async function updateGist(token, gistId, payload) {
    const res = await fetchWithTimeout(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: getHeaders(token),
        body: JSON.stringify({
            files: { [GIST_FILE_NAME]: { content: JSON.stringify(payload, null, 2) } }
        })
    });
    if (!res.ok) throw new Error(`Gist update failed: ${res.status}`);
}

// ─── API PUBLIQUE ─────────────────────────────────────────────────────────────

/**
 * Récupère le contenu du Gist en se réparant si l'ID stocké est mort.
 *
 * `pushToGist` savait déjà se rattraper d'un 404 (recréation du Gist), mais le
 * pull, lui, ne retentait JAMAIS une découverte : la redécouverte n'avait lieu
 * que si `hw_gist_id` était absent. Conséquence observée le 09/08/2026 — après
 * suppression manuelle de Gists fantômes sur github.com, chaque appareil gardait
 * l'ID mort et affichait « Sync Gist indisponible » à CHAQUE boot, alors qu'un
 * Gist valide existait juste à côté. Seul un `localStorage.removeItem` manuel
 * débloquait la situation.
 *
 * Un Gist DÉCOUVERT est renvoyé dans `adoptId` sans être mémorisé : l'appelant
 * ne le mémorise qu'une fois le contenu fusionné (cf. adoptExistingGist).
 *
 * @param {string} token
 * @returns {Promise<{remote: object|null, adoptId?: string, adoptToast?: string}>}
 */
async function fetchGistWithRecovery(token) {
    const gistId = getGistId();

    // Aucun ID connu (nouvel appareil, localStorage vidé) : découverte directe.
    // Cf. mémoire project_gist_for_future_users.md (anomalie #8 onboarding).
    if (!gistId) {
        const discovered = await discoverGistId(token);
        if (!discovered) return { remote: null }; // Aucun Gist côté GitHub → cas normal
        const remote = await fetchGist(token, discovered);
        return { remote, adoptId: discovered, adoptToast: 'Gist détecté, sync activée.' };
    }

    try {
        return { remote: await fetchGist(token, gistId) };
    } catch (e) {
        // Seul le 404 est récupérable : le Gist n'existe plus. Un 401/403
        // (token) ou un 5xx doivent remonter tels quels — réessayer une
        // découverte avec le même token échouerait pareil, et masquerait la
        // vraie cause derrière un « aucun Gist trouvé » trompeur.
        if (!/\b404\b/.test(e.message)) throw e;

        localStorage.removeItem(GIST_ID_KEY);
        const rediscovered = await discoverGistId(token);
        if (!rediscovered) throw e; // Rien à retrouver → on signale l'échec d'origine

        const remote = await fetchGist(token, rediscovered);
        return { remote, adoptId: rediscovered, adoptToast: 'Gist retrouvé, sync réactivée.' };
    }
}

/** Extrait le code HTTP d'un message d'erreur `... failed: 404`, sinon null. */
function httpStatusOf(err) {
    const m = /\b(\d{3})\b/.exec((err && err.message) || '');
    return m ? m[1] : null;
}

/**
 * Pull depuis le Gist → merge dans le state local → sauvegarde IndexedDB.
 * Appelé au démarrage de l'app.
 */
export async function pullFromGist() {
    const token = getStoredToken();
    if (!token) return; // Pas de token → silencieux
    if (!state.currentMapId) return; // aucune section à lire sans destination active

    // Hors-ligne : inutile (et bruyant, cf. plus bas) de tenter un fetch voué à
    // l'échec au boot. Silencieux — un boot hors-ligne est un cas normal, pas
    // une panne à signaler.
    if (isOffline()) return;

    try {
        const { remote, adoptId, adoptToast } = await fetchGistWithRecovery(token);
        if (!remote) return; // Aucun Gist côté GitHub → silencieux

        const adopt = () => {
            if (!adoptId) return;
            setGistId(adoptId);
            showToast(adoptToast, 'info', 3000);
        };

        // Pas de section pour cette destination (rien à fusionner : le Gist est
        // lisible, on peut le retenir).
        const section = sectionFor(remote, state.currentMapId);
        if (!section) {
            adopt();
            return;
        }

        const { updates, circuitsChanged, hiddenChanged } = await applyRemoteMerge(section);
        adopt();
        if (updates.length > 0 || circuitsChanged || hiddenChanged) {
            const parts = [];
            if (updates.length > 0) parts.push(`${updates.length} lieu(x)`);
            if (circuitsChanged) parts.push('circuits');
            if (hiddenChanged) parts.push('masquages');
            showToast(`Sync Gist : ${parts.join(' + ')} mis à jour.`, 'info', 3000);
        }

    } catch (e) {
        // Avant ce fix (01/08/2026), cet échec était TOTALEMENT silencieux
        // (console.warn seul) — si une modification suivait avant le prochain
        // pull réussi, un push pouvait alors créer un Gist fantôme (cf.
        // pushToGist) sans que rien ne le signale. Le hors-ligne étant déjà
        // filtré au-dessus, tout ce qui atteint ce catch est une vraie panne
        // (token expiré, Gist supprimé, 5xx, rate-limit) — elle mérite d'être vue.
        // Le code HTTP est affiché : sans lui, « indisponible » ne distingue pas
        // un token refusé (401/403) d'un Gist absent (404) ou d'une panne GitHub
        // (5xx) — trois causes aux remèdes opposés, indiagnosticables à distance.
        console.warn('[GistSync] Pull failed:', e.message);
        const status = httpStatusOf(e);
        showToast(
            `Sync Gist indisponible${status ? ` (erreur ${status})` : ''} — vos données restent enregistrées localement.`,
            'warning',
            5000
        );
    }
}

/**
 * Push le state courant vers le Gist.
 * Crée le Gist s'il n'existe pas encore.
 */
export async function pushToGist() {
    const token = getStoredToken();
    if (!token) return;
    // Sans destination active, la section n'aurait pas de clé (format 2).
    if (!state.currentMapId) return;

    // Hors-ligne : inutile de lancer un fetch voué à l'échec. On mémorise que la
    // sync est en attente — le retour du réseau la rejouera (initGistReconnectSync).
    if (isOffline()) {
        _pendingPush = true;
        return;
    }

    try {
        let gistId = getGistId();

        // Gist local inconnu (localStorage vidé, nouveau profil navigateur, PWA
        // réinstallée…) : AVANT d'en créer un nouveau, on cherche s'il en existe
        // déjà un côté GitHub. Sans cette étape, chaque perte de localStorage
        // fabriquait silencieusement un Gist fantôme — cause identifiée des deux
        // Gists Djerba distincts trouvés le 01/08/2026 (un « créé il y a 2 mois »
        // abandonné, un « actif il y a 3 jours » devenu le seul à jour). Un Gist
        // retrouvé est d'abord rapatrié et FUSIONNÉ dans l'état local — jamais
        // écrasé à l'aveugle — pour ne pas perdre ce qui n'existe que là-bas.
        // Si la recherche ou la lecture échoue, adoptExistingGist jette : on ne
        // pousse RIEN (fix 25/09/2026 — avant, on poussait quand même l'état
        // local, qui sur un appareil neuf est presque vide).
        let remote = null;
        if (!gistId) {
            const adopted = await adoptExistingGist(token);
            if (!adopted) {
                await createFreshGist(token, 'Gist créé ! Sync activée.');
                return;
            }
            ({ id: gistId, remote } = adopted);
        } else {
            // Format 2 : relire AVANT d'écrire, pour recopier les sections des
            // autres destinations (sinon un envoi depuis Charleroi effaçait Djerba).
            try {
                remote = await fetchGistForPush(token, gistId);
            } catch (readErr) {
                if (!/\b404\b/.test(readErr.message)) throw readErr;
                // Gist mémorisé supprimé sur github.com : même démarche qu'un appareil
                // neuf — chercher (et fusionner) AVANT de créer. Avant le 25/09/2026,
                // ce chemin créait directement : un vieil ID resté dans un navigateur
                // suffisait à fabriquer un Gist vide à côté du vrai.
                localStorage.removeItem(GIST_ID_KEY);
                const adopted = await adoptExistingGist(token);
                if (!adopted) {
                    await createFreshGist(token, 'Gist re-créé après suppression côté GitHub.');
                    return;
                }
                ({ id: gistId, remote } = adopted);
            }
        }

        // Reconstruit APRÈS une éventuelle fusion ci-dessus : le payload doit
        // refléter l'état local à jour, pas celui d'avant la fusion.
        await updateGist(token, gistId, buildPayload(remote));

        _pendingPush = false; // push confirmé → plus rien en attente

    } catch (e) {
        // Échec (réseau coupé en cours, 5xx, rate-limit…) : on garde la sync en
        // attente pour la rejouer au prochain retour de connectivité.
        _pendingPush = true;
        console.warn('[GistSync] Push failed:', e.message);
    }
}

/**
 * Push différé (debounced) — appelé après chaque modification utilisateur.
 */
export function schedulePush() {
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(() => {
        pushToGist();
        _pushTimer = null;
    }, PUSH_DEBOUNCE_MS);
}

/**
 * Rejoue le push Gist au retour de la connectivité s'il en restait un en attente.
 * Retour du réseau VÉRIFIÉ (network-status.js) : le seul signal « online » du
 * navigateur se perd sur Android quand Heripia est en arrière-plan.
 * Idempotent : on ne s'abonne qu'une seule fois. À appeler une fois au boot
 * (cf. app-startup.js, après pullFromGist).
 */
export function initGistReconnectSync() {
    if (_reconnectBound) return;
    _reconnectBound = true;
    onNetworkBack(() => {
        if (_pendingPush) pushToGist();
    });
}

