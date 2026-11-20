// fileManager.js
import { state, setCurrentMap, setLoadedFeatures, getActiveMapId, DEFAULT_MAP_ID} from './state.js';
import { getPoiId, displayGeoJSON } from './data.js';
import { DOM } from './ui-dom.js';
import { closeDetailsPanel } from './ui-details.js';
import { showToast } from './toast.js';
import { saveAppState } from './database.js';
import { applyRestore } from './restore-apply.js';
import { confirmRestore } from './restore-ui.js';
import { switchActiveDestination } from './destination-switch.js';
import { processImportedGpx } from './gpx.js';
// Import pour contrôler la vue mobile
import { isMobileView } from './mobile-state.js';
import { eventBus } from './events.js';
import { downloadFile } from './utils.js';
import { getDraftZones, createLocalDraftDestination } from './local-destinations.js';

// --- IMPORTATION GÉNÉRIQUE ---

export function handleFileLoad(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const json = JSON.parse(e.target.result);
            
            // Cas 1 : GeoJSON (Carte)
            if (json.type === 'FeatureCollection') {
                const mapName = file.name.replace('.geojson', '').replace('.json', '');
                
                if (isMobileView()) {
                    // Mobile: Chargement mémoire uniquement
                    setLoadedFeatures(json.features || []);
                    setCurrentMap(mapName);
                    await saveAppState('lastMapId', mapName);
                    await saveAppState(`lastGeoJSON_${mapName}`, json);
                    eventBus.emit('mobile:switch-view', 'circuits');
                } else {
                    // Desktop: Rendu Carte
                    await displayGeoJSON(json, mapName);
                    // On cadre la vue sur la nouvelle carte
                    import('./map.js').then(m => m.fitMapToContent())
                        .catch(e => console.warn('[fileManager] import map.js échoué (déploiement en cours ?) :', e));
                }
            } 
            // Cas 2 : Backup
            else if (isValidBackup(json) && (json.baseGeoJSON || json.userData || json.kind === 'photos')) {
                await restoreBackup(json);
            }
            else {
                showToast("Format de fichier non reconnu.", "error");
            }
        } catch (error) {
            console.error("Erreur lecture fichier:", error);
            showToast("Erreur lors de la lecture du fichier.", "error");
        }
    };
    reader.readAsText(file);
    event.target.value = ''; 
}

// --- SAUVEGARDE (EXPORT) - INCHANGÉ ---
// Option A — si la destination active est un BROUILLON LOCAL (custom), joindre sa
// définition + ses quartiers au backup. Sans ça, un brouillon n'existe que dans
// l'IndexedDB de cet appareil (sa data GitHub n'existe pas — modèle 2-phases) :
// un plantage DB le perdrait. draftDestination est minuscule ; draftZones est inclus
// dans TOUS les backups (restauration toujours complète). No-op sur une dest publiée.
async function attachLocalDraft(exportData, mapId) {
    const dest = state.destinations?.maps?.[mapId];
    if (!dest?.custom) return;
    exportData.draftDestination = { ...dest };
    exportData.draftZones = await getDraftZones(mapId);
}

/**
 * Préfixes des lieux créés par l'utilisateur : sur PC (`HW-PC-`, richEditor),
 * sur le téléphone (`HW-MOB-`, mobile-new-place : « Nouveau lieu » du dock ou
 * du suivi) ou importés (`auto_`). Les autres fiches viennent du site.
 *
 * `HW-MOB-` manquait jusqu'au 17/11/2026 : les lieux créés sur le téléphone
 * n'entraient ni dans la sauvegarde légère ni dans la restauration — un
 * utilisateur qui transférait son téléphone vers son PC les perdait (constaté
 * sur la sauvegarde de Stefan : 2 lieux créés au téléphone, 0 sauvegardé).
 */
const USER_CREATED_PREFIXES = ['HW-PC-', 'HW-MOB-', 'auto_'];

/** Lieu créé par l'utilisateur sur une destination publiée. */
export function isUserCreatedFeature(f) {
    const id = String(f?.properties?.HW_ID || f?.id || '');
    return USER_CREATED_PREFIXES.some(p => id.startsWith(p));
}

