
import L from 'leaflet';
import { map, startMarkerDrag } from './map.js';
import { state, POI_CATEGORIES } from './state.js';
import { getPoiId, commitPendingPoiIfNeeded, updatePoiCoordinates, updatePoiData } from './data.js';
import { eventBus } from './events.js';
import { getZoneFromCoords, openCoordsOnMap, isCandidate, normalizeOsmRef, osmObjectUrl, mapsPlaceUrl } from './utils.js';
import { addPoiFeature } from './data.js';
import { saveAppState } from './database.js';
import { persistPoiEdit } from './poi-persistence.js';
import { schedulePush } from './gist-sync.js';
import { logModification } from './logger.js';
import { showToast } from './toast.js';
import { openDetailsPanel, closeDetailsPanel } from './ui-details.js';
import { showConfirm, openHwModal, closeHwModal, suspendHwModal, resumeHwModal } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { getSubtypes, getStates, getAccessValues } from './taxonomy.js';
import { configureHelp, helpButton, helpInline } from './help-popover.js';
import { GUIDE_LIEU, HELP_LIEU_ZONE, HELP_LIEU_CATEGORIE, HELP_LIEU_DESC_COURTE, HELP_LIEU_SOURCE } from './help-content.js';
import {
    getWorkPhotosById, uploadWorkPhoto, loadWorkPhotoBlob, MAX_WORK_PHOTOS_PER_POI
} from './work-photos.js';
import { savePrivateNote } from './private-notes.js';
import { getStoredToken } from './github-sync.js';

// Aide « ? » : le patron rend l'icône via createIcons (idempotent).
configureHelp({ renderIcons: (root) => createIcons({ icons: appIcons, root }) });

// --- IDs DOM ---
const DOM_IDS = {
    MODAL: 'rich-poi-modal',
    TITLE: 'rich-poi-modal-title',
    COORDS: 'rich-poi-coords',
    INPUTS: {
        NAME_FR: 'rich-poi-name-fr',
        NAME_AR: 'rich-poi-name-ar',
        CATEGORY: 'rich-poi-category',
        ZONE: 'rich-poi-zone',
        DESC_SHORT: 'rich-poi-desc-short',
        DESC_LONG: 'rich-poi-desc-long',
        NOTES: 'rich-poi-notes',
        TIME_H: 'rich-poi-time-h',
        TIME_M: 'rich-poi-time-m',
        PRICE: 'rich-poi-price',
        SOURCE: 'rich-poi-source',
        OSM_REF: 'rich-poi-osm-ref',
        MAPS_REF: 'rich-poi-maps-ref',
        SUBTYPE: 'rich-poi-subtype',
        STATE: 'rich-poi-state',
        ACCESS: 'rich-poi-access',
        PHONE: 'rich-poi-phone',
        HOURS: 'rich-poi-hours',
        FACEBOOK: 'rich-poi-facebook'
    },
    BTNS: {
        SAVE: 'btn-save-rich-poi',
        VALIDATE_SAVE: 'btn-validate-save-rich-poi',
        CANCEL: 'btn-cancel-rich-poi',
        DELETE: 'btn-delete-rich-poi',
        CLOSE: 'close-rich-poi-modal',
        EMAIL: 'btn-suggest-email',
        PREV: 'btn-rich-prev',
        NEXT: 'btn-rich-next',
        MOVE: 'btn-rich-move-marker'
    },
    NAV_CONTROLS: 'rich-poi-nav-controls',
    VERIFIED: 'rich-poi-verified',
    MAP_MISSING: 'rich-poi-mapmissing',
    DESC_PUBLIC: 'rich-poi-descpublic',
    // Checklist de vérification (15/08/2026) : traçent l'ACTE de vérification,
    // séparément du résultat (osm_ref/maps_ref) — cf. handleSave pour la
    // logique d'auto-implication (« trouvé » vaut « vérifié » sans double case).
    OSM_CHECKED: 'rich-poi-osmchecked',
    OSM_CHECKED_DATE: 'rich-poi-osmchecked-date',
    MAPS_CHECKED: 'rich-poi-mapschecked',
    MAPS_HAS_PHOTO: 'rich-poi-mapsphoto',
    JALEL_CHECKED: 'rich-poi-jalelchecked'
};

let currentMode = 'CREATE'; // 'CREATE' | 'EDIT'
let currentFeatureId = null; // Pour le mode EDIT
let currentDraftCoords = null; // Pour le mode CREATE
let currentPhotos = []; // Pour le mode CREATE (import photos)
let isDirty = false;
// État OSM tel que CHARGÉ (avant modif de la session en cours) — sert à ne
// rafraîchir osmCheckedDate que sur une vraie transition (checked/ref changés),
// pas à chaque enregistrement du formulaire pour une raison sans rapport.
let originalOsmState = { checked: false, ref: '', date: null };
// Réunif A3b : hôte de montage du formulaire — 'modal' (openHwModal, fiche
// classique) ou 'drawer' (tiroir droit ancré dans le Mode Données). Le corps du
// formulaire (RICH_POI_BODY_HTML) et ses IDs sont identiques dans les deux cas.
let _host = 'modal';
let _drawerEl = null;

