import { state, setUserData } from './state.js';
import { getPoiId, getRealDistance } from './utils.js';
import { generateGPXString } from './gpx.js';
import { eventBus } from './events.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { generateMasterGeoJSONData } from './admin-geojson.js';
import { uploadFileToGitHub, deleteFileFromGitHub, getStoredToken } from './github-sync.js';
import { GITHUB_OWNER, GITHUB_REPO, RAW_BASE, GITHUB_PATHS } from './config.js';
import { showToast } from './toast.js';
import { showConfirm, closeModal } from './modal.js';
import { saveAppState, getAppState, getPendingAdminPhotos, setPendingAdminPhotos, clearPendingAdminPhotos, deletePoiData } from './database.js';
import { uploadPhotoForPoi } from './photo-service.js';

// Nouveaux imports suite au découpage
import { reconcileLocalChanges, prepareDiffData, purgeOrphanPendingPois, diffData } from './admin-diff-engine.js';
import { openControlCenterModal, renderTab } from './admin-control-ui.js';

/**
 * Construit l'entrée d'index circuit (circuits/<map>.json) à partir d'un circuit
 * local + ses features POI résolues. Doit matcher le format produit par
 * scripts/generate-circuit-index.js (l'Action update-circuits.yml régénère
 * l'index canonique ; cette version client donne une cohérence immédiate, et
 * l'Action reconfirme — idempotent). Champs alignés sur le script :
 *  - distance : Haversine sur realTrack /1000, "X.X km" (getRealDistance = même calcul)
 *  - zone : Zone du 1er POI (le script fait pareil en priorité 1)
 *  - description : constante (le script lit le <desc> de metadata, hardcodé par generateGPXString)
 * Exporté pour test unitaire.
 */
export function buildCircuitIndexEntry(circuit, features, mapId) {
    const distance = (getRealDistance(circuit) / 1000).toFixed(1) + ' km';
    const entry = {
        id: circuit.id,
        name: circuit.name,
        file: `${mapId}/${circuit.name}.gpx`,
        description: 'Circuit généré par History Walk.',
        distance,
        isOfficial: true,
        hasRealTrack: true,
        zone: features[0]?.properties?.Zone || undefined,
        poiIds: circuit.poiIds || [],
    };
    if (!entry.zone) delete entry.zone;
    return entry;
}

// --- STATE MANAGEMENT (Brouillon) ---
const DRAFT_IDB_KEY = 'adminDraft';
let adminDraft = {
    pendingPois: {},
    pendingCircuits: {}
};

// --- INITIALISATION (Point d'entrée principal) ---
export async function initAdminControlCenter() {
    // Lire depuis IndexedDB (nouvelle source de vérité)
    const saved = await getAppState(DRAFT_IDB_KEY);
    if (saved) {
        adminDraft = saved;
        updateButtonBadge();
    }

    // Migration : nettoyer l'ancienne clé localStorage si elle existe encore
    localStorage.removeItem('admin_draft_v1');

    // Synchroniser le flag cross-app au boot (cas : F5 alors qu'un brouillon existait déjà)
    updateUnpublishedFlag();

    // Écoute les modifications faites via RichEditor (évite l'import circulaire
    // richEditor → admin-control-center → richEditor).
    // Quand l'admin sauvegarde un POI via le modal d'édition, on propage
    // l'information dans adminDraft immédiatement (sans attendre reconcileLocalChanges).
    eventBus.on('admin:poi-edited', ({ id, type }) => {
        addToDraft('poi', id, { type });
    });
}

// Flag cross-app (HW ↔ DM) : indique qu'on a des changements non publiés.
// Lu par le DM au boot (même origin = localStorage partagé) pour afficher
// un bandeau "HW a un brouillon non publié, va publier d'abord".
const UNPUBLISHED_FLAG_KEY = 'hw_has_unpublished_changes';
function updateUnpublishedFlag() {
    const total = Object.keys(adminDraft.pendingPois).length
                + Object.keys(adminDraft.pendingCircuits).length;
    if (total > 0) {
        localStorage.setItem(UNPUBLISHED_FLAG_KEY, '1');
    } else {
        localStorage.removeItem(UNPUBLISHED_FLAG_KEY);
    }
}

function updateButtonBadge() {
    const btn = document.getElementById('btn-admin-control-center');
    if (!btn) return;
    const total = Object.keys(adminDraft.pendingPois).length + Object.keys(adminDraft.pendingCircuits).length;
    btn.innerHTML = `<i data-lucide="layout-dashboard"></i> Centre de Contrôle ${total > 0 ? `<span class="cc-badge">${total}</span>` : ''}`;
    createIcons({ icons: appIcons, root: btn });
}