/**
 * Lieux à embarquer dans `baseGeoJSON`.
 *  - Destination publiée : seulement les lieux créés par l'utilisateur. La
 *    restauration ne relit rien d'autre de ce bloc (les fiches officielles sont
 *    rechargées depuis le site) ; mesuré le 11/11/2026, la carte entière pesait
 *    775 Ko sur 839 dans la sauvegarde d'un visiteur.
 *  - Brouillon local : tout, sa carte n'existe nulle part ailleurs.
 */
function featuresForBackup(mapId) {
    const all = state.loadedFeatures || [];
    if (state.destinations?.maps?.[mapId]?.custom) return all;
    return all.filter(isUserCreatedFeature);
}

/**
 * Nom d'un fichier de sauvegarde : `Heripia_<destination>_<donnees|photos>_<date>`.
 * Une seule règle pour le PC et le téléphone (11/11/2026). 20/11/2026 : Données /
 * Photos remplacent Légère / Complète. La restauration ne lit pas le nom : les
 * anciens fichiers (`legere`, `complete`, `HistoryWalk_…`) restent restaurables.
 * @param {string} mapId
 * @param {'donnees'|'photos'} [kind] données (.txt, passe par mail et messageries) ou photos (.json)
 * @param {Date} [now]
 */
export function backupFileName(mapId, kind = 'donnees', now = new Date()) {
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}_${p2(now.getHours())}h${p2(now.getMinutes())}`;
    const dest = String(mapId || 'destination').replace(/[^a-z0-9-]+/gi, '-');
    const photos = kind === 'photos';
    return `Heripia_${dest}_${photos ? 'photos' : 'donnees'}_${stamp}.${photos ? 'json' : 'txt'}`;
}

/** Sauvegarde « Données » (téléphone : Web Share). Les photos ont leur propre fichier (photo-backup.js). */
export async function saveUserData() {
    if (!state.currentMapId) return showToast("Aucune carte chargée.", "error");

    const mapId = state.currentMapId;

    const exportData = cleanDataForExport({
        backupVersion: state.appVersion || "3.0",
        date: new Date().toISOString(),
        mapId,
        baseGeoJSON: {
            type: "FeatureCollection",
            features: featuresForBackup(mapId).map(f => {
                const featureClone = JSON.parse(JSON.stringify(f));
                const poiId = getPoiId(f);
                if (state.userData[poiId]) {
                    featureClone.properties.userData = JSON.parse(JSON.stringify(state.userData[poiId]));
                }
                // Les photos vivent dans le bloc userData racine — jamais dupliquées ici.
                if (featureClone.properties.userData) {
                    delete featureClone.properties.userData.photos;
                }
                return featureClone;
            })
        },
        userData: buildRootUserData(),
        myCircuits: state.myCircuits,
        hiddenPoiIds: state.hiddenPoiIds,
        officialCircuitsStatus: state.officialCircuitsStatus || {},
        // Dates et circuits cachés (19/11/2026) : la restauration qui fusionne
        // en a besoin pour savoir quelle version est la plus récente.
        officialCircuitsStatusUpdatedAt: state.officialCircuitsStatusUpdatedAt || {},
        hiddenCircuitIds: state.hiddenCircuitIds || [],
        hiddenCircuitIdsUpdatedAt: state.hiddenCircuitIdsUpdatedAt || {},
        testedCircuits: state.testedCircuits || {}
    });
    await attachLocalDraft(exportData, mapId);

    downloadJSON(exportData, backupFileName(mapId, 'donnees'));
}

async function downloadJSON(data, filename) {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    
    // 1. Création d'un objet File pour le partage
    const safeFileName = filename.replace('.json', '.txt');
    const file = new File([blob], safeFileName, { type: 'text/plain' });

    // 2. Vérification : Est-ce qu'on peut utiliser le menu Partager natif ?
    // (Fonctionne sur Android et iOS modernes)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({
    files: [file],
    title: safeFileName, // <-- ON REMPLACE LE TEXTE EN DUR PAR LE VRAI NOM DU FICHIER
    text: `Backup du ${new Date().toLocaleDateString()}`
});
            // Si le partage a réussi, on s'arrête là (pas besoin de télécharger en double)
            return; 
        } catch (error) {
            // Si l'utilisateur annule le partage ou s'il y a une erreur,
            // on continue vers la méthode classique ci-dessous (fallback).
            if (error.name !== 'AbortError') {
                console.warn("Erreur partage, bascule vers téléchargement classique:", error);
            } else {
                return; // L'utilisateur a annulé volontairement
            }
        }
    }

    // 3. Méthode Classique (PC ou vieux téléphones)
    // C'est le code que tu avais avant, qui sert de roue de secours
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Petit message différent selon le contexte
}

// --- RESTAURATION (Modifiée pour Mobile) ---


/**
 * Vérifie si le fichier JSON fourni est une sauvegarde valide.
 * @param {Object} json L'objet JSON à vérifier
 * @returns {boolean} True si valide, False sinon
 */
export function isValidBackup(json) {
    if (!json || typeof json !== 'object') return false;

    // backupVersion (doit exister)
    if (!json.backupVersion) {
        console.warn("[Validation] Version de backup manquante.");
        return false;
    }

    // mapId (string non vide)
    if (typeof json.mapId !== 'string' || json.mapId.trim() === '') {
        console.warn("[Validation] ID de carte invalide ou manquant.");
        return false;
    }

    // Fichier « Photos » (20/11/2026) : { [lieu]: [{ id, data }] }
    if (json.kind === 'photos' && (typeof json.photos !== 'object' || json.photos === null || Array.isArray(json.photos))) {
        console.warn("[Validation] Fichier de photos invalide.");
        return false;
    }

    // userData (objet plat, non-tableau)
    if (json.userData !== undefined) {
        if (typeof json.userData !== 'object' || Array.isArray(json.userData) || json.userData === null) {
            console.warn("[Validation] Format de userData invalide (doit être un objet).");
            return false;
        }
    }

    // myCircuits (tableau si présent)
    if (json.myCircuits !== undefined && !Array.isArray(json.myCircuits)) {
        console.warn("[Validation] myCircuits invalide (doit être un tableau).");
        return false;
    }

    // hiddenPoiIds (tableau si présent)
    if (json.hiddenPoiIds !== undefined && !Array.isArray(json.hiddenPoiIds)) {
        console.warn("[Validation] hiddenPoiIds invalide (doit être un tableau).");
        return false;
    }

    // testedCircuits (objet OU tableau si présent). Le runtime + l'export
    // produisent un objet { circuitId: bool } ; on tolère aussi un tableau pour
    // d'anciens backups. Rejet uniquement si null ou primitive.
    if (json.testedCircuits !== undefined) {
        if (typeof json.testedCircuits !== 'object' || json.testedCircuits === null) {
            console.warn("[Validation] testedCircuits invalide (doit être un objet ou un tableau).");
            return false;
        }
    }

    // officialCircuitsStatus (objet si présent)
    if (json.officialCircuitsStatus !== undefined) {
        if (typeof json.officialCircuitsStatus !== 'object' || Array.isArray(json.officialCircuitsStatus) || json.officialCircuitsStatus === null) {
            console.warn("[Validation] officialCircuitsStatus invalide (doit être un objet).");
            return false;
        }
    }

    // baseGeoJSON (FeatureCollection si présent)
    if (json.baseGeoJSON !== undefined) {
        if (json.baseGeoJSON?.type !== 'FeatureCollection' || !Array.isArray(json.baseGeoJSON?.features)) {
            console.warn("[Validation] baseGeoJSON invalide (doit être une FeatureCollection).");
            return false;
        }
    }

    return true;
}

export async function restoreBackup(json) {
    // Sémantique DIFFÉRENTE de getActiveMapId() : une sauvegarde antérieure au
    // multi-destination ne porte pas de `mapId`, et elle ne peut venir que de
    // Djerba (seule destination à l'époque). On restaure donc là, PAS dans la
    // destination active du moment.
    const mapId = json.mapId || DEFAULT_MAP_ID;

    // Lieux créés du fichier. Dest publiée : seuls les POIs créés à la main
    // (HW-PC-, HW-MOB-) ou importés (auto_). Brouillon LOCAL (Option A) : TOUS
    // ses lieux sont custom (les captures Scout ont un id HW-ULID).
    const isDraftRestore = !!json.draftDestination;
    const isPlace = isDraftRestore ? () => true : isUserCreatedFeature;

    // 19/11/2026 (PR 2 « synchro users ») : on montre d'abord ce que contient le
    // fichier ; la restauration RÉUNIT au lieu de remplacer (restore-merge.js),
    // avec une copie de sécurité pour l'annuler (restore-apply.js). Avant, elle
    // s'appliquait sans rien demander et remplaçait circuits perso, lieux
    // masqués, statuts et lieux créés.
    if (!await confirmRestore(json, mapId, isPlace)) return;

    try {
        showToast("Restauration en cours…", "info");
        setCurrentMap(mapId);
        await saveAppState('lastMapId', mapId);

        // Les circuits « vérifiés » (testedCircuits) ne sont plus repris du
        // fichier : c'est une autorité serveur (tested_<map>.json), qu'une
        // sauvegarde ancienne ferait reculer.
        await applyRestore(mapId, json, isPlace);

        // BROUILLON LOCAL (Option A) : recréer sa définition. Elle n'existe que dans
        // la sauvegarde — un brouillon ne vit jamais sur GitHub. On (re)pose l'entrée
        // draftDestinations + ses quartiers + un geojson base vide (les lieux sont déjà
        // en customPois), et on bascule dessus pour que le reload l'affiche.
        if (json.draftDestination) {
            const zones = json.draftZones || { type: 'FeatureCollection', features: [] };
            await createLocalDraftDestination(mapId, json.draftDestination, { type: 'FeatureCollection', features: [] }, zones);
        }

        // Redémarrage SUR LA DESTINATION DU FICHIER : l'app recharge sa carte, y
        // applique les données réunies, et montre le résumé (restore-ui.js,
        // showRestoreSummaryIfPending). 19/11/2026 : un simple rechargement
        // rouvrait la destination ouverte au moment de restaurer (le démarrage
        // lit `?map=` puis `hw_active_dest`, pas `lastMapId`) — restaurer un
        // fichier de Charleroi depuis Djerba cachait le résumé (constaté par Stefan).
        showToast("Données réunies ! Redémarrage…", "success");
        setTimeout(() => {
            switchActiveDestination(mapId);
        }, 1200);

    } catch (error) {
        console.error("Erreur restauration:", error);
        showToast("Erreur lors de la restauration.", "error");
    }
}

// --- IMPORTS SPÉCIFIQUES ---

export async function handleGpxFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (state.circuitIdToImportFor) {
        try {
            await processImportedGpx(file, state.circuitIdToImportFor);
        } catch (err) {
            console.error("Erreur import GPX:", err);
            showToast("Erreur lors de l'import du GPX.", "error");
        }
    } else {
        showToast("Veuillez sélectionner un circuit avant d'importer un GPX.", "warning");
    }
    event.target.value = '';
}

export function handlePhotoImport(event) {
    const files = Array.from(event.target.files);
    if (!files || files.length === 0) return;
    event.target.value = '';

    import('./desktopMode.js').then(module => {
        if (module.handleDesktopPhotoImport) {
            module.handleDesktopPhotoImport(files);
        } else {
            showToast("Import photos non disponible ici", "warning");
        }
    }).catch(err => {
        showToast("Erreur chargement module Photos", "error");
    });
}

export function handleRestoreFile(event) {
    const file = event.target.files[0];
    if(!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const json = JSON.parse(e.target.result);
            if (isValidBackup(json)) {
                restoreBackup(json);
            } else {
                showToast("Fichier de sauvegarde corrompu ou invalide.", "error");
            }
        } catch(err) {
            console.error(err);
            showToast("Fichier de sauvegarde invalide", "error");
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

/**
 * MOTEUR INTERNE : Prépare l'objet de sauvegarde avec le bon format
 */

/**
 * Nettoie un objet en supprimant les clés ayant des valeurs null ou undefined.
 * Pour les tableaux, on supprime les éléments nulls/undefined.
 * @param {any} obj L'objet ou tableau à nettoyer
 * @returns {any} L'objet nettoyé
 */
export function cleanDataForExport(obj) {
    if (obj === null || obj === undefined) return undefined;

    if (Array.isArray(obj)) {
        return obj.filter(item => item !== null && item !== undefined).map(cleanDataForExport);
    }

    if (typeof obj === 'object') {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            const cleanedValue = cleanDataForExport(value);
            if (cleanedValue !== undefined) {
                cleaned[key] = cleanedValue;
            }
        }
        return cleaned;
    }

    return obj;
}

/**
 * Construit le bloc `userData` racine du backup. Garde les références de photos
 * « légères » (URLs/chemins admin) ; les photos perso (Blobs) partent dans le
 * fichier « Photos » (photo-backup.js), jamais ici.
 */
function buildRootUserData() {
    const out = {};
    for (const poiId of Object.keys(state.userData || {})) {
        const data = state.userData[poiId] || {};
        const clean = { ...data };
        const lightPhotos = (Array.isArray(data.photos) ? data.photos : [])
            .filter(p => typeof p === 'string' && !p.startsWith('data:'));
        if (lightPhotos.length > 0) clean.photos = lightPhotos;
        else delete clean.photos;
        out[poiId] = clean;
    }
    return out;
}

export async function prepareExportData() {
    const mapId = getActiveMapId();

    const geojson = {
        type: 'FeatureCollection',
        features: featuresForBackup(mapId).map(f => {
            const poiId = getPoiId(f);
            const finalUserData = { ...(state.userData[poiId] || {}) };
            // Les photos vivent dans le bloc userData racine (seul relu à l'import) ;
            // on ne les duplique jamais dans le geojson.
            delete finalUserData.photos;
            return {
                ...f,
                properties: { ...f.properties, userData: finalUserData }
            };
        })
    };

    const exportData = {
        backupVersion: "3.0",
        mapId,
        date: new Date().toISOString(),
        baseGeoJSON: geojson,
        userData: buildRootUserData(),
        myCircuits: state.myCircuits || [],
        hiddenPoiIds: state.hiddenPoiIds || [],
        officialCircuitsStatus: state.officialCircuitsStatus || {},
        // Dates et circuits cachés (19/11/2026) : la restauration qui fusionne
        // en a besoin pour savoir quelle version est la plus récente.
        officialCircuitsStatusUpdatedAt: state.officialCircuitsStatusUpdatedAt || {},
        hiddenCircuitIds: state.hiddenCircuitIds || [],
        hiddenCircuitIdsUpdatedAt: state.hiddenCircuitIdsUpdatedAt || {},
        testedCircuits: state.testedCircuits || {}
    };

    const cleaned = cleanDataForExport(exportData);
    await attachLocalDraft(cleaned, mapId);
    return cleaned;
}

/**
 * BOUTON : Sauvegarde « Données » au PC (téléchargement).
 */
export async function exportDataForMobilePC() {
    try {
        const data = await prepareExportData();
        const jsonString = JSON.stringify(data, null, 2);
        
        // .txt + text/plain : passe mieux par mail et messageries qu'un .json.
        downloadFile(backupFileName(data.mapId, 'donnees'), jsonString, 'text/plain');

        showToast("Sauvegarde de vos données téléchargée", "success");
    } catch (err) {
        console.error("Erreur export données :", err);
        showToast("Erreur lors de la sauvegarde des données", "error");
    }
}

export function setupFileListeners() {
    if (DOM.restoreLoader) {
        DOM.restoreLoader.removeEventListener('change', handleRestoreFile);
        DOM.restoreLoader.addEventListener('change', handleRestoreFile);
    }
    // (Listener btnRestoreData retiré 10/05/2026, PR cleanup post-#514 : le
    // bouton Restaurer n'existe plus dans le menu Outils. Restauration via
    // Outils > Sauvegarder (PR3 dissolution Mon Espace, 06/06/2026).)
    if (DOM.geojsonLoader) {
        DOM.geojsonLoader.removeEventListener('change', handleFileLoad);
        DOM.geojsonLoader.addEventListener('change', handleFileLoad);
    }
    // Handler `btn-open-geojson` retiré 15/05/2026 — le bouton n'existe plus
    // dans le menu admin God Mode (déplacé en carte dans CC admin > Outils).
    // L'input file caché `geojson-loader` reste actif côté change (parsing).

    const btnSaveMobile = document.getElementById('btn-save-mobile');
    if (btnSaveMobile) {
        btnSaveMobile.addEventListener('click', () => {
            if (!isMobileView()) {
                exportDataForMobilePC();
            } else {
                saveUserData();
            }
        });
    }

    const photoLoader = document.getElementById('photo-gps-loader');
    if (photoLoader) photoLoader.addEventListener('change', handlePhotoImport);

    if (DOM.gpxImporter) DOM.gpxImporter.addEventListener('change', handleGpxFileImport);
}

