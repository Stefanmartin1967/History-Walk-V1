// database.js
const DB_NAME = 'HistoryWalkDB';
import { showAlert } from './modal.js';
import { BASE_KEY, pruneStamps, OFFICIAL_BASE_KEY, pruneOfficialBases } from './overlay-base.js';
import { syncStampsFor } from './sync-stamps.js';
import { FIELD_DATES_KEY, FIELD_FROM_KEY, fieldStamps, stampsAfterRemoval, stampCreatedPlaces, circuitUpdatedAt } from './field-dates.js';

// ─── Estampille de la version de départ (18/11/2026, conflits à la publication) ──
// Toutes les écritures de fiche passent par savePoiData / batchSavePoiData : c'est
// ici, et seulement ici, qu'on note sur quelle version de la carte un champ publié
// a été modifié (cf. overlay-base.js). Le crochet est posé au démarrage par
// installOverlayBaseHook (overlay-base-hook.js) ; sans lui (tests), rien n'est noté.
let _writeHook = null;
export function setPoiDataWriteHook(fn) { _writeHook = typeof fn === 'function' ? fn : null; }
// Valeur officielle d'un champ à sa première modification par un user
// (overlay-base.js, « fiche officielle mise à jour depuis votre modification »).
let _officialBaseHook = null;
export function setOfficialBaseHook(fn) { _officialBaseHook = typeof fn === 'function' ? fn : null; }

// Dates de changement, posées ici pour la même raison (une écriture = un seul
// endroit) : champs synchronisés par le Gist (18/11/2026, sync-stamps.js) et,
// depuis le 19/11/2026, chaque champ modifié d'une fiche (`_fieldDates`,
// field-dates.js — fondation de la restauration qui fusionne et de la synchro
// des users). L'écouteur recopie ces dates dans la mémoire, d'où partent les
// sauvegardes et l'envoi Gist.
let _stampListener = null;
export function setStampListener(fn) { _stampListener = typeof fn === 'function' ? fn : null; }
function notifyStamps(mapId, poiId, fields) {
    try { _stampListener?.(mapId, poiId, fields); }
    catch (e) { console.warn('[database] dates non recopiées en mémoire :', e); }
}

function withStamps(mapId, poiId, existing, data) {
    const dated = syncStampsFor(existing, data);
    if (dated) {
        data = { ...data, ...dated };
        notifyStamps(mapId, poiId, dated);
    }
    const stamps = fieldStamps(existing, data);
    if (stamps) {
        data = { ...data, ...stamps };
        notifyStamps(mapId, poiId, stamps);
    }
    if (_officialBaseHook) {
        let bases = null;
        try { bases = _officialBaseHook(mapId, poiId, existing, data); }
        catch (e) { console.warn('[database] valeur officielle non notée :', e); }
        if (bases) data = { ...data, [OFFICIAL_BASE_KEY]: { ...(existing?.[OFFICIAL_BASE_KEY] || {}), ...(data[OFFICIAL_BASE_KEY] || {}), ...bases } };
    }
    if (!_writeHook) return data;
    let extra = null;
    try { extra = _writeHook(mapId, poiId, existing, data); }
    catch (e) { console.warn('[database] estampille de version ignorée :', e); }
    if (!extra) return data;
    return { ...data, [BASE_KEY]: { ...(existing?.[BASE_KEY] || {}), ...(data[BASE_KEY] || {}), ...extra } };
}

const DB_VERSION = 9;

