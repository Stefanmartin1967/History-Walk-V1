import L from 'leaflet';
import { state, MAX_CIRCUIT_POINTS, setSelectionMode, addPoiToCurrentCircuit, resetCurrentCircuit, addMyCircuit, updateMyCircuit, setTestedCircuits, setActiveCircuitId, setTestedCircuit, setOfficialCircuitStatus, setCustomDraftName, setCurrentFeatureId, setCurrentCircuitIndex, setCurrentCircuit } from './state.js';
import { DOM } from './ui-dom.js';
import { openDetailsPanel } from './ui-details.js';
import { switchSidebarTab } from './ui-sidebar.js';
import { getPoiId, getPoiName, applyFilters, recomputeVu } from './data.js';
import { getRealDistance, getOrthodromicDistance, map } from './map.js';
import { getAppState, saveAppState, saveCircuit, batchSavePoiData } from './database.js';
import { isMobileView, renderMobilePoiList } from './mobile.js';
import * as View from './circuit-view.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { eventBus } from './events.js';
import { pushToGist } from './gist-sync.js';

export function isCircuitTested(circuitId) {
    return state.testedCircuits[String(circuitId)] === true;
}

// Le statut "testé/vérifié" d'un circuit officiel est désormais dérivé
// automatiquement du "coché fait" par l'admin (cf. setCircuitVisitedState).
// Publication via Control Center → tous les users voient le bouclier vert.

export function isCircuitCompleted(circuit) {
    if (!circuit) return false;
    if (circuit.isOfficial) {
        // Pour les officiels, on regarde dans la carte d'état chargée
        return state.officialCircuitsStatus[circuit.id] === true;
    } else {
        // Pour les locaux, c'est une propriété directe
        return circuit.isCompleted === true;
    }
}

// --- LE CHEF D'ORCHESTRE (Traducteur pour la carte) ---
export function notifyCircuitChanged() {
    const event = new CustomEvent('circuit:updated', {
        detail: {
            points: state.currentCircuit,
            activeId: state.activeCircuitId
        }
    });
    window.dispatchEvent(event);
}

// --- FONCTION CORRIGÉE ---
export async function setCircuitVisitedState(circuitId, isVisited) {
    // Sanitization: Ensure ID is a string to match state structure
    circuitId = String(circuitId);

    // 1. Recherche du circuit (Local ou Officiel)
    let localCircuit = state.myCircuits.find(c => c.id === circuitId);
    let officialCircuit = state.officialCircuits ? state.officialCircuits.find(c => c.id === circuitId) : null;

    if (!localCircuit && !officialCircuit) return;

    // 2. Mise à jour de l'état (Mémoire & Persistance)
    try {
        // CORRECTION : Si un circuit est officiel (même s'il a un Shadow local),
        // on DOIT mettre à jour le statut officiel car c'est lui qui est lu par la liste Explorer.
        if (officialCircuit) {
            setOfficialCircuitStatus(circuitId, isVisited);
            officialCircuit.isCompleted = isVisited; // Maj en mémoire pour UI immédiate
            await saveAppState(`official_circuits_status_${state.currentMapId}`, state.officialCircuitsStatus);

            // Admin : "coché fait" = circuit vérifié (publié via Control Center).
            // Règle métier : si l'admin l'a fait, il est testé → rassure l'utilisateur lambda.
            if (state.isAdmin) {
                setTestedCircuit(circuitId, isVisited);
                await saveAppState(`tested_circuits_${state.currentMapId}`, state.testedCircuits);
            }
        }

        // Si on a (aussi ou uniquement) une copie locale (Shadow), on la met à jour aussi pour la cohérence
        if (localCircuit) {
            localCircuit.isCompleted = isVisited;
            await saveCircuit(localCircuit);
        }

        const name = (officialCircuit || localCircuit).name;

    } catch (error) {
        console.error("Erreur de sauvegarde statut circuit :", error);
        showToast("Erreur lors de la sauvegarde du statut", "error");
        return;
    }

    // 3. Mise à jour des POIs (contribution du circuit à l'état visité)
    // Modèle : chaque POI garde `visitedByCircuits` (liste des circuits qui le marquent).
    // `vu` est dérivé = vuManual || visitedByCircuits.length > 0.
    // Cocher "Fait"   → ajoute circuitId à visitedByCircuits
    // Décocher "Fait" → retire circuitId ; si plus aucun circuit et pas de vuManual, le POI redevient non-visité.
    const circuit = officialCircuit || localCircuit;
    if (circuit && circuit.poiIds && circuit.poiIds.length > 0) {
        const updates = [];
        circuit.poiIds.forEach(id => {
            const feature = state.loadedFeatures.find(f => getPoiId(f) === id);
            if (feature) {
                if (!feature.properties.userData) feature.properties.userData = {};
                const ud = feature.properties.userData;
                if (!Array.isArray(ud.visitedByCircuits)) ud.visitedByCircuits = [];

                if (isVisited) {
                    if (!ud.visitedByCircuits.includes(circuitId)) {
                        ud.visitedByCircuits.push(circuitId);
                    }
                } else {
                    ud.visitedByCircuits = ud.visitedByCircuits.filter(cid => cid !== circuitId);
                }
                recomputeVu(ud);

                // Mémoire state.userData (source de vérité pour updatePoiData et Gist)
                state.userData[id] = ud;

                updates.push({ poiId: id, data: ud });
            }
        });

        if (updates.length > 0) {
            try {
                await batchSavePoiData(state.currentMapId, updates);
                // Refresh des marqueurs (couleur peut changer dans les 2 sens)
                import('./data.js').then(({ applyFilters }) => applyFilters());
                // Push Gist (événement important)
                pushToGist();
            } catch (e) {
                console.error("Erreur mise à jour POIs du circuit:", e);
            }
        }
    }

    // 4. Mise à jour de l'interface
    // Si c'est le circuit actif affiché sur la carte, on doit redessiner la ligne (couleur change)
    if (state.activeCircuitId === circuitId) {
        notifyCircuitChanged();
    }

    // On notifie tout le monde que la liste a changé (pour mettre à jour la coche dans l'explorer)
    eventBus.emit('circuit:list-updated');
}