function saveDraft(newDraft) {
    adminDraft = newDraft;
    // Fire-and-forget pour les callbacks synchrones (reconcileLocalChanges, etc.)
    saveAppState(DRAFT_IDB_KEY, adminDraft).catch(e => console.error("Erreur sauvegarde draft", e));
    updateUnpublishedFlag();
}

// Version awaitable : à utiliser dans les chemins où la persistance DOIT être
// committée avant de retourner (ex: Ignorer → éviter que F5 ressuscite le draft).
async function saveDraftAwait(newDraft) {
    adminDraft = newDraft;
    try {
        await saveAppState(DRAFT_IDB_KEY, adminDraft);
        updateUnpublishedFlag();
    } catch (e) {
        console.error("Erreur sauvegarde draft (await)", e);
        throw e;
    }
}

// Helper : appelle prepareDiffData PUIS purgeOrphanPendingPois. Les entrées
// pendingPois sans diff réel sont retirées + userData associée nettoyée.
// Persiste si quelque chose a changé. Voir admin-diff-engine.js
// purgeOrphanPendingPois pour la justification (bug observé 20/05/2026).
async function prepareDiffAndPurge() {
    await prepareDiffData(adminDraft);
    const purged = await purgeOrphanPendingPois(adminDraft);
    if (purged.length > 0) {
        saveDraft(adminDraft);
        updateButtonBadge();
        console.log('[CC] purged orphan pendingPois:', purged);
    }
}

// --- OUVERTURE DIRECTE ONGLET CONFIG (sans calcul diff) ---
// --- OUVERTURE DU PANNEAU (Interface + Logique) ---
// initialTab : onglet affiché en premier ('dashboard' par défaut, 'settings' pour config token)
export async function openControlCenter(initialTab = 'dashboard') {
    // Garde-fou : quand branché directement via addEventListener('click', openControlCenter),
    // le premier argument est un MouseEvent, pas une string. On retombe alors sur 'dashboard'.
    if (typeof initialTab !== 'string') initialTab = 'dashboard';

    // 1. Ouvrir la modale avec tous les callbacks
    const callbacks = {
        publishChanges: publishChanges,
        toggleDiffDetails: toggleDiffDetails,
        updateDraftValue: updateDraftValue,
        processDecision: processDecision,
        openEditorForPoi: openEditorForPoi,
        togglePhotoSkip: togglePhotoSkip,
        removeAdminPhoto: removeAdminPhoto,
        bulkSetPhotoSkip: bulkSetPhotoSkip
    };

    openControlCenterModal(diffData, callbacks);

    // 2. Calculer les données (Diff Engine) + purger les orphelins éventuels
    reconcileLocalChanges(adminDraft, saveDraft, updateButtonBadge);
    await prepareDiffAndPurge();

    // 3. Rendre l'onglet demandé
    renderTab(initialTab, diffData, callbacks);
}

// Raccourci : ouvre directement l'onglet Réglages (token GitHub)
export function openControlCenterSettings() {
    openControlCenter('settings');
}

// --- ACTIONS GLOBALES ---

export const toggleDiffDetails = (id) => {
    const el = document.getElementById(`diff-details-${id}`);
    if (el) {
        el.classList.toggle('open');
    }
};

/**
 * Persiste le flag `skipPublish` d'une photo pending dans IDB (Chantier 2).
 * Appelé quand l'admin coche/décoche une vignette dans l'onglet Modifications.
 * - skipPublish=true : photo reste dans `pendingAdminPhotos` mais sera ignorée
 *   lors du prochain Publier (pas d'upload GitHub). Elle reste visible dans
 *   l'app via `poiPhotos` (source séparée).
 * - skipPublish=false : photo sera uploadée et retirée de pendingAdminPhotos
 *   lors du prochain Publier.
 *
 * MAJ aussi `diffData` en mémoire pour que le compteur du Dashboard reflète
 * l'état courant sans attendre un rafraîchissement complet.
 */
