import { state } from './state.js';
import { fetchWithTimeout } from './net.js';
import { getPoiId, getPoiName, isCandidate } from './utils.js';
import { RAW_BASE, GITHUB_PATHS, PERSONAL_KEYS } from './config.js';
import { getAllPendingAdminPhotos, savePoiData, deletePoiData } from './database.js';

// --- MOTEUR DE DIFFÉRENCE (DIFF ENGINE) ---
// Ce fichier concentre exclusivement la logique complexe de comparaison
// entre les données locales (modifiées par l'utilisateur) et les données du serveur (officielles).

export let diffData = {
    pois: [],
    circuits: [],
    testedChanges: { additions: [], removals: [], hasChanges: false, snapshot: {} },
    // { [poiId]: [{id, blob, skipPublish}] } — blobs locaux en attente d'upload.
    // Format enrichi (vs juste un compteur) pour que l'UI puisse afficher la
    // grille de miniatures avec cases à cocher avant publication.
    pendingPhotos: {},
    stats: { poisModified: 0, photosAdded: 0, circuitsModified: 0, testedChanged: 0, pendingPhotoCount: 0, contentLosses: 0 },
    // Snapshot du patrimoine remote (peuplé par prepareDiffData) — utilisé par
    // purgeOrphanPendingPois pour comparer les userData aux valeurs patrimoine.
    originalFeatures: [],
    // true si le fetch remote (geojson/circuits/tested) a échoué dans prepareDiffData.
    // purgeOrphanPendingPois s'appuie là-dessus pour ne PAS confondre « échec réseau »
    // et « confirmé absent du dépôt » — un originalFeatures vide par échec de fetch ne
    // doit jamais faire passer une suppression légitime pour un fantôme.
    fetchFailed: false
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
            // Réunif C1 : un candidat Scout (« à curer ») n'est PAS publiable tant
            // qu'il n'a pas été validé → jamais au brouillon. isCandidate lit l'overlay
            // (curation = userData.candidate=false) pour couvrir un candidat porté par une feature de base.
            if (isCandidate(f)) return;
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
            // Champs personnels (Gist sync privé) — ne doivent jamais apparaître dans le CC.
            const meaningfulKeys = Object.keys(data).filter(k => !PERSONAL_KEYS.includes(k));

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
// Circuits que l'app a supprimés DU SERVEUR pendant cette session (onglet
// Nettoyage : GPX + entrée d'index, écritures confirmées par l'API Contents).
//
// Pourquoi ce filtre existe (04/09/2026) : la relecture de l'index passe par
// raw.githubusercontent, qui peut encore servir la version d'AVANT l'écriture
// pendant quelques secondes. Le diff comparait alors un local à jour à un
// remote en retard et signalait une « SUPPRESSION » pour un circuit déjà
// parti ; « Tout publier » poussait ensuite des commits vides. Reproduit en
// preview : relecture à jour → 0 diff ; relecture périmée → « Tout publier 1 ».
//
// On fait donc confiance à notre propre écriture confirmée plutôt qu'à une
// lecture qui peut retarder — même raisonnement que `deletedOfficialCircuitIds`
// (circuit-deletion-state.js), avec une durée de vie plus courte : ce Set est
// vidé au rechargement de la page, quand le CDN a rattrapé depuis longtemps.
const _serverDeletedCircuitIds = new Set();

/** @param {string|number} id Circuit dont la suppression serveur est confirmée. */
export function noteServerDeletedCircuit(id) {
    _serverDeletedCircuitIds.add(String(id));
}

/** Test-only : remet le filtre à zéro entre deux cas. */
export function _resetServerDeletedCircuits() {
    _serverDeletedCircuitIds.clear();
}

export async function prepareDiffData(adminDraft) {
    let originalFeatures = [];
    let remoteCircuits = [];
    let remoteTested = {};
    const timestamp = Date.now();
    const mapId = state.currentMapId || 'djerba';

    // 1. Fetch Remote Data (POIs + Circuits + Tested)
    try {
        const [respGeo, respCirc, respTested] = await Promise.all([
            fetchWithTimeout(`${RAW_BASE}/${GITHUB_PATHS.geojson(mapId)}?t=${timestamp}`),
            fetchWithTimeout(`${RAW_BASE}/${GITHUB_PATHS.circuits(mapId)}?t=${timestamp}`),
            fetchWithTimeout(`${RAW_BASE}/${GITHUB_PATHS.tested(mapId)}?t=${timestamp}`)
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
        diffData.fetchFailed = false;
    } catch (e) {
        console.error("Erreur fetch original data", e);
        // originalFeatures reste [] : sans cette distinction, purgeOrphanPendingPois
        // traiterait ce [] comme « le dépôt est vide » et purgerait à tort toute
        // suppression en attente (cf. commentaire sur diffData.fetchFailed plus haut).
        diffData.fetchFailed = true;
    }

    // Voir _serverDeletedCircuitIds : une relecture en retard listerait encore
    // un circuit que l'app vient de supprimer du serveur.
    if (Array.isArray(remoteCircuits) && _serverDeletedCircuitIds.size > 0) {
        remoteCircuits = remoteCircuits.filter(r => !_serverDeletedCircuitIds.has(String(r.id)));
    }

    diffData.pois = [];
    diffData.circuits = [];
    diffData.testedChanges = { additions: [], removals: [], hasChanges: false, snapshot: {} };
    diffData.pendingPhotos = {};
    diffData.originalFeatures = originalFeatures;
    diffData.stats = { poisModified: 0, photosAdded: 0, circuitsModified: 0, testedChanged: 0, pendingPhotoCount: 0, contentLosses: 0 };

    // --- A. ANALYSE DES POIS (Via adminDraft + Comparaison directe) ---
    const pendingIds = Object.keys(adminDraft.pendingPois);

    pendingIds.forEach(id => {
        const current = state.loadedFeatures.find(f => getPoiId(f) === id);
        const original = originalFeatures.find(f => getPoiId(f) === id);

        // Réunif C1 : ceinture+bretelles — un candidat « à curer » ne part JAMAIS
        // dans le diff/publication, même s'il s'est retrouvé dans pendingPois.
        if (current && isCandidate(current)) return;

        // Cas spécial : Suppression
        if (adminDraft.pendingPois[id].type === 'delete') {
            // Une suppression n'a de sens que si le POI existe SUR GITHUB
            // (originalFeatures). Un POI jamais publié (candidat scout supprimé au
            // tri, custom local non gradué) n'a rien à supprimer côté dépôt →
            // entrée fantôme : on l'ignore (sinon « SUPPRESSION / Inconnu » pollue
            // le CC). purgeOrphanPendingPois retire ensuite l'entrée pour de bon.
            if (!original) return;
            diffData.pois.push({
                id: id,
                name: current ? getPoiName(current) : getPoiName(original),
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

        // Clés structurelles (comparées séparément) + clés perso (jamais affichées dans le diff).
        const skipKeys = new Set(['lat', 'lng', 'userData', ...PERSONAL_KEYS]);
        allKeys.forEach(key => {
            if (skipKeys.has(key)) return;

            let oldVal = original ? original.properties[key] : undefined;
            let newVal = userData[key] !== undefined ? userData[key] : current.properties[key];

            // --- USER FRIENDLY LABELS ---
            let displayKey = key;
            if (key === 'Temps_minutes') displayKey = 'Durée (min)';
            if (key === 'Prix_TND') displayKey = 'Prix (TND)';
            if (key === 'description') displayKey = 'Description';
            if (key === 'info_gpx') displayKey = 'Info GPX';
            if (key === 'osm_ref') displayKey = 'Objet OSM';

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

            // Point d'accès au tracé : affichage lisible (lat, lon) ou « — » si
            // absent/retiré. Détecte pose / déplacement / retrait.
            if (key === 'accessPoint') {
                const fmt = (v) => (Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]))
                    ? `${v[1].toFixed(5)}, ${v[0].toFixed(5)}` // [lon,lat] → affiché (lat, lon)
                    : '—';
                const oldF = fmt(oldVal);
                const newF = fmt(newVal);
                if (oldF !== newF) {
                    changes.push({ key: 'Point d\'accès', old: oldF, new: newF });
                }
                return;
            }

            // Curation Scout (réunif) : un candidat porté par une feature de base, validé,
            // porte userData.candidate=false sur un patrimoine candidate:true. On compte
            // bien la modification (sinon purgeOrphanPendingPois la purgerait → « rien à
            // publier ») mais on l'affiche en clair plutôt qu'en `candidate: true → false`.
            if (key === 'candidate') {
                if (oldVal && !newVal) {
                    changes.push({ key: 'Curation', old: 'Candidat à curer', new: 'Validé' });
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
            annotateLosses(changes);
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

            // PAS de comparaison de DESCRIPTION : elle ne fait pas l'aller-retour
            // via le pipeline GPX → index. Le format d'index lit le <desc>
            // des <metadata> du GPX, hardcodé par generateGPXString à la constante
            // « Circuit généré par History Walk. » → l'index distant porte TOUJOURS
            // cette chaîne. En local, circuit-actions.js appose la signature
            // « (Créé par History Walk) » à la description saisie. Les deux ne
            // peuvent donc jamais coïncider : differ la description signalait à tort
            // une « modification » PERMANENTE sur tout circuit publié (faux positif
            // observé 21/05/2026, jumeau du bug poiIds en boucle). La description
            // n'étant pas un champ publiable côté circuit, on ne la diff pas.

            // Comparaison des étapes (ordre + contenu), sur poiIds DÉDOUBLONNÉS.
            // L'index distant porte des poiIds dédoublonnés (Set), aussi bien
            // écrit par l'app que régénéré par generate-circuit-index.js
            // → un circuit en BOUCLE (étape 1 = étape
            // N, ex. retour au point de départ) a N poiIds en local mais N-1
            // dans l'index. Sans dédoublonnage, le diff signalerait à tort une
            // « modification » permanente sur tout circuit en boucle (bug
            // observé 21/05/2026). On compare donc les séquences uniques
            // (1re occurrence préservée), ce qui matche le comportement du script.
            const dedup = (ids) => [...new Set(ids || [])];
            const localIds = dedup(local.poiIds).join(',');
            const remoteIds = dedup(remote.poiIds).join(',');

            if (localIds !== remoteIds) {
                changes.push({
                    key: 'Étapes',
                    old: `${dedup(remote.poiIds).length} étapes`,
                    new: `${dedup(local.poiIds).length} étapes`
                });
            }

            // Comparaison de la trace : on ne diff que si remote a publié sa trace.
            // Le fichier circuits/<map>.json publié sur GitHub ne contient AUCUN
            // realTrack (les GPX sont des fichiers séparés, chargés lazy côté admin
            // via loadCircuitById). Sans ce garde, on aurait un faux positif
            // "0 pts → N pts" sur TOUS les circuits que l'admin a ouverts dans la
            // session : leur realTrack est rempli en local, alors que remote reste
            // undefined. Bug pré-existant découvert 15/05/2026.
            if (remote.realTrack !== undefined) {
                const localLen = local.realTrack.length; // garanti par le filtre l.279
                const remoteLen = remote.realTrack.length;
                // On tolère une petite différence (compression ou arrondi), mais si écart > 5 points c'est une modif
                if (Math.abs(localLen - remoteLen) > 5) {
                    changes.push({
                        key: 'Trace GPS',
                        old: `${remoteLen} pts`,
                        new: `${localLen} pts`
                    });
                }
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
    // Chaque entrée pendingAdminPhotos[poiId] = [{id, blob, skipPublish?}, ...].
    // On expose les entrées complètes (pas juste un compteur) pour que l'UI
    // affiche une grille de miniatures avec cases à cocher (Chantier 2).
    // - skipPublish=true : photo conservée localement mais PAS poussée sur GitHub
    //   (usage : photos personnelles, admin veut les voir dans l'app seulement).
    // - Le compteur stats.pendingPhotoCount reflète uniquement les photos qui
    //   seront effectivement publiées au prochain Publier (skipPublish=false).
    const pendingPhotosMap = await getAllPendingAdminPhotos(mapId);
    for (const poiId of Object.keys(pendingPhotosMap)) {
        const list = pendingPhotosMap[poiId] || [];
        if (list.length === 0) continue;

        const entries = list.map(p => ({
            id: p.id,
            blob: p.blob,
            skipPublish: !!p.skipPublish
        }));
        diffData.pendingPhotos[poiId] = entries;

        const publishableCount = entries.filter(e => !e.skipPublish).length;
        diffData.stats.pendingPhotoCount += publishableCount;

        const current = state.loadedFeatures.find(f => getPoiId(f) === poiId);
        const name = current ? getPoiName(current) : poiId;

        // L'UI affiche la grille à partir de `pendingPhotos` sur l'item POI,
        // donc on n'ajoute PAS de ligne texte dans `changes[]` (évite le
        // doublon "Photos — N en attente" + grille).
        const existing = diffData.pois.find(p => p.id === poiId);
        if (existing) {
            existing.pendingPhotos = entries;
            existing.hasPendingPhotos = true;
        } else {
            diffData.pois.push({
                id: poiId,
                name,
                changes: [],
                pendingPhotos: entries,
                hasPendingPhotos: true,
            });
            diffData.stats.poisModified++;
        }
    }

    return diffData;
}

/**
 * Purge les entries orphelines de `adminDraft.pendingPois` — i.e. les POIs
 * pistés comme « modifiés » mais dont le diff réel est vide (changes.length===0).
 *
 * Cause typique : richEditor sauvegarde tous les champs dans userData, même
 * ceux qui matchent le patrimoine. `reconcileLocalChanges` voit alors une
 * userData « non vide » et crée une entry pendingPois. Mais `prepareDiffData`
 * compare valeur par valeur et n'incrémente pas stats → le badge dit 1 et le
 * dashboard dit « Tout est synchronisé ». Bug observé 20/05/2026 par Stefan,
 * blocait aussi le DM via le flag localStorage `hw_has_unpublished_changes`.
 *
 * Cette fonction :
 *  - Identifie les pendingPois sans représentation dans diffData.pois
 *    (en ignorant les types `creation`/`delete`/`migration` qui ont une
 *    sémantique indépendante du diff de valeurs)
 *  - Retire l'entry de pendingPois
 *  - Nettoie `state.userData[id]` : supprime les clés non-PERSONAL dont la
 *    valeur matche le patrimoine (sinon le prochain reconcile recrée l'entry).
 *    Persiste via savePoiData / deletePoiData.
 *  - Retourne la liste des IDs purgés (vide si rien à faire).
 *
 * À appeler APRÈS `prepareDiffData` (qui peuple diffData.originalFeatures).
 */
// Seuil de « raccourcissement significatif » : en dessous, c'est une reformulation
// ou une coquille corrigée, pas une perte. 20 caractères ≈ une demi-phrase.
const LOSS_SHRINK_CHARS = 20;

/**
 * Marque les changements qui FONT PERDRE du contenu déjà publié, pour qu'ils ne
 * ressemblent plus visuellement à une correction voulue.
 *
 * Pourquoi : le diff affiche fidèlement tous les champs modifiés, mais un champ
 * revenu en arrière (état local périmé, champ vidé par mégarde) s'affiche comme
 * n'importe quelle autre modification — perte silencieuse observée le 26/07 sur
 * « Mosquée de Midoun » (description raccourcie + Source vidée, publiées sans
 * être vues). On ne peut pas DEVINER l'intention de l'admin ; on peut en
 * revanche isoler les deux cas où du contenu disparaît :
 *   - `cleared`   : un champ rempli devient vide
 *   - `shortened` : le texte perd au moins LOSS_SHRINK_CHARS caractères
 * Une correction de même longueur (« مدنين » → « ميدون ») ne déclenche RIEN,
 * un enrichissement non plus → le signal reste rare, donc lisible.
 *
 * Mute `changes` (ajoute `loss`) et incrémente diffData.stats.contentLosses.
 * @param {Array<{key:string, old:*, new:*}>} changes
 */
export function annotateLosses(changes) {
    const asText = (v) => (v === undefined || v === null || v === '—') ? '' : String(v).trim();
    changes.forEach(c => {
        // `photos` est déjà résumé en « N photo(s) » et les suppressions de
        // photos passent par la grille dédiée → hors périmètre.
        if (c.rawKey === 'photos') return;
        const oldText = asText(c.old);
        const newText = asText(c.new);
        if (!oldText) return;                     // champ vide au départ : rien à perdre
        if (!newText) c.loss = 'cleared';
        else if (oldText.length - newText.length >= LOSS_SHRINK_CHARS) c.loss = 'shortened';
        if (c.loss) diffData.stats.contentLosses++;
    });
}

/**
 * Vrai si la valeur userData ne représente PAS un changement par rapport à
 * la valeur patrimoine. Aligné EXACTEMENT sur la logique de prepareDiffData
 * (lignes 235-251) — gère `photos` séparément (longueur), et tolère le cas
 * « patrimoine absent + userData vide » (champ saisi puis effacé dans
 * richEditor, qui sauvegarde même les chaînes vides).
 */
function isNoChangeAgainstOriginal(key, userVal, originalProps) {
    const origVal = originalProps[key];
    if (key === 'photos') {
        const oldLen = (origVal || []).length;
        const newLen = (userVal || []).length;
        return oldLen === newLen;
    }
    // Cas « default empty » : patrimoine absent + user a '' / 0 / "0" / null.
    // richEditor sauvegarde les champs vides → sans ce check, ces champs
    // restent considérés comme diff par mon purge alors que prepareDiffData
    // les filtre (cf. isDefaultEmpty ligne 250).
    const isDefaultEmpty = origVal === undefined &&
        (userVal === '' || userVal === 0 || userVal === '0' || userVal === null);
    if (isDefaultEmpty) return true;
    return String(origVal) === String(userVal);
}

export async function purgeOrphanPendingPois(adminDraft) {
    const purged = [];
    // Échec réseau lors du dernier prepareDiffData : originalFeatures est [] par
    // défaut, pas par confirmation. On ne purge rien tant qu'on n'a pas pu vérifier
    // pour de vrai — sinon toute suppression en attente serait prise pour un fantôme.
    if (diffData.fetchFailed) return purged;
    const originalFeatures = diffData.originalFeatures || [];
    const diffIds = new Set(diffData.pois.map(p => p.id));

    for (const id of Object.keys(adminDraft.pendingPois)) {
        const entry = adminDraft.pendingPois[id];
        // Ne pas toucher aux types qui ont leur propre sémantique sans diff de valeurs.
        if (entry.type === 'creation' || entry.type === 'migration') continue;
        // Suppression : une entrée sans original GitHub est un FANTÔME (POI jamais
        // publié — candidat supprimé au tri, custom local) → rien à supprimer côté
        // dépôt, on la purge. Une suppression d'un POI réellement publié reste
        // légitime → on la garde (prepareDiffData l'a déjà surfacée).
        if (entry.type === 'delete') {
            if (!originalFeatures.find(f => getPoiId(f) === id)) {
                delete adminDraft.pendingPois[id];
                purged.push(id);
            }
            continue;
        }
        // L'entry produit-elle un diff réel selon prepareDiffData ? Si oui, garder.
        if (diffIds.has(id)) continue;

        // Orphan définitif : prepareDiffData a vu 0 diff. On purge TOUJOURS
        // pendingPois (sinon le bug rebondit) + on essaie de nettoyer userData
        // pour empêcher reconcileLocalChanges de recréer l'orphelin au boot suivant.
        const original = originalFeatures.find(f => getPoiId(f) === id);
        const userData = state.userData && state.userData[id];

        if (userData && original) {
            const cleaned = { ...userData };
            for (const key of Object.keys(cleaned)) {
                if (PERSONAL_KEYS.includes(key)) continue;
                // Aligné sur prepareDiffData : si la valeur userData ne
                // représente pas un vrai changement, on retire la clé.
                if (isNoChangeAgainstOriginal(key, cleaned[key], original.properties)) {
                    delete cleaned[key];
                }
            }
            // Persister la userData nettoyée
            const remainingKeys = Object.keys(cleaned);
            if (remainingKeys.length === 0) {
                await deletePoiData(state.currentMapId, id);
                delete state.userData[id];
            } else {
                state.userData[id] = cleaned;
                await savePoiData(state.currentMapId, id, cleaned);
            }
        }

        // TOUJOURS retirer de pendingPois — prepareDiffData a dit « 0 diff »,
        // l'entry n'a aucune raison de subsister. Si on échoue à nettoyer
        // userData (edge case), reconcileLocalChanges recréera l'entry à la
        // prochaine ouverture CC, mais cette purge la retirera à nouveau —
        // pas de blocage permanent comme avec l'ancien continue/suspect.
        delete adminDraft.pendingPois[id];
        purged.push(id);
    }

    return purged;
}

/**
 * Symétrique de purgeOrphanPendingPois, pour les CIRCUITS.
 * Un `pendingCircuits[id]` qui ne produit AUCUN diff réel (absent de
 * diffData.circuits après prepareDiffData) est un orphelin : typiquement un
 * circuit déjà publié mais resté flaggé dans le brouillon (la publication hors
 * « Tout publier » ne réinitialise pas le draft). reconcileLocalChanges ne
 * retire un pendingCircuit que s'il n'existe plus / sans tracé — JAMAIS sur la
 * seule absence de diff. Résultat sans cette purge : le badge du CC reste > 0
 * alors que le tableau de bord affiche « synchronisé » (bug observé 03/06/2026 :
 * badge=1 / CC vide après publication d'un circuit). Les créations et
 * modifications réelles sont, elles, présentes dans diffData.circuits → gardées.
 * Pas de userData à nettoyer : l'état d'un circuit vit dans state.myCircuits.
 * @param {{pendingCircuits?: Object}} adminDraft
 * @returns {string[]} ids des circuits purgés
 */
export function purgeOrphanPendingCircuits(adminDraft) {
    const purged = [];
    if (!adminDraft || !adminDraft.pendingCircuits) return purged;
    const diffIds = new Set((diffData.circuits || []).map(c => String(c.id)));
    for (const id of Object.keys(adminDraft.pendingCircuits)) {
        if (diffIds.has(String(id))) continue; // vrai diff → on garde
        delete adminDraft.pendingCircuits[id];
        purged.push(id);
    }
    return purged;
}
