// gpx.js
import { state, APP_VERSION } from './state.js';
import { getPoiId, getPoiName, applyFilters } from './data.js';
import { generateCircuitName, loadCircuitById } from './circuit.js';
import { DOM } from './ui.js';
import { getAllPoiDataForMap, getAllCircuitsForMap, saveCircuit, batchSavePoiData, getAppState } from './database.js';
import { showToast } from './toast.js';
import { downloadFile, escapeXml } from './utils.js';
import { updatePolylines } from './map.js';

// --- HELPER : Analyse de proximité ---
function findFeaturesOnTrack(trackCoords, features, threshold = 0.0006) {
    const detected = [];

    // Pour chaque lieu chargé, on regarde s'il est proche de la trace
    features.forEach(f => {
        const [fLon, fLat] = f.geometry.coordinates;

        let minDist = Infinity;
        let closestIndex = -1;

        // Optimisation possible : ne pas scanner tous les points si trop loin
        // Mais pour < 5000 points et < 500 features, c'est instantané.
        for (let i = 0; i < trackCoords.length; i += 2) { // Un point sur 2 suffit pour la précision
            const [tLat, tLon] = trackCoords[i];
            const d = Math.sqrt(Math.pow(tLat - fLat, 2) + Math.pow(tLon - fLon, 2));
            if (d < minDist) {
                minDist = d;
                closestIndex = i;
            }
        }

        // Seuil 0.0006 deg ~= 60-70m
        if (minDist < threshold) {
            detected.push({ feature: f, index: closestIndex });
        }
    });

    // Tri chronologique (selon l'ordre de passage sur la trace)
    detected.sort((a, b) => a.index - b.index);

    // Détection de boucle : Si la trace revient au départ, on duplique le premier POI à la fin
    if (trackCoords.length > 1) {
        const startPoint = trackCoords[0];
        const endPoint = trackCoords[trackCoords.length - 1];

        // Calcul distance Start-End (trace fermée ?)
        const loopDist = Math.sqrt(Math.pow(startPoint[0] - endPoint[0], 2) + Math.pow(startPoint[1] - endPoint[1], 2));

        if (loopDist < threshold && detected.length > 0) {
            const firstDet = detected[0];
            // Vérifie si ce premier POI est géographiquement cohérent avec la fin de la trace
            const [fLon, fLat] = firstDet.feature.geometry.coordinates;
            const distToEnd = Math.sqrt(Math.pow(endPoint[0] - fLat, 2) + Math.pow(endPoint[1] - fLon, 2));

            if (distToEnd < threshold) {
                detected.push({
                    feature: firstDet.feature,
                    index: trackCoords.length // On le place à la fin
                });
            }
        }
    }

    return detected.map(d => d.feature);
}

