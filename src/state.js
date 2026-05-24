// state.js
import { getCategoryLabels } from './taxonomy.js';

export const APP_VERSION = '3.7.91'; // Viewer photo — fin du vide sous le viewer : le .hw-modal-body de base plafonnait à max-height:70vh (60vh mobile), ce qui bridait le viewer à ~70 % de hauteur (la bande de vignettes flottait au-dessus d'un grand vide noir). Fix : max-height:none en mode photo-viewer → la zone photo + la bande remplissent l'écran, et le plein écran prend la VRAIE pleine hauteur. Complète la bande séparée (3.7.90). // Viewer photo — refonte immersive du chrome (handoff Claude Design) : fond NOIR opaque (plus de transparence latérale), header hw-modal MASQUÉ → image bord à bord, compteur « Photo X/Y » RETIRÉ (la pellicule suffit). Chrome flottant unifié = pastilles rondes « glass » (.hw-pv-btn, halo noir pour lisibilité sur photo claire) : fermer + plein écran en haut-droite, flèches nav (.is-lg), zoom = 3 pastilles empilées (zoom-in/out + RESET icône rotate-ccw, fini le boîtier et le « 100 % »). Vrai PLEIN ÉCRAN (API Fullscreen) masquant barre des tâches + chrome navigateur ; en plein écran, chrome minimal (tout masqué sauf les flèches, sortie via Échap). Pellicule = BANDE SÉPARÉE sous la photo (zones empilées façon Wikiloc, PAS un overlay → la photo ne passe jamais derrière les vignettes, robuste portrait ; viewer en flex-column) ; centrée si peu, pleine largeur + scroll si beaucoup (.is-overflow — anticipe la galerie de circuit) ; masquée en plein écran → la photo prend toute la hauteur. Icônes maximize/zoom-in/zoom-out ajoutées à lucide-icons. Image gardée en position:absolute+inset:0 (robuste vs le grid+max du handoff qui rognait les portraits). Tokens HW only. // Viewer photo de consultation (handoff Claude Design) : un viewer unique plein écran immersif remplace le lightbox pauvre. Zoom/pan natif (molette, double-clic, paliers +/−/fit, pinch, double-tap, reset au changement de photo), pellicule de vignettes (active = --brand, PAS l'ambre proposé par CD), nav flèches/clavier/swipe mobile, état .is-single (1 photo) + loading. Clic sur le hero d'une fiche AVEC photo → ouvre le viewer (consultation) au lieu de la grille d'édition ; hero VIDE → grille (ajout) inchangé. collectPoiPhotoUrls (ui-details) agrège URLs publiées + blobs locaux (objectURL révoqués à la fermeture), publiées en tête. Double-listener hero supprimé (hydrateHeroFromBlobs). Image en position:absolute + inset:0 + object-fit:contain (boîte = stage exacte → letterbox tous ratios ; corrige le portrait qui débordait car height:100% en flux se résolvait contre 100vh, pas contre la stage). ui-photo-viewer.js réécrit (classes .hw-pv-*), modals.css enrichi (anciennes règles .hw-photo-viewer-* retirées), tokens HW only. Édition photos = grille « Gérer les photos », inchangée. // Fix watermark admin sur l'import GPS : le chemin batch « Enregistrer » (compressFileToBlob, ui-photo-batch.js) ne tatouait PAS les photos, alors que la grille « Ajouter » (compressImage) le faisait → photos admin publiées SANS watermark sur le chemin de production PRINCIPAL. Fix : applyWatermark exporté depuis photo-service.js (source unique du dessin + texte) et appliqué dans compressFileToBlob si state.isAdmin. Taille/qualité du pipeline GPS inchangées (1600px/0.88). Pas de re-watermark rétroactif (photos de test à ré-uploader). +2 tests applyWatermark. // Refonte Mon Espace V3 (handoff Claude Design) : 2 onglets (Sauvegarde + Corbeille) au lieu de 4 ; accent ambre→thème (--cta-bg, comme CC Admin). Onglet Sauvegarde allégé : Sauvegarder (choix explicite Légère/Complète + bouton ADAPTATIF « Télécharger » desktop / « Enregistrer·Partager » mobile, qui RESET le compteur backup-auto via resetBackupCounter), Restaurer (compact), statut backup auto en footnote 1 ligne. RETIRÉS : « Partager » (fusionné dans Sauvegarder), « Forcer un backup », « Sync à venir », onglet Sécurité, onglet Préférences/lieu de résidence (relocalisation au tri « Proximité » à venir — trou assumé, Stefan seul testeur, usage nov.). Onglet Corbeille gagne « Supprimer définitivement » (deleteCircuitById + modale de confirmation). CSS V3.1 intégré (tokens HW only, 1 seul #fff → var(--cta-fg)). Poids photos estimé sur la carte Complète. // Fix sauvegarde/restauration des photos perso : les photos (Blobs du store poiPhotos) n'étaient JAMAIS incluses dans l'export — export ET import ne lisaient que state.userData, vidé de ses photos depuis la migration base64→Blob. Conséquences : la case « Inclure les photos » était inopérante (sauvegardes identiques avec/sans) et un user perdait ses photos à la restauration. Fix : l'export FULL encode les Blobs en base64 dans le bloc userData racine (collectPhotosAsBase64 + nouveau blobToBase64), SANS duplication dans le geojson ; restoreBackup redécode base64→Blob vers poiPhotos (base64ToBlob désormais exporté) et ne conserve que les URLs légères dans poiUserData. Runtime inchangé (Blob, compact) ; seul le fichier d'échange porte du base64 (+33%, attendu). Corrige les 2 chemins d'export (Mon Espace prepareExportData + menu/partage saveUserData). +5 tests export/import + 3 tests round-trip Blob↔base64. // Fix BLOQUANT révélé au test de restauration : isValidBackup rejetait testedCircuits quand c'était un objet (n'acceptait qu'un tableau), or l'export ET le runtime produisent un objet { circuitId: bool } → AUCUNE restauration ne passait depuis l'ajout de testedCircuits à l'export (~#506). Désormais objet OU tableau accepté (rejet si null/primitive). // Recherche POI : le focus va désormais sur l'onglet « Lieu » (fiche du POI cherché) au lieu de « Mes Circuits ». Le filtrage des circuits par ce POI est conservé (chip « Filtré par »). openDetailsPanel gagne un 3e param fromSearch (défaut false) qui pilote poiFilterFromSearch. // Harmonisation champs contact + Facebook. L'éditeur HW « Éditer le lieu » (richEditor) gagne Téléphone + Horaires (parité avec le DM, ils manquaient côté HW). Nouveau champ public Facebook ajouté PARTOUT : éditeur HW (richEditor) + DM (index.html/main.js/storage.js) + affichage fiche (templates.js, ligne « Détails pratiques », icône f). Lien FB sécurisé : href http(s) only (bloque javascript:/data:) + target=_blank rel=noopener. // Couverture de tests (#3, PR2) : loaders de config au boot (app-startup) — loadDestinationsConfig / loadOfficialCircuits / loadPoiCategoriesConfig testés sur valide + échec/fallback (404, réseau, JSON malformé, vide) → garde contre une dégradation SILENCIEUSE du boot. 10 tests, aucun changement de comportement (loaders déjà exportés). // Couverture de tests (#3, PR1) : findFeaturesOnTrack (gpx.js) exporté + testé (tests/gpx_find_features.test.js — 8 cas : détection, seuil, threshold custom, ordre de passage, boucle/duplication, trace ouverte, vides). Aucun changement de comportement. // Fix multi-destinations : le chemin d'upload d'un circuit (admin-control-ui) ne hardcode plus "djerba" — utilise state.currentMapId via GITHUB_PATHS.circuitFile(mapId, filename) (helper config.js ressuscité + corrigé, était du code mort). Évite qu'un circuit Hammamet/Agadir parte dans circuits/djerba/. // Fix flake test backup_auto_local (non déterministe : passait isolé, échouait ~40% en suite complète). Cause racine : recordModification déclenche checkAndTriggerAutoBackup en arrière-plan non-awaité → ce trigger se terminait pendant le test suivant (appel saveUserData parasite), et le mutex _backupInProgress pouvait rester bloqué. Fix : hook test _flushAutoBackupForTests (drainage déterministe, remplace les setTimeout fragiles) + afterEach qui draine + _resetCacheForTests réinitialise mutex & pending. Zéro impact prod. Vérifié 20/20 runs verts. // Fix circuit perso consulté : rendu épuré. Un perso enregistré simplement consulté rendait 4 éléments (poignée+numéro+nom+actions) dans la grille de consultation à 2 colonnes (data-mode="consult") → repli en 2×2, nom en mot-par-mot + boutons mal placés. isCreate (createStepElement) ne vaut désormais vrai que pour un brouillon ou state.editingMode (= complément exact de isConsult dans applyCircuitMode) → un perso consulté rend 2 éléments comme un officiel ; édition via "Modifier le circuit". Perso-only ; mobile non concerné. // Destinations brouillon/publié : champ `status` sur destinations.json — Hammamet (draft) masqué du sélecteur + boot bloqué pour les non-admins (repli sur la dest publiée par défaut, anti-contournement ?map=hammamet). Admin voit les brouillons via un badge "Brouillon". Helper pur isDestinationPublished (défaut : status absent = brouillon). // Point d'accès — PR C (peaufinage UX) : (1) retrait du toast ratable à l'entrée du mode pose (la barre persistante porte déjà la consigne ; le conseil « passe en OSM » était caduc — Voyager montre les routes, OSM grise au zoom). (2) Fix du grisé OSM/Voyager à fort zoom : Google Satellite monte à z20 mais OSM & Voyager plafonnaient à z19 → ces couches se grisaient dans le contrôle de calques dès z20 (impossible d'y revenir au zoom de pose). Correctif : maxNativeZoom=19 (tuiles agrandies au-delà) + maxZoom=20 sur planLayer et voyagerLayer (map.js) → couches sélectionnables sur toute la plage. Bénéfique à toute l'appli, pas que cette feature. // Feature « point d'accès au tracé » — PR B (pose) : item kebab admin+desktop « Point d'accès au tracé » sur la fiche POI → mode pose carte (access-point-editor.js) : drapeau draggable (clic = place/déplace, glisser = ajuste) + ligne pointillée POI→drapeau, barre Enregistrer/Effacer/Annuler. Save via updatePoiData('accessPoint',[lon,lat]) → publié auto (geojson). Erase = null (prime sur le patrimoine) + strip au publish (admin-geojson) pour ne pas laisser de résidu. Chip admin « Point d'accès » sur la fiche + libellé propre dans le diff CC. Helper getAccessPoint extrait dans utils.js (réutilisé par gpx.js). Ne déplace JAMAIS le POI. // Feature « point d'accès au tracé » — PR A (plomberie, sans effet visible) : generateGPXString (gpx.js) lit désormais, en Cas B (vol d'oiseau), un champ public OPTIONNEL accessPoint:[lon,lat] sur le POI et l'utilise comme ancre <trkpt> s'il est valide, sinon les coords réelles du POI (helper trackAnchorOf). Sert aux POI « hors voie » (bâtiment isolé) : l'admin posera (PR B) un drapeau sur la voie la plus proche → GPX Studio peut router jusque-là sans ignorer le POI. Le <wpt> (marqueur) reste TOUJOURS sur le vrai POI ; Cas A (realTrack) intouché ; aucun circuit existant affecté (champ absent → comportement identique). // Fix export GPX « vol d'oiseau » : on retire le pré-snap routier OSRM (profil VOITURE) qui déplaçait les <trkpt> sur la route carrossable la plus proche. Conséquence du bug : pour un POI en retrait/sur un sentier, l'ancre du tracé atterrissait à côté du POI, et GPX Studio (qui s'ancre sur les <trkpt>) routait en IGNORANT le POI (POI laissé sur le côté). Désormais en Cas B (pas de realTrack), les <trkpt> = coordonnées RÉELLES des POIs → GPX Studio s'ancre pile dessus et fait lui-même le routage piéton. Helpers snapToNearestRoad/snapCircuitToRoads supprimés (+ param snappedCoords de generateGPXString). N'affecte que l'export à éditer ; les circuits publiés (realTrack, Cas A) sont intouchés. // Fix RACINE des faux positifs circuit (remplace les rustines #624/#625 par la vraie cause) : l'index publié ré-ordonnait les poiIds par position sur le tracé GPS (generate-circuit-index.js, findPOIsOnTrack), alors qu'en local l'ordre est celui de SÉLECTION. Pour une BOUCLE, le POI de départ (présent au début ET à la fin du tracé) était trié en DERNIER → l'index ne matchait plus l'ordre local (faux positif « modifié » permanent dans le CC) ET la boucle s'affichait au mauvais départ côté user. Or ce tri-par-tracé était un VESTIGE de l'ancienne découverte par proximité ; depuis qu'on ne garde QUE les waypoints (« Disable proximity-based POI discovery »), ceux-ci ont déjà leur ordre. Fix : findPOIsOnTrack préserve l'ordre des waypoints (= sélection). Index djerba régénéré (seul le circuit en boucle change). Aucune modif du diff engine (le dédoublonnage #624 suffit). Corrige les 2 symptômes à la source. // Fix (jumeau du #624) : circuits détectés à tort comme « modifiés » sur une simple différence de DESCRIPTION. Cause : la description ne fait pas l'aller-retour via le pipeline GPX → index. generate-circuit-index.js lit le <desc> des metadata GPX, hardcodé par generateGPXString à « Circuit généré par History Walk. » → l'index distant porte TOUJOURS cette constante, tandis qu'en local circuit-actions.js appose la signature « (Créé par History Walk) ». Les deux ne coïncident jamais → faux positif permanent. Fix : on retire la comparaison de description du diff circuit (admin-diff-engine.js). La description n'est pas un champ publiable côté circuit.
export const MAX_CIRCUIT_POINTS = 15;