// HTML du formulaire (body de la modale V2). IDs préservés à l'identique
// pour que toute la logique métier (setValue/getValue/handleSave/executeCreate
// /executeEdit) reste fonctionnelle sans modification. Le wrapper
// `.rich-poi-form` scope les règles CSS (input-group en colonne, padding
// inputs, etc.) qui étaient préfixées `#rich-poi-modal` avant la migration.
const RICH_POI_BODY_HTML = `
<div class="rich-poi-form">
    <!-- Bandeau « Statut de la fiche » (réunification, Lot A) : porte le toggle
         Vérifié, en tête du formulaire. Méta-FICHE (≠ taxonomie État/Accès qui
         décrit le LIEU). Le cycle de vie Candidat/Curé viendra ici au Lot C. -->
    <div class="fiche-status">
        <div class="fiche-status-hd"><i data-lucide="badge-check"></i>Statut de la fiche</div>
        <div class="fiche-row">
            <span class="lbl"><span class="t">Vérifié</span><span class="h">La fiche a été relue et validée</span></span>
            <span class="ctl">
                <button class="sw" id="rich-poi-verified" type="button" role="switch" aria-checked="false" aria-label="Vérifié"></button>
            </span>
        </div>
        <!-- P8 (renommé 15/08/2026) : l'existence même du lieu n'est pas confirmée
             avec certitude — pas juste sa position. Masqué par défaut pour un
             non-admin (state.js : setIsAdmin), visible et publié avec une alerte
             « Existence à confirmer » pour l'admin (templates.js). -->
        <div class="fiche-row">
            <span class="lbl"><span class="t">Existence à confirmer</span><span class="h">Existence non confirmée avec certitude — masqué par défaut aux visiteurs, publié avec une alerte « Existence à confirmer » pour l'admin</span></span>
            <span class="ctl">
                <button class="sw" id="rich-poi-mapmissing" type="button" role="switch" aria-checked="false" aria-label="Existence à confirmer"></button>
            </span>
        </div>
        <!-- Description publiée (08-09/08/2026) : par défaut, Description+Source restent
             modifiables et sourcées librement (citation brute acceptée) mais NE S'AFFICHENT
             PAS côté visiteur — matériau de travail tant que l'admin n'a pas explicitement
             publié. Ne compte pour le seuil qui déclenche une page SEO statique
             (generate-poi-pages.mjs) que si publié. Défaut OFF assumé (v3.7.349) : beaucoup
             de descriptions déjà en ligne étaient des citations brutes, pas du texte relu. -->
        <div class="fiche-row">
            <span class="lbl"><span class="t">Description publiée</span><span class="h">Par défaut, la description n'est pas visible des visiteurs — active pour publier une fois le texte relu</span></span>
            <span class="ctl">
                <button class="sw" id="rich-poi-descpublic" type="button" role="switch" aria-checked="false" aria-label="Description publiée"></button>
            </span>
        </div>
        <!-- Candidat « à curer » (réunif C1b) : visible seulement pour un candidat Scout.
             P7 : plus de bouton « Valider » ici — la validation se fait au footer via
             « Valider & enregistrer » (1 geste = enrichir + rendre publiable). La ligne
             reste un indicateur de statut (cohérent avec le toggle « Vérifié »). -->
        <div class="fiche-row" id="rich-poi-candidate-row" hidden>
            <span class="lbl"><span class="t">Candidat à curer</span><span class="h">Trouvé par Scout — « Valider &amp; enregistrer » pour le rendre publiable</span></span>
            <span class="ctl">
                <button class="btn btn-ghost btn-sm" id="btn-rich-duplicate" type="button"
                        title="Ce candidat double un lieu déjà présent">
                    <i data-lucide="copy"></i><span>Doublon d'un lieu existant…</span>
                </button>
            </span>
        </div>
    </div>

    <!-- Checklist de vérification (15/08/2026) : trace l'acte de vérification
         par source, séparément du résultat. « OSM vérifié » et « Maps vérifié »
         passent automatiquement à vrai dès que le champ Objet OSM / Lien Maps
         plus bas est rempli — la case ne sert qu'au cas négatif (cherché, rien
         trouvé). Pas de case pour Facebook/livres/etc. : trop varié pour être
         structuré, ça reste dans Notes. -->
    <div class="fiche-status">
        <div class="fiche-status-hd"><i data-lucide="list-checks"></i>Vérifications</div>
        <div class="fiche-row">
            <span class="lbl"><span class="t">OSM vérifié</span><span class="h">Coché automatiquement si un objet OSM est renseigné plus bas — sinon, à cocher à la main si la recherche n'a rien donné<span class="rich-check-date" id="rich-poi-osmchecked-date"></span></span></span>
            <span class="ctl">
                <button class="sw" id="rich-poi-osmchecked" type="button" role="switch" aria-checked="false" aria-label="OSM vérifié"></button>
            </span>
        </div>
        <div class="fiche-row">
            <span class="lbl"><span class="t">Maps vérifié</span><span class="h">Coché automatiquement si un lien Maps est renseigné plus bas — sinon, à cocher à la main si la recherche n'a rien donné</span></span>
            <span class="ctl">
                <button class="sw" id="rich-poi-mapschecked" type="button" role="switch" aria-checked="false" aria-label="Maps vérifié"></button>
            </span>
        </div>
        <div class="fiche-row">
            <span class="lbl"><span class="t">Photo Maps disponible</span><span class="h">Des photos existent sur Maps, indépendamment de ce qui a déjà été récupéré en photo de travail</span></span>
            <span class="ctl">
                <button class="sw" id="rich-poi-mapsphoto" type="button" role="switch" aria-checked="false" aria-label="Photo Maps disponible"></button>
            </span>
        </div>
        <div class="fiche-row">
            <span class="lbl"><span class="t">Jalel checké</span><span class="h">Répertoire de Jalel consulté pour ce lieu, qu'il y ait eu match ou non</span></span>
            <span class="ctl">
                <button class="sw" id="rich-poi-jalelchecked" type="button" role="switch" aria-checked="false" aria-label="Jalel checké"></button>
            </span>
        </div>
    </div>

    <!-- Ligne 1 : Noms -->
    <div class="rich-poi-row-2col">
        <div class="input-group">
            <label for="rich-poi-name-fr">Nom (FR)*</label>
            <input type="text" id="rich-poi-name-fr" class="editable-input">
        </div>
        <div class="input-group">
            <label for="rich-poi-name-ar">Nom (AR)</label>
            <input type="text" id="rich-poi-name-ar" class="editable-input" placeholder="الاسم بالعربية">
        </div>
    </div>

    <!-- Ligne 2 : Catégorie & Zone -->
    <div class="rich-poi-row-2col">
        <div class="input-group">
            <label for="rich-poi-category">Catégorie</label>
            <select id="rich-poi-category" class="editable-input">
                <!-- Rempli par prepareModal -->
            </select>
        </div>
        <div class="input-group">
            <label for="rich-poi-zone">Zone</label>
            <input type="text" id="rich-poi-zone" class="editable-input" placeholder="Ex: Houmt Souk">
        </div>
    </div>

    <!-- Bloc taxonomie : Sous-type / État / Accès — contextuels selon la
         catégorie. Peuplés / affichés / masqués par populateTaxonomySelects(). -->
    <div class="rich-poi-taxonomy is-hidden" id="rich-poi-taxonomy">
        <div class="input-group" id="rich-poi-subtype-group">
            <label for="rich-poi-subtype">Sous-type</label>
            <select id="rich-poi-subtype" class="editable-input"></select>
        </div>
        <div class="input-group" id="rich-poi-state-group">
            <label for="rich-poi-state">État</label>
            <select id="rich-poi-state" class="editable-input"></select>
        </div>
        <div class="input-group" id="rich-poi-access-group">
            <label for="rich-poi-access">Accès</label>
            <select id="rich-poi-access" class="editable-input"></select>
        </div>
    </div>

    <!-- Descriptions -->
    <div class="input-group">
        <label for="rich-poi-desc-short">Description Courte (Résumé)</label>
        <input type="text" id="rich-poi-desc-short" class="editable-input" placeholder="Apparaît dans la liste...">
    </div>
    <div class="input-group">
        <label for="rich-poi-desc-long">Description Complète</label>
        <textarea id="rich-poi-desc-long" class="editable-input" rows="4"></textarea>
    </div>

    <!-- Infos Pratiques -->
    <div class="rich-poi-section-muted">
        <div class="input-group">
            <label>Temps de visite</label>
            <div class="rich-poi-time-row">
                <input type="number" id="rich-poi-time-h" class="editable-input" placeholder="H"> h
                <input type="number" id="rich-poi-time-m" class="editable-input" placeholder="M"> min
            </div>
        </div>
        <div class="input-group">
            <label for="rich-poi-price">Prix (TND)</label>
            <input type="number" id="rich-poi-price" class="editable-input" placeholder="0" step="0.5">
        </div>
        <div class="input-group">
            <label for="rich-poi-phone">Téléphone</label>
            <input type="tel" id="rich-poi-phone" class="editable-input" placeholder="+216 ...">
        </div>
        <div class="input-group">
            <label for="rich-poi-hours">Horaires</label>
            <input type="text" id="rich-poi-hours" class="editable-input" placeholder="Ex : 09h-18h">
        </div>
        <div class="input-group">
            <label for="rich-poi-facebook">Facebook</label>
            <input type="url" id="rich-poi-facebook" class="editable-input" placeholder="https://facebook.com/...">
        </div>
    </div>

    <!-- Source & Notes -->
    <div class="input-group">
        <label for="rich-poi-source">Sources (une par ligne — Texte, URL, ou « Texte | URL »)</label>
        <textarea id="rich-poi-source" class="editable-input" rows="2" placeholder="Auteur, titre | https://..."></textarea>
    </div>
    <div class="input-group">
        <label for="rich-poi-osm-ref">Objet OSM</label>
        <input type="text" id="rich-poi-osm-ref" class="editable-input" placeholder="Coller l'URL OSM du lieu (ou way/123)">
    </div>
    <div class="input-group">
        <label for="rich-poi-maps-ref">Lien Google Maps</label>
        <input type="url" id="rich-poi-maps-ref" class="editable-input" placeholder="Collez le lien du lieu (bouton Partager sur Maps)">
    </div>
    <div class="input-group">
        <label for="rich-poi-notes">Notes</label>
        <textarea id="rich-poi-notes" class="editable-input" rows="2"></textarea>
    </div>

    <!-- Photos de travail (10/08/2026) — images dont Stefan n'est PAS l'auteur,
         pour identifier un lieu pas encore visité. Déposées dans un dépôt PRIVÉ,
         jamais publiées, sans watermark. Enregistrement IMMÉDIAT (upload réseau),
         indépendant du bouton Enregistrer du formulaire. -->
    <div class="input-group rich-work-photos" id="rich-work-photos">
        <label>Photos de travail <span class="rich-work-hint">jamais publiées — repère de recherche</span></label>
        <div class="rich-work-list" id="rich-work-list"></div>
        <button type="button" class="btn btn-ghost rich-work-add" id="btn-rich-work-add">
            <i data-lucide="image-plus"></i><span>Ajouter une photo de travail</span>
        </button>
        <input type="file" id="rich-work-file" class="is-hidden" accept="image/*">
    </div>

    <!-- GPS footer : déplacer + coords + liens carte (réunif A3f) -->
    <div class="rich-poi-gps-footer">
        <button id="btn-rich-move-marker" class="btn btn-ghost" title="Déplacer le marqueur" aria-label="Déplacer le marqueur" type="button">
            <i data-lucide="move"></i><span>Déplacer</span>
        </button>
        <span>📍 GPS : <span id="rich-poi-coords">...</span></span>
        <span class="rich-poi-map-links">
            <button id="btn-rich-open-gmaps" class="rich-maplink" type="button" title="Voir sur Google Maps" aria-label="Voir sur Google Maps"><i data-lucide="map-pin"></i>Maps</button>
            <button id="btn-rich-open-osm" class="rich-maplink" type="button" title="Voir sur OpenStreetMap" aria-label="Voir sur OpenStreetMap"><i data-lucide="map"></i>OSM</button>
        </span>
    </div>
</div>
`;

// Subheader : nav controls (prev/next dans circuit). Caché en mode CREATE
// ou si le POI courant n'est pas dans un circuit affiché.
const RICH_POI_SUBHEADER_HTML = `
    <div id="rich-poi-nav-controls" class="rich-poi-nav-controls is-hidden">
        <button id="btn-rich-prev" class="btn btn-ghost" title="Précédent" aria-label="Précédent" type="button"><i data-lucide="chevron-left"></i></button>
        <button id="btn-rich-next" class="btn btn-ghost" title="Suivant" aria-label="Suivant" type="button"><i data-lucide="chevron-right"></i></button>
    </div>
`;

// Footer : Supprimer (danger, EDIT seulement) + Annuler (ghost) + Enregistrer (primary,
// désactivable via updateSaveButtonState).
//
// « Supprimer » ferme le trou de curation signalé par Stefan le 10/08/2026 : le Mode
// Données ne donnait AUCUN accès à la suppression — il fallait quitter le mode, retrouver
// le lieu sur la carte, ouvrir sa fiche et passer par le kebab. Le bouton délègue à
// requestSoftDelete (ui-modals.js), le MÊME chemin que ce kebab : un seul confirm, un seul
// deletePoi, donc pas de second comportement de suppression à maintenir en parallèle.
// P7 : pour un candidat Scout (EDIT), updateCandidateFooter() révèle « Valider &
// enregistrer » (primaire, 1 geste = enrichir + publiable) et rétrograde
// « Enregistrer » en secondaire « (garder à curer) ». Les deux boutons partagent le
// même garde-fou de validité (nom + catégorie) via updateSaveButtonState.
const RICH_POI_FOOTER_HTML = `
    <button id="btn-delete-rich-poi" class="btn btn-danger" type="button" hidden>
        <i data-lucide="trash-2"></i><span>Supprimer</span>
    </button>
    <button id="btn-cancel-rich-poi" class="btn btn-ghost" type="button">Annuler</button>
    <button id="btn-save-rich-poi" class="btn btn-primary" type="button">
        <i data-lucide="save"></i><span>Enregistrer</span>
    </button>
    <button id="btn-validate-save-rich-poi" class="btn btn-primary" type="button" hidden>
        <i data-lucide="check"></i><span>Valider &amp; enregistrer</span>
    </button>
`;