// Helper: convert a base64 data-URL string to a Blob
export function base64ToBlob(base64) {
    const [header, data] = base64.split(',');
    const mime = (header.match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

// Helper: convert a Blob to a base64 data-URL string (inverse de base64ToBlob).
// Utilisé à l'export pour sérialiser les photos (le JSON ne peut pas porter un Blob).
export function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
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

            // 6. Cache OSM nearest-way (chantier point d'accès v2, 31/05/2026)
            // Réponse Overpass mise en cache par POI pour éviter de re-fetch :
            // - à la création silencieuse depuis richEditor,
            // - au clic « Pré-poser via OSM » dans la barre unitaire,
            // - à la passe globale (PR3).
            // Pas de TTL : l'admin re-déclenche manuellement si OSM a évolué.
            if (!tempDb.objectStoreNames.contains('osmNearestWay')) {
                tempDb.createObjectStore('osmNearestWay', { keyPath: ['mapId', 'poiId'] })
                      .createIndex('mapId_index', 'mapId', { unique: false });
            }

            // 7. Cache des photos de travail (chantier 10/08/2026, DB v9).
            // Les octets vivent dans un dépôt GitHub PRIVÉ : impossible de les
            // charger via `<img src>` (il faut un en-tête d'autorisation). On les
            // rapatrie une fois par API authentifiée, puis on les sert depuis ce
            // cache — c'est ce qui les rend consultables hors-ligne sur le terrain.
            // Clé = chemin dans le dépôt privé (déjà unique, mapId inclus).
            if (!tempDb.objectStoreNames.contains('workPhotoCache')) {
                tempDb.createObjectStore('workPhotoCache', { keyPath: 'path' });
            }
        };
    });

    return _dbPromise;
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
                // Date du geste Corbeille (field-dates.js), renvoyée à l'appelant
                // pour la mémoire.
                circuit.trashUpdatedAt = Date.now();
                const putRequest = store.put(circuit);
                putRequest.onsuccess = () => resolve(circuit.trashUpdatedAt);
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
                // Date du geste Corbeille (field-dates.js), renvoyée à l'appelant
                // pour la mémoire.
                circuit.trashUpdatedAt = Date.now();
                const putRequest = store.put(circuit);
                putRequest.onsuccess = () => resolve(circuit.trashUpdatedAt);
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
        const store = transaction.objectStore('appState');
        const put = () => {
            const request = store.put({ key, value });
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        };
        // Lieux créés (`customPois_<destination>`, une dizaine de sites
        // d'écriture) : leurs champs changés sont datés ici, à l'unique point
        // d'écriture (field-dates.js), sur les objets reçus, ceux de la mémoire.
        if (typeof key === 'string' && key.startsWith('customPois_') && Array.isArray(value)) {
            const getRequest = store.get(key);
            getRequest.onsuccess = () => { stampCreatedPlaces(getRequest.result?.value, value); put(); };
            getRequest.onerror = (event) => reject(event.target.error);
        } else {
            put();
        }
    }));
}