// POI_CATEGORIES : liste plate des libellés de catégories, dérivée du référentiel
// taxonomy.js (source : public/poi-categories.json, chargé async au boot). Le
// fallback initial vient du FALLBACK intégré à taxonomy.js. Binding ESM live :
// la réassignation via setPoiCategories est visible côté importeurs sans reload.
export let POI_CATEGORIES = getCategoryLabels();

export function setPoiCategories(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return;
    POI_CATEGORIES = [...arr].sort();
}

// --- 1. LE FRIGO (L'État Global) ---
export const state = {
    isMobile: false,
    currentMapId: null,
    // Structure par défaut robuste pour éviter les crashs si le JSON manque
    destinations: {
        activeMapId: 'djerba',
        maps: {}
    },
    userData: {},
    myCircuits: [],
    officialCircuits: [],
    officialCircuitsStatus: {}, // Statut (Completed) des circuits officiels
    testedCircuits: {},         // Circuits testés sur le terrain par l'admin (badge 🛡️)
    geojsonLayer: null,
    loadedFeatures: [],
    currentFeatureId: null,
    currentCircuitIndex: null,
    // Refactor PR2 (15/05/2026) : renommé depuis `isSelectionModeActive`.
    // Sémantique stricte : true uniquement quand l'user est en train de créer
    // un circuit (sélection de POIs depuis la carte). Auparavant utilisé aussi
    // comme drapeau « panneau Circuit ouvert » en consultation — usages
    // détournés retirés en PR2 au profit de switchSidebarTab + renderCircuitPanel
    // appelés directement.
    isCircuitCreationMode: false,
    currentCircuit: [],
    customFeatures: [],
    hiddenPoiIds: [],
    customDraftName: null, // Titre personnalisé pour le brouillon
    activeCircuitId: null,
    // Édition d'un circuit chargé : true quand admin clique "Modifier" sur un
    // officiel/vérifié et qu'on garde l'ID pour mettre à jour (pas de duplication).
    // applyCircuitMode lit ce flag pour forcer data-mode='create' même si
    // activeCircuitId est set.
    editingMode: false,
    // Filtre POI sur la liste des circuits (Mes Circuits) : true uniquement
    // quand la searchbar a sélectionné un POI. Un clic carte sur un POI ne
    // doit PAS activer ce filtre (juste ouvrir la fiche POI).
    poiFilterFromSearch: false,
    circuitIdToImportFor: null,
    orthodromicPolyline: null,
    realTrackPolyline: null,
    ghostMarker: null, // Marqueur temporaire pour la recherche de coordonnées
    draggingMarkerId: null, // Marqueur en cours de déplacement (pour ignorer le clic)
    filterCompleted: false,
    hasUnexportedChanges: false,
    isAdmin: false, // Activation du "God Mode"
    // Liste blacklist : circuits cachés du listing (officiels + perso confondus).
    // [] (défaut) = tous visibles. Cohérence : la blacklist filtre la sidebar
    // Mes Circuits, le compteur planifié des POIs et le calcul du Carnet de voyage.
    hiddenCircuitIds: [],
    // selectionModeFilters supprimé (point #5 audit Stefan) : le filtre topbar
    // (activeFilters) gère désormais le filtrage en mode normal ET en mode création.
    activeFilters: {
        categories: [],
        // 3-states refonte filtres (Claude Design) : 'all' (par défaut) | 'hide' | 'only'
        // L'ancien topbar (toggle binaire) bascule entre 'all' et 'hide' uniquement.
        vus: 'all',
        planifies: 'all',
        verified: 'all',
        photo: 'all',
        description: 'all',
        incontournablesOnly: false,
        zone: null
    },
    // Lieu de résidence (capté via GPS depuis Mon Espace).
    // null = non défini → tri par proximité désactivé.
    // { lat, lng, savedAt } = défini.
    homeLocation: null
};