export const togglePhotoSkip = async (poiId, photoId, skipPublish) => {
    try {
        const mapId = state.currentMapId || 'djerba';
        const photos = await getPendingAdminPhotos(mapId, poiId);
        const updated = photos.map(p =>
            p.id === photoId ? { ...p, skipPublish } : p
        );
        await setPendingAdminPhotos(mapId, poiId, updated);

        // MAJ diffData en mémoire (même référence que l'entrée pois[].pendingPhotos,
        // donc la grille reste cohérente si on change d'onglet puis on revient).
        const entry = diffData.pendingPhotos[poiId]?.find(e => e.id === photoId);
        if (entry) {
            const wasPublishable = !entry.skipPublish;
            entry.skipPublish = skipPublish;
            const isPublishable = !skipPublish;
            if (wasPublishable && !isPublishable) {
                diffData.stats.pendingPhotoCount = Math.max(0, diffData.stats.pendingPhotoCount - 1);
            } else if (!wasPublishable && isPublishable) {
                diffData.stats.pendingPhotoCount += 1;
            }
        }
        // B3 — Re-render pour déplacer la photo entre les sections "À publier"
        // et "Gardées en local" selon son nouveau flag.
        try {
            renderTab('changes', diffData, { publishChanges, processDecision, openEditorForPoi, togglePhotoSkip, removeAdminPhoto, bulkSetPhotoSkip });
        } catch (e) {
            console.warn('[CC] renderTab after togglePhotoSkip failed:', e);
        }
    } catch (err) {
        console.error('[CC] togglePhotoSkip échoué', err);
        showToast("Impossible d'enregistrer l'état local de la photo", 'error');
    }
};

/**
 * B3 — Supprime UNE photo pending d'un POI (corbeille unitaire dans la grille).
 * Retire de pendingAdminPhotos uniquement (les photos admin ne sont jamais
 * dans poiPhotos avant publication).
 */
export const removeAdminPhoto = async (poiId, photoId) => {
    try {
        const mapId = state.currentMapId || 'djerba';
        const photos = await getPendingAdminPhotos(mapId, poiId);
        const removedEntry = photos.find(p => p.id === photoId);
        const updated = photos.filter(p => p.id !== photoId);
        await setPendingAdminPhotos(mapId, poiId, updated);

        // MAJ diffData en mémoire pour cohérence immédiate
        if (diffData.pendingPhotos[poiId]) {
            diffData.pendingPhotos[poiId] = diffData.pendingPhotos[poiId].filter(e => e.id !== photoId);
            if (diffData.pendingPhotos[poiId].length === 0) {
                delete diffData.pendingPhotos[poiId];
            }
        }
        const item = diffData.pois.find(p => p.id === poiId);
        if (item && Array.isArray(item.pendingPhotos)) {
            item.pendingPhotos = item.pendingPhotos.filter(e => e.id !== photoId);
            if (item.pendingPhotos.length === 0) {
                item.hasPendingPhotos = false;
            }
        }
        // Décrémente le compteur publishable si la photo retirée était à publier
        if (removedEntry && !removedEntry.skipPublish) {
            diffData.stats.pendingPhotoCount = Math.max(0, (diffData.stats.pendingPhotoCount || 0) - 1);
        }

        showToast("Photo supprimée du brouillon", "info");

        // Re-render pour refléter immédiatement (compteurs des pills + grille)
        try {
            renderTab('changes', diffData, { publishChanges, processDecision, openEditorForPoi, togglePhotoSkip, removeAdminPhoto, bulkSetPhotoSkip });
        } catch (e) {
            console.warn('[CC] renderTab after removeAdminPhoto failed:', e);
        }
    } catch (err) {
        console.error('[CC] removeAdminPhoto échoué', err);
        showToast("Impossible de supprimer la photo", 'error');
    }
};

/**
 * B3 — Bascule le flag `skipPublish` sur TOUTES les photos pending d'un POI
 * en une seule opération (boutons "Tout cocher" / "Tout décocher" en lot).
 * @param {string} poiId
 * @param {boolean} skipPublish - true = toutes en local, false = toutes à publier
 */
export const bulkSetPhotoSkip = async (poiId, skipPublish) => {
    try {
        const mapId = state.currentMapId || 'djerba';
        const photos = await getPendingAdminPhotos(mapId, poiId);
        if (photos.length === 0) return;

        const updated = photos.map(p => ({ ...p, skipPublish }));
        await setPendingAdminPhotos(mapId, poiId, updated);

        // MAJ diffData en mémoire
        const entries = diffData.pendingPhotos[poiId];
        if (Array.isArray(entries)) {
            const oldPublishable = entries.filter(e => !e.skipPublish).length;
            entries.forEach(e => { e.skipPublish = skipPublish; });
            const newPublishable = entries.filter(e => !e.skipPublish).length;
            diffData.stats.pendingPhotoCount = Math.max(
                0,
                (diffData.stats.pendingPhotoCount || 0) - oldPublishable + newPublishable
            );
        }

        try {
            renderTab('changes', diffData, { publishChanges, processDecision, openEditorForPoi, togglePhotoSkip, removeAdminPhoto, bulkSetPhotoSkip });
        } catch (e) {
            console.warn('[CC] renderTab after bulkSetPhotoSkip failed:', e);
        }
    } catch (err) {
        console.error('[CC] bulkSetPhotoSkip échoué', err);
        showToast("Impossible d'appliquer l'action en lot", 'error');
    }
};

