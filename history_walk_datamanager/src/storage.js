// src/storage.js
import { cleanUrl, generateHWID, isPointInPolygon, parseGps } from './utils.js';
import { hwConfirm, hwAlert } from '../../src/modal.js';
import { setTaxonomy, getCategoryLabels } from '../../src/taxonomy.js';

// --- SOURCE DE VÉRITÉ UNIQUE : GitHub ---
const GITHUB_RAW = 'https://raw.githubusercontent.com/Stefanmartin1967/History-Walk-V1/main';
const DESTINATIONS_URL = `${GITHUB_RAW}/public/destinations.json`;
const CATEGORIES_URL = `${GITHUB_RAW}/public/poi-categories.json`;

// Multi-destinations (PR B). Source : destinations.json à la racine du repo.
// La destination active est persistée en localStorage 'hw_active_dest' (clé
// partagée avec HW pour cohérence cross-app).
const ACTIVE_DEST_KEY = 'hw_active_dest';
let destinationsData = null; // { djerba: {file, zonesFile, ...}, hammamet: {...} }
let activeDestId = 'djerba'; // fallback initial

function getGeoJSONUrl(destId = activeDestId) {
    const file = destinationsData?.[destId]?.file || `${destId}.geojson`;
    return `${GITHUB_RAW}/public/${file}`;
}
function getZonesUrl(destId = activeDestId) {
    const zonesFile = destinationsData?.[destId]?.zonesFile;
    if (!zonesFile) return null;
    return `${GITHUB_RAW}/public/${zonesFile}`;
}

// Brouillon localStorage par destination (évite la pollution entre destinations).
const STORAGE_KEY_PREFIX = 'history_walk_autosave_';
function getStorageKey() { return STORAGE_KEY_PREFIX + activeDestId; }

let globalGeoJSON = null;
let zonesGeoJSON = null;
let poiCategories = null; // Liste partagée HW/DM, chargée au boot
let historyStack = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

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
    try { localStorage.setItem(getStorageKey(), JSON.stringify(globalGeoJSON)); }
    catch (e) { console.warn(e); notify("error", "Sauvegarde locale impossible"); }
}

// --- DESTINATIONS (PR B) ---

async function loadDestinationsConfig() {
    try {
        const response = await fetch(DESTINATIONS_URL + '?t=' + Date.now());
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        destinationsData = json.maps || {};
        // Choix de la destination active : URL > localStorage > json activeMapId > djerba
        const urlDest = new URLSearchParams(location.search).get('dest');
        const lsDest = localStorage.getItem(ACTIVE_DEST_KEY);
        const candidates = [urlDest, lsDest, json.activeMapId, 'djerba'];
        for (const c of candidates) {
            if (c && destinationsData[c]) { activeDestId = c; break; }
        }
        // Synchronise le localStorage si on a choisi via URL ou fallback
        localStorage.setItem(ACTIVE_DEST_KEY, activeDestId);
    } catch (e) {
        console.warn("Impossible de charger destinations.json — fallback djerba seul.", e);
        destinationsData = { djerba: { name: 'Djerba', file: 'djerba.geojson', zonesFile: 'map.geojson' } };
        activeDestId = 'djerba';
    }
}

export function getDestinations() { return destinationsData || {}; }
export function getActiveDestinationId() { return activeDestId; }

export async function setActiveDestination(destId) {
    if (!destinationsData?.[destId]) return false;
    if (destId === activeDestId) return true;
    activeDestId = destId;
    localStorage.setItem(ACTIVE_DEST_KEY, destId);
    // Reload du data pour cette nouvelle destination
    historyStack = []; historyIndex = -1;
    globalGeoJSON = null;
    zonesGeoJSON = null;
    return await loadGeoJSON(false);
}

