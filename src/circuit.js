import { state, MAX_CIRCUIT_POINTS, setSelectionMode, addPoiToCurrentCircuit, resetCurrentCircuit } from './state.js';
import { DOM, openDetailsPanel, updateSelectionModeButton } from './ui.js';
import { switchSidebarTab } from './ui-sidebar.js';
import { getPoiId, getPoiName, applyFilters } from './data.js';
import { drawLineOnMap, clearMapLines, getRealDistance, getOrthodromicDistance, map } from './map.js';
import { saveAndExportCircuit } from './gpx.js';
import { getAppState, saveAppState, saveCircuit, batchSavePoiData } from './database.js';
// import { saveUserData } from './fileManager.js'; // <--- RETRAIT (C'était la cause du bug de fenêtre)
import { isMobileView, renderMobilePoiList } from './mobile.js';
import * as View from './circuit-view.js';
import { showToast } from './toast.js';
import { showConfirm, showAlert, showPrompt } from './modal.js';
import { performCircuitDeletion } from './circuit-actions.js';
import { eventBus } from './events.js';
import { escapeHtml } from './utils.js';
import QRCode from 'qrcode';

export function isCircuitCompleted(circuit) {
    if (!circuit) return false;
    if (circuit.isOfficial) {
        // Pour les officiels, on regarde dans la carte d'état chargée
        // FIX: Utilisation de String() pour éviter les mismatches (101 vs "101")
        return state.officialCircuitsStatus[String(circuit.id)] === true;
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
    // 1. Recherche du circuit (Local ou Officiel)
    // FIX: Recherche robuste avec String()
    let localCircuit = state.myCircuits.find(c => String(c.id) === String(circuitId));
    let officialCircuit = state.officialCircuits ? state.officialCircuits.find(c => String(c.id) === String(circuitId)) : null;

    if (!localCircuit && !officialCircuit) return;

    // 2. Mise à jour de l'état (Mémoire & Persistance)
    try {
        // CORRECTION : Si un circuit est officiel (même s'il a un Shadow local),
        // on DOIT mettre à jour le statut officiel car c'est lui qui est lu par la liste Explorer.
        if (officialCircuit) {
            state.officialCircuitsStatus[String(circuitId)] = isVisited;
            officialCircuit.isCompleted = isVisited; // Maj en mémoire pour UI immédiate
            await saveAppState(`official_circuits_status_${state.currentMapId}`, state.officialCircuitsStatus);
        }

        // Si on a (aussi ou uniquement) une copie locale (Shadow), on la met à jour aussi pour la cohérence
        if (localCircuit) {
            localCircuit.isCompleted = isVisited;
            await saveCircuit(localCircuit);
        }

        const name = (officialCircuit || localCircuit).name;
        console.log(`[Circuit] Circuit "${name}" marqué comme ${isVisited ? 'FAIT' : 'NON FAIT'}.`);

    } catch (error) {
        console.error("Erreur de sauvegarde statut circuit :", error);
        showToast("Erreur lors de la sauvegarde du statut", "error");
        return;
    }

    // 3. Mise à jour de l'interface
    // On ne touche plus aux POIs ("On ne s'occupe pas du statut visité")

    // Si c'est le circuit actif affiché sur la carte, on doit redessiner la ligne (couleur change)
    if (state.activeCircuitId === circuitId) {
        notifyCircuitChanged();
    }

    // On notifie tout le monde que la liste a changé (pour mettre à jour la coche dans l'explorer)
    eventBus.emit('circuit:list-updated');
}

// ... LE RESTE DU FICHIER RESTE IDENTIQUE ...
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
            state.currentCircuit = savedData.poiIds.map(id => state.loadedFeatures.find(feature => getPoiId(feature) === id)).filter(Boolean);
            state.customDraftName = savedData.customDraftName || null;

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
                    toggleSelectionMode();
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

// --- LE BOUTON QUI APPELLE LE MAJORDOME ET GÈRE L'AFFICHAGE ---
export function toggleSelectionMode(forceValue) {
    // 1. Le Majordome gère la donnée (L'État)
    // On garde votre logique de "forceValue" qui était très bien
    if (typeof forceValue === 'boolean') {
        setSelectionMode(forceValue);
    } else {
        setSelectionMode(!state.isSelectionModeActive);
    }

    // 2. Mise à jour du bouton
    if (DOM.btnModeSelection) {
        DOM.btnModeSelection.classList.toggle('active', state.isSelectionModeActive);
        updateSelectionModeButton(state.isSelectionModeActive);
    }

    // 3. Gestion de l'Interface (Panneaux et Lignes)
    if (state.isSelectionModeActive) {
        if (DOM.rightSidebar) {
            DOM.rightSidebar.style.display = 'flex';
            document.body.classList.add('sidebar-open');
        }
        switchSidebarTab('circuit');
        renderCircuitPanel();
    } else {
        if (DOM.rightSidebar) {
            DOM.rightSidebar.style.display = 'none';
            document.body.classList.remove('sidebar-open');
        }
        if (state.orthodromicPolyline) state.orthodromicPolyline.remove();
        if (state.realTrackPolyline) state.realTrackPolyline.remove();
    }

    applyFilters();
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

    View.renderCircuitList(points, {
        onAction: (action, index) => handleCircuitAction(action, index),
        onDetails: (feature, index) => {
            const featureId = state.loadedFeatures.indexOf(feature);
            openDetailsPanel(featureId, index);
        }
    });

    // On met à jour les boutons
    View.updateControlButtons({
        cannotLoop: points.length === 0 || points.length >= MAX_CIRCUIT_POINTS,
        isEmpty: points.length === 0,
        isActive: !!state.activeCircuitId // On passe l'info si un circuit est chargé
    });

    updateCircuitMetadata();
    notifyCircuitChanged();; // Cette fonction va maintenant choisir la bonne ligne !
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

    // 2. ENVOI À LA VUE (On ne touche plus au DOM ici)
    View.updateCircuitHeader({
        countText: `${state.currentCircuit.length}/${MAX_CIRCUIT_POINTS}`,
        distanceText: (totalDistance / 1000).toFixed(1) + ' km',
        title: title,
        iconType: isRealTrack ? 'footprints' : 'bird',
        iconTitle: isRealTrack ? 'Distance du tracé réel' : "Distance à vol d'oiseau"
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
            state.currentFeatureId = null;
            state.currentCircuitIndex = null;

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
        toggleSelectionMode(false); // Cette fonction ferme déjà le panneau et nettoie la carte
        resetCurrentCircuit();
        state.activeCircuitId = null;
    }
    else {
        // CAS 2 : On est en mode Brouillon (Modification en cours)
        const hasPoints = state.currentCircuit.length > 0;
        if (withConfirmation && hasPoints) {
            if (!await showConfirm("Réinitialiser", "Voulez-vous vraiment réinitialiser ce brouillon ?", "Réinitialiser", "Annuler", true)) return;
        }
        resetCurrentCircuit();
        state.activeCircuitId = null;
    }

    // NETTOYAGE COMMUN (IMPORTANT pour éviter les fantômes)
    if(DOM.circuitDescription) DOM.circuitDescription.value = '';
    if(DOM.circuitTitleText) DOM.circuitTitleText.textContent = 'Nouveau Circuit';
    
    state.customDraftName = null;

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
    state.activeCircuitId = null;
    
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
            console.log(`[Circuit] Chargement de la trace depuis ${circuitToLoad.file}...`);
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
                    const shadowIndex = state.myCircuits.findIndex(c => String(c.id) === String(id));
                    if (shadowIndex === -1) {
                        // On s'assure que le flag isOfficial est présent pour que l'UI le masque (évite les doublons visuels)
                        if (!circuitToLoad.isOfficial) circuitToLoad.isOfficial = true;
                        state.myCircuits.push(circuitToLoad);
                    } else {
                        // Mise à jour du shadow existant
                        state.myCircuits[shadowIndex].realTrack = coordinates;
                    }

                    console.log(`[Circuit] Trace chargée (${coordinates.length} points) et sauvegardée (Shadow).`);
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
    state.activeCircuitId = id;
    state.currentCircuit = circuitToLoad.poiIds
        .map(poiId => state.loadedFeatures.find(f => getPoiId(f) === poiId))
        .filter(Boolean);

    // 3. Délégation à la VUE (On sort le HTML d'ici !)
    View.updateCircuitForm(circuitToLoad);

    // 4. Gestion de l'affichage selon le mode (Mobile ou PC)
    if (isMobileView()) {
        renderMobilePoiList(state.currentCircuit);
    } else {
        // Active le mode sélection si besoin et rafraîchit le panneau
        if (!state.isSelectionModeActive) {
            toggleSelectionMode(true);
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
    notifyCircuitChanged();;
}

// --- GÉNÉRATION QR CODE (OFFICIEL: ONGLETS, LOCAL: UNIQUE) ---

export async function generateCircuitQR() {
    if (state.currentCircuit.length === 0) return;

    let activeCircuit = state.myCircuits.find(c => c.id === state.activeCircuitId);
    let isOfficial = false;
    let gpxFile = null;

    // Recherche Prioritaire dans les Officiels (Source de Vérité)
    const officialCandidate = state.officialCircuits ? state.officialCircuits.find(c => c.id === state.activeCircuitId) : null;

    if (officialCandidate) {
        // C'est un officiel certifié
        activeCircuit = officialCandidate;
        isOfficial = true;
        gpxFile = officialCandidate.file;
    } else if (!activeCircuit) {
        // Circuit introuvable (ni local ni officiel)
        return;
    } else {
        // C'est un circuit local : On vérifie s'il prétend être officiel
        if (activeCircuit.isOfficial) {
             isOfficial = true;
             gpxFile = activeCircuit.file;
        }
    }

    const circuitName = activeCircuit ? activeCircuit.name : generateCircuitName();
    const displayTitle = circuitName.split(' via ')[0]; // TRONCATURE

    // --- MODE PC: RATIONALISATION DU PARTAGE ---
    // Si c'est un officiel avec fichier GPX, on affiche le lien de téléchargement direct.
    // Sinon, on affiche un message d'information.

    // Le QR Code App n'est plus généré ni affiché sur PC pour simplifier.

    if (isMobileView()) {
        // --- MOBILE: Affichage standard (QR App) ---
        // Génération du lien "Ouvrir dans l'App" (Commun)
        const ids = state.currentCircuit.map(getPoiId).filter(Boolean);
        const baseUrl = window.location.origin + window.location.pathname;
        const appDataString = `${baseUrl}?import=${ids.join(',')}&name=${encodeURIComponent(circuitName)}`;

        let qrApp;
        try {
            qrApp = await QRCode.toDataURL(appDataString, { width: 300, margin: 2 });
        } catch (e) {
            console.error("Erreur QR App", e);
            showToast("Erreur génération QR", "error");
            return;
        }

        const htmlContent = `
            <div style="display:flex; flex-direction:column; align-items:center; gap:15px;">
                <img src="${qrApp}" style="width:250px; height:250px; border-radius:10px; border:1px solid var(--line);">
                <p style="text-align:center; color:var(--ink-soft); font-size:14px;">
                    Partager ce circuit avec un autre appareil.
                </p>
                <div style="font-size:14px; font-weight:bold; color:var(--text-main); word-break:break-word; text-align:center; max-width:100%;">
                    ${escapeHtml(circuitName)}
                </div>
            </div>
        `;
        await showAlert("Partager le circuit", htmlContent, "Fermer");

    } else {
        // --- PC: Affichage Compact (GPX Uniquement) ---

        if (isOfficial && gpxFile) {
            // Construction de l'URL absolue vers le fichier public
            const baseUrl = window.location.origin + window.location.pathname;
            const cleanPath = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
            const gpxUrl = `${cleanPath}circuits/${gpxFile}`;

            let qrGpx;
            try {
                qrGpx = await QRCode.toDataURL(gpxUrl, { width: 250, margin: 1 });
            } catch (e) {
                console.error("Erreur QR GPX", e);
                return;
            }

            const htmlContent = `
                <div style="display:flex; flex-direction:column; align-items:center; gap:10px; font-family:sans-serif;">

                    <!-- QR Code GPX -->
                    <img src="${qrGpx}" style="width:200px; height:200px; border-radius:8px; border:1px solid var(--line, #eee);">

                    <!-- Bouton Téléchargement -->
                    <a href="${gpxUrl}" download class="action-button primary" style="
                        text-decoration:none; display:inline-flex; align-items:center; gap:8px; white-space:nowrap;
                        padding:10px 20px; border-radius:20px; font-weight:600; font-size:14px;">
                        <i data-lucide="download"></i> Télécharger le circuit
                    </a>

                </div>
            `;

            // On utilise le NOM TRONQUÉ comme titre
            await showAlert(escapeHtml(displayTitle), htmlContent, "Fermer");

        } else {
            // Pas de GPX disponible
             await showAlert(
                 escapeHtml(displayTitle),
                 `<div style="text-align:center; padding:20px; color:var(--ink-soft);">
                    Ce circuit ne dispose pas de fichier GPX téléchargeable.
                 </div>`,
                 "Fermer"
             );
        }
    }
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
        state.myCircuits.push(newCircuit); // Mise à jour mémoire
        eventBus.emit('circuit:list-updated'); // Mise à jour UI
    } catch (err) {
        console.error("Erreur sauvegarde circuit importé:", err);
        showToast("Erreur lors de la sauvegarde du circuit", "error");
        return;
    }

    // 4. CHARGEMENT (Activer le circuit nouvellement créé)
    await clearCircuit(false);

    state.activeCircuitId = newCircuitId;
    state.currentCircuit = resolvedFeatures;

    // 5. Mise à jour de l'affichage
    if (isMobileView()) {
        renderMobilePoiList(state.currentCircuit);
        import('./mobile.js').then(m => m.switchMobileView('circuits'));
    } else {
        renderCircuitPanel();
        if (!state.isSelectionModeActive) {
            toggleSelectionMode(true);
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

export function setupCircuitEventListeners() {
    console.log("⚡ Démarrage des écouteurs du Circuit...");

    // 0. Bouton PARTAGER
    const btnShare = document.getElementById('btn-share-circuit');
    if (btnShare) {
        btnShare.addEventListener('click', generateCircuitQR);
    }

    // 1. Bouton EXPORTER GPX
    // On vérifie DOM.btnExportGpx (généré automatiquement par ton ui.js)
    if (DOM.btnExportGpx) {
        // On clone le bouton pour supprimer les vieux bugs d'écouteurs
        const newBtn = DOM.btnExportGpx.cloneNode(true);
        DOM.btnExportGpx.parentNode.replaceChild(newBtn, DOM.btnExportGpx);
        DOM.btnExportGpx = newBtn;

        DOM.btnExportGpx.addEventListener('click', () => {
            console.log("Clic sur Exporter GPX");
            saveAndExportCircuit();
        });
    }

    // 2. Bouton IMPORTER GPX
    if (DOM.btnImportGpx) {
        DOM.btnImportGpx.addEventListener('click', () => {
            console.log("Clic sur Import. ID Actif :", state.activeCircuitId);

            if (state.activeCircuitId) {
                // CAS 1 : On est en mode actif -> On veut importer une trace réelle pour CE circuit
                // On passe par l'eventBus qui va déclencher le file input via main.js
                eventBus.emit('circuit:request-import', state.activeCircuitId);
            } else {
                // CAS 2 : On est en mode création -> On ouvre l'import GPX pour créer un nouveau circuit
                if (DOM.gpxImporter) {
                    DOM.gpxImporter.click();
                } else {
                    console.error("Élément DOM gpxImporter introuvable");
                }
            }
        });
    }

    // BOUTON VIDER / FERMER
    if (DOM.btnClearCircuit) {
        DOM.btnClearCircuit.addEventListener('click', () => {
            clearCircuit(true);
        });
    }
    // 3. Bouton BOUCLER
    if (DOM.btnLoopCircuit) {
        DOM.btnLoopCircuit.addEventListener('click', () => {
            console.log("Clic sur Boucler");
            if (state.currentCircuit.length > 0 && state.currentCircuit.length < MAX_CIRCUIT_POINTS) {
                // Ajoute le 1er point à la fin pour fermer la boucle
                addPoiToCircuit(state.currentCircuit[0]);
            } else {
                showToast("Impossible de boucler (Circuit vide ou plein)", "warning");
            }
        });
    }

    // 4. Description (Input texte)
    if (DOM.circuitDescription) {
        DOM.circuitDescription.addEventListener('input', saveCircuitDraft);
    }

    // 5. Bouton SUPPRIMER (Poubelle active)
    const btnDelete = document.getElementById('btn-delete-active-circuit');
    if (btnDelete) {
        btnDelete.addEventListener('click', async () => {
             if (await showConfirm("Suppression", "Voulez-vous vraiment supprimer ce circuit ?", "Supprimer", "Annuler", true)) {
                 if (state.activeCircuitId) {
                     const result = await performCircuitDeletion(state.activeCircuitId);
                     if (result.success) {
                         await clearCircuit(false);
                         eventBus.emit('circuit:list-updated');
                     } else {
                         showToast(result.message, 'error');
                     }
                 }
             }
        });
    }

    // 6. Édition du Titre
    const btnModify = document.getElementById('btn-modify-circuit');
    if (btnModify) {
        btnModify.addEventListener('click', () => {
            convertToDraft();
        });
    }

    const btnEditTitle = document.getElementById('edit-circuit-title-button');
    if (btnEditTitle) {
        btnEditTitle.addEventListener('click', async () => {
             const currentTitle = DOM.circuitTitleText ? DOM.circuitTitleText.textContent : "";
             const newTitle = await showPrompt("Renommer le circuit", "Nouveau titre :", currentTitle);

             if (newTitle !== null && newTitle.trim() !== "") {
                 const trimmed = newTitle.trim();

                 if (state.activeCircuitId) {
                     const idx = state.myCircuits.findIndex(c => c.id === state.activeCircuitId);
                     if (idx > -1) {
                         state.myCircuits[idx].name = trimmed;
                         // SAUVEGARDE PERMANENTE
                         await saveCircuit(state.myCircuits[idx]);
                         eventBus.emit('circuit:list-updated');
                     }
                 } else {
                     state.customDraftName = trimmed;
                 }

                 updateCircuitMetadata();
                 saveCircuitDraft();
             }
        });
    }
}