export async function saveCircuitDraft() {
    if (!state.currentMapId) return;
    try {
        // Petit helper local pour lire une valeur sans crasher si l'élément manque
        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? el.value : '';
        };

        const circuitData = {
            poiIds: state.currentCircuit.map(getPoiId).filter(Boolean),
            customDraftName: state.customDraftName,
            // On vérifie aussi DOM.circuitDescription au cas où
            description: DOM.circuitDescription ? DOM.circuitDescription.value : '',
            transport: {
                allerTemps: getVal('transport-aller-temps'),
                allerCout: getVal('transport-aller-cout'),
                retourTemps: getVal('transport-retour-temps'),
                retourCout: getVal('transport-retour-cout')
            }
        };
        await saveAppState(`circuitDraft_${state.currentMapId}`, circuitData);
    } catch (error) {
        console.error("Erreur lors de la sauvegarde du brouillon:", error);
    }
}

export async function loadCircuitDraft() {
    if (!state.currentMapId || state.loadedFeatures.length === 0) return;
    try {
        const savedData = await getAppState(`circuitDraft_${state.currentMapId}`);
        if (savedData && Array.isArray(savedData.poiIds) && savedData.poiIds.length > 0) {
            setCurrentCircuit(savedData.poiIds.map(id => state.loadedFeatures.find(feature => getPoiId(feature) === id)).filter(Boolean));
            setCustomDraftName(savedData.customDraftName || null);

            if (DOM.circuitTitleText) {
                DOM.circuitTitleText.textContent = state.customDraftName || generateCircuitName();
            }

            if (DOM.circuitDescription) DOM.circuitDescription.value = savedData.description || '';

            const tAllerTemps = document.getElementById('transport-aller-temps');
            if (tAllerTemps && savedData.transport) {
                tAllerTemps.value = savedData.transport.allerTemps || '';
                document.getElementById('transport-aller-cout').value = savedData.transport.allerCout || '';
                document.getElementById('transport-retour-temps').value = savedData.transport.retourTemps || '';
                document.getElementById('transport-retour-cout').value = savedData.transport.retourCout || '';
            }

            if (state.currentCircuit.length > 0) {
                if (!state.isSelectionModeActive) {
                    eventBus.emit('circuit:toggle-selection-mode', {});
                } else {
                    renderCircuitPanel();
                }
            }
        }
    } catch (e) {
        console.error("Erreur lors du chargement du brouillon sauvegardé:", e);
        await saveAppState(`circuitDraft_${state.currentMapId}`, null);
    }
}