// Flag cross-app (HW ↔ DM) : indique qu'on a des modifs non publiées sur GitHub.
// Lu par HW au boot du Control Center pour afficher un bandeau de warning.
//
// Fiabilisation PR C1 — au-delà de "il y a eu une modif", on suit aussi
// `cleanHistoryIndex` : l'index de l'historique correspondant à l'état "propre"
// (= dernier load OK ou dernière publication GitHub). À chaque mutation /
// undo / redo, on appelle `refreshDirtyFlag()` qui clear le flag SI on est
// revenus à cet index (faux positif sinon : flag à 1 alors que l'admin a
// annulé toutes ses modifs et n'a plus rien à publier).
const UNPUBLISHED_FLAG_KEY = 'dm_has_unpublished_changes';
let cleanHistoryIndex = -1;

export function markDmDirty() {
    localStorage.setItem(UNPUBLISHED_FLAG_KEY, '1');
}
export function clearDmDirty() {
    localStorage.removeItem(UNPUBLISHED_FLAG_KEY);
}

/**
 * Marque l'état courant comme "propre" : aligne `cleanHistoryIndex` sur
 * `historyIndex` et clear le flag. À appeler après un load réussi ou une
 * publication GitHub réussie.
 */
export function markDmClean() {
    cleanHistoryIndex = historyIndex;
    clearDmDirty();
}

/** Recalcule le flag selon la position courante dans l'historique. */
function refreshDirtyFlag() {
    if (historyIndex === cleanHistoryIndex) {
        clearDmDirty();
    } else {
        markDmDirty();
    }
}

/** Test-only : reset l'index propre (utilisé en setup vitest). */
export function _resetCleanHistoryIndexForTests() {
    cleanHistoryIndex = -1;
}

/**
 * Test-only : initialise un état "propre" en mémoire pour les tests vitest.
 * Bypasse loadGeoJSON (qui fetch le remote) — pas pour usage en prod.
 */
export function _initStateForTests(geojson) {
    globalGeoJSON = geojson;
    historyStack = [];
    historyIndex = -1;
    cleanHistoryIndex = -1;
    saveStateToHistory();
    markDmClean();
}

/** Test-only : retourne l'état interne pour assertions. */
export function _getInternalStateForTests() {
    return {
        historyIndex,
        cleanHistoryIndex,
        historyStackLength: historyStack.length,
    };
}

// --- ZONES & CALCULS ---

async function loadZones() {
    const url = getZonesUrl();
    if (!url) { zonesGeoJSON = null; return; }
    try {
        const response = await fetch(url + '?t=' + Date.now());
        if (response.ok) {
            zonesGeoJSON = await response.json();
            console.log(`Zones chargées (${activeDestId}) :`, zonesGeoJSON.features?.length || 0);
        } else {
            console.warn(`Zones absentes pour ${activeDestId} (HTTP ${response.status})`);
            zonesGeoJSON = null;
        }
    } catch (e) {
        console.warn(`Impossible de charger les zones de ${activeDestId} :`, e);
        zonesGeoJSON = null;
    }
}

async function loadPoiCategories() {
    try {
        const response = await fetch(CATEGORIES_URL + '?t=' + Date.now());
        if (response.ok) {
            const data = await response.json();
            setTaxonomy(data);
            poiCategories = getCategoryLabels();
            console.log("Catégories chargées :", poiCategories.length);
        }
    } catch (e) {
        console.warn("Impossible de charger poi-categories.json — fallback sur valeurs uniques du data.", e);
    }
}

