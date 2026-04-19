// database.js
const DB_NAME = 'HistoryWalkDB';
import { showAlert } from './modal.js';

const DB_VERSION = 6;

// Helper: convert a base64 data-URL string to a Blob
function base64ToBlob(base64) {
    const [header, data] = base64.split(',');
    const mime = (header.match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}
// Singleton promise pour la connexion IDB.
// Un seul `indexedDB.open()` en vol à la fois — les appels concurrents partagent
// la même promesse. Reset sur fermeture pour que la prochaine requête réouvre.
let _dbPromise = null;

export function initDB() {
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            _dbPromise = null; // Permettre une tentative ultérieure
            console.error("Erreur d'initialisation de la base de données:", event);
            reject(new Error("Erreur d'initialisation IndexedDB."));
        };

        request.onsuccess = (event) => {
            const db = event.target.result;

            // onversionchange : une connexion concurrente demande une version supérieure.
            // On reset le singleton EN PREMIER pour que les prochains initDB() obtiennent
            // une nouvelle connexion fraîche. PUIS on ferme — les transactions en cours
            // sur cette connexion recevront une InvalidStateError, mais c'est inévitable
            // (la connexion est condamnée de toute façon).
            db.onversionchange = () => {
                _dbPromise = null; // d'abord : les nouveaux appels ouvriront une connexion fraîche
                db.close();        // ensuite  : on accepte la fermeture
                console.warn('[IDB] Connexion fermée (nouvelle version détectée). Réouverture à la prochaine requête.');
            };

            // La connexion peut aussi se fermer pour d'autres raisons (GC, OS, etc.)
            db.onclose = () => {
                _dbPromise = null;
                console.warn('[IDB] Connexion fermée inopinément — réouverture à la prochaine requête.');
            };

            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const tempDb = event.target.result;
            
            // 1. Données Utilisateur (Photos, Notes, etc.)
            if (!tempDb.objectStoreNames.contains('poiUserData')) {
                tempDb.createObjectStore('poiUserData', { keyPath: ['mapId', 'poiId'] })
                      .createIndex('mapId_index', 'mapId', { unique: false });
            }
            
            // 2. Circuits Sauvegardés
            if (!tempDb.objectStoreNames.contains('savedCircuits')) {
                tempDb.createObjectStore('savedCircuits', { keyPath: 'id' })
                      .createIndex('mapId_index', 'mapId', { unique: false });
            }
            
            // 3. État de l'application (Préférences)
            if (!tempDb.objectStoreNames.contains('appState')) {
                tempDb.createObjectStore('appState', { keyPath: 'key' });
            }
            
            // 4. Modifications en attente (Sync)
            // CORRECTION: On ne supprime plus le store s'il existe déjà pour éviter de perdre des données lors d'une update
            if (!tempDb.objectStoreNames.contains('modifications')) {
                tempDb.createObjectStore('modifications', { autoIncrement: true });
            }

            // 5. Photos utilisateur (Blobs natifs — séparé de poiUserData pour alléger les exports)
            if (!tempDb.objectStoreNames.contains('poiPhotos')) {
                tempDb.createObjectStore('poiPhotos', { keyPath: ['mapId', 'poiId'] })
                      .createIndex('mapId_index', 'mapId', { unique: false });
            }
        };
    });
}

// --- HELPER DE RÉSILIENCE IDB ---
// Exécute fn(db) et, si la connexion était en cours de fermeture (onversionchange
// concurrent), reset le singleton et réessaie UNE fois avec une connexion fraîche.
// Évite l'"InvalidStateError: database connection is closing" qui survient quand :
//   1. initDB() renvoie la connexion ouverte (t0)
//   2. onversionchange → db.close() + _dbPromise = null (t1)
//   3. db.transaction(...) → erreur (t2) car la connexion est fermée entre t0 et t2
async function withRetry(fn) {
    try {
        return await fn(await initDB());
    } catch (e) {
        if (e?.name === 'InvalidStateError' && e?.message?.includes('closing')) {
            _dbPromise = null; // Force réouverture si le singleton n'a pas encore été reset
            return await fn(await initDB());
        }
        throw e;
    }
}

export async function getAppState(key) {
    return withRetry(db => new Promise((resolve, reject) => {
        const transaction = db.transaction('appState', 'readonly');
        const request = transaction.objectStore('appState').get(key);
        request.onsuccess = () => resolve(request.result ? request.result.value : undefined);
        request.onerror = (event) => reject(event.target.error);
    }));
}