// --- 2. LES MAJORDOMES (Les "Gardiens" de l'état) ---
// À partir de maintenant, les autres fichiers devront utiliser ces fonctions 
// pour modifier l'état, au lieu de le faire en cachette.

// Gardien pour activer/désactiver le mode Création de circuit.
// Refactor PR2 : renommé depuis setSelectionMode (sémantique stricte).
export function setCircuitCreationMode(isActive) {
    state.isCircuitCreationMode = isActive;
}

// Gardien pour vider le brouillon de circuit
export function resetCurrentCircuit() {
    state.currentCircuit = [];
}

// Gardien pour changer de carte/zone
export function setCurrentMap(mapId) {
    state.currentMapId = mapId;
}

// Gardien pour définir les points d'intérêt chargés (features)
export function setLoadedFeatures(features) {
    state.loadedFeatures = features || [];
}

// Gardien pour remplacer toute la liste des circuits persos
export function setMyCircuits(circuits) {
    state.myCircuits = circuits || [];
}

// Gardien pour ajouter un circuit perso
export function addMyCircuit(circuit) {
    if (!circuit) return;
    state.myCircuits.push(circuit);
}

// Gardien pour mettre à jour un circuit perso existant
export function updateMyCircuit(updatedCircuit) {
    if (!updatedCircuit) return;
    const index = state.myCircuits.findIndex(c => String(c.id) === String(updatedCircuit.id));
    if (index !== -1) {
        state.myCircuits[index] = updatedCircuit;
    } else {
        console.warn(`[State] Impossible de mettre à jour le circuit ${updatedCircuit.id}, il n'existe pas.`);
    }
}