// --- FONCTION POUR AJOUTER UN POINT (La version robuste) ---
// circuit.js

export function addPoiToCircuit(feature) {
    // 1. Sécurité : Si un circuit est déjà chargé (Mode Consultation)
    if (state.activeCircuitId) {
        showToast("Mode lecture seule. Cliquez sur 'Modifier' pour changer ce circuit.", "info");
        return false;
    }
    
    // 2. Sécurités habituelles
    if (state.currentCircuit.length > 0 && getPoiId(feature) === getPoiId(state.currentCircuit[state.currentCircuit.length - 1])) return false;
    if (state.currentCircuit.length >= MAX_CIRCUIT_POINTS) {
        showToast(`Maximum de ${MAX_CIRCUIT_POINTS} points atteint.`, 'warning');
        return false;
    }

    // 3. Ajout normal (Mode Brouillon)
    addPoiToCurrentCircuit(feature);
    saveAppState('currentCircuit', state.currentCircuit);
    saveCircuitDraft(); // On met à jour le brouillon complet (avec description vide ou existante)
    renderCircuitPanel(); 
    notifyCircuitChanged();
    return true;
}

// circuit.js (extrait)
// circuit.js
export function renderCircuitPanel() {
    const points = state.currentCircuit;

    // Détermine si le circuit est officiel (pour masquer les actions d'édition)
    const isOfficial = state.officialCircuits && state.activeCircuitId
        ? state.officialCircuits.some(c => c.id === state.activeCircuitId)
        : false;

    View.renderCircuitList(points, {
        onAction: (action, index) => handleCircuitAction(action, index),
        onDetails: (feature, index) => {
            const featureId = state.loadedFeatures.indexOf(feature);
            openDetailsPanel(featureId, index);
        }
    }, isOfficial);

    // On met à jour les boutons
    View.updateControlButtons({
        cannotLoop: points.length === 0 || points.length >= MAX_CIRCUIT_POINTS,
        isEmpty: points.length === 0,
        isActive: !!state.activeCircuitId // On passe l'info si un circuit est chargé
    });

    updateCircuitMetadata();
    notifyCircuitChanged(); // Cette fonction va maintenant choisir la bonne ligne !
}

export function updateCircuitMetadata(updateTitle = true) {
    // 1. LOGIQUE DE CALCUL (On récupère ce qui était dans ton ancienne fonction)
    let totalDistance = 0;
    let isRealTrack = false;

    const activeCircuitData = state.myCircuits.find(c => c.id === state.activeCircuitId);

    if (activeCircuitData && activeCircuitData.realTrack) {
        totalDistance = getRealDistance(activeCircuitData);
        isRealTrack = true;
    } else {
        totalDistance = getOrthodromicDistance(state.currentCircuit);
    }

    // Priorité : Titre sauvegardé > Titre personnalisé brouillon > Génération auto
    let title = state.customDraftName || generateCircuitName();
    if (activeCircuitData && activeCircuitData.name && !activeCircuitData.name.startsWith("Nouveau Circuit")) {
        title = activeCircuitData.name;
    }

    // Détermine si le circuit actif est officiel et testé (pour le badge desktop)
    const isOfficialActive = state.officialCircuits && state.activeCircuitId
        ? state.officialCircuits.some(c => c.id === state.activeCircuitId)
        : false;
    const isTestedActive = isOfficialActive ? isCircuitTested(state.activeCircuitId) : false;

    // 2. ENVOI À LA VUE (On ne touche plus au DOM ici)
    View.updateCircuitHeader({
        countText: `${state.currentCircuit.length}/${MAX_CIRCUIT_POINTS}`,
        distanceText: (totalDistance / 1000).toFixed(1) + ' km',
        title: title,
        iconType: isRealTrack ? 'footprints' : 'bird',
        iconTitle: isRealTrack ? 'Distance du tracé réel' : "Distance à vol d'oiseau",
        isOfficial: isOfficialActive,
        isTested: isTestedActive,
        circuitId: state.activeCircuitId
    });
}

