import { getZonesData } from './circuit-actions.js';
import { applyFilters } from './data.js';
import { toggleSelectionMode, clearCircuit } from './circuit.js';
import { map } from './map.js';
import { addPoiFeature, getPoiId, getPoiName, updatePoiData } from './data.js';
import { state } from './state.js';
import { saveAppState, savePoiData } from './database.js';
import { logModification } from './logger.js';
import { DOM, closeDetailsPanel, openDetailsPanel, closeAllDropdowns } from './ui.js';
import { getExifLocation, calculateDistance, resizeImage, getZoneFromCoords, clusterByLocation, calculateBarycenter, filterOutliers } from './utils.js';
import { showToast } from './toast.js';
import { showPhotoSelectionModal } from './photo-import-ui.js';
import { RichEditor } from './richEditor.js';

let desktopDraftMarker = null;

export function enableDesktopCreationMode() {
    if (!map) return;
    RichEditor.init(); // Initialisation des écouteurs de la modale riche
    map.on('contextmenu', (e) => {
        const { lat, lng } = e.latlng;
        if (desktopDraftMarker) {
            desktopDraftMarker.setLatLng(e.latlng);
        } else {
            createDraftMarker(lat, lng, map);
        }
    });
}

// --- FONCTION D'IMPORT AVEC CLUSTERING ET DÉTECTION ---
export async function handleDesktopPhotoImport(filesList) {
    console.log(">>> Démarrage Import Desktop. Fichiers reçus :", filesList);

    const files = Array.from(filesList);
    if (!files || files.length === 0) {
        showToast("Erreur : Aucun fichier reçu par le module.", "error");
        return;
    }

    const loader = (DOM && DOM.loaderOverlay) ? DOM.loaderOverlay : null;
    if (loader) loader.style.display = 'flex';

    try {
        // --- ETAPE 1 : EXTRACTION GPS ---
        const filesData = [];

        for (let file of files) {
            try {
                const coords = await getExifLocation(file);
                filesData.push({ file, coords, hasGps: true });
            } catch (e) {
                console.warn(`Pas de GPS pour ${file.name}`);
                filesData.push({ file, coords: null, hasGps: false });
            }
        }

        const validItems = filesData.filter(f => f.hasGps);
        if (validItems.length === 0) {
             if (loader) loader.style.display = 'none';
             return showToast("Aucune coordonnée GPS trouvée dans ces photos.", 'error');
        }

        // --- ETAPE 2 : CLUSTERING (Regroupement) ---
        // On groupe les photos distantes de moins de 80m (augmenté pour éviter le split abusif)
        const clusters = clusterByLocation(validItems, 80);

        // On trie par taille : Les plus gros groupes d'abord ("Majorité")
        clusters.sort((a, b) => b.length - a.length);

        console.log(`>>> ${clusters.length} clusters identifiés.`);

        // --- ETAPE 3 : TRAITEMENT SÉQUENTIEL DES GROUPES ---
        let processedCount = 0;
        let totalDuplicates = 0;

        for (let i = 0; i < clusters.length; i++) {
            let cluster = clusters[i];
            const ignoredPoiIds = new Set(); // Reset pour chaque cluster

            // --- ETAPE 2b : DÉTECTION ET EXCLUSION DES OUTLIERS (Parasites) ---
            const { main, outliers } = filterOutliers(cluster);

            if (outliers.length > 0) {
                console.log(`>>> Cluster ${i+1}: ${outliers.length} outliers détectés et séparés.`);
                // On garde le noyau principal
                cluster = main;
                // On ajoute les outliers comme un nouveau groupe à traiter plus tard
                clusters.push(outliers);
            }

            // --- PRÉ-TRAITEMENT : CALCUL BASE64 POUR DÉTECTION DOUBLONS ---
            // On le fait ici pour le cluster actif afin de comparer avec les photos existantes des POIs
            for (let item of cluster) {
                if (!item.base64) {
                    try {
                        item.base64 = await resizeImage(item.file);
                    } catch (e) {
                        console.error("Erreur pré-calcul base64:", e);
                    }
                }
            }

            const center = calculateBarycenter(cluster.map(c => c.coords));

            console.log(`>>> Traitement Cluster ${i+1}/${clusters.length} (${cluster.length} photos) à [${center.lat}, ${center.lng}]`);

            // Centrage Carte
            if (map) map.flyTo([center.lat, center.lng], 18, { duration: 1.0 });

            // Recherche TOUS les POIs proches du BARYCENTRE (< 100m)
            let nearbyPois = [];
            state.loadedFeatures.forEach(feature => {
                const pId = getPoiId(feature);
                if (state.hiddenPoiIds && state.hiddenPoiIds.includes(pId)) return;

                if (feature.geometry && feature.geometry.coordinates) {
                    const [fLng, fLat] = feature.geometry.coordinates;
                    const dist = calculateDistance(center.lat, center.lng, fLat, fLng);
                    if (dist < 100) {
                        nearbyPois.push({ feature, dist });
                    }
                }
            });

            // Tri par distance croissante
            nearbyPois.sort((a, b) => a.dist - b.dist);

            let assigned = false;

            // CAS A : PROPOSITIONS ITÉRATIVES
            if (nearbyPois.length > 0) {
                if (loader) loader.style.display = 'none';

                for (let k = 0; k < nearbyPois.length; k++) {
                    const { feature, dist } = nearbyPois[k];
                    const poiName = getPoiName(feature);
                    const poiId = getPoiId(feature);

                    // --- FILTRAGE DES DOUBLONS ---
                    const existingPhotos = (state.userData[poiId] && state.userData[poiId].photos) || [];
                    const uniqueCluster = cluster.filter(item => item.base64 && !existingPhotos.includes(item.base64));
                    const duplicateCount = cluster.length - uniqueCluster.length;

                    // Si TOUT le cluster est en doublon
                    if (uniqueCluster.length === 0) {
                         totalDuplicates += duplicateCount;
                         assigned = true; // On considère que c'était le bon endroit, donc on arrête
                         break;
                    }

                    const selectedPhotos = await showPhotoSelectionModal(
                        "Ajout Photos",
                        `Groupe ${i+1}/${clusters.length} détecté près de :\n` +
                        `"${poiName}" (${Math.round(dist)}m).\n` +
                        (duplicateCount > 0 ? `(${duplicateCount} doublons masqués)\n` : '') +
                        `Sélectionnez les photos à AJOUTER à ce lieu :`,
                        uniqueCluster,
                        "Ajouter"
                    );

                    if (selectedPhotos && selectedPhotos.length > 0) {
                        if (loader) loader.style.display = 'flex';
                        await addPhotosToPoi(feature, selectedPhotos);
                        processedCount += selectedPhotos.length;
                        totalDuplicates += duplicateCount; // On compte les doublons qu'on a filtrés
                        assigned = true;
                        break; // Sort de la boucle des POIs proches
                    }
                    // Si refus (null), on mémorise pour ne pas le reproposer plus tard
                    ignoredPoiIds.add(poiId);
                }

                if (assigned) continue; // On passe au cluster suivant
            }

            // CAS B : PAS DE POI PROCHE OU TOUS REFUSÉS -> PROPOSITION DE CRÉATION
            if (loader) loader.style.display = 'none';

            // 1. Recherche du POI le plus proche (Absolu, sans limite 100m) pour proposer le "Force Add"
            let absoluteNearest = null;
            let minDistance = Infinity;

            state.loadedFeatures.forEach(feature => {
                 const pId = getPoiId(feature);
                 if (state.hiddenPoiIds && state.hiddenPoiIds.includes(pId)) return;
                 // On ignore ceux que l'utilisateur vient de refuser explicitement
                 if (ignoredPoiIds.has(pId)) return;

                 if (feature.geometry && feature.geometry.coordinates) {
                     const [fLng, fLat] = feature.geometry.coordinates;
                     const d = calculateDistance(center.lat, center.lng, fLat, fLng);
                     if (d < minDistance) {
                         minDistance = d;
                         absoluteNearest = feature;
                     }
                 }
            });

            let extraAction = null;
            let duplicateCountForNearest = 0;
            let uniqueClusterForNearest = cluster;

            if (absoluteNearest) {
                const nName = getPoiName(absoluteNearest);
                const nId = getPoiId(absoluteNearest);

                // Vérification doublons pour Force Add
                const existingPhotos = (state.userData[nId] && state.userData[nId].photos) || [];
                uniqueClusterForNearest = cluster.filter(item => item.base64 && !existingPhotos.includes(item.base64));
                duplicateCountForNearest = cluster.length - uniqueClusterForNearest.length;

                if (uniqueClusterForNearest.length > 0) {
                    extraAction = {
                        label: `Ajouter à "${nName}" (${Math.round(minDistance)}m)`,
                        value: 'FORCE_ADD'
                    };
                }
            }

            // Si tout le cluster est doublon pour le nearest et qu'on n'a pas trouvé d'autre POI avant...
            // On peut afficher le toast mais on doit quand même proposer "Créer Lieu" au cas où l'utilisateur
            // veut créer un NOUVEAU lieu à côté.
            // Mais si l'utilisateur voulait l'ajouter au nearest, c'est déjà fait.

            const selectionResult = await showPhotoSelectionModal(
                "Nouveau Lieu ?",
                `Groupe ${i+1}/${clusters.length} non rattaché.\n` +
                `Sélectionnez les photos pour créer un NOUVEAU lieu :`,
                uniqueClusterForNearest, // On propose par défaut les uniques (pour Force Add)
                // MAIS pour "Créer Lieu", on devrait peut-être proposer TOUT ?
                // Non, car "Créer Lieu" utilise la sélection retournée.
                // Si on crée un nouveau lieu, il n'y a pas de notion de doublon car le lieu est vide.
                // Donc on peut ré-afficher tout le cluster si on veut créer un nouveau lieu.
                // COMPROMIS : On affiche uniqueClusterForNearest pour être cohérent avec Force Add.
                // Si l'utilisateur choisit "Créer Lieu", il créera avec ces photos.
                "Créer Lieu",
                extraAction
            );

            if (selectionResult && selectionResult.length > 0) {
                // Cas 1 : Ajout Forcé au POI le plus proche
                if (selectionResult.action === 'FORCE_ADD' && absoluteNearest) {
                     if (loader) loader.style.display = 'flex';
                     await addPhotosToPoi(absoluteNearest, selectionResult);
                     processedCount += selectionResult.length;
                     totalDuplicates += duplicateCountForNearest;
                     // On continue la boucle vers le prochain cluster
                }
                // Cas 2 : Création (Comportement par défaut)
                else {
                    if (loader) loader.style.display = 'none';
                    // Si on crée un nouveau lieu, on utilise selectionResult.
                    // (On ignore duplicateCountForNearest car ça concernait un autre lieu)
                    createDraftMarker(center.lat, center.lng, map, selectionResult);
                    showToast(`Placez le marqueur pour le groupe ${i+1}. L'import s'arrête ici.`, 'info');
                    return;
                }
            } else if (duplicateCountForNearest > 0 && uniqueClusterForNearest.length === 0) {
                 // Cas où tout est doublon pour le nearest et l'utilisateur a annulé (ou liste vide)
                 totalDuplicates += duplicateCountForNearest;
            }
        }

        if (loader) loader.style.display = 'none';

        // Résumé final
        const msg = `Import terminé. ${processedCount} photos ajoutées.`;
        const dupMsg = totalDuplicates > 0 ? ` ${totalDuplicates} déjà présentes (ignorées).` : "";
        showToast(msg + dupMsg, processedCount > 0 ? 'success' : 'info', 6000);

    } catch (error) {
        if (loader) loader.style.display = 'none';
        console.error(">>> ERREUR IMPORT :", error);
        showToast("Erreur lors du traitement : " + error.message, 'error');
    }
}