// Gardien pour supprimer un circuit perso
export function removeMyCircuit(circuitId) {
    state.myCircuits = state.myCircuits.filter(c => String(c.id) !== String(circuitId));
}

// Gardien pour ajouter un point au circuit
export function addPoiToCurrentCircuit(feature) {
    state.currentCircuit.push(feature);
}

// --- Nouveaux Gardiens ajoutés (Nettoyage de Dette Technique) ---

export function setUserData(userData) {
    state.userData = userData || {};
}

export function setOfficialCircuits(circuits) {
    state.officialCircuits = circuits || [];
}

export function setOfficialCircuitsStatus(status) {
    state.officialCircuitsStatus = status || {};
}

export function setTestedCircuits(tested) {
    state.testedCircuits = tested || {};
}

export function setGeojsonLayer(layer) {
    state.geojsonLayer = layer;
}

export function setCurrentFeatureId(featureId) {
    state.currentFeatureId = featureId;
}

export function setCurrentCircuitIndex(index) {
    state.currentCircuitIndex = index;
}

export function setCurrentCircuit(features) {
    state.currentCircuit = features || [];
}

export function setCustomFeatures(features) {
    state.customFeatures = features || [];
}

export function setHiddenPoiIds(ids) {
    state.hiddenPoiIds = ids || [];
}