function generateAndDownloadGPX(circuit, id, name, description, realTrack = null) {
    const waypointsXML = circuit.map(feature => {
        const poiName = escapeXml(getPoiName(feature));
        // Description de l'étiquette (Wikiloc)
        const desc = escapeXml(feature.properties.userData?.Description_courte || feature.properties.Desc_wpt || '');

        // Lien externe (Wikiloc)
        // On cherche 'Source' ou 'Lien'
        const sourceUrl = feature.properties.userData?.Source || feature.properties.Source || '';
        let linkXML = '';
        if (sourceUrl && sourceUrl.trim().startsWith('http')) {
             linkXML = `
      <link href="${escapeXml(sourceUrl.trim())}">
        <text>Lien vers le site</text>
      </link>`;
        }

        return `
    <wpt lat="${feature.geometry.coordinates[1]}" lon="${feature.geometry.coordinates[0]}">
      <name>${poiName}</name>
      <desc>${desc}</desc>${linkXML}
    </wpt>`;
    }).join('');

    let trackpointsXML = '';

    if (realTrack && realTrack.length > 0) {
        // Cas A : Trace réelle (Importée) -> Format [lat, lon]
        trackpointsXML = realTrack.map(coord =>
            `<trkpt lat="${coord[0]}" lon="${coord[1]}"><ele>0</ele></trkpt>`
        ).join('\n      ');
    } else {
        // Cas B : Trace orthodromique (POI à POI) -> Format GeoJSON [lon, lat]
        trackpointsXML = circuit.map(feature =>
            `<trkpt lat="${feature.geometry.coordinates[1]}" lon="${feature.geometry.coordinates[0]}"><ele>0</ele></trkpt>`
        ).join('\n      ');
    }

    // MÉTADONNÉES ÉTENDUES (Destination + Lien)
    // NOUVELLE STRUCTURE V5 : ID dans <link><text> pour persistance GPX Studio
    const metadataXML = `
    <metadata>
        <name>${escapeXml(name)}</name>
        <desc>Circuit généré par History Walk.</desc>
        <link href="https://stefanmartin1967.github.io/history-walk/">
            <text>History Walk [HW-ID:${id}]</text>
        </link>
    </metadata>`;

    const gpxContent = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="History Walk ${APP_VERSION}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">${metadataXML}${waypointsXML}<trk><name>${escapeXml(name)}</name><desc><![CDATA[${description}]]></desc><trkseg>${trackpointsXML}</trkseg></trk></gpx>`;

    downloadFile(`${name}.gpx`, gpxContent, 'application/gpx+xml');
}

export async function recalculatePlannedCountersForMap(mapId) {
    if (!mapId) return;
    try {
        const poiDataForMap = await getAllPoiDataForMap(mapId);
        const circuitsForMap = await getAllCircuitsForMap(mapId);
        
        // FIX: On ne prend que les circuits NON supprimés
        const activeLocalCircuits = circuitsForMap.filter(c => !c.isDeleted);

        // FIX: On inclut aussi les circuits officiels (qui ne sont pas en base)
        const officialCircuits = state.officialCircuits || [];

        const allCircuits = [...activeLocalCircuits, ...officialCircuits];

        const counters = {};
        
        // Etape 1 : On initialise tout à 0 (même les supprimés s'ils sont chargés)
        state.loadedFeatures.forEach(f => {
            counters[getPoiId(f)] = 0;
        });

        allCircuits.forEach(circuit => {
            const poiIds = circuit.poiIds || [];
            [...new Set(poiIds)].forEach(poiId => {
                // Etape 2 : On vérifie l'existence et l'état du POI
                if (counters.hasOwnProperty(poiId)) {
                    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
                    // CORRECTION : On ne compte QUE si le POI n'est pas marqué supprimé
                    const isDeleted = feature && feature.properties.userData && feature.properties.userData.deleted;
                    
                    if (!isDeleted) {
                        counters[poiId]++;
                    }
                }
            });
        });

        const updatesToBatch = [];
        for (const [poiId, count] of Object.entries(counters)) {
            const currentCount = (poiDataForMap[poiId] && poiDataForMap[poiId].planifieCounter) || 0;
            if (currentCount !== count) {
                updatesToBatch.push({ poiId: poiId, data: { planifieCounter: count } });
            }
        }
        
        if (updatesToBatch.length > 0) {
            await batchSavePoiData(mapId, updatesToBatch);
        }
        
        // ... Mise à jour de l'état local ...
        state.userData = await getAllPoiDataForMap(mapId);
        state.loadedFeatures.forEach(feature => {
            const poiId = getPoiId(feature);
            if (state.userData[poiId]) {
                feature.properties.userData = { ...feature.properties.userData, ...state.userData[poiId] };
            }
        });
    } catch (error) {
        console.error("Erreur lors du recalcul des compteurs:", error);
    }
}

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
    const signature = "\n\n(Créé par History Walk)";
    if (!description.includes("History Walk")) {
        description += signature;
    }
    // ----------------------------------------------------

    const poiIds = state.currentCircuit.map(getPoiId);
    
    let circuitToSave;

    if (state.activeCircuitId) {
        const index = state.myCircuits.findIndex(c => c.id === state.activeCircuitId);
        if (index > -1) {
            state.myCircuits[index].name = circuitName;
            state.myCircuits[index].description = description;
            state.myCircuits[index].poiIds = poiIds;
            state.myCircuits[index].transport = transportData;
            circuitToSave = state.myCircuits[index];
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
        const newId = `HW-${Date.now()}`;
        circuitToSave = {
            id: newId,
            mapId: state.currentMapId,
            name: circuitName,
            description: description,
            poiIds: poiIds,
            realTrack: null,
            transport: transportData
        };
        state.myCircuits.push(circuitToSave);
        state.activeCircuitId = newId;
    }

    try {
        await saveCircuit(circuitToSave);
        state.hasUnexportedChanges = true; // FLAG CHANGEMENT
        await recalculatePlannedCountersForMap(state.currentMapId);
        applyFilters();
        generateAndDownloadGPX(state.currentCircuit, circuitToSave.id, circuitToSave.name, circuitToSave.description, circuitToSave.realTrack);
        showToast(`Circuit "${circuitToSave.name}" sauvegardé et exporté !`, 'success');
    } catch (error) {
        console.error("Erreur lors de la sauvegarde du circuit :", error);
        showToast("Erreur lors de la sauvegarde du circuit.", 'error');
    }
}

export async function processImportedGpx(file, circuitId) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = async (e) => {
            try {
                const text = e.target.result;

                // 1. EXTRACTION HW-ID (SÉCURITÉ)
                // Utilisation d'une Regex sur le texte brut pour éviter les problèmes de parsing XML/Namespace
                let foundHwId = null;
                const idMatch = text.match(/\[HW-ID:(HW-\d+)\]/);
                if (idMatch) {
                    foundHwId = idMatch[1];
                }

                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(text, "text/xml");

                // 2. EXTRACTION TRACE
                const trkpts = xmlDoc.getElementsByTagName("trkpt");
                const coordinates = [];
                for (let i = 0; i < trkpts.length; i++) {
                    const lat = parseFloat(trkpts[i].getAttribute("lat"));
                    const lon = parseFloat(trkpts[i].getAttribute("lon"));
                    coordinates.push([lat, lon]);
                }

                if (coordinates.length === 0) {
                    throw new Error("Aucun point trouvé dans le fichier GPX.");
                }

                // 3. LOGIQUE DE VÉRIFICATION
                let canImport = false;
                const { showConfirm, showAlert } = await import('./modal.js');

                // A. VÉRIFICATION GEOGRAPHIQUE (HORS ZONE)
                if (state.loadedFeatures.length > 0 && coordinates.length > 0) {
                    // Calcul de la Bounding Box de la carte
                    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
                    state.loadedFeatures.forEach(f => {
                        const [lon, lat] = f.geometry.coordinates;
                        if (lat < minLat) minLat = lat;
                        if (lat > maxLat) maxLat = lat;
                        if (lon < minLon) minLon = lon;
                        if (lon > maxLon) maxLon = lon;
                    });

                    // Marge de tolérance (ex: 0.1 degré ~= 11km)
                    const margin = 0.1;
                    minLat -= margin; maxLat += margin;
                    minLon -= margin; maxLon += margin;

                    // Vérification si au moins un point de la trace est dans la zone
                    const isInside = coordinates.some(([lat, lon]) =>
                        lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon
                    );

                    if (!isInside) {
                        await showAlert(
                            "Import Bloqué",
                            "Ce fichier contient une trace située HORS DE LA ZONE actuelle (trop éloignée).\n\nVeuillez charger la carte correspondante avant d'importer ce fichier."
                        );
                        reject(new Error("Hors Zone"));
                        return;
                    }
                }

                // B. VÉRIFICATION HW-ID
                if (foundHwId) {
                    // CAS A : Un ID est présent dans le fichier
                    if (circuitId && foundHwId === circuitId) {
                        canImport = true;
                    } else if (!circuitId) {
                        canImport = true;
                    } else {
                        await showAlert(
                            "Erreur d'identification",
                            `L'ID du fichier (${foundHwId}) ne correspond pas au circuit actuel.\n\nImport annulé pour protéger vos données.`
                        );
                        reject(new Error("ID Mismatch"));
                        return;
                    }
                } else {
                    // CAS B : Pas d'ID -> Analyse heuristique des étapes (Waypoints)
                    const wpts = xmlDoc.getElementsByTagName("wpt");
                    let matchCount = 0;

                    const targetCircuit = state.myCircuits.find(c => c.id === circuitId);

                    if (targetCircuit) {
                        const circuitFeatures = targetCircuit.poiIds
                            .map(pid => state.loadedFeatures.find(f => getPoiId(f) === pid))
                            .filter(Boolean);

                        if (circuitFeatures.length > 0) {
                            // ÉTAPE 1 : Tentative via Waypoints
                            if (wpts.length > 0) {
                                for (let i = 0; i < wpts.length; i++) {
                                    const lat = parseFloat(wpts[i].getAttribute("lat"));
                                    const lon = parseFloat(wpts[i].getAttribute("lon"));

                                    const isMatch = circuitFeatures.some(f => {
                                        const fLat = f.geometry.coordinates[1];
                                        const fLon = f.geometry.coordinates[0];
                                        const d = Math.sqrt(Math.pow(lat - fLat, 2) + Math.pow(lon - fLon, 2));
                                        return d < 0.0006;
                                    });
                                    if (isMatch) matchCount++;
                                }
                            }

                            // ÉTAPE 2 : Fallback sur la trace
                            if (matchCount === 0 && coordinates.length > 0) {
                                circuitFeatures.forEach(f => {
                                    const [fLon, fLat] = f.geometry.coordinates;
                                    const isNearTrace = coordinates.some(([tLat, tLon]) => {
                                        const d = Math.sqrt(Math.pow(tLat - fLat, 2) + Math.pow(tLon - fLon, 2));
                                        return d < 0.0006;
                                    });
                                    if (isNearTrace) matchCount++;
                                });
                            }
                        }
                    }

                    if (matchCount > 0) {
                        canImport = await showConfirm(
                            "Vérification",
                            `Ce fichier n'a pas d'ID certifié, mais ${matchCount} étapes correspondent au circuit.\n\nVoulez-vous importer cette trace ?`,
                            "Importer", "Annuler"
                        );
                    } else {
                        const msg = circuitId
                            ? "Ce fichier ne contient ni ID certifié, ni étapes communes avec ce circuit.\n\nÊtes-vous SÛR de vouloir l'utiliser ?"
                            : "Ce fichier ne contient pas d'ID certifié.\n\nCréer un nouveau circuit à partir de cette trace ?";

                        canImport = await showConfirm(
                            "Confirmation",
                            msg,
                            "Importer", "Annuler", true
                        );
                    }
                }

                if (!canImport) {
                    reject(new Error("Import annulé par l'utilisateur."));
                    return;
                }

                // 4. SAUVEGARDE ET MISE À JOUR INTELLIGENTE
                if (circuitId) {
                    // Mise à jour d'un circuit existant (Local ou Officiel)
                    // CORRECTION : Priorité à l'Officiel (Visible) pour l'affichage, mais maj du Local (Shadow) si existant
                    let targetCircuit = null;
                    let isOfficial = false;
                    let localCircuit = null;

                    // 1. Recherche Officiel (Prioritaire pour l'affichage UI)
                    if (state.officialCircuits) {
                        const officialIndex = state.officialCircuits.findIndex(c => String(c.id) === String(circuitId));
                        if (officialIndex !== -1) {
                            targetCircuit = state.officialCircuits[officialIndex];
                            isOfficial = true;
                        }
                    }

                    // 2. Recherche Local (Pour synchro ou si pas d'officiel)
                    const localIndex = state.myCircuits.findIndex(c => String(c.id) === String(circuitId));
                    if (localIndex !== -1) {
                        localCircuit = state.myCircuits[localIndex];
                        if (!targetCircuit) {
                            targetCircuit = localCircuit;
                        }
                    }

                    if (targetCircuit) {
                        let shouldUpdatePois = false;
                        let detectedFeatures = [];

                        // --- ANALYSE INTELLIGENTE ---
                        if (foundHwId === circuitId) {
                            // Si l'ID est identique, on fait confiance à l'utilisateur et on met à jour uniquement la trace
                            // sans toucher aux étapes (pour éviter de supprimer des étapes légèrement décalées).
                            shouldUpdatePois = false;
                        } else {
                            detectedFeatures = findFeaturesOnTrack(coordinates, state.loadedFeatures);
                            const currentIds = new Set(targetCircuit.poiIds);

                            // Combien de NOUVEAUX points (non présents actuellement) ?
                            const newPoints = detectedFeatures.filter(f => !currentIds.has(getPoiId(f)));

                            if (newPoints.length > 0) {
                                const confirmMsg = `La trace passe par ${detectedFeatures.length} lieux connus, dont ${newPoints.length} absent(s) de votre circuit.\n\nVoulez-vous mettre à jour la liste des étapes pour correspondre au tracé ?`;

                                if (await showConfirm("Mise à jour des étapes", confirmMsg, "Mettre à jour", "Garder mes étapes")) {
                                    shouldUpdatePois = true;
                                }
                            } else if (detectedFeatures.length > 0 && detectedFeatures.length !== targetCircuit.poiIds.length) {
                                // Cas où on a moins de points (ex: raccourci), on propose aussi
                                if (await showConfirm("Mise à jour des étapes", "La trace semble différente de vos étapes actuelles. Voulez-vous réaligner les étapes sur le tracé ?", "Réaligner", "Garder")) {
                                    shouldUpdatePois = true;
                                }
                            }
                        }

                        // --- APPLICATION (VISUELLE) ---
                        targetCircuit.realTrack = coordinates;
                        if (shouldUpdatePois) targetCircuit.poiIds = detectedFeatures.map(getPoiId);

                        // --- SYNCHRONISATION DU SHADOW (CREATION FORCEE SI OFFICIEL) ---
                        // Si c'est un circuit officiel, on force la création d'un shadow local pour inclure la trace dans les backups
                        if (isOfficial && !localCircuit) {
                            localCircuit = { ...targetCircuit };
                            // On s'assure qu'il est marqué officiel pour l'UI
                            if (!localCircuit.isOfficial) localCircuit.isOfficial = true;
                            state.myCircuits.push(localCircuit);
                        }

                        if (localCircuit) {
                            // On met à jour le shadow (existant ou nouveau)
                            localCircuit.realTrack = coordinates;
                            if (shouldUpdatePois) localCircuit.poiIds = detectedFeatures.map(getPoiId);
                            await saveCircuit(localCircuit);
                        }

                        // --- FEEDBACK USER ---
                        if (shouldUpdatePois) {
                            showToast(`Trace importée et ${detectedFeatures.length} étapes mises à jour !`, "success");
                        } else {
                            if (foundHwId === circuitId) {
                                showToast("Trace mise à jour (ID certifié).", "success");
                            } else {
                                showToast("Trace importée (étapes conservées).", "success");
                            }
                        }

                        // Sauvegarde SYSTEMATIQUE (Locaux et Officiels modifiés)
                        // On force la sauvegarde DB pour que la modification persiste
                        // main.js se chargera de fusionner au prochain démarrage
                        await saveCircuit(targetCircuit);
                        console.log("Circuit sauvegardé (Local ou Officiel modifié).");

                        // RAFFRAÎCHISSEMENT UI COMPLET (ESSENTIEL)
                        if (state.activeCircuitId === circuitId) {
                            await loadCircuitById(circuitId);
                        } else {
                            updatePolylines();
                        }

                        // IMPORTANT : On notifie la liste pour mettre à jour l'icône (Oiseau -> Pieds)
                        import('./events.js').then(({ eventBus }) => eventBus.emit('circuit:list-updated'));

                        resolve();
                    } else {
                        throw new Error("Circuit cible introuvable.");
                    }
                } else {
                    // Création d'un NOUVEAU circuit
                    const newId = `HW-${Date.now()}`;

                    // On détecte aussi les POIs pour le nouveau circuit
                    const detectedFeatures = findFeaturesOnTrack(coordinates, state.loadedFeatures);

                    const newCircuit = {
                        id: newId,
                        mapId: state.currentMapId,
                        name: "Trace Importée",
                        description: "Circuit créé à partir d'un import GPX.",
                        poiIds: detectedFeatures.map(getPoiId), // On remplit auto !
                        realTrack: coordinates,
                        transport: {}
                    };

                    state.myCircuits.push(newCircuit);
                    await saveCircuit(newCircuit);

                    await loadCircuitById(newId);
                    showToast(`Nouveau circuit créé avec ${detectedFeatures.length} étapes détectées`, "success");
                    resolve();
                }
            } catch (err) {
                reject(err);
            }
        };
        
        reader.onerror = () => reject(new Error("Erreur de lecture du fichier."));
        reader.readAsText(file);
    });
}