// Regex strict : "lat, lng" avec décimales optionnelles, signe optionnel
const POSITION_RE = /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/;

/**
 * Valide une chaîne "lat, lng". Retourne { ok: true, lat, lng } en cas de
 * succès, ou { ok: false, reason } en cas d'échec (format, bornes, inversion).
 */
function validatePositionInput(value) {
    const trimmed = String(value || '').trim();
    if (!POSITION_RE.test(trimmed)) {
        return { ok: false, reason: 'Format attendu : "lat, lng" (ex : 33.77, 10.94)' };
    }
    const [lat, lng] = trimmed.split(',').map(s => parseFloat(s.trim()));
    if (lat < -90 || lat > 90) {
        // Heuristique : si lat hors bornes mais lng dans [-90, 90], probable inversion
        if (Math.abs(lng) <= 90) {
            return { ok: false, reason: `Latitude ${lat} hors bornes (-90..90). Lat et lng inversés ?` };
        }
        return { ok: false, reason: `Latitude ${lat} hors bornes (-90..90).` };
    }
    if (lng < -180 || lng > 180) {
        return { ok: false, reason: `Longitude ${lng} hors bornes (-180..180).` };
    }
    return { ok: true, lat, lng };
}

export const updateDraftValue = async (id, key, value) => {
    // Met à jour directement userData (la source de vérité locale)

    const newUserData = { ...state.userData };
    if (!newUserData[id]) newUserData[id] = {};

    if (key === 'Position') {
        const result = validatePositionInput(value);
        if (!result.ok) {
            showToast(result.reason, 'error', 5000);
            return; // Pas d'écriture si invalide
        }
        newUserData[id].lat = result.lat;
        newUserData[id].lng = result.lng;
    } else {
        newUserData[id][key] = value;
    }

    setUserData(newUserData);
    await saveAppState('userData', state.userData); // Uses state.userData which is updated via reactivity, but just to be safe:
    showToast("Correction enregistrée localement", "info");
};

export function openEditorForPoi(id) {
    // On n'ouvre PAS le RichEditor sur la map — on le laisse s'ouvrir par-dessus le CC
    // Le CC reste ouvert en dessous (z-index CC=3000, RichEditor=4000)
    eventBus.emit('richEditor:open-for-edit', id);

    // Quand l'éditeur se ferme, on rafraîchit l'onglet Modifications
    window.addEventListener('richEditor:closed', async () => {
        await prepareDiffAndPurge();
        const callbacks = {
            publishChanges,
            toggleDiffDetails,
            updateDraftValue,
            processDecision,
            openEditorForPoi,
            togglePhotoSkip,
            removeAdminPhoto,
            bulkSetPhotoSkip
        };
        renderTab('changes', diffData, callbacks);
    }, { once: true });
}

/**
 * Refuser une modification ou supprimer un sous-ensemble de l'état pending.
 *
 * @param {string} id - POI / circuit ID
 * @param {string} decision - 'refuse' (revert) ou autre (accepter, no-op affichage)
 * @param {string} [scope='poi'] - 'poi' : revert geom + userData, garde les photos
 *                                  pending ; 'photos' : supprime UNIQUEMENT les
 *                                  photos pending pour ce POI sans toucher au reste.
 *                                  Pour les circuits, le scope est ignoré
 *                                  (comportement legacy conservé).
 */