export async function softDeleteCircuit(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('savedCircuits', 'readwrite');
        const store = transaction.objectStore('savedCircuits');

        const getRequest = store.get(id);
        getRequest.onsuccess = () => {
            const circuit = getRequest.result;
            if (circuit) {
                circuit.isDeleted = true;
                const putRequest = store.put(circuit);
                putRequest.onsuccess = () => resolve();
                putRequest.onerror = (e) => reject(e.target.error);
            } else {
                resolve();
            }
        };
        getRequest.onerror = (e) => reject(e.target.error);
    });
}

export async function restoreCircuit(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('savedCircuits', 'readwrite');
        const store = transaction.objectStore('savedCircuits');

        const getRequest = store.get(id);
        getRequest.onsuccess = () => {
            const circuit = getRequest.result;
            if (circuit) {
                circuit.isDeleted = false;
                const putRequest = store.put(circuit);
                putRequest.onsuccess = () => resolve();
                putRequest.onerror = (e) => reject(e.target.error);
            } else {
                resolve();
            }
        };
        getRequest.onerror = (e) => reject(e.target.error);
    });
}

export async function saveAppState(key, value) {
    return withRetry(db => new Promise((resolve, reject) => {
        const transaction = db.transaction('appState', 'readwrite');
        const request = transaction.objectStore('appState').put({ key, value });
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    }));
}

export async function getAllPoiDataForMap(mapId) {
    return withRetry(db => new Promise((resolve, reject) => {
        const transaction = db.transaction('poiUserData', 'readonly');
        const request = transaction.objectStore('poiUserData').index('mapId_index').getAll(mapId);
        request.onsuccess = () => {
            const userData = {};
            if (request.result) {
                request.result.forEach(item => {
                    const { mapId, poiId, ...data } = item;
                    userData[poiId] = data;
                });
            }
            resolve(userData);
        };
        request.onerror = (event) => reject(event.target.error);
    }));
}

export async function savePoiData(mapId, poiId, data) {
    return withRetry(db => new Promise((resolve, reject) => {
        const transaction = db.transaction('poiUserData', 'readwrite');
        const store = transaction.objectStore('poiUserData');

        // Lecture d'abord pour fusionner (merge) au lieu d'écraser
        const getRequest = store.get([mapId, poiId]);

        getRequest.onsuccess = () => {
            const existingData = getRequest.result || {};
            const dataToSave = { ...existingData, ...data, mapId, poiId };

            const putRequest = store.put(dataToSave);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = (event) => reject(event.target.error);
        };

        getRequest.onerror = (event) => reject(event.target.error);
    }));
}

/**
 * Supprime l'entrée d'un POI dans le store `poiUserData`.
 * Utilisé par le CC après publication ou refus pour éviter que les
 * modifications locales réapparaissent au prochain boot (getAllPoiDataForMap
 * repeuplerait state.userData avec ces entrées orphelines).
 */
export async function deletePoiData(mapId, poiId) {
    return withRetry(db => new Promise((resolve, reject) => {
        const tx = db.transaction('poiUserData', 'readwrite');
        const req = tx.objectStore('poiUserData').delete([mapId, poiId]);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    }));
}

export async function batchSavePoiData(mapId, dataArray) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        if (!dataArray || dataArray.length === 0) return resolve();

        // 1. Regrouper et fusionner les modifications en mémoire par poiId
        // Cela évite d'écraser des données si dataArray contient plusieurs mises à jour pour le même POI
        const mergedDataMap = new Map();
        dataArray.forEach(item => {
            const { poiId, data } = item;
            if (mergedDataMap.has(poiId)) {
                mergedDataMap.set(poiId, { ...mergedDataMap.get(poiId), ...data });
            } else {
                mergedDataMap.set(poiId, { ...data });
            }
        });

        const transaction = db.transaction('poiUserData', 'readwrite');
        const store = transaction.objectStore('poiUserData');
        let errors = [];

        transaction.oncomplete = () => {
            if (errors.length > 0) {
                console.warn("Certaines sauvegardes batch ont échoué :", errors);
                // On résout quand même car la transaction a commité ce qui était valide
            }
            resolve();
        };

        transaction.onerror = (event) => reject(event.target.error);

        // 2. Traiter chaque poiId unique
        mergedDataMap.forEach((data, poiId) => {
            try {
                // Lecture d'abord pour fusionner (merge) au lieu d'écraser
                const getRequest = store.get([mapId, poiId]);
                getRequest.onsuccess = () => {
                    const existingData = getRequest.result || {};
                    const dataToSave = { ...existingData, ...data, mapId, poiId };

                    const putRequest = store.put(dataToSave);
                    putRequest.onerror = (e) => errors.push({ id: poiId, error: e.target.error });
                };
                getRequest.onerror = (e) => errors.push({ id: poiId, error: e.target.error });
            } catch (e) {
                errors.push({ id: poiId, error: e });
            }
        });
    });
}