export const RichEditor = {
    /**
     * Initialise les écouteurs d'événements.
     * Migration V2 : la modale est désormais créée à la volée par openHwModal,
     * donc init() est devenue un no-op pour rétro-compat avec les callers
     * (desktopMode, ui.js). Le bind effectif des listeners se fait dans
     * showModal() après chaque création de la modale.
     */
    init: () => { /* no-op : voir bindModalEvents() */ },

    /**
     * Ouvre la modale en mode CRÉATION
     * @param {number} lat
     * @param {number} lng
     * @param {Array} photos (Optionnel) Liste des photos importées
     */
    openForCreate: (lat, lng, photos = []) => {
        _host = 'modal'; // la création passe toujours par la modale classique
        currentMode = 'CREATE';
        currentDraftCoords = { lat, lng };
        currentPhotos = photos;
        currentFeatureId = null;

        // V2 : showModal crée la modale via openHwModal (DOM dispo après).
        showModal();

        // Valeurs par défaut
        setValue(DOM_IDS.INPUTS.NAME_FR, "");
        setValue(DOM_IDS.INPUTS.NAME_AR, "");
        setValue(DOM_IDS.INPUTS.CATEGORY, ""); // Vide par défaut pour forcer le choix

        // Zone Automatique
        const autoZone = getZoneFromCoords(lat, lng);
        setValue(DOM_IDS.INPUTS.ZONE, autoZone || "");

        // Lock Zone Input
        const zoneInput = document.getElementById(DOM_IDS.INPUTS.ZONE);
        if (zoneInput) zoneInput.disabled = true;

        // Photos de travail : masquées en création — il n'y a pas encore
        // d'identifiant stable auquel rattacher un envoi.
        const workWrap = document.getElementById('rich-work-photos');
        if (workWrap) workWrap.hidden = true;

        setValue(DOM_IDS.INPUTS.DESC_SHORT, "");
        setValue(DOM_IDS.INPUTS.DESC_LONG, "");
        setValue(DOM_IDS.INPUTS.NOTES, "");
        setValue(DOM_IDS.INPUTS.TIME_H, "");
        setValue(DOM_IDS.INPUTS.TIME_M, "");
        setValue(DOM_IDS.INPUTS.PRICE, "");
        setValue(DOM_IDS.INPUTS.SOURCE, "");
        setValue(DOM_IDS.INPUTS.PHONE, "");
        setValue(DOM_IDS.INPUTS.HOURS, "");
        setValue(DOM_IDS.INPUTS.FACEBOOK, "");
        setVerified(false);
        setMapMissing(false);
        setDescPublic(false);
        setOsmChecked(false);
        setOsmCheckedDateDisplay(null);
        setMapsChecked(false);
        setMapsHasPhoto(false);
        setJalelChecked(false);
        originalOsmState = { checked: false, ref: '', date: null };
        { const r = document.getElementById('rich-poi-candidate-row'); if (r) r.hidden = true; }
        updateCandidateFooter(false); // création : footer « Enregistrer » standard

        // Bloc taxonomie : catégorie vide en création → bloc masqué.
        populateTaxonomySelects("");

        // Affichage coords
        const coordsEl = document.getElementById(DOM_IDS.COORDS);
        if (coordsEl) coordsEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

        // Hide navigation in create mode
        const navControls = document.getElementById(DOM_IDS.NAV_CONTROLS);
        if (navControls) navControls.classList.add('is-hidden');

        // Focus premier champ + reset isDirty (déjà reset par showModal mais
        // certains setValue peuvent l'avoir set à true via les listeners input)
        isDirty = false;
        updateSaveButtonState();
        document.getElementById(DOM_IDS.INPUTS.NAME_FR)?.focus();
    },

    /**
     * Ouvre la modale en mode ÉDITION
     * @param {string} poiId ID du POI (HW-...)
     */
    openForEdit: async (poiId, opts = {}) => {
        // Recherche du feature
        const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
        if (!feature) {
            showToast("Erreur : POI introuvable.", "error");
            return false;
        }

        // Réunif A3b : un tiroir déjà ouvert avec des modifs non enregistrées →
        // confirmer avant de basculer sur un autre lieu (pas de perte silencieuse).
        if (_drawerEl && isDirty) {
            const ok = await showConfirm("Modifications non enregistrées", "Changer de lieu sans enregistrer ?", "Changer", "Annuler", true);
            if (!ok) return false;
        }
        _host = (opts && opts.host === 'drawer') ? 'drawer' : 'modal';

        currentMode = 'EDIT';
        currentFeatureId = poiId;
        currentDraftCoords = null;
        currentPhotos = [];

        // V2 : showModal crée la modale via openHwModal (DOM dispo après).
        showModal();

        // Fusion Properties + UserData
        const props = feature.properties || {};
        const userData = state.userData[poiId] || {}; // Priorité aux données user si existantes
        const merged = { ...props, ...userData };

        // Remplissage
        setValue(DOM_IDS.INPUTS.NAME_FR, merged['Nom du site FR'] || merged.name || "");
        setValue(DOM_IDS.INPUTS.NAME_AR, merged['Nom du site arabe'] || "");
        setValue(DOM_IDS.INPUTS.CATEGORY, merged['Catégorie'] || "A définir");

        // Bloc taxonomie : peupler selon la catégorie, puis restaurer les valeurs.
        populateTaxonomySelects(merged['Catégorie'] || "");
        setValue(DOM_IDS.INPUTS.SUBTYPE, merged['Sous-type'] || "");
        setValue(DOM_IDS.INPUTS.STATE, merged['État'] || "");
        setValue(DOM_IDS.INPUTS.ACCESS, merged['Accès'] || "");

        // Recalculate Zone and Lock
        let zoneVal = merged['Zone'] || "";
        if (feature.geometry && feature.geometry.coordinates) {
             const [lng, lat] = feature.geometry.coordinates;
             zoneVal = getZoneFromCoords(lat, lng);
        }
        setValue(DOM_IDS.INPUTS.ZONE, zoneVal);
        const zoneInput = document.getElementById(DOM_IDS.INPUTS.ZONE);
        if (zoneInput) zoneInput.disabled = true;

        setValue(DOM_IDS.INPUTS.DESC_SHORT, merged['info_gpx'] || "");
        setValue(DOM_IDS.INPUTS.DESC_LONG, merged['description'] || "");
        setValue(DOM_IDS.INPUTS.NOTES, merged['notes'] || "");

        // Temps : Temps_minutes (number) → décomposé en h + m
        const totalMin = Number.isFinite(merged['Temps_minutes']) ? merged['Temps_minutes'] : null;
        setValue(DOM_IDS.INPUTS.TIME_H, totalMin != null ? Math.floor(totalMin / 60) : "");
        setValue(DOM_IDS.INPUTS.TIME_M, totalMin != null ? totalMin % 60 : "");

        // Prix : Prix_TND (number)
        const price = merged['Prix_TND'];
        setValue(DOM_IDS.INPUTS.PRICE, Number.isFinite(price) ? price : "");

        setValue(DOM_IDS.INPUTS.SOURCE, merged.Source || "");
        setValue(DOM_IDS.INPUTS.OSM_REF, merged.osm_ref || "");
        setValue(DOM_IDS.INPUTS.MAPS_REF, merged.maps_ref || "");
        setValue(DOM_IDS.INPUTS.PHONE, merged['Téléphone'] || merged.telephone || "");
        setValue(DOM_IDS.INPUTS.HOURS, merged['Horaires'] || merged.horaires || "");
        setValue(DOM_IDS.INPUTS.FACEBOOK, merged['Facebook'] || "");
        setVerified(!!merged.verified);
        setMapMissing(!!merged.introuvableCarte);
        setDescPublic(!!merged.descriptionPublic);
        setOsmChecked(!!merged.osmChecked);
        setOsmCheckedDateDisplay(merged.osmCheckedDate || null);
        setMapsChecked(!!merged.mapsChecked);
        setMapsHasPhoto(!!merged.mapsHasPhoto);
        setJalelChecked(!!merged.jalelChecked);
        originalOsmState = { checked: !!merged.osmChecked, ref: merged.osm_ref || '', date: merged.osmCheckedDate || null };
        renderWorkPhotos(currentFeatureId);
        // Réunif C1b : ligne « Candidat à curer » visible seulement pour un candidat Scout.
        // P7 : et le footer bascule en mode candidat (« Valider & enregistrer »).
        { const cand = isCandidate(feature);
          const r = document.getElementById('rich-poi-candidate-row'); if (r) r.hidden = !cand;
          updateCandidateFooter(cand); }

        // Tiroir (Mode Données) : sous-titre = nom du lieu en cours d'édition.
        const drawerSub = _drawerEl && _drawerEl.querySelector('[data-rich-drawer-sub]');
        if (drawerSub) drawerSub.textContent = merged['Nom du site FR'] || merged.name || '';

        // Affichage coords
        const coordsEl = document.getElementById(DOM_IDS.COORDS);
        if (coordsEl && feature.geometry) {
            const [lng, lat] = feature.geometry.coordinates;
            coordsEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        }

        updateNavigationControls(poiId);
        isDirty = false;
        updateSaveButtonState();
        document.getElementById(DOM_IDS.INPUTS.NAME_FR)?.focus();
        return true;
    },

    close: async () => {
        if (isDirty) {
            if (!await showConfirm("Modifications non enregistrées", "Voulez-vous fermer sans enregistrer ?", "Fermer sans sauver", "Annuler", true)) {
                return;
            }
        }
        isDirty = false;
        // `created: true` uniquement si CREATE s'est terminé par un executeCreate réussi
        // (qui set currentFeatureId = actualId). Permet aux listeners (ex: ui-photo-batch)
        // de distinguer "fermeture après création" vs "annulation".
        const wasCreated = currentMode === 'CREATE' && currentFeatureId !== null;
        // Migration V2 : closeHwModal au lieu de toggle .is-hidden. L'event
        // richEditor:closed est dispatch après la fermeture (les listeners
        // peuvent assumer que la modale n'est plus dans le DOM).
        if (_host === 'drawer') {
            teardownDrawer();
            _host = 'modal';
        } else {
            closeHwModal();
        }
        window.dispatchEvent(new CustomEvent('richEditor:closed', {
            detail: { poiId: currentFeatureId, mode: currentMode, created: wasCreated }
        }));
    },

    // Réunif A3b : ferme sans confirmation un tiroir éventuellement ouvert (appelé
    // par le Mode Données à sa sortie). No-op si aucun tiroir.
    discardDrawer: () => {
        if (!_drawerEl) return;
        teardownDrawer();
        _host = 'modal';
        isDirty = false;
    }
};

