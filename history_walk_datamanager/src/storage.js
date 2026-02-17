// src/storage.js
import { cleanUrl, generateHWID, isPointInPolygon, parseGps } from './utils.js';

let globalGeoJSON = null;
let zonesGeoJSON = null; // Stocke les zones (map.geojson)
let historyStack = [];
let historyIndex = -1;
const MAX_HISTORY = 50;
const STORAGE_KEY = 'history_walk_autosave';

let renderCallback = null;
let statusCallback = null;

export function initStorage(onRender, onStatus) {
    renderCallback = onRender;
    statusCallback = onStatus;
}

function notify(type, msg) { if (statusCallback) statusCallback(type, msg); }

function refreshUI() { if (renderCallback && globalGeoJSON) renderCallback(globalGeoJSON.features); }

function saveToLocalStorage() {
    if (!globalGeoJSON) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(globalGeoJSON)); } 
    catch (e) { console.warn(e); notify("error", "Sauvegarde locale impossible"); }
}

// --- ZONES & CALCULS ---

async function loadZones() {
    try {
        const response = await fetch('/map.geojson');
        if (response.ok) {
            zonesGeoJSON = await response.json();
            console.log("Zones chargées :", zonesGeoJSON.features.length);
        }
    } catch (e) {
        console.warn("Impossible de charger map.geojson", e);
    }
}

export function detectZone(lat, lon) {
    if (!zonesGeoJSON || !zonesGeoJSON.features) return "";
    
    // On parcourt chaque zone
    for (const feature of zonesGeoJSON.features) {
        // Un polygone GeoJSON a ses coordonnées dans coordinates[0] (l'anneau extérieur)
        if (feature.geometry && feature.geometry.coordinates && feature.geometry.coordinates[0]) {
            if (isPointInPolygon([lon, lat], feature.geometry.coordinates[0])) {
                return feature.properties.name || "";
            }
        }
    }
    return "";
}

// --- DONNÉES UTILES POUR L'INTERFACE ---

export function getUniqueValues(key) {
    if (!globalGeoJSON) return [];
    const values = new Set();
    globalGeoJSON.features.forEach(f => {
        if (f.properties[key]) values.add(f.properties[key]);
    });
    // On ajoute aussi les valeurs des zones si on cherche les zones
    if (key === 'Zone' && zonesGeoJSON) {
        zonesGeoJSON.features.forEach(f => { if(f.properties.name) values.add(f.properties.name); });
    }
    return Array.from(values).sort();
}

// --- GESTION FICHIER ---

export async function loadGeoJSON(forceRemote = false) {
    try {
        notify("loading", "Chargement...");
        
        // Charger les zones en arrière-plan
        await loadZones();

        let dataToLoad = null;
        const savedData = localStorage.getItem(STORAGE_KEY);

        if (savedData && !forceRemote) {
            if (confirm("Brouillon trouvé. Restaurer ?")) {
                dataToLoad = JSON.parse(savedData);
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        }

        if (!dataToLoad) {
            const response = await fetch('/djerba.geojson?t=' + Date.now());
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            dataToLoad = await response.json();
            notify("success", `Chargé : ${dataToLoad.features.length} lieux.`);
        } else {
            notify("success", "Restauré.");
        }

        globalGeoJSON = dataToLoad;
        historyStack = []; historyIndex = -1;
        saveStateToHistory();
        refreshUI();
        return true;

    } catch (error) {
        console.error(error);
        notify("error", error.message);
        return false;
    }
}

export function getGeoJSONForExport() { return globalGeoJSON; }

// --- ACTIONS CRUD ---

export function saveStateToHistory() {
    if (!globalGeoJSON) return;
    if (historyIndex < historyStack.length - 1) historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(JSON.parse(JSON.stringify(globalGeoJSON)));
    if (historyStack.length > MAX_HISTORY) historyStack.shift(); else historyIndex++;
    saveToLocalStorage();
    return { canUndo: historyIndex > 0, canRedo: historyIndex < historyStack.length - 1 };
}

export function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        globalGeoJSON = JSON.parse(JSON.stringify(historyStack[historyIndex]));
        saveToLocalStorage();
        refreshUI();
        notify("success", "Annulation");
        return { canUndo: historyIndex > 0, canRedo: historyIndex < historyStack.length - 1 };
    }
    return { canUndo: false, canRedo: true };
}