export async function getAllCircuitsForMap(mapId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('savedCircuits', 'readonly');
        const request = transaction.objectStore('savedCircuits').index('mapId_index').getAll(mapId);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (event) => reject(event.target.error);
    });
}

export async function saveCircuit(circuitData) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('savedCircuits', 'readwrite');
        const request = transaction.objectStore('savedCircuits').put(circuitData);
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

export async function deleteCircuitById(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('savedCircuits', 'readwrite');
        const request = transaction.objectStore('savedCircuits').delete(id);
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

export async function clearAllUserData() {
    try {
        const db = await initDB();
        // On liste explicitement les stores connus
        const storesToClear = ['poiUserData', 'savedCircuits', 'appState', 'modifications', 'poiPhotos'];
        
        // On vérifie qu'ils existent dans la version actuelle de la DB pour éviter une erreur
        const activeStores = storesToClear.filter(name => db.objectStoreNames.contains(name));
        
        if (activeStores.length === 0) return Promise.resolve();

        const transaction = db.transaction(activeStores, 'readwrite');

        return new Promise((resolve, reject) => {
            let completed = 0;
            
            const checkCompletion = () => {
                completed++;
                if (completed === activeStores.length) resolve();
            };

            activeStores.forEach(storeName => {
                const request = transaction.objectStore(storeName).clear();
                request.onsuccess = checkCompletion;
                request.onerror = (e) => {
                    console.error(`Erreur vidage ${storeName}`, e);
                    checkCompletion(); // On continue même si un store plante
                };
            });

            transaction.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        return Promise.reject(error);
    }
}

export function deleteDatabase() {
    return new Promise((resolve, reject) => {
        const dbName = DB_NAME; 
        
        // 1. On ferme la connexion active locale (celle du module)
        if (db) {
            db.close();
            db = null; // On remet à null pour éviter toute réutilisation
        }

        // 2. On lance la suppression
        const request = indexedDB.deleteDatabase(dbName);

        request.onsuccess = () => {
            localStorage.clear(); 
            resolve();
        };

        request.onerror = (event) => {
            console.error("Erreur suppression DB:", event);
            reject("Impossible de supprimer la base de données.");
        };

        request.onblocked = async () => {
            console.warn("Suppression bloquée. Fermeture forcée de la connexion et réessai...");
            // Si bloqué, c'est souvent qu'une autre instance (onglet) est ouverte.
            // On ne peut pas forcer la fermeture des autres onglets via JS.
            await showAlert("Base de données verrouillée", "Veuillez fermer les autres onglets de l'application pour permettre la réinitialisation complète.");
        };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// PHOTOS (poiPhotos store)
// Chaque enregistrement : { mapId, poiId, photos: [{ id: string, blob: Blob }] }
// La migration lazy convertit les anciens base64 de poiUserData → Blob ici.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Charge les photos d'un POI depuis le store dédié.
 * Migration automatique si des base64 traînent encore dans poiUserData.
 * @returns {Promise<Array<{id: string, blob: Blob}>>}
 */
export async function getPoiPhotos(mapId, poiId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['poiPhotos', 'poiUserData'], 'readwrite');
        tx.onerror = (e) => reject(e.target.error);

        const photosStore = tx.objectStore('poiPhotos');
        const userDataStore = tx.objectStore('poiUserData');

        const req1 = photosStore.get([mapId, poiId]);
        req1.onerror = (e) => reject(e.target.error);
        req1.onsuccess = () => {
            const existing = req1.result;
            if (existing?.photos?.length > 0) {
                resolve(existing.photos);
                return;
            }

            // Migration lazy : cherche les base64 dans l'ancien store
            const req2 = userDataStore.get([mapId, poiId]);
            req2.onerror = (e) => reject(e.target.error);
            req2.onsuccess = () => {
                const oldData = req2.result;
                const base64List = (oldData?.photos || []).filter(
                    p => typeof p === 'string' && p.startsWith('data:')
                );

                if (base64List.length === 0) {
                    resolve([]);
                    return;
                }

                // Convertit base64 → Blob et persiste dans le nouveau store
                const migrated = base64List.map((b64, i) => ({
                    id: `migrated_${poiId}_${i}_${Date.now()}`,
                    blob: base64ToBlob(b64)
                }));

                photosStore.put({ mapId, poiId, photos: migrated });

                // Retire les base64 de poiUserData (conserve les URL strings admin)
                const remainingPhotos = (oldData.photos || []).filter(
                    p => typeof p === 'string' && !p.startsWith('data:')
                );
                oldData.photos = remainingPhotos;
                userDataStore.put(oldData);

                tx.oncomplete = () => resolve(migrated);
            };
        };
    });
}

/**
 * Sauvegarde (remplace) toutes les photos d'un POI dans le store dédié.
 * @param {string} mapId
 * @param {string} poiId
 * @param {Array<{id: string, blob: Blob}>} photos
 */
export async function savePoiPhotos(mapId, poiId, photos) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('poiPhotos', 'readwrite');
        const req = tx.objectStore('poiPhotos').put({ mapId, poiId, photos });
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Supprime toutes les photos d'un POI.
 */
export async function deletePoiPhotos(mapId, poiId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('poiPhotos', 'readwrite');
        const req = tx.objectStore('poiPhotos').delete([mapId, poiId]);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// PENDING ADMIN PHOTOS (appState key: `pendingAdminPhotos_${mapId}`)
// Draft local des photos admin à uploader lors du prochain publish CC.
// Les photos sont stockées sous forme de Blob local tant qu'elles ne sont pas
// publiées sur GitHub (pattern aligné sur le reste de l'adminDraft).
// Format : { [poiId]: [{ id: string, blob: Blob }] }
// ─────────────────────────────────────────────────────────────────────────────

function pendingAdminPhotosKey(mapId) {
    return `pendingAdminPhotos_${mapId}`;
}

/** Photos pending d'un POI (array vide si aucune). */
export async function getPendingAdminPhotos(mapId, poiId) {
    const all = (await getAppState(pendingAdminPhotosKey(mapId))) || {};
    return all[poiId] || [];
}

/** Map complète des photos pending pour la carte courante. */
export async function getAllPendingAdminPhotos(mapId) {
    return (await getAppState(pendingAdminPhotosKey(mapId))) || {};
}

/** Remplace les photos pending d'un POI (array vide = suppression). */
export async function setPendingAdminPhotos(mapId, poiId, photos) {
    const all = (await getAppState(pendingAdminPhotosKey(mapId))) || {};
    if (!photos || photos.length === 0) {
        delete all[poiId];
    } else {
        all[poiId] = photos;
    }
    await saveAppState(pendingAdminPhotosKey(mapId), all);
}

/** Supprime toutes les photos pending d'un POI. */
export async function clearPendingAdminPhotos(mapId, poiId) {
    const all = (await getAppState(pendingAdminPhotosKey(mapId))) || {};
    delete all[poiId];
    await saveAppState(pendingAdminPhotosKey(mapId), all);
}

/**
 * Retourne toutes les entrées photos pour une carte (pour calcul de taille backup).
 * @returns {Promise<Array<{mapId, poiId, photos}>>}
 */
export async function getAllPoiPhotosForMap(mapId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('poiPhotos', 'readonly');
        const req = tx.objectStore('poiPhotos').index('mapId_index').getAll(mapId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
    });
}

export async function clearStore(storeName) {
    // Utilisation de initDB pour garantir une connexion valide
    try {
        const db = await initDB();
        
        // Vérification de sécurité
        if (!db.objectStoreNames.contains(storeName)) {
            console.warn(`Le store ${storeName} n'existe pas.`);
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const clearRequest = store.clear();

            clearRequest.onsuccess = () => resolve();
            clearRequest.onerror = (e) => reject(e.target.error);
        });
    } catch (err) {
        return Promise.reject(err);
    }
}