// Listener eventBus au module-load (pas besoin de DOM pour cet écouteur — init()
// reste lazy pour les écouteurs DOM). Permet aux modules externes de déclencher
// l'ouverture sans import direct de RichEditor (casse admin-control-center → richEditor).
eventBus.on('richEditor:open-for-edit', (id) => RichEditor.openForEdit(id));

// --- PRIVATE HELPERS ---

// Coordonnées courantes du lieu édité (réunif A3f) : currentDraftCoords si défini
// (mode CREATE, ou après un « Déplacer » en EDIT), sinon la géométrie du feature.
function getCurrentEditorCoords() {
    if (currentDraftCoords && Number.isFinite(currentDraftCoords.lat) && Number.isFinite(currentDraftCoords.lng)) {
        return { lat: currentDraftCoords.lat, lng: currentDraftCoords.lng };
    }
    if (currentFeatureId) {
        const f = state.loadedFeatures.find(x => getPoiId(x) === currentFeatureId);
        const c = f?.geometry?.coordinates;
        if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
            return { lat: c[1], lng: c[0] };
        }
    }
    return null;
}

// Ouvre la position courante du lieu sur Google Maps / OSM (réunif A3f, parité DM).
function openEditorCoordsOnMap(provider) {
    // On lit l'input EN DIRECT (pas la feature) — l'admin vient peut-être de
    // coller la référence sans avoir encore enregistré, et le geste naturel
    // est de vérifier ce qu'il a collé. Repli coordonnées si vide/invalide.
    if (provider === 'osm') {
        const url = osmObjectUrl(getValue(DOM_IDS.INPUTS.OSM_REF));
        if (url) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
    }
    if (provider === 'gmaps') {
        const url = mapsPlaceUrl(getValue(DOM_IDS.INPUTS.MAPS_REF));
        if (url) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
    }
    const c = getCurrentEditorCoords();
    if (!c) { showToast("Position du lieu indisponible.", "warning"); return; }
    openCoordsOnMap(c.lat, c.lng, provider);
}

async function handleMove() {
    // Migration V2 : on suspend la modale (cachée + détachée du système V2).
    // Indispensable car showConfirm ouvre une modale V2 par-dessus, et le
    // système V2 interdit le stacking : il fermerait définitivement la rich
    // editor. suspendHwModal préserve l'overlay, resumeHwModal le restaure.
    suspendHwModal();

    // Helper to update coords in Rich Editor UI and state
    const updateEditorCoords = (lat, lng) => {
        currentDraftCoords = { lat, lng };
        const coordsEl = document.getElementById(DOM_IDS.COORDS);
        if (coordsEl) coordsEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

        // Auto-update Zone if possible
        const autoZone = getZoneFromCoords(lat, lng);
        if (autoZone) setValue(DOM_IDS.INPUTS.ZONE, autoZone);

        isDirty = true;
    };

    if (currentMode === 'EDIT' && currentFeatureId) {
        // Mode ÉDITION : On utilise le marqueur existant
        const success = startMarkerDrag(
            currentFeatureId,
            null, // No onDrag callback needed
            async (lat, lng, revert) => {
                if (await showConfirm("Déplacement", "Valider la nouvelle position ?", "Valider", "Annuler")) {
                    updateEditorCoords(lat, lng);
                    showToast("Position mise à jour localement.", "success");
                } else {
                    revert();
                }
                // Re-open modal
                resumeHwModal();
            }
        );

        if (!success) resumeHwModal();

    } else if (currentMode === 'CREATE' && currentDraftCoords) {
        // Mode CRÉATION : On crée un marqueur temporaire
        const { lat, lng } = currentDraftCoords;
        const tempMarker = L.marker([lat, lng], { draggable: true }).addTo(map);

        tempMarker.bindPopup("Déplacez-moi !", { autoClose: false, closeOnClick: false }).openPopup();

        showToast("Mode déplacement activé.", "info");

        const onEnd = async () => {
            const newPos = tempMarker.getLatLng();

            if (await showConfirm("Déplacement", "Valider la nouvelle position ?", "Valider", "Annuler")) {
                updateEditorCoords(newPos.lat, newPos.lng);
                showToast("Position mise à jour localement.", "success");
            } else {
                // Cancelled, keep old coords (no action needed on editor state)
            }

            // Cleanup
            tempMarker.remove();
            resumeHwModal();
        };

        // On écoute dragend, mais on peut aussi attendre un clic sur le marker ou autre
        // Pour rester simple et cohérent : dragend -> confirm
        tempMarker.on('dragend', onEnd);

        // Optionnel : fermer au clic sur la carte si pas de drag ?
        // Compliqué. Restons sur le dragend simple.
    }
}

function updateNavigationControls(currentPoiId) {
    const navControls = document.getElementById(DOM_IDS.NAV_CONTROLS);
    const prevBtn = document.getElementById(DOM_IDS.BTNS.PREV);
    const nextBtn = document.getElementById(DOM_IDS.BTNS.NEXT);

    if (!navControls) return;

    // Check if we are in a circuit context
    if (!state.currentCircuit || state.currentCircuit.length === 0) {
        navControls.classList.add('is-hidden');
        return;
    }

    // Find index in current circuit
    const index = state.currentCircuit.findIndex(f => getPoiId(f) === currentPoiId);

    if (index === -1) {
        navControls.classList.add('is-hidden');
        return;
    }

    // Show controls
    navControls.classList.remove('is-hidden');

    // Update buttons
    if (prevBtn) prevBtn.disabled = index === 0;
    if (nextBtn) nextBtn.disabled = index === state.currentCircuit.length - 1;
}

async function navigate(direction) {
    if (isDirty) {
        if (!await showConfirm("Modifications non enregistrées", "Voulez-vous changer de lieu sans enregistrer ?", "Changer sans sauver", "Annuler", true)) {
            return;
        }
    }

    const index = state.currentCircuit.findIndex(f => getPoiId(f) === currentFeatureId);
    if (index === -1) return;

    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= state.currentCircuit.length) return;

    const newFeature = state.currentCircuit[newIndex];
    if (newFeature) {
        RichEditor.openForEdit(getPoiId(newFeature));
    }
}

// Bind les listeners de la modale après chaque création par openHwModal.
// Remplace l'ancienne RichEditor.init() qui s'exécutait sur HTML statique.
function bindModalEvents() {
    // Fermeture (croix V2 gérée par openHwModal, mais bouton "Annuler" du footer
    // doit déclencher la même logique de confirm-if-dirty que close()).
    document.getElementById(DOM_IDS.BTNS.CANCEL)?.addEventListener('click', () => RichEditor.close());

    // Navigation prev/next
    document.getElementById(DOM_IDS.BTNS.PREV)?.addEventListener('click', () => navigate(-1));
    document.getElementById(DOM_IDS.BTNS.NEXT)?.addEventListener('click', () => navigate(1));

    // Move Marker
    document.getElementById(DOM_IDS.BTNS.MOVE)?.addEventListener('click', handleMove);

    // Liens carte Maps/OSM (réunif A3f) — ouvrent la position courante du lieu.
    document.getElementById('btn-rich-open-gmaps')?.addEventListener('click', () => openEditorCoordsOnMap('gmaps'));
    document.getElementById('btn-rich-open-osm')?.addEventListener('click', () => openEditorCoordsOnMap('osm'));

    // « Doublon d'un lieu existant… » (ligne Candidat à curer, donc candidats seuls).
    document.getElementById('btn-rich-duplicate')?.addEventListener('click', handleDuplicate);

    // « Supprimer » (EDIT seulement — currentMode est posé avant showModal, donc lisible ici).
    document.getElementById(DOM_IDS.BTNS.DELETE)?.addEventListener('click', handleDelete);
    updateDeleteButton();

    // Sauvegarde. P7 : « Enregistrer » garde l'éventuel flag candidat ;
    // « Valider & enregistrer » le retire dans la foulée (handleSave(true)).
    document.getElementById(DOM_IDS.BTNS.SAVE)?.addEventListener('click', () => handleSave(false));
    document.getElementById(DOM_IDS.BTNS.VALIDATE_SAVE)?.addEventListener('click', () => handleSave(true));

    // Photos de travail : câblage à part car elles s'enregistrent immédiatement
    // (envoi réseau) et ne participent pas au submit du formulaire.
    setupWorkPhotoControls();

    // Toggle « Vérifié » (bouton-switch, hors boucle INPUTS car pas de .value)
    document.getElementById(DOM_IDS.VERIFIED)?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const on = !btn.classList.contains('is-on');
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-checked', String(on));
        isDirty = true;
    });

    // P8 — Toggle « Introuvable sur la carte » (même mécanique bouton-switch).
    document.getElementById(DOM_IDS.MAP_MISSING)?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const on = !btn.classList.contains('is-on');
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-checked', String(on));
        isDirty = true;
    });

    // Toggle « Description publiée » (même mécanique bouton-switch).
    document.getElementById(DOM_IDS.DESC_PUBLIC)?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const on = !btn.classList.contains('is-on');
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-checked', String(on));
        isDirty = true;
    });

    // Checklist de vérification (15/08/2026) — 4 toggles, même mécanique.
    for (const id of [DOM_IDS.OSM_CHECKED, DOM_IDS.MAPS_CHECKED, DOM_IDS.MAPS_HAS_PHOTO, DOM_IDS.JALEL_CHECKED]) {
        document.getElementById(id)?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const on = !btn.classList.contains('is-on');
            btn.classList.toggle('is-on', on);
            btn.setAttribute('aria-checked', String(on));
            isDirty = true;
        });
    }

    // Bloc taxonomie : repeupler les 3 selects quand la catégorie change.
    document.getElementById(DOM_IDS.INPUTS.CATEGORY)?.addEventListener('change', () => {
        populateTaxonomySelects(getValue(DOM_IDS.INPUTS.CATEGORY));
    });

    // Validation Listeners
    const validationEvents = ['input', 'change'];
    const fieldsToCheck = [DOM_IDS.INPUTS.NAME_FR, DOM_IDS.INPUTS.CATEGORY, DOM_IDS.INPUTS.DESC_LONG, DOM_IDS.INPUTS.SOURCE];
    fieldsToCheck.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            validationEvents.forEach(evt => {
                el.addEventListener(evt, () => {
                    updateSaveButtonState();
                    isDirty = true;
                });
            });
        }
    });

    // Dirty tracking pour les autres champs
    Object.values(DOM_IDS.INPUTS).forEach(id => {
        if (!fieldsToCheck.includes(id)) {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => { isDirty = true; });
            }
        }
    });
}