// Fonction utilitaire pour l'ajout effectif avec détection de doublons
export async function addPhotosToPoi(feature, clusterItems) {
    let poiId = getPoiId(feature);

    // Si c'est un POI "natif" sans ID user, on lui en crée un
    if (!poiId) {
        const [lng, lat] = feature.geometry.coordinates;
        poiId = `auto_${Math.round(lat*100000)}_${Math.round(lng*100000)}`;
        if (!feature.properties) feature.properties = {};
        feature.properties.HW_ID = poiId;
    }

    if (!state.userData[poiId]) state.userData[poiId] = {};
    if (!state.userData[poiId].photos) state.userData[poiId].photos = [];

    let added = 0;
    let duplicates = 0;

    for (const item of clusterItems) {
        try {
            // Utilisation du base64 pré-calculé si disponible, sinon on redimensionne
            const resizedBase64 = item.base64 || await resizeImage(item.file);

            // DÉTECTION DOUBLON
            if (state.userData[poiId].photos.includes(resizedBase64)) {
                duplicates++;
            } else {
                state.userData[poiId].photos.push(resizedBase64);
                added++;
            }
        } catch (err) {
            console.error("Erreur compression:", err);
        }
    }

    if (added > 0) {
        // Utilisation de updatePoiData pour garantir la sync Mémoire + DB + UI
        await updatePoiData(poiId, 'photos', state.userData[poiId].photos);
        
        // Refresh UI
        closeDetailsPanel();
        setTimeout(() => {
            const index = state.loadedFeatures.indexOf(feature);
            if (index > -1) openDetailsPanel(index);
        }, 100);
    }
}