function handleCircuitAction(action, index) {
    if (action === 'up' && index > 0) {
        [state.currentCircuit[index], state.currentCircuit[index - 1]] = [state.currentCircuit[index - 1], state.currentCircuit[index]];
    } else if (action === 'down' && index < state.currentCircuit.length - 1) {
        [state.currentCircuit[index], state.currentCircuit[index + 1]] = [state.currentCircuit[index + 1], state.currentCircuit[index]];
    } else if (action === 'remove') {
        const removedFeature = state.currentCircuit[index];
        state.currentCircuit.splice(index, 1);

        if (state.currentFeatureId !== null && getPoiId(state.loadedFeatures[state.currentFeatureId]) === getPoiId(removedFeature)) {
            setCurrentFeatureId(null);
            setCurrentCircuitIndex(null);

            if (document.querySelector('#details-panel.active')) {
                if (state.currentCircuit.length > 0) {
                    const firstFeatureId = state.loadedFeatures.indexOf(state.currentCircuit[0]);
                    openDetailsPanel(firstFeatureId, 0);
                } else {
                    switchSidebarTab('circuit');
                }
            }
        }
    }
    saveCircuitDraft();
    renderCircuitPanel();
}

export function generateCircuitName() {
    if (state.currentCircuit.length === 0) return "Nouveau Circuit";
    if (state.currentCircuit.length === 1) return `Départ de ${getPoiName(state.currentCircuit[0])}`;

    const startPoi = getPoiName(state.currentCircuit[0]);
    const endPoi = getPoiName(state.currentCircuit[state.currentCircuit.length - 1]);

    let middlePoi = "";
    if (state.currentCircuit.length > 2) {
        const middleIndex = Math.floor((state.currentCircuit.length - 1) / 2);
        middlePoi = getPoiName(state.currentCircuit[middleIndex]);
    }

    if (getPoiId(state.currentCircuit[0]) === getPoiId(state.currentCircuit[state.currentCircuit.length - 1])) {
        if (middlePoi && startPoi !== middlePoi) {
            return `Boucle autour de ${startPoi} via ${middlePoi}`;
        }
        return `Boucle autour de ${startPoi}`;
    }
    else {
        if (middlePoi) {
            return `Circuit de ${startPoi} à ${endPoi} via ${middlePoi}`;
        }
        return `Circuit de ${startPoi} à ${endPoi}`;
    }
}

// --- FONCTION POUR VIDER LE BROUILLON (Version Majordome + UI) ---
export async function clearCircuit(withConfirmation = true) {
    // CAS 1 : On consulte un circuit enregistré (Mode Consultation)
    if (state.activeCircuitId) {
        // Pas d'alerte, on "ferme" juste la vue
        eventBus.emit('circuit:toggle-selection-mode', { force: false }); // Cette fonction ferme déjà le panneau et nettoie la carte
        resetCurrentCircuit();
        setActiveCircuitId(null);
    }
    else {
        // CAS 2 : On est en mode Brouillon (Modification en cours)
        const hasPoints = state.currentCircuit.length > 0;
        if (withConfirmation && hasPoints) {
            if (!await showConfirm("Réinitialiser", "Voulez-vous vraiment réinitialiser ce brouillon ?", "Réinitialiser", "Annuler", true)) return;
        }
        resetCurrentCircuit();
        setActiveCircuitId(null);
    }

    // NETTOYAGE COMMUN (IMPORTANT pour éviter les fantômes)
    if(DOM.circuitDescription) DOM.circuitDescription.value = '';
    if(DOM.circuitTitleText) DOM.circuitTitleText.textContent = 'Nouveau Circuit';
    
    setCustomDraftName(null);

    // On vide le brouillon persistant
    await saveAppState(`circuitDraft_${state.currentMapId}`, null);
    await saveAppState('currentCircuit', []);

    renderCircuitPanel();
    notifyCircuitChanged();
}

export function navigatePoiDetails(direction) {
    if (state.currentCircuitIndex === null) return;

    const newIndex = state.currentCircuitIndex + direction;

    if (newIndex >= 0 && newIndex < state.currentCircuit.length) {
        const newFeature = state.currentCircuit[newIndex];
        const newFeatureId = state.loadedFeatures.indexOf(newFeature);
        openDetailsPanel(newFeatureId, newIndex);
    }
}

// circuit.js

export function convertToDraft() {
    if (!state.activeCircuitId) return;

    // 1. On "oublie" l'ID pour autoriser l'édition
    setActiveCircuitId(null);
    
    // 2. On change le nom pour ne pas écraser l'original par mégarde plus tard
    if (DOM.circuitTitleText) {
        DOM.circuitTitleText.textContent += " (modifié)";
    }

    showToast("Mode édition activé. Vous pouvez maintenant modifier ce circuit.", "info");

    // 3. On redessine tout (Boutons + Carte)
    renderCircuitPanel(); 
    notifyCircuitChanged(); // Cela va forcer le passage à la ligne bleue
}