export const processDecision = async (id, decision, scope = 'poi') => {
    if (decision !== 'refuse') {
        // Branche "accepter" : griser la ligne, UI mise à jour immédiatement
        showToast("Modification validée pour publication", "success");
        const card = document.getElementById(`cc-diff-item-${id}`);
        if (card) {
            card.style.opacity = "0.5";
            card.style.pointerEvents = "none";
        }
        return;
    }

    // Feedback UI immédiat — ne jamais dépendre du succès des awaits
    // async qui suivent (IDB / fetch peuvent échouer silencieusement).
    const card = document.getElementById(`cc-diff-item-${id}`);
    if (card) card.remove();

    if (scope === 'photos') {
        // B2 — Suppression isolée des photos pending d'un POI : ne touche
        // pas au userData / geometry. L'admin garde la main sur le contenu
        // texte (voir vue Lieux) tout en pouvant nettoyer le contenu visuel.
        try { await clearPendingAdminPhotos(state.currentMapId || 'djerba', id); }
        catch (e) { console.warn('[CC] clearPendingAdminPhotos failed:', e); }

        showToast("Photos retirées du brouillon", "info");

        try {
            await prepareDiffAndPurge();
            renderTab('changes', diffData, { publishChanges, processDecision, openEditorForPoi, togglePhotoSkip, removeAdminPhoto, bulkSetPhotoSkip });
        } catch (e) {
            console.warn('[CC] prepareDiffData/renderTab after photos refuse failed:', e);
        }
        return;
    }

    // scope === 'poi' (vue Lieux) ou non spécifié (circuits, comportement legacy)
    //
    // Revert en mémoire COMPLET : coordonnées ET userData. Mais (B2) NE TOUCHE
    // PLUS aux photos pending — l'admin doit les supprimer explicitement
    // depuis la vue Photos s'il le souhaite.
    //
    // Problème avant ce fix : Ignorer ne nettoyait que l'IDB et adminDraft.
    // En mémoire, feature.geometry.coordinates restait muté (POI en position
    // déplacée sur la carte) et feature.properties.userData pointait vers un
    // objet orphelin conservant les champs édités.
    // Résultat : carte et panneau Détails montraient l'état "modifié" jusqu'au F5.

    // 1. Restauration des coordonnées originales (si déplacement tracé)
    const draftEntry = adminDraft.pendingPois[id] || {};
    const feature = state.loadedFeatures.find(f => getPoiId(f) === id);
    if (feature && draftEntry.originalLat !== undefined && draftEntry.originalLng !== undefined) {
        feature.geometry.coordinates = [draftEntry.originalLng, draftEntry.originalLat];
    }

    // 2. Nettoyage de userData en mémoire
    if (adminDraft.pendingPois[id]) delete adminDraft.pendingPois[id];

    const newUserData = { ...state.userData };
    delete newUserData[id];
    setUserData(newUserData);

    // 3. Rebind feature.properties.userData → {} pour couper le lien avec
    //    l'objet orphelin (qui conservait l'ancienne description, lat, lng…)
    if (feature) {
        feature.properties.userData = state.userData[id] || {};
    }

    showToast("Modification refusée et annulée", "info");

    // 4. Persistance asynchrone — on AWAIT la sauvegarde du draft pour
    //    garantir qu'un F5 immédiat ne ressuscite pas l'entrée. Avant,
    //    saveDraft était fire-and-forget : sous forte charge IDB, la
    //    deletion pouvait se perdre en race avec les écritures suivantes.
    try { await saveDraftAwait(adminDraft); }
    catch (e) { console.warn('[CC] saveDraftAwait failed:', e); }
    try { updateButtonBadge(); } catch (e) { console.warn('[CC] updateButtonBadge failed:', e); }

    // Purge systématique — pas de garde hadUserData. `deletePoiData`
    // est idempotent (no-op si absent) donc ça coûte rien de le tenter
    // toujours, et ça ferme un trou si state.userData[id] était undefined
    // au moment du clic (race possible entre init et action).
    try { await saveAppState('userData', state.userData); }
    catch (e) { console.warn('[CC] saveAppState userData failed:', e); }
    try { await deletePoiData(state.currentMapId || 'djerba', id); }
    catch (e) { console.warn('[CC] deletePoiData failed:', id, e); }

    // 5. Re-calcul du diff + re-render complet (pour retomber sur
    //    l'empty state s'il ne reste rien). Isolé pour que l'UI déjà
    //    mise à jour ne soit pas perdue si prepareDiffData plante.
    try {
        await prepareDiffAndPurge();
        renderTab('changes', diffData, { publishChanges });
    } catch (e) {
        console.warn('[CC] prepareDiffData/renderTab after refuse failed:', e);
    }
};


// --- PUBLICATION RAPIDE (sans ouvrir la CC modale) ---

export async function quickPublish() {
    reconcileLocalChanges(adminDraft, saveDraft, updateButtonBadge);
    await prepareDiffAndPurge();
    await publishChanges();
}

// --- GESTION DE LA PUBLICATION ET SYNCHRONISATION ---

