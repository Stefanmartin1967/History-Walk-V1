import { state } from './state.js';
import { getPoiId, getPoiName } from './utils.js';
import { RAW_BASE, GITHUB_PATHS } from './config.js';
import { getAllPendingAdminPhotos } from './database.js';

// --- MOTEUR DE DIFFÉRENCE (DIFF ENGINE) ---
// Ce fichier concentre exclusivement la logique complexe de comparaison
// entre les données locales (modifiées par l'utilisateur) et les données du serveur (officielles).

export let diffData = {
    pois: [],
    circuits: [],
    testedChanges: { additions: [], removals: [], hasChanges: false, snapshot: {} },
    pendingPhotos: {}, // { [poiId]: count } — blobs locaux en attente d'upload
    stats: { poisModified: 0, photosAdded: 0, circuitsModified: 0, testedChanged: 0, pendingPhotoCount: 0 }
};

/**
 * Réconcilie les changements locaux (créations, modifications, suppressions)
 * avec le brouillon actuel de publication (`adminDraft`).
 */
export function reconcileLocalChanges(adminDraft, saveDraftCallback, updateBadgeCallback) {
    let changed = false;

    // 1. Réconciliation des CRÉATIONS (Lieux ajoutés manuellement)
    if (state.customFeatures && state.customFeatures.length > 0) {
        state.customFeatures.forEach(f => {
            const id = getPoiId(f);
            if (!adminDraft.pendingPois[id]) {
                adminDraft.pendingPois[id] = { type: 'creation', timestamp: Date.now() };
                changed = true;
            }
        });
    }

    // 2. Réconciliation des MODIFICATIONS (via userData)
    if (state.userData) {
        Object.keys(state.userData).forEach(id => {
            const data = state.userData[id];

            // Si déjà pisté, on passe
            if (adminDraft.pendingPois[id]) return;

            // On filtre pour ne pas pister les simples visites/favoris
            // On cherche des modifications structurelles (lat, lng, _deleted, ou propriétés de contenu)
            const ignoredKeys = ['visited', 'hidden', 'notes', 'planifie', 'planifieCounter'];
            const meaningfulKeys = Object.keys(data).filter(k => !ignoredKeys.includes(k));

            if (meaningfulKeys.length > 0) {
                 // Est-ce une création déjà gérée ?
                 const isCreation = state.customFeatures && state.customFeatures.some(f => getPoiId(f) === id);

                 if (!isCreation) {
                      const type = data._deleted ? 'delete' : 'update';
                      adminDraft.pendingPois[id] = { type: type, timestamp: Date.now() };
                      changed = true;
                 }
            }
        });
    }

    // 3. Réconciliation des CIRCUITS (Suppression des fantômes)
    const pendingCircuits = Object.keys(adminDraft.pendingCircuits);
    if (pendingCircuits.length > 0) {
        pendingCircuits.forEach(id => {
            const exists = state.myCircuits.find(c => String(c.id) === String(id));

            // Si le circuit n'existe plus localement, ou est supprimé, ou n'a pas de trace réelle
            // => On le retire du brouillon de publication
            if (!exists || exists.isDeleted || (!exists.realTrack || exists.realTrack.length === 0)) {
                delete adminDraft.pendingCircuits[id];
                changed = true;
            }
        });
    }

    if (changed) {
        if (saveDraftCallback) saveDraftCallback(adminDraft);
        if (updateBadgeCallback) updateBadgeCallback();
    }

    return changed;
}

/**
 * Prépare et calcule toutes les différences entre l'état local (`state` + `adminDraft`)
 * et les fichiers sources hébergés sur GitHub (`.geojson` et `circuits.json`).
 * Le résultat met à jour la variable globale `diffData` exportée par ce module.
 */