function showModal() {
    isDirty = false; // Reset on open

    const isCreate = currentMode === 'CREATE';
    if (_host === 'drawer') {
        // Réunif A3b : montage en TIROIR droit (Mode Données) — MÊME formulaire,
        // MÊMES IDs ; seul le conteneur change (pas de openHwModal/backdrop).
        mountDrawer(isCreate);
    } else {
        // Migration V2 : crée la modale via openHwModal. Le close (croix/Escape)
        // ferme directement ; le bouton "Annuler" gère le contrôle isDirty via close().
        openHwModal({
            size: 'lg',
            icon: isCreate ? 'map-pin-plus' : 'edit-3',
            title: isCreate ? 'Nouveau Lieu' : 'Éditer le Lieu',
            subheader: RICH_POI_SUBHEADER_HTML,
            body: RICH_POI_BODY_HTML,
            footer: RICH_POI_FOOTER_HTML,
            closeOnBackdrop: false,
        });
    }

    // DOM prêt (synchrone dans les deux cas). Bind + remplissage.
    bindModalEvents();
    populateCategorySelect();
    createIcons({ icons: appIcons });

    // Aide « ? » header — uniquement en modale (le tiroir n'a pas de header modale).
    if (_host !== 'drawer') {
        const headerEl = document.querySelector('.hw-modal-overlay.is-active .hw-modal-header');
        const closeBtn = headerEl?.querySelector('.hw-modal-close');
        if (headerEl && closeBtn && !headerEl.querySelector('.help-trigger')) {
            closeBtn.insertAdjacentElement('beforebegin', helpButton(GUIDE_LIEU, { label: 'Aide : créer ou éditer un lieu' }));
        }
    }
    attachFieldHelp();
}

// Réunif A3b : monte le formulaire RichEditor dans un tiroir droit (Mode Données).
// Réutilise tel quel subheader/body/footer (mêmes IDs → bind/populate inchangés) ;
// seul le conteneur diffère. Ancré dans l'overlay du Mode Données.
function mountDrawer(isCreate) {
    teardownDrawer(); // un seul tiroir à la fois
    const drawer = document.createElement('aside');
    drawer.className = 'md-drawer';
    drawer.innerHTML = `
        <div class="md-drawer-head">
            <span class="ic"><i data-lucide="${isCreate ? 'map-pin-plus' : 'edit-3'}"></i></span>
            <div><h4>${isCreate ? 'Nouveau lieu' : 'Éditer le lieu'}</h4><div class="sub" data-rich-drawer-sub></div></div>
            <span class="nav">
                <button class="md-iconbtn" type="button" id="close-rich-poi-drawer" title="Fermer" aria-label="Fermer"><i data-lucide="x"></i></button>
            </span>
        </div>
        <div class="md-drawer-body">${RICH_POI_SUBHEADER_HTML}${RICH_POI_BODY_HTML}</div>
        <div class="md-drawer-foot">${RICH_POI_FOOTER_HTML}</div>`;
    const mount = document.querySelector('.mode-donnees-overlay') || document.body;
    mount.appendChild(drawer);
    _drawerEl = drawer;
    drawer.querySelector('#close-rich-poi-drawer').addEventListener('click', () => RichEditor.close());
}

function teardownDrawer() {
    if (_drawerEl && _drawerEl.parentNode) _drawerEl.parentNode.removeChild(_drawerEl);
    _drawerEl = null;
}

// « Supprimer » — délègue au chemin unique de suppression (ui-modals.requestSoftDelete) :
// même confirmation et même soft delete que le kebab de la fiche. Import dynamique pour
// ne pas nouer richEditor à la chaîne ui-modals → ui-details.
async function handleDelete() {
    if (currentMode !== 'EDIT' || !currentFeatureId) return;
    const { requestSoftDelete } = await import('./ui-modals.js');
    // Le lieu n'existe plus : on ferme SANS le confirm « modifications non enregistrées »,
    // qui porterait sur des champs devenus sans objet.
    if (await requestSoftDelete(currentFeatureId)) {
        isDirty = false;
        await RichEditor.close();
    }
}

// Affichage du bouton « Supprimer » : EDIT seulement (rien à supprimer en CREATE).
// Rappelé à chaque ouverture — le footer est recréé par showModal.
function updateDeleteButton() {
    const btn = document.getElementById(DOM_IDS.BTNS.DELETE);
    if (btn) btn.hidden = currentMode !== 'EDIT';
}

// « Doublon d'un lieu existant… » — le candidat ouvert double un POI déjà présent :
// on reporte son objet OSM sur le lieu gardé puis on retire le candidat (détail du
// pourquoi : poi-duplicate.js). La surcouche se pose dans l'hôte de l'éditeur — une
// openHwModal fermerait l'éditeur (stacking interdit).
async function handleDuplicate() {
    const feature = state.loadedFeatures.find(f => getPoiId(f) === currentFeatureId);
    if (!feature) return;
    const host = _drawerEl || document.querySelector('.hw-modal-overlay.is-active .hw-modal');
    if (!host) return;

    const { openDuplicatePicker } = await import('./poi-duplicate.js');
    const merged = await openDuplicatePicker(feature, host);
    // Fusion faite → le candidat n'existe plus : on ferme SANS le confirm « modifications
    // non enregistrées » (les champs à l'écran portent sur un lieu qui vient de partir).
    if (merged) {
        isDirty = false;
        await RichEditor.close();
    }
}

// Pose les « ? » inline à côté de 4 labels du formulaire (Zone, Catégorie,
// Description courte, Source). Appelée à chaque showModal (formulaire recréé).
function attachFieldHelp() {
    const root = document.querySelector('.hw-modal-overlay.is-active') || _drawerEl;
    if (!root) return;
    const put = (forId, opts) => {
        const label = root.querySelector(`label[for="${forId}"]`);
        if (label && !label.querySelector('.help-dot')) {
            label.append(' ', helpInline(opts, { size: 'sm' }));
        }
    };
    put('rich-poi-zone', HELP_LIEU_ZONE);
    put('rich-poi-category', HELP_LIEU_CATEGORIE);
    put('rich-poi-desc-short', HELP_LIEU_DESC_COURTE);
    put('rich-poi-source', HELP_LIEU_SOURCE);
}

function updateSaveButtonState() {
    const saveBtn = document.getElementById(DOM_IDS.BTNS.SAVE);
    if (!saveBtn) return;
    const validateBtn = document.getElementById(DOM_IDS.BTNS.VALIDATE_SAVE);

    const name = getValue(DOM_IDS.INPUTS.NAME_FR);
    const cat = getValue(DOM_IDS.INPUTS.CATEGORY);

    let error = null;
    if (!name) error = "Le nom est obligatoire";
    else if (!cat || cat === "A définir") error = "Veuillez sélectionner une catégorie";
    // else if (desc && !source) error = "Source non remplie (obligatoire avec description)"; // Désactivé pour assouplir la validation

    // P7 : même garde-fou pour « Enregistrer » ET « Valider & enregistrer » — on ne
    // peut pas valider (rendre publiable) un candidat sans nom ni catégorie.
    const apply = (btn, okTitle) => {
        if (!btn) return;
        btn.disabled = !!error;
        btn.title = error || okTitle;
        btn.style.opacity = error ? '0.5' : '1';
        btn.style.cursor = error ? 'not-allowed' : 'pointer';
    };
    apply(saveBtn, saveBtn.querySelector('span')?.textContent || "Enregistrer");
    apply(validateBtn, "Valider & enregistrer");
}