export function createDraftMarker(lat, lng, mapInstance, photos = []) {
    if (desktopDraftMarker) {
        mapInstance.removeLayer(desktopDraftMarker);
    }

    desktopDraftMarker = L.marker([lat, lng], {
        draggable: true,
        title: "Déplacez-moi pour ajuster"
    }).addTo(mapInstance);

    const popupContent = document.createElement('div');
    popupContent.style.textAlign = 'center';
    popupContent.style.display = 'flex';
    popupContent.style.flexDirection = 'column';
    popupContent.style.alignItems = 'center';
    popupContent.style.justifyContent = 'center';
    popupContent.innerHTML = `
        <div style="font-weight:bold; margin-bottom:5px;">Nouveau Lieu ?</div>
        <div style="font-size:12px; color:#666; margin-bottom:8px;">Glissez pour ajuster.</div>
        <button id="btn-validate-desktop-poi" class="action-btn" style="background:var(--brand); color:white; padding:4px 8px; font-size:12px; cursor:pointer; margin: 0 auto;">
            Valider cette position
        </button>
    `;

    const validateBtn = popupContent.querySelector('#btn-validate-desktop-poi');
    
    validateBtn.addEventListener('click', () => {
        const finalLatLng = desktopDraftMarker.getLatLng();
        // REMPLACEMENT PAR LA RICH EDITOR
        RichEditor.openForCreate(finalLatLng.lat, finalLatLng.lng, photos);
        
        if (mapInstance && desktopDraftMarker) {
            mapInstance.removeLayer(desktopDraftMarker);
        }
        desktopDraftMarker = null;
    });

    desktopDraftMarker.bindPopup(popupContent, { minWidth: 200 }).openPopup();

    desktopDraftMarker.on('dragend', () => desktopDraftMarker.openPopup());
}