export async function prepareDiffData(adminDraft) {
    let originalFeatures = [];
    let remoteCircuits = [];
    let remoteTested = {};
    const timestamp = Date.now();
    const mapId = state.currentMapId || 'djerba';

    // 1. Fetch Remote Data (POIs + Circuits + Tested)
    try {
        const [respGeo, respCirc, respTested] = await Promise.all([
            fetch(`${RAW_BASE}/${GITHUB_PATHS.geojson(mapId)}?t=${timestamp}`),
            fetch(`${RAW_BASE}/${GITHUB_PATHS.circuits(mapId)}?t=${timestamp}`),
            fetch(`${RAW_BASE}/${GITHUB_PATHS.tested(mapId)}?t=${timestamp}`)
        ]);

        if (respGeo.ok) {
            const json = await respGeo.json();
            originalFeatures = json.features;
        }
        if (respCirc.ok) {
            remoteCircuits = await respCirc.json();
        }
        // tested.json : 404 attendu avant 1re publication → fallback objet vide
        if (respTested.ok) {
            remoteTested = await respTested.json() || {};
        }
    } catch (e) {
        console.error("Erreur fetch original data", e);
    }

    diffData.pois = [];
    diffData.circuits = [];
    diffData.testedChanges = { additions: [], removals: [], hasChanges: false, snapshot: {} };
    diffData.pendingPhotos = {};
    diffData.stats = { poisModified: 0, photosAdded: 0, circuitsModified: 0, testedChanged: 0, pendingPhotoCount: 0 };

    // --- A. ANALYSE DES POIS (Via adminDraft + Comparaison directe) ---
    const pendingIds = Object.keys(adminDraft.pendingPois);

    pendingIds.forEach(id => {
        const current = state.loadedFeatures.find(f => getPoiId(f) === id);
        const original = originalFeatures.find(f => getPoiId(f) === id);

        // Cas spécial : Suppression
        if (adminDraft.pendingPois[id].type === 'delete') {
            diffData.pois.push({
                id: id,
                name: current ? getPoiName(current) : (original ? getPoiName(original) : 'Inconnu'),
                changes: [{ key: 'STATUT', old: 'Actif', new: 'SUPPRESSION' }],
                isDeletion: true
            });
            diffData.stats.poisModified++;
            return;
        }

        // Cas spécial : Création (Nouveau POI)
        if (!original && current && adminDraft.pendingPois[id].type === 'creation') {
             diffData.pois.push({
                id: id,
                name: getPoiName(current),
                changes: [{ key: 'STATUT', old: 'Inexistant', new: 'NOUVEAU' }],
                isCreation: true
            });
            diffData.stats.poisModified++;
            return;
        }

        // Cas spécial : Migration d'ID
        if (adminDraft.pendingPois[id].type === 'migration') {
            const oldId = adminDraft.pendingPois[id].oldId;
            diffData.pois.push({
                id: id,
                name: current ? getPoiName(current) : 'Lieu migré',
                changes: [{ key: 'IDENTIFIANT', old: oldId || 'Legacy', new: id }],
                isMigration: true
            });
            diffData.stats.poisModified++;
            return;
        }

        if (!current) return;

        const userData = current.properties.userData || {};
        const changes = [];

        // Geometry Check — compare TOUJOURS local vs remote.
        // (Auparavant, la présence de userData.lat/lng suffisait à signaler un
        //  changement, même si remote avait déjà été publié aux mêmes valeurs.)
        const userLat = userData.lat;
        const userLng = userData.lng;

        if (userLat !== undefined && userLng !== undefined && original) {
            // Surcharge explicite : comparer à original.geometry
            const [oLng, oLat] = original.geometry.coordinates;
            const localLatStr = parseFloat(userLat).toFixed(5);
            const localLngStr = parseFloat(userLng).toFixed(5);
            const remoteLatStr = oLat.toFixed(5);
            const remoteLngStr = oLng.toFixed(5);
            if (localLatStr !== remoteLatStr || localLngStr !== remoteLngStr) {
                changes.push({
                    key: 'Position',
                    old: `${remoteLatStr}, ${remoteLngStr}`,
                    new: `${localLatStr}, ${localLngStr}`
                });
            }
        } else if (userLat !== undefined && userLng !== undefined && !original) {
            // Cas rare : surcharge mais pas d'original (POI créé local ?)
            changes.push({
                key: 'Position',
                old: 'Inconnu',
                new: `${parseFloat(userLat).toFixed(5)}, ${parseFloat(userLng).toFixed(5)}`
            });
        } else if (original) {
            // Fallback : diff direct sur feature.geometry
            const [oLng, oLat] = original.geometry.coordinates;
            const [cLng, cLat] = current.geometry.coordinates;
            if (oLng.toFixed(5) !== cLng.toFixed(5) || oLat.toFixed(5) !== cLat.toFixed(5)) {
                changes.push({
                    key: 'Position',
                    old: `${oLat.toFixed(5)}, ${oLng.toFixed(5)}`,
                    new: `${cLat.toFixed(5)}, ${cLng.toFixed(5)}`
                });
            }
        }

        // Property Checks (Check ALL relevant keys)
        const allKeys = new Set([...Object.keys(current.properties), ...Object.keys(userData)]);

        allKeys.forEach(key => {
            if (['lat', 'lng', 'userData', 'visited', 'hidden', 'planifieCounter'].includes(key)) return;

            let oldVal = original ? original.properties[key] : undefined;
            let newVal = userData[key] !== undefined ? userData[key] : current.properties[key];

            // --- USER FRIENDLY LABELS ---
            let displayKey = key;
            if (key === 'timeH') displayKey = 'Heures (Durée)';
            if (key === 'timeM') displayKey = 'Minutes (Durée)';
            if (key === 'price') displayKey = 'Prix (TND)';
            if (key === 'description') displayKey = 'Description';

            if (key === 'photos') {
                const oldLen = (oldVal || []).length;
                const newLen = (newVal || []).length;
                if (oldLen !== newLen) {
                    changes.push({
                        key: 'Photos',
                        old: `${oldLen} photo(s)`,
                        new: `${newLen} photo(s)`,
                    });
                    if (newLen > oldLen) diffData.stats.photosAdded += (newLen - oldLen);
                }
                return;
            }

            // Simple equality check — ignore undefined→0/null/"" (champs vides par défaut)
            const isDefaultEmpty = oldVal === undefined && (newVal === "" || newVal === 0 || newVal === "0" || newVal === null);
            if (String(oldVal) !== String(newVal) && !isDefaultEmpty) {
                changes.push({
                    key: displayKey, // Use friendly name
                    rawKey: key,     // Keep raw key for editing logic
                    old: oldVal !== undefined ? oldVal : '—',
                    new: newVal
                });
            }
        });

        if (changes.length > 0) {
            diffData.pois.push({
                id: id,
                name: getPoiName(current),
                changes: changes
            });
            diffData.stats.poisModified++;
        }
    });

    // --- B. ANALYSE DES CIRCUITS (Comparaison State vs Remote) ---
    // On combine les Officiels et les Personnels (candidats)
    const localCircuits = [...(state.officialCircuits || []), ...(state.myCircuits || [])];

    // 1. Nouveaux & Modifiés
    localCircuits.forEach(local => {
        // --- FILTRE STRICT : PAS DE PUBLICATION SANS TRACE RÉELLE NI POUR LES SUPPRIMÉS ---
        if (local.isDeleted) return; // Ignorer la corbeille locale
        if (!local.realTrack || local.realTrack.length === 0) return; // Ignorer les brouillons orthodromiques

        // On normalise l'ID (parfois string vs number)
        const remote = remoteCircuits.find(r => String(r.id) === String(local.id));

        if (!remote) {
            // Cas : Nouveau Circuit (Validé avec trace réelle)
            diffData.circuits.push({
                id: local.id,
                name: local.name,
                changes: [{ key: 'STATUT', old: 'Inexistant', new: 'NOUVEAU' }],
                isCreation: true
            });
        } else {
            // Cas : Modification potentielle
            const changes = [];

            // Comparaison simple des champs clés
            if (local.name !== remote.name) changes.push({ key: 'Nom', old: remote.name, new: local.name });
            if ((local.description || '') !== (remote.description || '')) {
                // On ignore les diffs vides vs null/undefined
                if(local.description || remote.description) {
                     changes.push({ key: 'Description', old: '...', new: '...' }); // Simplifié pour l'affichage
                }
            }

            // Comparaison des étapes (Ordre et Contenu)
            const localIds = (local.poiIds || []).join(',');
            const remoteIds = (remote.poiIds || []).join(',');

            if (localIds !== remoteIds) {
                changes.push({
                    key: 'Étapes',
                    old: `${(remote.poiIds || []).length} étapes`,
                    new: `${(local.poiIds || []).length} étapes`
                });
            }

            // Comparaison de la trace (Longueur approximative pour détecter un changement)
            const localLen = local.realTrack ? local.realTrack.length : 0;
            const remoteLen = remote.realTrack ? remote.realTrack.length : 0;
            // On tolère une petite différence (compression ou arrondi), mais si écart > 5 points c'est une modif
            if (Math.abs(localLen - remoteLen) > 5) {
                changes.push({
                    key: 'Trace GPS',
                    old: `${remoteLen} pts`,
                    new: `${localLen} pts`
                });
            }

            if (changes.length > 0) {
                diffData.circuits.push({
                    id: local.id,
                    name: local.name,
                    changes: changes
                });
            }
        }
    });

    // 2. Supprimés
    remoteCircuits.forEach(remote => {
        // On considère un circuit supprimé s'il est absent localement OU marqué deleted
        const localMatch = localCircuits.find(l => String(l.id) === String(remote.id));

        if (!localMatch || localMatch.isDeleted) {
            diffData.circuits.push({
                id: remote.id,
                name: remote.name,
                changes: [{ key: 'STATUT', old: 'Actif', new: 'SUPPRESSION' }],
                isDeletion: true
            });
        }
    });

    diffData.stats.circuitsModified = diffData.circuits.length;

    // --- C. ANALYSE DES CIRCUITS VÉRIFIÉS (testedCircuits local vs tested.json remote) ---
    // Règle : admin qui coche "fait" sur un circuit officiel → testedCircuits[id] = true.
    // Au push CC, on publie l'ensemble courant → les users voient le bouclier vert.
    const localTested = state.testedCircuits || {};
    const localIds = new Set(Object.keys(localTested).filter(k => localTested[k] === true));
    const remoteIds = new Set(Object.keys(remoteTested).filter(k => remoteTested[k] === true));

    // Résolveur de nom pour affichage CC
    const allCircuits = [...(state.officialCircuits || []), ...(state.myCircuits || [])];
    const resolveName = (cid) => {
        const c = allCircuits.find(x => String(x.id) === String(cid));
        return c ? c.name : cid;
    };

    localIds.forEach(id => {
        if (!remoteIds.has(id)) {
            diffData.testedChanges.additions.push({ id, name: resolveName(id) });
        }
    });
    remoteIds.forEach(id => {
        if (!localIds.has(id)) {
            diffData.testedChanges.removals.push({ id, name: resolveName(id) });
        }
    });

    diffData.testedChanges.hasChanges =
        diffData.testedChanges.additions.length > 0 ||
        diffData.testedChanges.removals.length > 0;

    // Snapshot du payload exact à publier (utilisé par publishChanges)
    diffData.testedChanges.snapshot = { ...localTested };

    diffData.stats.testedChanged =
        diffData.testedChanges.additions.length + diffData.testedChanges.removals.length;

    // --- D. PHOTOS EN ATTENTE (blobs locaux admin, pas encore uploadés) ---
    // Chaque entrée pendingAdminPhotos[poiId] = [{id, blob}, ...]. On compte
    // et on injecte le POI dans diffData.pois (s'il n'y est pas déjà) pour
    // qu'il apparaisse dans l'onglet Modifications avec Éditer/Ignorer.
    const pendingPhotosMap = await getAllPendingAdminPhotos(mapId);
    for (const poiId of Object.keys(pendingPhotosMap)) {
        const list = pendingPhotosMap[poiId] || [];
        if (list.length === 0) continue;

        diffData.pendingPhotos[poiId] = list.length;
        diffData.stats.pendingPhotoCount += list.length;

        const current = state.loadedFeatures.find(f => getPoiId(f) === poiId);
        const name = current ? getPoiName(current) : poiId;
        const photoChange = {
            key: 'Photos',
            old: '—',
            new: `${list.length} en attente`,
        };

        const existing = diffData.pois.find(p => p.id === poiId);
        if (existing) {
            existing.changes.push(photoChange);
            existing.hasPendingPhotos = true;
        } else {
            diffData.pois.push({
                id: poiId,
                name,
                changes: [photoChange],
                hasPendingPhotos: true,
            });
            diffData.stats.poisModified++;
        }
    }

    return diffData;
}