// P7 — bascule le footer selon que le POI édité est un candidat Scout (EDIT) :
//   candidat → « Valider & enregistrer » (primaire) + « Enregistrer (garder à curer) »
//             (secondaire, pour sauver un enrichissement partiel sans publier) ;
//   sinon    → « Enregistrer » seul (primaire). Idempotent (rappelé à chaque ouverture).
function updateCandidateFooter(isCand) {
    const saveBtn = document.getElementById(DOM_IDS.BTNS.SAVE);
    const validateBtn = document.getElementById(DOM_IDS.BTNS.VALIDATE_SAVE);
    if (!saveBtn || !validateBtn) return;
    const saveLabel = saveBtn.querySelector('span');
    if (isCand) {
        validateBtn.hidden = false;
        saveBtn.classList.remove('btn-primary');
        saveBtn.classList.add('btn-secondary');
        if (saveLabel) saveLabel.textContent = 'Enregistrer (garder à curer)';
    } else {
        validateBtn.hidden = true;
        saveBtn.classList.remove('btn-secondary');
        saveBtn.classList.add('btn-primary');
        if (saveLabel) saveLabel.textContent = 'Enregistrer';
    }
    updateSaveButtonState(); // resync l'état désactivé des deux boutons
}

// Migration V2 : le titre est passé à openHwModal (plus de DOM_IDS.TITLE).
// prepareModal() ne sert plus qu'au populate du select catégories.
function populateCategorySelect() {
    const catSelect = document.getElementById(DOM_IDS.INPUTS.CATEGORY);
    if (catSelect) {
        catSelect.innerHTML = '<option value="" disabled selected>Choisir une catégorie...</option>';
        POI_CATEGORIES.filter(c => c !== "A définir" && c !== "Autre").forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            catSelect.appendChild(opt);
        });
    }
}

// Peuple les 3 selects taxonomie (Sous-type / État / Accès) selon la catégorie.
// Un select sans valeurs pour la catégorie est masqué ; si aucun des 3 n'a de
// valeurs, le bloc entier disparaît (ex : Restaurant n'a aucun des 3 attributs).
function populateTaxonomySelects(category) {
    const block = document.getElementById('rich-poi-taxonomy');
    if (!block) return;
    const specs = [
        { groupId: 'rich-poi-subtype-group', selId: DOM_IDS.INPUTS.SUBTYPE, values: getSubtypes(category) },
        { groupId: 'rich-poi-state-group',   selId: DOM_IDS.INPUTS.STATE,   values: getStates(category) },
        { groupId: 'rich-poi-access-group',  selId: DOM_IDS.INPUTS.ACCESS,  values: getAccessValues(category) },
    ];
    let anyVisible = false;
    specs.forEach(({ groupId, selId, values }) => {
        const group = document.getElementById(groupId);
        const sel = document.getElementById(selId);
        if (!group || !sel) return;
        const hasValues = values.length > 0;
        group.classList.toggle('is-hidden', !hasValues);
        if (hasValues) anyVisible = true;
        sel.innerHTML = '';
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '—';
        sel.appendChild(blank);
        values.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            sel.appendChild(opt);
        });
    });
    block.classList.toggle('is-hidden', !anyVisible);
}

function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
}

// Toggle « Vérifié » : bouton-switch (pas un <input>, donc hors setValue/getValue
// qui lisent .value). L'état est porté par la classe .is-on + aria-checked.
function setVerified(val) {
    const el = document.getElementById(DOM_IDS.VERIFIED);
    if (!el) return;
    el.classList.toggle('is-on', !!val);
    el.setAttribute('aria-checked', String(!!val));
}

function getVerified() {
    const el = document.getElementById(DOM_IDS.VERIFIED);
    return !!(el && el.classList.contains('is-on'));
}

// P8 — flag « Introuvable sur la carte » (clé interne `introuvableCarte`), même
// mécanique bouton-switch que Vérifié.
function setMapMissing(val) {
    const el = document.getElementById(DOM_IDS.MAP_MISSING);
    if (!el) return;
    el.classList.toggle('is-on', !!val);
    el.setAttribute('aria-checked', String(!!val));
}

function getMapMissing() {
    const el = document.getElementById(DOM_IDS.MAP_MISSING);
    return !!(el && el.classList.contains('is-on'));
}

// Flag « Description publiée » (clé interne `descriptionPublic`), même
// mécanique bouton-switch que Vérifié / Introuvable sur la carte. Défaut OFF :
// une fiche sans ce flag (créée ou déjà existante) n'affiche pas sa description
// aux visiteurs tant que l'admin ne l'a pas explicitement publiée.
function setDescPublic(val) {
    const el = document.getElementById(DOM_IDS.DESC_PUBLIC);
    if (!el) return;
    el.classList.toggle('is-on', !!val);
    el.setAttribute('aria-checked', String(!!val));
}

// ─── Photos de travail (10/08/2026) ──────────────────────────────────────────
// Images dont Stefan n'est PAS l'auteur, pour identifier un lieu pas encore
// visité. Déposées dans un dépôt PRIVÉ (jamais publiées, jamais watermarquées).
//
// À la différence des autres champs, elles s'enregistrent IMMÉDIATEMENT et ne
// passent pas par le bouton « Enregistrer » : l'ajout est un envoi réseau
// asynchrone, l'accrocher au submit synchrone du formulaire l'aurait rendu
// silencieusement faillible.

// ObjectURLs des vignettes, révoqués à chaque re-rendu (sinon fuite mémoire).
let _workThumbUrls = [];

function revokeWorkThumbs() {
    _workThumbUrls.forEach(u => URL.revokeObjectURL(u));
    _workThumbUrls = [];
}

async function renderWorkPhotos(poiId) {
    const wrap = document.getElementById('rich-work-photos');
    const list = document.getElementById('rich-work-list');
    if (!wrap || !list) return;

    // Réservé à l'admin : un visiteur n'a de toute façon jamais ces références
    // (elles vivent dans le Gist privé), mais on ne montre pas le bloc pour autant.
    wrap.hidden = !state.isAdmin;
    if (!state.isAdmin) return;

    revokeWorkThumbs();
    const paths = getWorkPhotosById(poiId);
    list.innerHTML = '';

    const addBtn = document.getElementById('btn-rich-work-add');
    if (addBtn) addBtn.disabled = paths.length >= MAX_WORK_PHOTOS_PER_POI;

    for (const path of paths) {
        const item = document.createElement('div');
        item.className = 'rich-work-item';

        const blob = await loadWorkPhotoBlob(path);
        if (blob) {
            const url = URL.createObjectURL(blob);
            _workThumbUrls.push(url);
            const img = document.createElement('img');
            img.className = 'rich-work-thumb';
            img.src = url;
            img.alt = 'Photo de travail';
            item.appendChild(img);
        } else {
            // Jamais rapatriée sur cet appareil et hors-ligne : on ne masque pas
            // la référence, on dit pourquoi elle n'est pas visible.
            const ph = document.createElement('span');
            ph.className = 'rich-work-thumb rich-work-thumb--missing';
            ph.textContent = 'hors-ligne';
            item.appendChild(ph);
        }

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'rich-work-del';
        del.title = 'Retirer cette photo de travail';
        del.setAttribute('aria-label', 'Retirer cette photo de travail');
        del.innerHTML = '<i data-lucide="x"></i>';
        del.addEventListener('click', () => removeWorkPhoto(poiId, path));
        item.appendChild(del);

        list.appendChild(item);
    }

    createIcons({ icons: appIcons, root: list });
}

async function removeWorkPhoto(poiId, path) {
    const remaining = getWorkPhotosById(poiId).filter(p => p !== path);
    // Seule la référence disparaît : les octets restent dans le dépôt privé
    // (décision 10/08 — un retrait par erreur ne doit pas détruire le travail).
    await updatePoiData(poiId, 'workPhotos', remaining);
    await renderWorkPhotos(poiId);
}

async function addWorkPhoto(poiId, file) {
    const current = getWorkPhotosById(poiId);
    if (current.length >= MAX_WORK_PHOTOS_PER_POI) {
        showToast(`Maximum ${MAX_WORK_PHOTOS_PER_POI} photos de travail par lieu.`, 'warning');
        return;
    }
    const addBtn = document.getElementById('btn-rich-work-add');
    if (addBtn) addBtn.disabled = true;
    try {
        showToast('Envoi de la photo de travail…', 'info', 2000);
        const path = await uploadWorkPhoto(file, poiId);
        await updatePoiData(poiId, 'workPhotos', [...current, path]);
        await renderWorkPhotos(poiId);
        showToast('Photo de travail ajoutée.', 'success');
    } catch (e) {
        console.warn('[WorkPhotos] Ajout échoué:', e.message);
        showToast(`Ajout impossible : ${e.message}`, 'error', 5000);
        if (addBtn) addBtn.disabled = false;
    }
}

function setupWorkPhotoControls() {
    const addBtn = document.getElementById('btn-rich-work-add');
    const fileInput = document.getElementById('rich-work-file');
    if (!addBtn || !fileInput) return;

    addBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = ''; // Permet de re-choisir le même fichier après un échec
        if (!file) return;
        // Mode CREATE : le POI n'a pas encore d'identifiant stable, donc rien à
        // quoi rattacher un envoi. Une photo de travail se pose sur un lieu qui
        // existe déjà — le cas d'usage est d'ailleurs celui d'un lieu à identifier.
        if (!currentFeatureId) {
            showToast("Enregistrez d'abord le lieu, puis ajoutez ses photos de travail.", 'warning', 4000);
            return;
        }
        await addWorkPhoto(currentFeatureId, file);
    });
}

function getDescPublic() {
    const el = document.getElementById(DOM_IDS.DESC_PUBLIC);
    return !!(el && el.classList.contains('is-on'));
}