// L'ancienne fonction openDesktopAddModal a été supprimée car remplacée par RichEditor.

// --- LOGIQUE WIZARD & OUTILS ---

export function setupDesktopTools() {
    // 1. Bouton "Mode Sélection" avec Interception pour Wizard
    const btnSelect = document.getElementById('btn-mode-selection');
    if (btnSelect) {
        // On clone le bouton pour supprimer les anciens écouteurs (toggle simple)
        const newBtn = btnSelect.cloneNode(true);
        btnSelect.parentNode.replaceChild(newBtn, btnSelect);

        newBtn.addEventListener('click', () => {
             if (state.isSelectionModeActive) {
                 toggleSelectionMode(false);
             } else {
                 openSelectionWizard();
             }
        });
    }

    // 2. Menu Outils (Dropdown) - GÉRÉ DANS ui.js (initializeDomReferences)
    // Ne pas dupliquer l'écouteur ici !

    // La fermeture au clic ailleurs est aussi gérée globalement dans main.js/setupDesktopUIListeners

    // 3. Initialisation du Wizard
    const btnStart = document.getElementById('btn-wizard-start');
    const btnClose = document.getElementById('close-wizard-modal');
    if (btnStart) btnStart.addEventListener('click', handleWizardStart);
    if (btnClose) btnClose.addEventListener('click', () => {
        document.getElementById('selection-wizard-modal').style.display = 'none';
    });
}

function openSelectionWizard() {
    const modal = document.getElementById('selection-wizard-modal');
    if (!modal) return;

    // Remplissage de la liste des zones
    const zoneSelect = document.getElementById('wizard-zone-select');
    if (zoneSelect) {
        // On garde "Toute l'île"
        zoneSelect.innerHTML = '<option value="">Toute l\'île</option>';
        const data = getZonesData();
        if (data && data.sortedZones) {
             data.sortedZones.forEach(zone => {
                 const option = document.createElement('option');
                 option.value = zone;
                 option.textContent = `${zone} (${data.zoneCounts[zone]})`;
                 zoneSelect.appendChild(option);
             });
        }
    }

    modal.style.display = 'flex';
}

function handleWizardStart() {
    // 1. Récupération des choix
    const zoneSelect = document.getElementById('wizard-zone-select');
    const checkVisited = document.getElementById('wizard-check-visited');
    const checkPlanned = document.getElementById('wizard-check-planned');

    const selectedZone = zoneSelect ? zoneSelect.value : "";
    const hideVisited = checkVisited ? checkVisited.checked : true;
    const hidePlanned = checkPlanned ? checkPlanned.checked : true;

    // 2. Mise à jour de l'état
    state.selectionModeFilters = {
        hideVisited: hideVisited,
        hidePlanned: hidePlanned
    };

    // On met à jour le filtre Zone global car il est partagé
    state.activeFilters.zone = selectedZone || null;

    // Mise à jour de l'étiquette du bouton Zone
    const zonesLabel = document.getElementById('zonesLabel');
    if (zonesLabel) {
        zonesLabel.textContent = selectedZone || 'Zone';
    }

    // 3. Lancement du mode (Avec reset du circuit précédent pour éviter la confusion)
    clearCircuit(false);
    toggleSelectionMode(true);
    applyFilters(); // Force le rafraîchissement avec les nouvelles règles

    // 4. Fermeture du Wizard
    document.getElementById('selection-wizard-modal').style.display = 'none';
}
