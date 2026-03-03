// gpx.js
import { state, APP_VERSION, addMyCircuit } from './state.js';
import { getPoiId, getPoiName } from './data.js';
import { loadCircuitById, generateCircuitName } from './circuit.js';
import { getAppState, saveCircuit } from './database.js';
import { showToast } from './toast.js';
import { downloadFile, escapeXml, generateHWID } from './utils.js';
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

export function generateGPXString(circuit, id, name, description, realTrack = null) {
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

    return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="History Walk ${APP_VERSION}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">${metadataXML}${waypointsXML}<trk><name>${escapeXml(name)}</name><desc><![CDATA[${description}]]></desc><trkseg>${trackpointsXML}</trkseg></trk></gpx>`;
}

export function generateAndDownloadGPX(circuit, id, name, description, realTrack = null) {
    const gpxContent = generateGPXString(circuit, id, name, description, realTrack);
    downloadFile(`${name}.gpx`, gpxContent, 'application/gpx+xml');
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
                // FIX: Support des IDs alphanumériques (HW-ULID) et non plus seulement numériques
                const idMatch = text.match(/\[HW-ID:(HW-[A-Z0-9]+)\]/);
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

                // --- VERIFICATION STRUCTURELLE (WPT) ---
                // Une "vraie" trace de circuit doit idéalement contenir des Waypoints (<wpt>)
                // correspondant aux étapes. Une simple trace brute (Garmin) n'a souvent que des <trkpt>.
                // L'utilisateur souhaite une sécurité ici.
                const wpts = xmlDoc.getElementsByTagName("wpt");
                if (wpts.length === 0) {
                    const { showConfirm } = await import('./modal.js');
                    if (!await showConfirm(
                        "Attention : Trace brute",
                        "Ce fichier GPX ne contient aucun Waypoint (<wpt>).\n\nS'agit-il vraiment d'un circuit finalisé ou d'un simple enregistrement GPS brut ?\n\nImporter quand même ?",
                        "Importer (Trace brute)", "Annuler", true
                    )) {
                        reject(new Error("Import annulé (Absence de Waypoints)"));
                        return;
                    }
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
                            addMyCircuit(localCircuit);
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
                    const newId = generateHWID();

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

                    addMyCircuit(newCircuit);
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