export async function deleteAppState(key) {
    return withRetry(db => new Promise((resolve, reject) => {
        const transaction = db.transaction('appState', 'readwrite');
        const request = transaction.objectStore('appState').delete(key);
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

/**
 * Migration one-shot : pour chaque entrée du store `poiUserData` d'une carte,
 * normalise la clé `Description` (capital) en `description` (lowercase).
 *   - les 2 cases coexistent → lowercase a la priorité, capital supprimée
 *   - capital seule           → renommée en lowercase
 * Idempotente. Retourne le nombre d'entrées modifiées.
 *
 * Pourquoi ICI et pas en mémoire seule : si on normalise juste `state.userData`
 * sans toucher le store, le prochain `savePoiData` fera `{...existing, ...data}`
 * qui ressort la clé `Description` du store → migration annulée. Il faut écrire
 * la version normalisée au store, en remplaçant l'entrée entière (pas un merge).
 */
export async function normalizeDescriptionCaseInPoiData(mapId) {
    return withRetry(db => new Promise((resolve, reject) => {
        const tx = db.transaction('poiUserData', 'readwrite');
        const store = tx.objectStore('poiUserData');
        const req = store.index('mapId_index').openCursor(mapId);
        let migrated = 0;
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return; // fin du curseur → tx.oncomplete prend le relais
            const v = cursor.value;
            if (v && typeof v === 'object' && 'Description' in v) {
                if (!('description' in v) || v.description == null) {
                    v.description = v.Description;
                }
                delete v.Description;
                cursor.update(v);
                migrated++;
            }
            cursor.continue();
        };
        req.onerror = (e) => reject(e.target.error);
        tx.oncomplete = () => resolve(migrated);
        tx.onerror = (e) => reject(e.target.error);
    }));
}

/**
 * Migration one-shot : renomme `Description_courte` → `info_gpx` dans le
 * store `poiUserData` d'une carte. Même pattern que normalizeDescriptionCase :
 * curseur transactionnel, write-back via cursor.update, idempotente.
 *
 * `info_gpx` est la nouvelle clé canonique pour le texte qui voyage dans le
 * <desc> des waypoints du GPX exporté (cf. gpx.js). L'ancien nom partageait
 * son préfixe avec `description` → confusion. Le case lowercase suit la
 * trajectoire de la PR #704.
 */
export async function renameDescriptionCourteToInfoGpxInPoiData(mapId) {
    return withRetry(db => new Promise((resolve, reject) => {
        const tx = db.transaction('poiUserData', 'readwrite');
        const store = tx.objectStore('poiUserData');
        const req = store.index('mapId_index').openCursor(mapId);
        let migrated = 0;
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            const v = cursor.value;
            if (v && typeof v === 'object' && 'Description_courte' in v) {
                if (!('info_gpx' in v) || v.info_gpx == null) {
                    v.info_gpx = v.Description_courte;
                }
                delete v.Description_courte;
                cursor.update(v);
                migrated++;
            }
            cursor.continue();
        };
        req.onerror = (e) => reject(e.target.error);
        tx.oncomplete = () => resolve(migrated);
        tx.onerror = (e) => reject(e.target.error);
    }));
}

/**
 * Migration one-shot : sous-type « Générique » → vide dans le store
 * `poiUserData` d'une carte (10/10/2026 : la valeur sort de la taxonomie,
 * Stefan préfère laisser vide). Même pattern que normalizeDescriptionCase :
 * curseur transactionnel, write-back via cursor.update, idempotente.
 *
 * Une surcharge locale « Générique » devient "" et non une clé supprimée : elle
 * disait « forme inconnue », le retrait ferait réapparaître la valeur publiée.
 * Le fichier publié est migré à part (scripts/migrate-sous-type-generique.mjs).
 */
export async function clearGenericSubtypeInPoiData(mapId) {
    return withRetry(db => new Promise((resolve, reject) => {
        const tx = db.transaction('poiUserData', 'readwrite');
        const store = tx.objectStore('poiUserData');
        const req = store.index('mapId_index').openCursor(mapId);
        let migrated = 0;
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            const v = cursor.value;
            if (v && typeof v === 'object' && v['Sous-type'] === 'Générique') {
                v['Sous-type'] = '';
                cursor.update(v);
                migrated++;
            }
            cursor.continue();
        };
        req.onerror = (e) => reject(e.target.error);
        tx.oncomplete = () => resolve(migrated);
        tx.onerror = (e) => reject(e.target.error);
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
            const dataToSave = { ...existingData, ...withStamps(mapId, poiId, getRequest.result || null, data), mapId, poiId };

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

/**
 * Retire des CLÉS précises de l'entrée d'un POI (store `poiUserData`), en
 * relisant l'enregistrement en base — tout le reste est conservé tel qu'il est
 * en base, y compris ce que la mémoire ignorerait. Si plus aucune clé ne reste,
 * l'entrée est supprimée.
 *
 * Pourquoi (14/09/2026) : le nettoyage des orphelins du CC écrivait via
 * `savePoiData`, qui FUSIONNE — une clé retirée en mémoire restait en base,
 * revenait au boot, et remettait le lieu « en attente » à chaque ouverture du CC
 * (416 lieux mesurés chez Stefan).
 * @param {string} mapId
 * @param {string} poiId
 * @param {string[]} keys
 * @returns {Promise<number>} Nombre de clés restantes.
 */
/**
 * REMPLACE l'entrée d'une fiche par `data` (sans fusion avec l'ancienne), en
 * comparant à l'ancienne pour les dates. Remplace le couple « deletePoiData puis
 * savePoiData », qui faisait passer chaque champ pour neuf (ancienne entrée
 * effacée avant la comparaison).
 */
export async function replacePoiData(mapId, poiId, data) {
    return withRetry(db => new Promise((resolve, reject) => {
        const tx = db.transaction('poiUserData', 'readwrite');
        const store = tx.objectStore('poiUserData');
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
        const getReq = store.get([mapId, poiId]);
        getReq.onsuccess = () => {
            const existing = getReq.result || null;
            // Les dates déjà posées suivent ; un champ absent de `data` est un
            // retrait, daté comme tel.
            const carried = {
                [FIELD_DATES_KEY]: { ...(existing?.[FIELD_DATES_KEY] || {}), ...(data?.[FIELD_DATES_KEY] || {}) },
                [FIELD_FROM_KEY]: { ...(existing?.[FIELD_FROM_KEY] || {}), ...(data?.[FIELD_FROM_KEY] || {}) },
            };
            const removed = existing
                ? Object.keys(existing).filter(k => k !== 'mapId' && k !== 'poiId' && !(k in data))
                : [];
            const stamps = stampsAfterRemoval(carried, removed) || carried;
            const next = Object.keys(stamps[FIELD_DATES_KEY]).length ? { ...data, ...stamps } : data;
            store.put({ ...withStamps(mapId, poiId, existing, next), mapId, poiId });
        };
    }));
}

/**
 * Remet l'entrée d'une fiche EXACTEMENT telle qu'elle était (null = pas
 * d'entrée), sans poser de date : sert à « Annuler la restauration »
 * (restore-apply.js), qui doit rendre l'appareil comme avant, dates comprises.
 */
export async function putPoiDataExact(mapId, poiId, data) {
    return withRetry(db => new Promise((resolve, reject) => {
        const tx = db.transaction('poiUserData', 'readwrite');
        const store = tx.objectStore('poiUserData');
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
        if (data) store.put({ ...data, mapId, poiId });
        else store.delete([mapId, poiId]);
    }));
}

export async function removePoiDataKeys(mapId, poiId, keys) {
    return withRetry(db => new Promise((resolve, reject) => {
        const tx = db.transaction('poiUserData', 'readwrite');
        const store = tx.objectStore('poiUserData');
        let remaining = 0;
        tx.oncomplete = () => resolve(remaining);
        tx.onerror = (e) => reject(e.target.error);
        const getReq = store.get([mapId, poiId]);
        getReq.onsuccess = () => {
            const existing = getReq.result;
            if (!existing) return;
            const next = { ...existing };
            if (next[BASE_KEY]) next[BASE_KEY] = { ...next[BASE_KEY] };
            if (next[OFFICIAL_BASE_KEY]) next[OFFICIAL_BASE_KEY] = { ...next[OFFICIAL_BASE_KEY] };
            const removed = (keys || []).filter(k => k in next);
            removed.forEach(k => { delete next[k]; });
            pruneStamps(next); // plus d'estampille pour un champ retiré
            pruneOfficialBases(next); // ni de valeur officielle notée
            // Retirer un champ (retour à la valeur officielle) est un changement
            // daté : une fusion saura qu'il est plus récent qu'une version qui
            // le portait encore.
            const stamps = stampsAfterRemoval(next, removed);
            if (stamps) { Object.assign(next, stamps); notifyStamps(mapId, poiId, stamps); }
            remaining = Object.keys(next).filter(k => k !== 'mapId' && k !== 'poiId' && k !== FIELD_DATES_KEY && k !== FIELD_FROM_KEY).length;
            if (remaining === 0) store.delete([mapId, poiId]);
            else store.put({ ...next, mapId, poiId });
        };
    }));
}

export async function batchSavePoiData(mapId, dataArray) {
    if (!dataArray || dataArray.length === 0) return;

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

    return withRetry(db => new Promise((resolve, reject) => {
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
                    const dataToSave = { ...existingData, ...withStamps(mapId, poiId, getRequest.result || null, data), mapId, poiId };

                    const putRequest = store.put(dataToSave);
                    putRequest.onerror = (e) => errors.push({ id: poiId, error: e.target.error });
                };
                getRequest.onerror = (e) => errors.push({ id: poiId, error: e.target.error });
            } catch (e) {
                errors.push({ id: poiId, error: e });
            }
        });
    }));
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

/**
 * Enregistre un circuit. Sa date de modification (`updatedAt`, field-dates.js)
 * est posée ici si son contenu change ; elle est aussi écrite sur l'objet reçu
 * (souvent celui de la mémoire, d'où partent les sauvegardes).
 */
export async function saveCircuit(circuitData) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('savedCircuits', 'readwrite');
        const store = transaction.objectStore('savedCircuits');
        const getRequest = store.get(circuitData.id);
        getRequest.onsuccess = () => {
            const updatedAt = circuitUpdatedAt(getRequest.result || null, circuitData);
            if (updatedAt !== undefined) circuitData.updatedAt = updatedAt;
            const request = store.put(circuitData);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        };
        getRequest.onerror = (event) => reject(event.target.error);
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

/**
 * Supprime TOUTES les entrées d'une carte dans les stores indexés par mapId :
 * poiUserData (curation/notes), savedCircuits (circuits perso), poiPhotos (blobs)
 * et osmNearestWay (cache OSM). Utilisé par la suppression d'un brouillon LOCAL de
 * destination (local-destinations.deleteLocalDraftDestination). Une seule
 * transaction multi-stores ; chaque store a un index 'mapId_index'.
 * @param {string} mapId
 * @returns {Promise<{poiUserData:number, savedCircuits:number, poiPhotos:number, osmNearestWay:number}>}
 */
export async function deleteAllMapData(mapId) {
    const STORES = ['poiUserData', 'savedCircuits', 'poiPhotos', 'osmNearestWay'];
    return withRetry(db => new Promise((resolve, reject) => {
        const counts = { poiUserData: 0, savedCircuits: 0, poiPhotos: 0, osmNearestWay: 0 };
        const tx = db.transaction(STORES, 'readwrite');
        tx.oncomplete = () => resolve(counts);
        tx.onerror = (e) => reject(e.target.error);
        tx.onabort = (e) => reject(e.target.error || new Error('deleteAllMapData aborted'));
        for (const name of STORES) {
            const req = tx.objectStore(name).index('mapId_index').openCursor(IDBKeyRange.only(mapId));
            req.onsuccess = (ev) => {
                const cur = ev.target.result;
                if (cur) { cur.delete(); counts[name]++; cur.continue(); }
            };
        }
    }));
}

/**
 * Vide le store `modifications` — ancien journal des modifications de lieux.
 *
 * Retiré le 14/09/2026 : il était écrit à chaque enregistrement mais plus lu
 * par rien depuis au moins le 17/02/2026 (son export CSV n'avait aucun appelant,
 * supprimé comme code mort le 25/05). Le store reste déclaré dans le schéma (le
 * supprimer imposerait un changement de version de la base, pour rien) ; on le
 * vide au démarrage — sans effet une fois vide, puisque plus rien n'y écrit.
 * @returns {Promise<void>}
 */
export async function clearModificationLog() {
    return withRetry(db => new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains('modifications')) { resolve(); return; }
        const tx = db.transaction('modifications', 'readwrite');
        tx.objectStore('modifications').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    }));
}