export function getPoiCategories() {
    // Fallback : si le JSON n'a pas pu être chargé, on utilise les valeurs présentes dans le data
    return poiCategories || getUniqueValues('Catégorie');
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

        // Charger destinations.json en premier (détermine la destination active)
        if (!destinationsData) await loadDestinationsConfig();

        // Charger les zones (par destination) et catégories en parallèle
        await Promise.all([loadZones(), loadPoiCategories()]);

        let dataToLoad = null;
        let fromDraft = false;
        const savedData = localStorage.getItem(getStorageKey());

        if (savedData && !forceRemote) {
            try {
                dataToLoad = JSON.parse(savedData);
                fromDraft = true;
            } catch (e) {
                localStorage.removeItem(getStorageKey());
            }
        }

        if (!dataToLoad) {
            const destName = destinationsData?.[activeDestId]?.name || activeDestId;
            const response = await fetch(getGeoJSONUrl() + '?t=' + Date.now());
            if (!response.ok) {
                // 404 gracieux : data pas encore créé pour cette destination (ex: Hammamet pré-saisie)
                if (response.status === 404) {
                    dataToLoad = { type: 'FeatureCollection', features: [] };
                    notify("warning", `Pas encore de data pour ${destName}. Tu peux commencer à ajouter des POIs.`);
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }
            } else {
                dataToLoad = await response.json();
                notify("success", `${destName} : ${dataToLoad.features.length} lieux chargés.`);
            }
        } else {
            const destName = destinationsData?.[activeDestId]?.name || activeDestId;
            notify("draft", `Brouillon ${destName} restauré (${dataToLoad.features.length} lieux). Cliquer ↻ pour recharger depuis le serveur.`);
        }

        globalGeoJSON = dataToLoad;
        historyStack = []; historyIndex = -1;
        saveStateToHistory();
        // Aligne `cleanHistoryIndex` sur le snapshot initial : pas de modifs
        // par rapport au remote tant qu'on n'a rien touché.
        markDmClean();
        refreshUI();
        return true;

    } catch (error) {
        console.error(error);
        notify("error", error.message);
        return false;
    }
}

export function getGeoJSONForExport() { return globalGeoJSON; }
export function getAllFeatures() { return globalGeoJSON?.features || []; }

// --- ACTIONS CRUD ---

export function saveStateToHistory() {
    if (!globalGeoJSON) return;
    if (historyIndex < historyStack.length - 1) historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(JSON.parse(JSON.stringify(globalGeoJSON)));
    if (historyStack.length > MAX_HISTORY) {
        historyStack.shift();
        // Le shift décale tout l'historique d'1 vers la gauche : il faut
        // décrémenter cleanHistoryIndex aussi (il pointait vers une position
        // qui vient de se déplacer). Si cleanHistoryIndex devient < 0, l'état
        // "propre" est sorti de l'historique → impossible d'y revenir, on
        // considère le draft comme dirty pour toujours (jusqu'à publish/load).
        if (cleanHistoryIndex >= 0) cleanHistoryIndex--;
    } else {
        historyIndex++;
    }
    saveToLocalStorage();
    refreshDirtyFlag();
    return { canUndo: historyIndex > 0, canRedo: historyIndex < historyStack.length - 1 };
}

export function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        globalGeoJSON = JSON.parse(JSON.stringify(historyStack[historyIndex]));
        saveToLocalStorage();
        refreshDirtyFlag();
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
        refreshDirtyFlag();
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
    if (!coords) {
        hwAlert({ title: 'GPS invalides', body: 'Coordonnées GPS invalides.' });
        return false;
    }

    const existing = indexToUpdate !== null ? globalGeoJSON.features[indexToUpdate].properties : null;

    // Note coords : la source canonique est `geometry.coordinates` (GeoJSON
    // standard, écrit plus bas). Les champs textuels legacy (Coordonnées GPS,
    // Latitude, Longitude) ont été supprimés du schéma le 06/05/2026.
    const properties = {
        "Nom du site FR": formData.nom,
        "Nom du site arabe": formData.nomArabe || null,
        "Catégorie": formData.categorie || null,
        "Sous-type": formData.sousType || null,
        "État": formData.etat || null,
        "Accès": formData.acces || null,
        "Zone": formData.zone || null,
        "description": formData.description || null,
        "info_gpx": formData.descCourte || null,
        "Source": formData.source || null,
        "Temps_minutes": formData.tempsMinutes,
        "Prix_TND": formData.prixTND,
        "Téléphone": formData.telephone || null,
        "Horaires": formData.horaires || null,
        "Facebook": formData.facebook || null,
        "verified": formData.verified || false,
        "HW_ID": existing?.HW_ID ?? generateHWID()
    };

    // Préservation explicite : les photos sont gérées exclusivement côté HW
    // (pipeline watermark + blob store). Le DM ne les touche jamais.
    if (existing && Array.isArray(existing.photos) && existing.photos.length > 0) {
        properties.photos = existing.photos;
    }

    const newFeature = {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [coords.lon, coords.lat]
        },
        "properties": properties
    };

    if (indexToUpdate !== null) {
        globalGeoJSON.features[indexToUpdate] = newFeature;
        notify("success", "Lieu modifié.");
    } else {
        globalGeoJSON.features.unshift(newFeature);
        notify("success", "Nouveau lieu ajouté.");
    }

    saveStateToHistory(); // APRÈS modification pour un undo correct ; gère aussi le flag dirty
    refreshUI();
    return true;
}