export function setHiddenCircuitIds(ids) {
    state.hiddenCircuitIds = Array.isArray(ids) ? ids.map(String) : [];
}

export function setCustomDraftName(name) {
    state.customDraftName = name;
}

export function setActiveCircuitId(id) {
    state.activeCircuitId = id;
    // Charger un nouveau circuit (ou clear) sort automatiquement du mode édition.
    state.editingMode = false;
}

export function setEditingMode(value) {
    state.editingMode = value === true;
}

export function setPoiFilterFromSearch(value) {
    state.poiFilterFromSearch = value === true;
}

export function setCircuitIdToImportFor(id) {
    state.circuitIdToImportFor = id;
}

export function setOrthodromicPolyline(polyline) {
    state.orthodromicPolyline = polyline;
}

export function setRealTrackPolyline(polyline) {
    state.realTrackPolyline = polyline;
}

export function setGhostMarker(marker) {
    state.ghostMarker = marker;
}

export function setDraggingMarkerId(id) {
    state.draggingMarkerId = id;
}

export function setFilterCompleted(value) {
    state.filterCompleted = value;
}

export function setIsAdmin(isAdmin) {
    state.isAdmin = isAdmin;
}

export function setDestinations(destinations) {
    state.destinations = destinations;
}

export function setHasUnexportedChanges(value) {
    state.hasUnexportedChanges = value;
}