export function redo() {
    if (historyIndex < historyStack.length - 1) {
        historyIndex++;
        globalGeoJSON = JSON.parse(JSON.stringify(historyStack[historyIndex]));
        saveToLocalStorage();
        refreshUI();
        notify("success", "Rétablissement");
        return { canUndo: historyIndex > 0, canRedo: historyIndex < historyStack.length - 1 };
    }
    return { canUndo: true, canRedo: false };
}

// Ajouter ou Mettre à jour un lieu
export function saveFeature(formData, indexToUpdate = null) {
    if (!globalGeoJSON) return;

    const coords = parseGps(formData.gps);
    if (!coords) { alert("Coordonnées GPS invalides"); return false; }

    const properties = {
        "Nom du site FR": formData.nom,
        "Nom du site arabe": formData.nomArabe || null,
        // CORRECTION ICI : Ajout de || null pour Catégorie et Zone
        "Catégorie": formData.categorie || null,
        "Zone": formData.zone || null,
        "Coordonnées GPS": `${coords.lat}, ${coords.lon}`,
        "Latitude": coords.lat,
        "Longitude": coords.lon,
        // CORRECTION ICI : Ajout de || null pour Description et Source
        "Description": formData.description || null,
        "Source": formData.source || null,
        "Temps de visite": formData.temps || null,
        "Prix d'entrée": formData.prix || null,
        "Desc_wpt": formData.descWpt || null,
        "HW_ID": indexToUpdate !== null ? globalGeoJSON.features[indexToUpdate].properties.HW_ID : generateHWID()
    };

    const newFeature = {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [coords.lon, coords.lat]
        },
        "properties": properties
    };

    saveStateToHistory();

    if (indexToUpdate !== null) {
        // Mise à jour
        globalGeoJSON.features[indexToUpdate] = newFeature;
        notify("success", "Lieu modifié.");
    } else {
        // Création
        globalGeoJSON.features.unshift(newFeature); // Ajout au début de la liste
        notify("success", "Nouveau lieu ajouté.");
    }

    refreshUI();
    return true;
}

export function deleteFeature(index) {
    if (!globalGeoJSON) return;
    const f = globalGeoJSON.features[index];
    if(!confirm(`Supprimer '${f.properties['Nom du site FR']}' ?`)) return;
    saveStateToHistory();
    globalGeoJSON.features.splice(index, 1);
    refreshUI();
    notify("success", "Supprimé.");
    return true;
}

// Récupérer un lieu pour l'édition
export function getFeatureByIndex(index) {
    if (!globalGeoJSON || !globalGeoJSON.features[index]) return null;
    return JSON.parse(JSON.stringify(globalGeoJSON.features[index]));
}

export function runMaintenance() {
    if (!globalGeoJSON) return;
    saveStateToHistory();
    let cUrl = 0;
    let cZone = 0;
    
    // On s'assure que les zones sont chargées avant de lancer le calcul
    if (!zonesGeoJSON) {
        alert("Les zones (map.geojson) ne sont pas encore chargées. Réessayez dans une seconde.");
        return;
    }

    globalGeoJSON.features.forEach(f => {
        // 1. Maintenance URLs
        const oldUrl = f.properties['Source'];
        const clean = cleanUrl(oldUrl);
        if(oldUrl !== clean) { f.properties['Source'] = clean; cUrl++; }
        
        // 2. Structure : S'assurer que les champs vides sont bien null (rétroactif)
        if (f.properties['Description'] === "") f.properties['Description'] = null;
        if (f.properties['Source'] === "") f.properties['Source'] = null;
        if (f.properties['Catégorie'] === "") f.properties['Catégorie'] = null;
        if (f.properties['Zone'] === "") f.properties['Zone'] = null;

        // 3. Recalcul de la ZONE
        // On récupère les coordonnées du point
        const coords = f.geometry.coordinates; // [lon, lat]
        if (coords && coords.length === 2) {
            const detected = detectZone(coords[1], coords[0]); // attention: detectZone attend (lat, lon)
            const currentZone = f.properties['Zone'];
            
            // Si une zone est détectée et qu'elle est différente de l'actuelle (ou si l'actuelle est vide)
            if (detected && currentZone !== detected) {
                f.properties['Zone'] = detected;
                cZone++;
            }
            // Optionnel : Si aucune zone n'est détectée mais qu'on veut forcer "A définir"
            // else if (!detected && !currentZone) {
            //     f.properties['Zone'] = "A définir";
            // }
        }
    });

    refreshUI();
    notify("success", `Maintenance : ${cUrl} URL(s) et ${cZone} Zone(s) mise(s) à jour.`);
}