export async function loadCircuitById(id) {
    // Sanitization: Ensure ID is a string for strict equality checks
    id = String(id);

    let circuitToLoad = state.myCircuits.find(c => c.id === id);
    if (!circuitToLoad && state.officialCircuits) {
        circuitToLoad = state.officialCircuits.find(c => c.id === id);
        // Protection contre la mutation de la liste officielle
        if (circuitToLoad) {
            circuitToLoad = { ...circuitToLoad };
        }
    }

    if (!circuitToLoad) return;

    // --- LAZY LOADING DE LA TRACE (OFFICIAL CIRCUITS) ---
    if (circuitToLoad.file && (!circuitToLoad.realTrack || circuitToLoad.realTrack.length === 0)) {
        try {
            // Correction URL : encodage pour gérer les espaces et apostrophes
            const safeUrl = `./circuits/${circuitToLoad.file.split('/').map(encodeURIComponent).join('/')}`;
            const response = await fetch(safeUrl);
            if (response.ok) {
                const text = await response.text();
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(text, "text/xml");
                const trkpts = xmlDoc.getElementsByTagName("trkpt");
                const coordinates = [];
                for (let i = 0; i < trkpts.length; i++) {
                    const lat = parseFloat(trkpts[i].getAttribute("lat"));
                    const lon = parseFloat(trkpts[i].getAttribute("lon"));
                    coordinates.push([lat, lon]);
                }

                if (coordinates.length > 0) {
                    circuitToLoad.realTrack = coordinates;

                    // FIX: On met à jour la source de vérité en mémoire (state.officialCircuits)
                    // Sinon, la carte (qui relit le state) ne verra pas la trace tout de suite
                    const originalOfficial = state.officialCircuits.find(c => c.id === id);
                    if (originalOfficial) {
                        originalOfficial.realTrack = coordinates;
                    }

                    // On sauvegarde pour persistance (IndexedDB)
                    await saveCircuit(circuitToLoad);

                    // FIX: On ajoute le circuit aux "Locaux" (Shadow) pour qu'il soit inclus dans les backups (saveUserData)
                    // Cela permet de restaurer la trace bleue même si le fichier GPX serveur est inaccessible (Offline/Clear DB)
                    const shadowIndex = state.myCircuits.findIndex(c => c.id === id);
                    if (shadowIndex === -1) {
                        // On s'assure que le flag isOfficial est présent pour que l'UI le masque (évite les doublons visuels)
                        if (!circuitToLoad.isOfficial) circuitToLoad.isOfficial = true;
                        addMyCircuit(circuitToLoad);
                    } else {
                        // Mise à jour du shadow existant
                        const updatedShadow = { ...state.myCircuits[shadowIndex] };
                        updatedShadow.realTrack = coordinates;
                        updateMyCircuit(updatedShadow);
                    }

                }
            } else {
                console.warn(`[Circuit] Fichier GPX introuvable : ${circuitToLoad.file}`);
            }
        } catch (e) {
            console.error(`[Circuit] Erreur chargement trace :`, e);
        }
    }

    // 1. Nettoyage de l'ancien état (sans confirmation)
    await clearCircuit(false);

    // 2. Mise à jour de l'état
    setActiveCircuitId(id);
    setCurrentCircuit(
        circuitToLoad.poiIds
            .map(poiId => state.loadedFeatures.find(f => getPoiId(f) === poiId))
            .filter(Boolean)
    );

    // 3. Délégation à la VUE (On sort le HTML d'ici !)
    View.updateCircuitForm(circuitToLoad);

    // 4. Gestion de l'affichage selon le mode (Mobile ou PC)
    if (isMobileView()) {
        renderMobilePoiList(state.currentCircuit);
    } else {
        // Active le mode sélection si besoin et rafraîchit le panneau
        if (!state.isSelectionModeActive) {
            eventBus.emit('circuit:toggle-selection-mode', { force: true });
        } else {
            renderCircuitPanel();
        }
        applyFilters();

        // 5. Centrage Intelligent de la carte
        if (map && (state.currentCircuit.length > 0 || circuitToLoad.realTrack)) {
            // On priorise la trace réelle pour le centrage si elle existe
            const pointsToFit = (circuitToLoad.realTrack && circuitToLoad.realTrack.length > 0)
                ? circuitToLoad.realTrack
                : state.currentCircuit.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);

            // On crée un groupe temporaire pour calculer les limites (bounds)
            const bounds = L.latLngBounds(pointsToFit);
            // Padding augmenté pour éviter que le circuit ne touche les bords (surtout avec la sidebar)
            map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        }
    }

    // On force un dernier rafraîchissement des lignes pour être sûr
    notifyCircuitChanged();
}