// Checklist de vérification — même mécanique bouton-switch que Vérifié.
function setOsmChecked(val) {
    const el = document.getElementById(DOM_IDS.OSM_CHECKED);
    if (!el) return;
    el.classList.toggle('is-on', !!val);
    el.setAttribute('aria-checked', String(!!val));
}

function getOsmChecked() {
    const el = document.getElementById(DOM_IDS.OSM_CHECKED);
    return !!(el && el.classList.contains('is-on'));
}

// Affiche la date de dernier check OSM en petit texte à côté du libellé.
// Purement informatif — le format stocké est ISO (YYYY-MM-DD), affiché tel quel.
function setOsmCheckedDateDisplay(dateStr) {
    const el = document.getElementById(DOM_IDS.OSM_CHECKED_DATE);
    if (!el) return;
    el.textContent = dateStr ? ` (${dateStr})` : '';
}

function setMapsChecked(val) {
    const el = document.getElementById(DOM_IDS.MAPS_CHECKED);
    if (!el) return;
    el.classList.toggle('is-on', !!val);
    el.setAttribute('aria-checked', String(!!val));
}

function getMapsChecked() {
    const el = document.getElementById(DOM_IDS.MAPS_CHECKED);
    return !!(el && el.classList.contains('is-on'));
}

function setMapsHasPhoto(val) {
    const el = document.getElementById(DOM_IDS.MAPS_HAS_PHOTO);
    if (!el) return;
    el.classList.toggle('is-on', !!val);
    el.setAttribute('aria-checked', String(!!val));
}

function getMapsHasPhoto() {
    const el = document.getElementById(DOM_IDS.MAPS_HAS_PHOTO);
    return !!(el && el.classList.contains('is-on'));
}

function setJalelChecked(val) {
    const el = document.getElementById(DOM_IDS.JALEL_CHECKED);
    if (!el) return;
    el.classList.toggle('is-on', !!val);
    el.setAttribute('aria-checked', String(!!val));
}

function getJalelChecked() {
    const el = document.getElementById(DOM_IDS.JALEL_CHECKED);
    return !!(el && el.classList.contains('is-on'));
}

// P7 : `validate=true` (bouton « Valider & enregistrer ») retire le flag candidat
// dans la même écriture que l'enrichissement. `false` (« Enregistrer ») le conserve.
async function handleSave(validate = false) {
    const nameFr = getValue(DOM_IDS.INPUTS.NAME_FR);
    if (!nameFr) {
        showToast("Le nom est obligatoire.", "warning");
        return;
    }

    // Checklist de vérification : « trouvé » (ref rempli) vaut « vérifié » sans
    // case séparée à cocher — cf. commentaire HTML. La date ne bouge que sur une
    // vraie transition (passage à vérifié, ou changement de la ref elle-même),
    // jamais sur un enregistrement sans rapport (sinon elle ne dirait plus rien
    // du moment du dernier VRAI check, cf. le but « relancer un re-scout »).
    const osmRefVal = normalizeOsmRef(getValue(DOM_IDS.INPUTS.OSM_REF));
    const mapsRefVal = getValue(DOM_IDS.INPUTS.MAPS_REF).trim();
    const osmCheckedNow = getOsmChecked() || !!osmRefVal;
    const wasOsmCheckedEffective = originalOsmState.checked || !!originalOsmState.ref;
    let osmCheckedDate = originalOsmState.date;
    if (osmCheckedNow && (!wasOsmCheckedEffective || osmRefVal !== originalOsmState.ref)) {
        osmCheckedDate = new Date().toISOString().slice(0, 10);
    } else if (!osmCheckedNow) {
        osmCheckedDate = null;
    }

    const data = {
        'Nom du site FR': nameFr,
        'Nom du site arabe': getValue(DOM_IDS.INPUTS.NAME_AR),
        'Catégorie': getValue(DOM_IDS.INPUTS.CATEGORY),
        'Sous-type': getValue(DOM_IDS.INPUTS.SUBTYPE),
        'État': getValue(DOM_IDS.INPUTS.STATE),
        'Accès': getValue(DOM_IDS.INPUTS.ACCESS),
        // Dégel de Zone : on ne PERSISTE plus la zone (elle se dérive des coordonnées).
        // L'input ZONE reste affiché en lecture seule (rempli par getZoneFromCoords à
        // l'ouverture) à titre informatif, mais n'entre plus dans les données sauvées.
        'info_gpx': getValue(DOM_IDS.INPUTS.DESC_SHORT),
        'description': getValue(DOM_IDS.INPUTS.DESC_LONG),
        'notes': getValue(DOM_IDS.INPUTS.NOTES),
        'Temps_minutes': (parseInt(getValue(DOM_IDS.INPUTS.TIME_H)) || 0) * 60 + (parseInt(getValue(DOM_IDS.INPUTS.TIME_M)) || 0),
        'Prix_TND': parseFloat(getValue(DOM_IDS.INPUTS.PRICE)) || 0,
        'Source': getValue(DOM_IDS.INPUTS.SOURCE),
        // Normalisé en « type/id » : l'admin colle l'URL OSM, on stocke l'identité.
        'osm_ref': osmRefVal,
        // Pas de normalisation possible ici (formats Maps trop variables) : on
        // stocke le lien tel que collé, la garde http(s) s'applique à l'ouverture
        // (mapsPlaceUrl, cf. utils.js).
        'maps_ref': mapsRefVal,
        'Téléphone': getValue(DOM_IDS.INPUTS.PHONE),
        'Horaires': getValue(DOM_IDS.INPUTS.HOURS),
        'Facebook': getValue(DOM_IDS.INPUTS.FACEBOOK),
        'verified': getVerified(),
        'introuvableCarte': getMapMissing(),
        'descriptionPublic': getDescPublic(),
        'osmChecked': osmCheckedNow,
        'osmCheckedDate': osmCheckedDate,
        'mapsChecked': getMapsChecked() || !!mapsRefVal,
        'mapsHasPhoto': getMapsHasPhoto(),
        'jalelChecked': getJalelChecked()
    };

    // P7 — « Valider & enregistrer » : on retire le flag candidat dans la foulée.
    // Folder `candidate:false` dans `data` → persistPoiEdit le route correctement
    // pour custom (properties, false conservé) ET base (overlay userData) ; à la
    // publication admin-geojson retire la clé `=== false` → geojson propre. Une
    // seule écriture, plus de double action « Valider » puis « Enregistrer ».
    if (validate && currentMode === 'EDIT' && currentFeatureId) {
        const feature = state.loadedFeatures.find(f => getPoiId(f) === currentFeatureId);
        if (feature && isCandidate(feature)) data.candidate = false;
    }

    // Prompt for suggestion (Workflow update)
    const isNew = currentMode === 'CREATE';
    const msg = isNew
        ? "Voulez-vous suggérer ce nouveau POI par email à l'administrateur ?"
        : "Voulez-vous suggérer cette modification par email à l'administrateur ?";

    // Dialog "suggérer par email" — ignoré en mode admin (évite aussi le conflit avec le modal CC)
    if (!state.isAdmin && await showConfirm("Suggestion", msg, "Oui, suggérer", "Non, enregistrer seul", false)) {
        handleEmailSuggestion();
    }

    // try/finally : on garantit la fermeture de la modale même si executeEdit
    // ou executeCreate throw (IDB / persistance async). Évite de laisser
    // l'utilisateur coincé sur une modale "fantôme" après une erreur silencieuse.
    try {
        if (currentMode === 'CREATE') {
            await executeCreate(data);
        } else {
            await executeEdit(data, validate);
        }
    } catch (e) {
        console.error('[RichEditor] Échec sauvegarde:', e);
        showToast("Erreur lors de la sauvegarde : " + (e?.message || 'inconnue'), "error", 5000);
    } finally {
        isDirty = false; // Prevent warning on successful close
        RichEditor.close();
    }
}

async function executeCreate(data) {
    const { lat, lng } = currentDraftCoords;
    const newPoiId = `HW-PC-${Date.now()}`;

    const newFeature = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {
            ...data,
            "HW_ID": newPoiId
        }
    };

    // Nettoyage des clés vides pour garder le GeoJSON propre
    Object.keys(newFeature.properties).forEach(key => {
        if (newFeature.properties[key] === "" || newFeature.properties[key] === null) {
            delete newFeature.properties[key];
        }
    });

    addPoiFeature(newFeature);
    // addPoiFeature régénère HW_ID en HW-ULID (29 chars). On lit l'ID
    // définitif depuis le feature muté, pas depuis la variable locale.
    const actualId = newFeature.properties.HW_ID;
    await saveAppState(`lastGeoJSON_${state.currentMapId}`, { type: 'FeatureCollection', features: state.loadedFeatures });

    // Si photos en attente (Import Photo Desktop).
    // L'attachement (addPhotosToPoi) vit dans desktopMode ; on passe par l'event-bus
    // pour éviter le cycle richEditor ↔ desktopMode. `done` est résolu par le listener.
    if (currentPhotos && currentPhotos.length > 0) {
         await new Promise(resolve => {
             eventBus.emit('photos:attach-after-create', {
                 feature: newFeature,
                 photos: currentPhotos,
                 done: resolve
             });
         });
    }

    await logModification(actualId, 'Création (Admin)', 'All', null, `Nouveau lieu : ${data['Nom du site FR']}`);

    // Marque la création réussie : les listeners de `richEditor:closed` (ex: ui-photo-batch
    // qui attend le retour pour retirer le cluster) lisent `currentFeatureId` via le detail.
    currentFeatureId = actualId;

    showToast("POI créé et enregistré localement.", "success");

    // Note privée (10/08/2026) : troisième point d'écriture de `notes` (avec
    // executeEdit ci-dessus et le champ rapide de la fiche, ui-details.js).
    // Fire-and-forget, même motif qu'executeEdit — la copie locale (dans
    // newFeature.properties, cf. poi-persistence.js pour la bascule vers
    // l'overlay userData au prochain edit) est déjà sauve.
    if (state.isAdmin && getStoredToken() && data.notes) {
        savePrivateNote(state.currentMapId, actualId, data.notes).catch(err => {
            console.warn('[PrivateNotes] Envoi heripia-travail échoué (création):', err.message);
        });
    }

    // PR 2/5 chantier point d'accès v2 : pré-pose silencieuse à la création
    // (admin uniquement). Overpass async non bloquant — l'utilisateur a déjà
    // vu son POI créé ; le drapeau (orange/on-track/failed) se matérialise
    // dans la seconde qui suit. Échec → toast warning + status='failed'.
    if (state.isAdmin) {
        void schedulePrepoSe(newFeature);
    }
}