/** @public API de reset complet — conservée délibérément (pas d'appelant actuel). */
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

export async function deleteDatabase() {
    // 1. Fermer la connexion active si elle existe, puis reset le singleton
    //    AVANT indexedDB.deleteDatabase() — sinon une requête concurrente via
    //    withRetry pourrait rouvrir la DB pendant la suppression.
    if (_dbPromise) {
        try {
            const db = await _dbPromise;
            db.close();
        } catch {
            // Connexion jamais établie (promise rejected) : rien à fermer.
        }
        _dbPromise = null;
    }

    // 2. Lancer la suppression
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME);

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
 * Tous les srcHash des photos user déjà stockées pour la carte (tous POIs
 * confondus). Sert à la déduplication à l'import (dédup 2-local) : une photo
 * dont le hash y figure déjà ne sera pas réimportée. Set vide si rien.
 * @param {string} mapId
 * @returns {Promise<Set<string>>}
 */
export async function getAllPoiPhotoHashes(mapId) {
    return withRetry(db => new Promise((resolve, reject) => {
        const tx = db.transaction('poiPhotos', 'readonly');
        const req = tx.objectStore('poiPhotos').index('mapId_index').getAll(mapId);
        req.onsuccess = () => {
            const hashes = new Set();
            for (const entry of req.result || []) {
                for (const p of entry.photos || []) {
                    if (p.srcHash) hashes.add(p.srcHash);
                }
            }
            resolve(hashes);
        };
        req.onerror = (e) => reject(e.target.error);
    }));
}