export async function loadCircuitFromIds(inputString, importedName = null) {
    if (!inputString) return;

    let idsStr = '';

    // 1. Parsing intelligent (URL vs Legacy hw:)
    if (inputString.includes('import=')) {
        // Format URL : http://.../?import=ID1,ID2
        try {
            // Astuce : on utilise une base fictive si l'URL est relative ou partielle, juste pour parser les params
            const urlObj = new URL(inputString.startsWith('http') ? inputString : 'https://dummy/' + inputString);
            idsStr = urlObj.searchParams.get('import');

            // Si le nom n'a pas été passé explicitement, on tente de le récupérer dans l'URL
            if (!importedName && urlObj.searchParams.has('name')) {
                importedName = urlObj.searchParams.get('name');
            }
        } catch (e) {
            // Fallback manuel si l'URL est malformée
            const match = inputString.match(/import=([^&]*)/);
            if (match) idsStr = match[1];
        }
    } else if (inputString.startsWith('hw:')) {
        // Format Legacy : hw:ID1,ID2
        idsStr = inputString.replace('hw:', '');
    } else {
        // Format Brut (Fallback)
        idsStr = inputString;
    }

    if (!idsStr) {
        showToast("Format de circuit invalide", "error");
        return;
    }

    const ids = idsStr.split(',').filter(Boolean);
    if (ids.length === 0) {
        showToast("Données de circuit vides", "warning");
        return;
    }

    // 2. Reconstruction et Résolution des POIs
    let foundCount = 0;
    const resolvedFeatures = ids.map(id => {
        const feature = state.loadedFeatures.find(f => getPoiId(f) === id);
        if (feature) foundCount++;
        return feature;
    }).filter(Boolean);

    if (resolvedFeatures.length === 0) {
        showToast("Aucune étape correspondante trouvée dans la base", "warning");
        return;
    }

    // 3. SAUVEGARDE EN BASE (Persistence)
    // On crée un vrai objet Circuit pour qu'il apparaisse dans la liste
    const newCircuitId = `circuit-${Date.now()}`;
    const newCircuit = {
        id: newCircuitId,
        mapId: state.currentMapId || 'djerba',
        name: importedName ? decodeURIComponent(importedName) : `Circuit Importé (${new Date().toLocaleDateString()})`,
        description: "Circuit importé via QR Code",
        poiIds: resolvedFeatures.map(getPoiId),
        realTrack: null,
        transport: { allerTemps: '', allerCout: '', retourTemps: '', retourCout: '' }
    };

    try {
        await saveCircuit(newCircuit);
        addMyCircuit(newCircuit); // Mise à jour mémoire
        eventBus.emit('circuit:list-updated'); // Mise à jour UI
    } catch (err) {
        console.error("Erreur sauvegarde circuit importé:", err);
        showToast("Erreur lors de la sauvegarde du circuit", "error");
        return;
    }

    // 4. CHARGEMENT (Activer le circuit nouvellement créé)
    await clearCircuit(false);

    setActiveCircuitId(newCircuitId);
    setCurrentCircuit(resolvedFeatures);

    // 5. Mise à jour de l'affichage
    if (isMobileView()) {
        renderMobilePoiList(state.currentCircuit);
        import('./mobile.js').then(m => m.switchMobileView('circuits'));
    } else {
        renderCircuitPanel();
        if (!state.isSelectionModeActive) {
            eventBus.emit('circuit:toggle-selection-mode', { force: true });
        }
        applyFilters();

        if (typeof map !== 'undefined' && map && state.currentCircuit.length > 0) {
            const points = state.currentCircuit.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
            const bounds = L.latLngBounds(points);
            map.flyToBounds(bounds, { padding: [50, 50] });
        }
    }

    notifyCircuitChanged();
    showToast(`Circuit importé et sauvegardé : ${foundCount} étapes`, "success");
}