// setSelectionModeFilters supprimé (point #5 audit Stefan).
// Le filtre topbar (setActiveFilters) gère désormais tous les modes.

export function setActiveFilters(filters) {
    state.activeFilters = filters || {};
}

// Majordome granulaire : modifie une seule clé du filtre actif.
// Utile pour les toggles individuels (vus, planifies, zone, etc.) sans remplacer tout l'objet.
export function setActiveFilter(key, value) {
    if (!key) return;
    if (!state.activeFilters) state.activeFilters = {};
    state.activeFilters[key] = value;
}

// Majordome granulaire : marque/démarque un circuit testé par l'admin.
// value falsy → suppression de la clé (évite la pollution de l'objet).
export function setTestedCircuit(circuitId, value) {
    if (!circuitId) return;
    if (!state.testedCircuits) state.testedCircuits = {};
    if (value) {
        state.testedCircuits[circuitId] = true;
    } else {
        delete state.testedCircuits[circuitId];
    }
}

// Majordome granulaire : statut "Completed" d'un circuit officiel.
export function setOfficialCircuitStatus(circuitId, value) {
    if (!circuitId) return;
    if (!state.officialCircuitsStatus) state.officialCircuitsStatus = {};
    state.officialCircuitsStatus[circuitId] = value;
}

// Majordome pour le lieu de résidence (tri par proximité).
// Accepte { lat, lng, savedAt } ou null pour réinitialiser.
export function setHomeLocation(home) {
    state.homeLocation = home || null;
}

