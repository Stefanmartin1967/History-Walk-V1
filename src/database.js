// database.js
const DB_NAME = 'HistoryWalkDB';
import { showAlert } from './modal.js';

const DB_VERSION = 5;
let db; // Variable locale au module pour garder la connexion ouverte

export function initDB() {
    return new Promise((resolve, reject) => {
        // Si la base de données est déjà ouverte avec la bonne version, on la réutilise.
        if (db && db.version === DB_VERSION) {
            return resolve(db);
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = (event) => {
            console.error("Erreur d'initialisation de la base de données:", event);
            reject(new Error("Erreur d'initialisation IndexedDB."));
        };
        
        request.onsuccess = (event) => {
            db = event.target.result;
            // Gestion générique des erreurs de connexion ultérieures
            db.onversionchange = () => {
                db.close();
                console.warn("Base de données fermée car une nouvelle version a été ouverte ailleurs.");
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
        };
    });
}

export async function getAppState(key) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('appState', 'readonly');
        const request = transaction.objectStore('appState').get(key);
        request.onsuccess = () => resolve(request.result ? request.result.value : undefined);
        request.onerror = (event) => reject(event.target.error);
    });
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
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('appState', 'readwrite');
        const request = transaction.objectStore('appState').put({ key, value });
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

export async function getAllPoiDataForMap(mapId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
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
    });
}

export async function savePoiData(mapId, poiId, data) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
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
    });
}

export async function batchSavePoiData(mapId, dataArray) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        if (!dataArray || dataArray.length === 0) return resolve();

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

        dataArray.forEach(item => {
            const { poiId, data } = item;
            // Note : Pour optimiser la vitesse du batch, on ne fait pas de read-before-write ici
            // On écrase ou on suppose que 'data' est complet.
            // Si le merge est vital, cela ralentira le processus batch.
            const dataToSave = { ...data, mapId, poiId };
            try {
                store.put(dataToSave);
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
        const storesToClear = ['poiUserData', 'savedCircuits', 'appState', 'modifications'];
        
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
            console.log("Base de données supprimée.");
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