// Bulk-edit (PR4 catégorisation) : applique un même set de champs à plusieurs
// POIs d'un coup. `indices` = positions dans globalGeoJSON.features ; `fields`
// = { 'Sous-type': '...', 'État': '...' }. Une clé vide/absente n'est pas
// touchée (les POIs gardent leur valeur). Retourne le nombre de POIs modifiés.
export function bulkUpdateFields(indices, fields) {
    if (!globalGeoJSON || !Array.isArray(indices) || indices.length === 0) return 0;
    const keys = Object.keys(fields || {}).filter(k => fields[k] !== '' && fields[k] != null);
    if (keys.length === 0) return 0;

    let count = 0;
    indices.forEach(idx => {
        const feature = globalGeoJSON.features[idx];
        if (!feature) return;
        keys.forEach(k => { feature.properties[k] = fields[k]; });
        count++;
    });

    if (count > 0) {
        saveStateToHistory(); // historique undo/redo + flag dirty
        refreshUI();
        notify("success", `${count} lieu${count > 1 ? 'x' : ''} mis à jour.`);
    }
    return count;
}

export async function deleteFeature(index) {
    if (!globalGeoJSON) return;
    const f = globalGeoJSON.features[index];
    const name = f.properties['Nom du site FR'] || 'ce lieu';
    const ok = await hwConfirm({
        title: 'Supprimer ce lieu ?',
        body: `Confirmer la suppression de <strong>${name}</strong> ?`,
        confirmLabel: 'Supprimer',
        danger: true,
    });
    if (!ok) return;
    globalGeoJSON.features.splice(index, 1);
    saveStateToHistory(); // APRÈS modification ; gère aussi le flag dirty
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
    let cUrl = 0;
    let cZone = 0;
    
    // On s'assure que les zones sont chargées avant de lancer le calcul
    if (!zonesGeoJSON) {
        hwAlert({
            title: 'Zones non chargées',
            body: 'Les zones (map.geojson) ne sont pas encore chargées. Réessayez dans une seconde.',
        });
        return;
    }

    globalGeoJSON.features.forEach(f => {
        // 1. Maintenance URLs
        const oldUrl = f.properties['Source'];
        const clean = cleanUrl(oldUrl);
        if(oldUrl !== clean) { f.properties['Source'] = clean; cUrl++; }
        
        // 2. Structure : S'assurer que les champs vides sont bien null (rétroactif)
        if (f.properties['description'] === "") f.properties['description'] = null;
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

    // Snapshot d'historique uniquement si un vrai changement a eu lieu (sinon
    // saveStateToHistory ferait avancer historyIndex sans cause et passerait
    // le flag à dirty alors que rien n'a bougé).
    if (cUrl > 0 || cZone > 0) {
        saveStateToHistory(); // gère le flag dirty
    }
    refreshUI();
    notify("success", `Maintenance : ${cUrl} URL(s) et ${cZone} Zone(s) mise(s) à jour.`);
}