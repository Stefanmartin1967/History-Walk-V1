
// circuit-actions.js
import { state, addMyCircuit, updateMyCircuit, setActiveCircuitId, setHasUnexportedChanges, setOfficialCircuits } from './state.js';
import { deleteCircuitById, softDeleteCircuit, getAppState, saveCircuit } from './database.js';
import { clearCircuit, setCircuitVisitedState, generateCircuitName } from './circuit.js';
import { applyFilters, getPoiId, passesUserFilters, passesStructuralFilters } from './data.js';
import { isMobileView } from './mobile-state.js';
import { showConfirm } from './modal.js';
import { showToast } from './toast.js';
import { generateHWID } from './utils.js';
import { generateAndDownloadGPX } from './gpx.js';
import { DOM } from './ui-dom.js';
import { getStoredToken } from './github-sync.js';
import { RAW_BASE, GITHUB_PATHS } from './config.js';
import { recordModification } from './backup-auto-local.js';

/**
 * B1 — Détection de doublon à la source : compare la signature `poiIds` du
 * circuit local à celle des circuits déjà publiés (circuits.json sur GitHub).
 *
 * Signature retenue = `poiIds.join('|')` SEUL. La distance n'est pas un
 * critère fiable car elle peut être calculée différemment (orthodromique
 * live vs valeur stockée à la publication).
 *
 * Skippe silencieusement si pas de token, pas de POIs, fichier manquant ou
 * réseau indisponible — la détection ne doit jamais bloquer une sauvegarde.
 *
 * @param {string[]} poiIds - Séquence d'IDs du circuit local à vérifier
 * @param {string} [excludeId] - ID du circuit en cours d'édition (à ignorer)
 * @returns {Promise<Object|null>} - Circuit remote dupliqué, ou null
 */
export async function checkCircuitDuplicate(poiIds, excludeId = null) {
    const token = getStoredToken();
    if (!token || !poiIds || poiIds.length === 0) return null;

    const mapId = state.currentMapId || 'djerba';
    try {
        const res = await fetch(`${RAW_BASE}/${GITHUB_PATHS.circuits(mapId)}?t=${Date.now()}`);
        if (!res.ok) return null;
        const remote = await res.json();
        const sig = poiIds.join('|');
        return remote.find(c =>
            String(c.id) !== String(excludeId) &&
            (c.poiIds || []).join('|') === sig
        ) || null;
    } catch (e) {
        return null;
    }
}

/**
 * Logique métier pour supprimer un circuit
 * Gère la base de données, l'état mémoire et les calculs GPX
 */
export async function performCircuitDeletion(id) {
    try {
        // 0. Gestion suppression (Officiel vs Local)
        const isOfficial = state.officialCircuits && state.officialCircuits.some(c => c.id === id);

        if (isOfficial) {
            if (!state.isAdmin) {
                return { success: false, message: "Impossible de supprimer un circuit officiel." };
            }
            // ADMIN : Suppression Mémoire Uniquement (Pour Export)
            setOfficialCircuits(state.officialCircuits.filter(c => c.id !== id));
            // On ne touche pas à softDeleteCircuit (DB) car ils n'y sont pas.
        } else {
            // STANDARD : Suppression logique (Corbeille)
            await softDeleteCircuit(id);

            // Mise à jour de la mémoire (state) pour les locaux
            const circuit = state.myCircuits.find(c => c.id === id);
            if (circuit) circuit.isDeleted = true;
        }
        
        // FLAG CHANGEMENT
        setHasUnexportedChanges(true);

        // [USER] Compte la suppression de circuit pour l'auto-backup local.
        void recordModification();

        // 3. Si c'était le circuit actif, on nettoie l'affichage
        if (state.activeCircuitId === id) {
            await clearCircuit(false);
        }

        // 4. Mise à jour des filtres (uniquement sur Desktop)
        // Le compteur planifié est calculé à la volée par computePlanifieCounter (data.js)
        if (!isMobileView()) {
            applyFilters();
        }
        
        // 6. Succès : On renvoie l'info ET le texte à afficher
        return { 
            success: true, 
            message: "Le circuit a été déplacé dans la corbeille."
        };

    } catch (error) {
        // En cas de panne technique (ex: base de données verrouillée)
        console.error("Erreur technique lors de la suppression:", error);
        return { 
            success: false, 
            message: "Erreur technique : impossible de supprimer le circuit." 
        };
    }
}

/**
 * Gère l'action utilisateur de bascule du statut "Fait" d'un circuit avec dialogues de confirmation.
 * @param {string} circuitId
 * @param {boolean} currentStatus - Le statut actuel (avant le clic) : true = Déjà fait (on veut décocher), false = Pas fait (on veut cocher)
 * @returns {Promise<{success: boolean, newState?: boolean}>}
 */
export async function handleCircuitVisitedToggle(circuitId, currentStatus) {
    try {
        if (currentStatus) {
             // Il est coché, on veut le décocher
             if (await showConfirm("Réinitialisation", "Voulez-vous vraiment décocher tous les lieux (remettre à 'Non visité') ?", "Tout décocher", "Annuler", true)) {
                 await setCircuitVisitedState(circuitId, false);
                 return { success: true, newState: false };
             }
        } else {
             // Il n'est pas coché, on veut le cocher
             if (await showConfirm("Circuit Terminé", "Bravo ! Marquer tous les lieux de ce circuit comme visités ?", "Tout cocher", "Annuler")) {
                 await setCircuitVisitedState(circuitId, true);
                 return { success: true, newState: true };
             }
        }
        // Annulation par l'utilisateur
        return { success: false };

    } catch (error) {
        console.error("Erreur toggle circuit visited:", error);
        return { success: false };
    }
}