async function publishChanges() {
    const token = getStoredToken();
    if (!token) {
        showToast("Token manquant. Vérifiez la configuration.", "error");
        return;
    }

    // Garde-fou cross-app (UX-4) : alerter si le DM a un brouillon non publié.
    // Publier HW maintenant écraserait le geojson distant et le DM verrait au
    // prochain refresh une version sans ses modifs en attente.
    if (localStorage.getItem('dm_has_unpublished_changes') === '1') {
        const okCross = await showConfirm(
            "Brouillon DM en attente",
            "Le Data Manager a un brouillon non publié. Si tu publies HW maintenant, les modifs DM en attente pourraient être écrasées au prochain refresh du DM.\n\nVeux-tu vraiment continuer ?",
            "Continuer",
            "Annuler"
        );
        if (!okCross) return;
    }

    const ok = await showConfirm(
        "Publication GitHub",
        "Publier toutes les modifications sur GitHub ?\n\nCette action rendra visibles toutes vos modifications pour tous les utilisateurs.",
        "Publier",
        "Annuler"
    );
    if (!ok) return;

    const btn = document.getElementById('btn-cc-publish');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Envoi...`;
        createIcons({ icons: appIcons, root: btn });
    }

    try {
        const mapId = state.currentMapId || 'djerba';

        // ─── 1. UPLOAD DES PHOTOS PENDING (blobs locaux → GitHub) ───
        // Doit précéder la génération du geojson pour que les URLs fraîches
        // soient injectées dans userData.photos et sérialisées dans le geojson.
        //
        // Chantier 2 : filtrage par flag `skipPublish`
        //   — skipPublish=true : photo gardée locale (jamais poussée), reste
        //     dans pendingAdminPhotos pour rester visible dans la grille CC.
        //   — skipPublish=false : photo uploadée puis retirée de pendingAdminPhotos.
        let uploadedPhotoCount = 0;
        let failedPhotoCount   = 0;
        let keptLocalCount     = 0;

        const pendingMap = diffData.pendingPhotos || {};
        const pendingPoiIds = Object.keys(pendingMap);

        if (pendingPoiIds.length > 0) {
            for (const poiId of pendingPoiIds) {
                const pending = await getPendingAdminPhotos(mapId, poiId);
                if (pending.length === 0) continue;

                // Sépare les photos à publier des photos gardées en local
                const toPublish = pending.filter(p => !p.skipPublish);
                const toKeep    = pending.filter(p =>  p.skipPublish);
                keptLocalCount += toKeep.length;

                const newUrls    = [];
                const successIds = [];
                // Séquentiel : évite les conflits de commit parallèles sur main.
                for (const item of toPublish) {
                    try {
                        const file = new File([item.blob], 'photo.jpg', { type: 'image/jpeg' });
                        const url = await uploadPhotoForPoi(file, poiId);
                        newUrls.push(url);
                        successIds.push(item.id);
                        uploadedPhotoCount++;
                    } catch (err) {
                        console.error('[CC] Upload photo échoué pour', poiId, err);
                        failedPhotoCount++;
                    }
                }

                if (newUrls.length > 0) {
                    // Fusion avec les URLs existantes de userData.photos (photos
                    // déjà publiées conservées en tête de liste).
                    const existingUrls = state.userData[poiId]?.photos || [];
                    const mergedUrls   = [...existingUrls, ...newUrls];

                    const newUserData = { ...state.userData };
                    if (!newUserData[poiId]) newUserData[poiId] = {};
                    newUserData[poiId].photos = mergedUrls;
                    setUserData(newUserData);
                }

                // Photos restantes dans pendingAdminPhotos :
                //   — Celles marquées skipPublish (jamais tentées, conservées).
                //   — Celles dont l'upload a échoué (retentées au prochain Publier).
                const successSet = new Set(successIds);
                const failedPublish = toPublish.filter(p => !successSet.has(p.id));
                const remaining = [...toKeep, ...failedPublish];
                await setPendingAdminPhotos(mapId, poiId, remaining);
            }

            await saveAppState('userData', state.userData);
        }

        // ─── 2. GÉNÉRATION + UPLOAD DU GEOJSON ───
        // Collect IDs to delete
        const idsToDelete = Object.keys(adminDraft.pendingPois).filter(id => adminDraft.pendingPois[id].type === 'delete');

        const geojson = generateMasterGeoJSONData(idsToDelete);
        if (!geojson) throw new Error("Erreur données GeoJSON");
        const filename = `${mapId}.geojson`;
        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
        const file = new File([blob], filename, { type: 'application/geo+json' });

        // Build a descriptive commit message from the diff stats
        const stats = diffData.stats || {};
        const msgParts = [`feat(map): Publication ${mapId}`];
        if (stats.poisModified > 0) msgParts.push(`${stats.poisModified} POI(s)`);
        const totalPhotos = (stats.photosAdded || 0) + uploadedPhotoCount;
        if (totalPhotos > 0) msgParts.push(`${totalPhotos} photo(s)`);
        const commitMessage = msgParts.join(' — ');

        await uploadFileToGitHub(file, token, GITHUB_OWNER, GITHUB_REPO, GITHUB_PATHS.geojson(mapId), commitMessage);

        // Publication du statut "vérifié" (testedCircuits) si changements détectés.
        // Fichier public lu par tous les users au boot pour afficher le bouclier vert.
        if (diffData.testedChanges && diffData.testedChanges.hasChanges) {
            try {
                const testedPayload = diffData.testedChanges.snapshot || {};
                const testedBlob = new Blob([JSON.stringify(testedPayload, null, 2)], { type: 'application/json' });
                const testedFile = new File([testedBlob], `tested_${mapId}.json`, { type: 'application/json' });

                const addCount = diffData.testedChanges.additions.length;
                const rmCount  = diffData.testedChanges.removals.length;
                const testedMsg = `feat(verified): ${addCount} ajout(s), ${rmCount} retrait(s) sur ${mapId}`;

                await uploadFileToGitHub(testedFile, token, GITHUB_OWNER, GITHUB_REPO, GITHUB_PATHS.tested(mapId), testedMsg);
            } catch (err) {
                console.warn('[Admin] Échec publication tested.json:', err);
                showToast("Statut vérifié non publié (géojson OK)", "warning", 5000);
            }
        }

        // ─── PUBLICATION DES CIRCUITS (nouveaux / modifiés / supprimés) ───
        // Vraie solution (21/05/2026, cf. project_circuit_publish_chantier) :
        // « Tout publier » ne publiait historiquement AUCUN circuit nouveau/modifié
        // (seulement les suppressions) — le bouton manuel « Upload fichier » était
        // le contournement. Ici on commit le GPX ET on met à jour l'index
        // circuits/<map>.json directement → cohérence immédiate (plus de
        // transitoire ~40s où le CC re-flague le circuit). L'Action
        // update-circuits.yml régénère ensuite l'index canonique depuis les GPX
        // (idempotent) = filet de sécurité + source de vérité finale.
        const circuitChanges = diffData.circuits || [];
        if (circuitChanges.length > 0) {
            try {
                // Index distant courant (base pour upsert / suppression).
                let index = [];
                try {
                    const r = await fetch(`${RAW_BASE}/${GITHUB_PATHS.circuits(mapId)}?t=${Date.now()}`);
                    if (r.ok) index = await r.json();
                } catch (_) { /* index vide si fetch échoue */ }
                if (!Array.isArray(index)) index = [];

                const allLocal = [...(state.officialCircuits || []), ...(state.myCircuits || [])];
                let indexDirty = false;

                for (const c of circuitChanges) {
                    const isDeletion = c.isDeletion
                        || (c.changes && c.changes.some(ch => ch.key === 'STATUT' && ch.new === 'SUPPRESSION'));

                    if (isDeletion) {
                        const entry = index.find(e => String(e.id) === String(c.id));
                        if (entry?.file) {
                            try { await deleteFileFromGitHub(token, GITHUB_OWNER, GITHUB_REPO, `public/circuits/${entry.file}`, `feat(circuit): Suppression "${c.name}"`); }
                            catch (e) { console.warn('[CC] suppression GPX échec:', c.name, e); }
                        }
                        index = index.filter(e => String(e.id) !== String(c.id));
                        indexDirty = true;
                        continue;
                    }

                    // Création / modification : nécessite un realTrack (garanti par le diff engine).
                    const local = allLocal.find(x => String(x.id) === String(c.id));
                    if (!local || !local.realTrack || local.realTrack.length === 0) continue;

                    const features = (local.poiIds || [])
                        .map(pid => state.loadedFeatures.find(f => getPoiId(f) === pid))
                        .filter(Boolean);

                    const oldEntry = index.find(e => String(e.id) === String(local.id));
                    const isNew = !oldEntry;

                    // 1. Commit du GPX (nom de fichier = nom du circuit).
                    const gpxStr = generateGPXString(features, local.id, local.name, local.description || '', local.realTrack);
                    const gpxFile = new File([gpxStr], `${local.name}.gpx`, { type: 'application/gpx+xml' });
                    const gpxPath = `public/circuits/${mapId}/${local.name}.gpx`;
                    await uploadFileToGitHub(gpxFile, token, GITHUB_OWNER, GITHUB_REPO, gpxPath, `feat(circuit): ${isNew ? 'Ajout' : 'MAJ'} "${local.name}"`);

                    // 2. Renommage → supprimer l'ancien fichier GPX (sinon doublon dans l'index régénéré).
                    if (oldEntry?.file && oldEntry.file !== `${mapId}/${local.name}.gpx`) {
                        try { await deleteFileFromGitHub(token, GITHUB_OWNER, GITHUB_REPO, `public/circuits/${oldEntry.file}`, `feat(circuit): renommage — retrait ancien fichier`); }
                        catch (e) { console.warn('[CC] suppression ancien GPX échec:', oldEntry.file, e); }
                    }

                    // 3. Upsert de l'entrée d'index (préserve `transport` existant).
                    const newEntry = buildCircuitIndexEntry(local, features, mapId);
                    if (oldEntry?.transport) newEntry.transport = oldEntry.transport;
                    const i = index.findIndex(e => String(e.id) === String(local.id));
                    if (i > -1) index[i] = newEntry; else index.push(newEntry);
                    indexDirty = true;
                }

                // 4. Commit de l'index mis à jour (cohérence immédiate).
                if (indexDirty) {
                    const idxFile = new File([JSON.stringify(index, null, 2)], `${mapId}.json`, { type: 'application/json' });
                    await uploadFileToGitHub(idxFile, token, GITHUB_OWNER, GITHUB_REPO, GITHUB_PATHS.circuits(mapId), `feat(circuit): MAJ index ${mapId}`);
                }
            } catch (err) {
                console.warn('[CC] Publication circuits échouée (POI/photos OK):', err);
                showToast("Circuits non publiés (le reste OK) — réessayez", "warning", 5000);
            }
        }

        // Toast adapté au contexte : mentionne les photos gardées en local si
        // l'admin a décoché des vignettes (flag skipPublish).
        const toastParts = ["Publication réussie !"];
        if (uploadedPhotoCount > 0) toastParts.push(`${uploadedPhotoCount} photo(s) publiée(s)`);
        if (keptLocalCount   > 0) toastParts.push(`${keptLocalCount} gardée(s) en local`);
        if (failedPhotoCount > 0) toastParts.push(`${failedPhotoCount} échec(s) d'upload`);
        const toastMsg  = toastParts.length > 1 ? toastParts.join(' · ') : toastParts[0];
        const toastKind = failedPhotoCount > 0 ? 'warning' : 'success';
        showToast(toastMsg, toastKind, failedPhotoCount > 0 ? 6000 : 3500);

        adminDraft = { pendingPois: {}, pendingCircuits: {} };
        // AWAIT : même raison que Ignorer — garantir que le draft vide est
        // persisté avant tout F5 éventuel.
        await saveDraftAwait(adminDraft);
        updateButtonBadge();

        // Clean local userData for published POIs (mémoire + IDB)
        const newUserData = { ...state.userData };
        const poisToDeleteFromIdb = [];
        diffData.pois.forEach(p => {
             if (newUserData[p.id]) {
                 delete newUserData[p.id];
                 poisToDeleteFromIdb.push(p.id);
             }
        });
        setUserData(newUserData);
        await saveAppState('userData', state.userData);

        // Supprime les entrées du store IDB `poiUserData` : sans ça,
        // getAllPoiDataForMap repeuplerait state.userData au prochain F5
        // et le diff engine signalerait à nouveau les modifications déjà publiées.
        const cleanupMapId = state.currentMapId || 'djerba';
        for (const poiId of poisToDeleteFromIdb) {
            try {
                await deletePoiData(cleanupMapId, poiId);
            } catch (e) {
                console.warn('[CC] deletePoiData failed:', poiId, e);
            }
        }

        // Invalide le cache SW pour .geojson et circuits.json — sinon au prochain
        // F5 la session principale pourrait servir une version stale via NetworkFirst
        // (fallback cache si la réponse réseau traîne) et l'admin ne verrait pas
        // immédiatement ses propres modifs fraîchement publiées.
        try {
            if ('caches' in window) {
                const names = await caches.keys();
                await Promise.all(
                    names
                        .filter(n => n === 'geojson-data' || n === 'app-data')
                        .map(n => caches.delete(n))
                );
            }
        } catch (e) {
            console.warn('[CC] Purge SW cache failed:', e);
        }

        closeModal();

    } catch (e) {
        console.error(e);
        showToast("Erreur: " + e.message, "error");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="rocket"></i> TOUT PUBLIER`;
            createIcons({ icons: appIcons, root: btn });
        }
    }
}



// --- EXPORTS POUR COMPATIBILITÉ ET TESTS ---

export function getAdminDraft() {
    return adminDraft;
}

export function addToDraft(type, id, details) {
    if (type === 'poi') {
        adminDraft.pendingPois[id] = {
            ...(adminDraft.pendingPois[id] || {}),
            timestamp: Date.now(),
            ...details
        };
    }
    if (type === 'circuit') adminDraft.pendingCircuits[id] = { timestamp: Date.now() };

    saveDraft(adminDraft);
    updateButtonBadge();
}

/**
 * Cherche si une migration est déjà enregistrée pour un ancien ID
 */
export function getMigrationId(oldId) {
    if (!oldId) return null;
    const entries = Object.entries(adminDraft.pendingPois);
    const found = entries.find(([newId, data]) => data.type === 'migration' && data.oldId === oldId);
    return found ? found[0] : null;
}