// Pré-pose Overpass à la création (silencieuse, fire-and-forget). On laisse
// executeCreate se résoudre tout de suite ; ce helper s'exécute en arrière
// plan et toast UNIQUEMENT en cas d'échec.
async function schedulePrepoSe(feature) {
    try {
        const { prepoSeAccessPoint } = await import('./access-point.js');
        const result = await prepoSeAccessPoint(feature);
        if (result.status === 'failed') {
            showToast("Drapeau d'accès à poser plus tard (OSM injoignable).", 'warning', 4000);
        }
        // 'osm' / 'on-track' = silencieux par design (cf. brief Design).
    } catch (e) {
        // Faute grave (ex : feature invalide) — log mais ne casse pas la création.
        console.error('[richEditor] Pré-pose accessPoint échouée:', e);
    }
}

async function executeEdit(data, validated = false) {
    const poiId = currentFeatureId;

    // Position déplacée pendant l'édition (« Déplacer » → currentDraftCoords) : on la
    // persiste AVANT les champs, via le MÊME helper canonique que le drag carte
    // (updatePoiCoordinates : userData.lat/lng pour un POI de base — rejoué au boot —,
    // customPois pour un custom). Avant ce fix, executeEdit ne lisait JAMAIS
    // currentDraftCoords → la position revenait à l'original au « Enregistrer » (perte
    // de donnée silencieuse). En tête pour que le lastGeoJSON sauvé par persistPoiEdit
    // (branche custom) capture la nouvelle géométrie. En mode EDIT, currentDraftCoords
    // est null sauf déplacement confirmé (openForEdit le réinitialise).
    if (currentDraftCoords) {
        await updatePoiCoordinates(poiId, currentDraftCoords.lat, currentDraftCoords.lng);
    }

    // Persistance custom-vs-base (overlay userData pour un POI de base, properties +
    // customPois_{id} pour un POI custom) déléguée au helper feuille partagé avec
    // ui-photo-batch.saveTaxonomyBatch — anti-dérive entre les 2 éditeurs. Détail de
    // la règle (et du revert de curation qu'elle évite) : voir poi-persistence.js.
    await persistPoiEdit(poiId, data);

    // Sync Gist des champs personnels restants (vu, incontournable…) —
    // persistPoiEdit ne fait QUE la persistance (cf. son en-tête), le push
    // Gist reste la responsabilité de l'appelant. Avant ce fix (01/08/2026),
    // ce call manquait ici : une modif écrite via le Rich Editor s'enregistrait
    // bien en local mais ne partait JAMAIS vers le Gist — l'autre éditeur de
    // POI (ui-photo-batch.saveTaxonomyBatch) l'appelle déjà après son propre
    // persistPoiEdit, ce qui a permis de repérer l'absence ici.
    schedulePush();

    // Note privée (10/08/2026) : ne voyage plus par le Gist (cf. gist-sync.js
    // SYNC_KEYS) — poussée séparément vers heripia-travail. C'est le DEUXIÈME
    // point d'écriture de `notes` (le premier est le champ rapide de la fiche,
    // ui-details.js setupNoteEditToggle) : les deux doivent synchroniser vers
    // le même dépôt, sinon une note modifiée ici resterait locale sans le
    // savoir. Fire-and-forget : un échec réseau n'est jamais une perte de
    // donnée, `persistPoiEdit` ci-dessus a déjà sauvé la copie locale.
    if (getStoredToken()) {
        savePrivateNote(state.currentMapId, poiId, data.notes).catch(err => {
            console.warn('[PrivateNotes] Envoi heripia-travail échoué (Rich Editor):', err.message);
        });
    }

    // Si c'est un POI "pending" (création mobile en attente), on finalise la persistance
    // du GeoJSON maintenant que l'utilisateur a rempli la fiche via le Rich Editor.
    await commitPendingPoiIfNeeded(poiId);

    // Log adapté selon admin ou non
    const logType = state.isAdmin ? 'Edition (Admin)' : 'Edition (User)';
    await logModification(poiId, logType, 'All', null, `Mise à jour via Rich Editor`);

    if (state.isAdmin) {
        // [ADMIN] Tracking : signale au CC que ce POI a été modifié.
        // Avant ce fix, executeEdit n'appelait pas addToDraft, donc le CC
        // ne découvrait les modifs via RichEditor que lors du prochain
        // openControlCenter (reconcileLocalChanges), jamais proactivement.
        // On passe par le bus pour éviter un import circulaire
        // (richEditor ← admin-control-center ← richEditor).
        eventBus.emit('admin:poi-edited', { id: poiId, type: 'update' });
        showToast(validated
            ? "Lieu validé et enregistré — sort de la file « à curer », devient publiable."
            : "Modification enregistrée localement.", "success", validated ? 3500 : undefined);
    }

    // Force le rafraîchissement des marqueurs Leaflet avec la nouvelle catégorie
    // On importe data.js, puis on force l'application des filtres qui va émettre 'data:filtered'
    // ce qui redessinera complètement les points sur la carte
    const { applyFilters } = await import('./data.js');
    applyFilters();

    // De plus, on s'assure que refreshMapMarkers est appelé avec les features filtrées
    const { getFilteredFeatures } = await import('./data.js');
    const { refreshMapMarkers } = await import('./map.js');
    refreshMapMarkers(getFilteredFeatures());

    // Force le rafraîchissement de l'interface si le panneau est ouvert
    if (state.currentFeatureId !== null) {
        const feature = state.loadedFeatures[state.currentFeatureId];
        if (getPoiId(feature) === poiId) {
            openDetailsPanel(state.currentFeatureId, state.currentCircuitIndex);
        }
    }
}

function handleEmailSuggestion() {
    const data = {
        'Nom du site FR': getValue(DOM_IDS.INPUTS.NAME_FR),
        'Nom du site arabe': getValue(DOM_IDS.INPUTS.NAME_AR),
        'Catégorie': getValue(DOM_IDS.INPUTS.CATEGORY),
        'Sous-type': getValue(DOM_IDS.INPUTS.SUBTYPE),
        'État': getValue(DOM_IDS.INPUTS.STATE),
        'Accès': getValue(DOM_IDS.INPUTS.ACCESS),
        'Zone': getValue(DOM_IDS.INPUTS.ZONE),
        'info_gpx': getValue(DOM_IDS.INPUTS.DESC_SHORT),
        'description': getValue(DOM_IDS.INPUTS.DESC_LONG),
        'notes': getValue(DOM_IDS.INPUTS.NOTES),
        'Temps_minutes': (parseInt(getValue(DOM_IDS.INPUTS.TIME_H)) || 0) * 60 + (parseInt(getValue(DOM_IDS.INPUTS.TIME_M)) || 0),
        'Prix_TND': parseFloat(getValue(DOM_IDS.INPUTS.PRICE)) || 0,
        'Source': getValue(DOM_IDS.INPUTS.SOURCE),
        // Normalisé en « type/id » : l'admin colle l'URL OSM, on stocke l'identité.
        'osm_ref': normalizeOsmRef(getValue(DOM_IDS.INPUTS.OSM_REF)),
        'maps_ref': getValue(DOM_IDS.INPUTS.MAPS_REF).trim(),
        'Téléphone': getValue(DOM_IDS.INPUTS.PHONE),
        'Horaires': getValue(DOM_IDS.INPUTS.HOURS),
        'Facebook': getValue(DOM_IDS.INPUTS.FACEBOOK),
        'verified': getVerified(),
        'introuvableCarte': getMapMissing(),
        'descriptionPublic': getDescPublic(),
        'osmChecked': getOsmChecked() || !!getValue(DOM_IDS.INPUTS.OSM_REF).trim(),
        'mapsChecked': getMapsChecked() || !!getValue(DOM_IDS.INPUTS.MAPS_REF).trim(),
        'mapsHasPhoto': getMapsHasPhoto(),
        'jalelChecked': getJalelChecked()
    };

    const mapName = state.currentMapId ? (state.currentMapId.charAt(0).toUpperCase() + state.currentMapId.slice(1)) : 'Inconnue';
    const poiName = data['Nom du site FR'] || 'Lieu';

    const subject = encodeURIComponent(`Heripia - Modification [${mapName}] : ${poiName}`);

    const bodyText = `Bonjour,\n\nVoici une suggestion de modification pour le lieu "${poiName}" sur la carte ${mapName}.\n\nDonnées JSON :\n${JSON.stringify(data, null, 2)}\n\nCordialement,`;
    const body = encodeURIComponent(bodyText);

    const mailtoLink = `mailto:history.walk.007@gmail.com?subject=${subject}&body=${body}`;

    window.open(mailtoLink, '_blank');
}