/**
 * Prépare les données des zones : filtre les POI (mêmes règles personnelles +
 * filtre catégorie multi que getFilteredFeatures) et compte les occurrences par
 * zone. Le filtre Zone lui-même est volontairement ignoré (skipZone:true) pour
 * que chaque zone affiche son compte propre, indépendamment de la zone
 * actuellement sélectionnée.
 */
export function getZonesData() {
    if (!state.loadedFeatures || state.loadedFeatures.length === 0) return null;

    const preFilteredFeatures = state.loadedFeatures.filter(f =>
        passesStructuralFilters(f, { skipZone: true }) && passesUserFilters(f)
    );

    const zoneCounts = preFilteredFeatures.reduce((acc, feature) => {
        const zone = feature.properties.Zone;
        if (zone) acc[zone] = (acc[zone] || 0) + 1;
        return acc;
    }, {});

    return {
        totalVisible: preFilteredFeatures.length,
        zoneCounts: zoneCounts,
        sortedZones: Object.keys(zoneCounts).sort()
    };
}








// NOTE : Les fonctions computeCircuitCounters() et recalculatePlannedCountersForMap()
// ont été supprimées le 03/05/2026. Le compteur planifié est désormais calculé à la
// volée par computePlanifieCounter() (data.js), évitant les bugs de désynchronisation
// (cf. mémoire project_planifie_counter_definition.md).

export async function saveAndExportCircuit() {
    if (state.currentCircuit.length === 0) return;

    // 1. Détermination du nom : Priorité à l'interface (User) sur la génération auto
    let circuitName = generateCircuitName();
    if (DOM.circuitTitleText && DOM.circuitTitleText.textContent) {
        const uiTitle = DOM.circuitTitleText.textContent.trim();
        // Si le titre de l'UI n'est pas le placeholder par défaut, on le garde
        if (uiTitle && uiTitle !== "Nouveau Circuit") {
            circuitName = uiTitle;
        }
    }

    const draft = await getAppState(`circuitDraft_${state.currentMapId}`);
    let description = (draft && draft.description) ? draft.description : '';
    const transportData = (draft && draft.transport) ? draft.transport : {};

    // --- MODIFICATION V2 : AJOUT SIGNATURE AUTOMATIQUE ---
    const signature = "\n\nCircuit généré par Heripia — heripia.com";
    if (!description.includes("History Walk") && !description.includes("Heripia")) {
        description += signature;
    }
    // ----------------------------------------------------

    const poiIds = state.currentCircuit.map(getPoiId);

    let circuitToSave;

    if (state.activeCircuitId) {
        const index = state.myCircuits.findIndex(c => c.id === state.activeCircuitId);
        if (index > -1) {
            circuitToSave = { ...state.myCircuits[index] };
            circuitToSave.name = circuitName;
            circuitToSave.description = description;
            circuitToSave.poiIds = poiIds;
            circuitToSave.transport = transportData;
            updateMyCircuit(circuitToSave);
        } else {
             // Recherche dans les circuits officiels (si on est en train d'éditer une version officielle)
             const offIndex = state.officialCircuits ? state.officialCircuits.findIndex(c => c.id === state.activeCircuitId) : -1;
             if (offIndex > -1) {
                 // On met à jour l'objet en mémoire
                 const offCircuit = state.officialCircuits[offIndex];
                 offCircuit.name = circuitName;
                 offCircuit.description = description;
                 offCircuit.poiIds = poiIds;
                 offCircuit.transport = transportData;
                 // On prépare l'objet pour la sauvegarde DB
                 circuitToSave = offCircuit;
             }
        }
    }

    if (!circuitToSave) {
        const newId = generateHWID();
        circuitToSave = {
            id: newId,
            mapId: state.currentMapId,
            name: circuitName,
            description: description,
            poiIds: poiIds,
            realTrack: null,
            transport: transportData
        };

        addMyCircuit(circuitToSave);
        setActiveCircuitId(newId);
    }

    // B1 — Vérification anti-doublon à la source (admin uniquement, skip silencieux
    // si pas de token / offline). Mieux qu'une détection post-hoc dans Nettoyage :
    // l'admin est alerté AVANT de polluer le repo.
    if (state.isAdmin) {
        const dupe = await checkCircuitDuplicate(poiIds, circuitToSave.id);
        if (dupe) {
            const proceed = await showConfirm(
                "Circuit similaire détecté",
                `Un circuit avec exactement les mêmes étapes existe déjà : « ${dupe.name} ».\n\nVoulez-vous l'enregistrer quand même ?`,
                "Continuer",
                "Annuler"
            );
            if (!proceed) {
                showToast("Sauvegarde annulée", "info");
                return;
            }
        }
    }

    try {
        await saveCircuit(circuitToSave);
        setHasUnexportedChanges(true); // FLAG CHANGEMENT
        // Compteur planifié calculé à la volée → applyFilters suffit pour rafraîchir
        applyFilters();
        await generateAndDownloadGPX(state.currentCircuit, circuitToSave.id, circuitToSave.name, circuitToSave.description, circuitToSave.realTrack);
        showToast(`Circuit "${circuitToSave.name}" sauvegardé !`, 'success');
        // [USER] Compte la création/modif du circuit pour l'auto-backup local.
        void recordModification();
    } catch (error) {
        console.error("Erreur lors de la sauvegarde du circuit :", error);
        showToast("Erreur lors de la sauvegarde du circuit.", 'error');
    }
}