/**
 * Supprime toutes les photos d'un POI.
 * @public Primitive d'API conservée délibérément (pas d'appelant actuel).
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

/**
 * Tous les srcHash des photos admin en attente (tous POIs). Pendant admin de
 * getAllPoiPhotoHashes pour la dédup à l'import (dédup 2-local). Set vide si rien.
 * @param {string} mapId
 * @returns {Promise<Set<string>>}
 */
export async function getAllPendingAdminPhotoHashes(mapId) {
    const all = await getAllPendingAdminPhotos(mapId);
    const hashes = new Set();
    for (const list of Object.values(all)) {
        for (const p of list || []) {
            if (p.srcHash) hashes.add(p.srcHash);
        }
    }
    return hashes;
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

    // Le provisoire s'efface devant le définitif (règle validée 10/08/2026) :
    // dès que de VRAIES photos sont attachées, les photos de travail du lieu
    // perdent leur raison d'être et leurs références sont retirées — sauf
    // celles marquées « gardées » (25/09/2026, cf. work-photos.js).
    //
    // Posé ICI et pas dans les appelants : les quatre chemins d'ajout (import
    // bureau, modale de tri, grille photo, Centre de Contrôle) convergent tous
    // vers cette fonction. Un par un, c'eût été un filtre à oublier de plus.
    //
    // La garde sur la longueur est essentielle : une liste VIDE signifie qu'on
    // SUPPRIME les photos du POI — surtout ne pas en profiter pour effacer aussi
    // le travail, le lieu se retrouverait sans aucune image.
    //
    // Import dynamique : work-photos.js lit ce module (cache), l'importer en
    // statique créerait un cycle.
    if (photos && photos.length > 0) {
        try {
            const { clearWorkPhotos } = await import('./work-photos.js');
            await clearWorkPhotos(poiId);
        } catch (e) {
            // Non bloquant : les vraies photos priment déjà à l'affichage, donc
            // le travail est de toute façon devenu inaccessible.
            console.warn('[WorkPhotos] Nettoyage après import échoué:', e.message);
        }
    }
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

/**
 * Compte les circuits enregistrés SANS `mapId`. Un index IndexedDB ignore les
 * enregistrements où la clé indexée manque : ces circuits sont stockés mais
 * invisibles à `getAllCircuitsForMap`. Parcours complet du store (petit), sans
 * rien modifier — sert d'alarme au boot si un nouvel écrivain oublie l'invariant.
 * @returns {Promise<number>}
 */
export async function countCircuitsWithoutMapId() {
    return withRetry(db => new Promise((resolve, reject) => {
        let count = 0;
        const req = db.transaction('savedCircuits', 'readonly').objectStore('savedCircuits').openCursor();
        req.onsuccess = (ev) => {
            const cur = ev.target.result;
            if (!cur) { resolve(count); return; }
            if (!cur.value?.mapId) count++;
            cur.continue();
        };
        req.onerror = (e) => reject(e.target.error);
    }));
}

// === Cache OSM nearest-way (chantier point d'accès v2, PR 2/5) =================
// Persiste la réponse Overpass {coords, distance} par POI pour éviter de re-fetch.
// Pas de TTL — l'admin re-déclenche manuellement via le bouton « Pré-poser via
// OSM » si OSM a évolué. Clé composée [mapId, poiId] comme poiUserData/poiPhotos.

export async function getCachedNearestWay(mapId, poiId) {
    return withRetry(db => new Promise((resolve, reject) => {
        const tx = db.transaction('osmNearestWay', 'readonly');
        const req = tx.objectStore('osmNearestWay').get([mapId, poiId]);
        req.onsuccess = () => {
            const r = req.result;
            // Retourne { coords:[lon,lat], distance:m, fetchedAt:ms } ou null.
            resolve(r ? { coords: r.coords, distance: r.distance, fetchedAt: r.fetchedAt } : null);
        };
        req.onerror = (e) => reject(e.target.error);
    }));
}

export async function setCachedNearestWay(mapId, poiId, payload) {
    // payload = { coords:[lon,lat]|null, distance:number|null, fetchedAt?:number }
    // coords/distance peuvent être null si Overpass a trouvé « aucune voie dans le rayon ».
    const record = {
        mapId,
        poiId,
        coords: payload.coords ?? null,
        distance: payload.distance ?? null,
        fetchedAt: payload.fetchedAt ?? Date.now(),
    };
    return withRetry(db => new Promise((resolve, reject) => {
        const tx = db.transaction('osmNearestWay', 'readwrite');
        const req = tx.objectStore('osmNearestWay').put(record);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    }));
}

// === Cache des photos de travail (chantier 10/08/2026) ========================
// Les octets vivent dans un dépôt GitHub PRIVÉ, donc inaccessibles à un
// `<img src>`. Rapatriés une fois par API authentifiée, ils sont servis ensuite
// depuis ce cache — d'où la consultation possible hors-ligne sur le terrain.
// Clé = chemin dans le dépôt privé (contient déjà le mapId, donc unique).

/** Blob d'une photo de travail déjà rapatriée, ou null si jamais téléchargée. */
export async function getCachedWorkPhoto(path) {
    return withRetry(db => new Promise((resolve, reject) => {
        const tx = db.transaction('workPhotoCache', 'readonly');
        const req = tx.objectStore('workPhotoCache').get(path);
        req.onsuccess = () => resolve(req.result?.blob || null);
        req.onerror = (e) => reject(e.target.error);
    }));
}

/** Met en cache le Blob d'une photo de travail. */
export async function setCachedWorkPhoto(path, blob) {
    return withRetry(db => new Promise((resolve, reject) => {
        const tx = db.transaction('workPhotoCache', 'readwrite');
        const req = tx.objectStore('workPhotoCache').put({ path, blob, cachedAt: Date.now() });
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    }));
}

/**
 * Retire une photo de travail du cache local.
 * Les octets restent dans le dépôt privé (décision 10/08/2026 : on ne supprime
 * jamais côté GitHub — un import par erreur ne doit pas détruire le travail).
 */
export async function deleteCachedWorkPhoto(path) {
    return withRetry(db => new Promise((resolve, reject) => {
        const tx = db.transaction('workPhotoCache', 'readwrite');
        const req = tx.objectStore('workPhotoCache').delete(path);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    }));
}