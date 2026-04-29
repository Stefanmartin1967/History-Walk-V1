
import L from 'leaflet';
import { map, startMarkerDrag } from './map.js';
import { state, POI_CATEGORIES } from './state.js';
import { getPoiId, commitPendingPoiIfNeeded } from './data.js';
import { eventBus } from './events.js';
import { getZoneFromCoords } from './utils.js';
import { addPoiFeature } from './data.js';
import { saveAppState, savePoiData } from './database.js';
import { logModification } from './logger.js';
import { showToast } from './toast.js';
import { openDetailsPanel, closeDetailsPanel } from './ui-details.js';
import { showConfirm, openHwModal, closeHwModal } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';

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
        SOURCE: 'rich-poi-source'
    },
    BTNS: {
        SAVE: 'btn-save-rich-poi',
        CANCEL: 'btn-cancel-rich-poi',
        CLOSE: 'close-rich-poi-modal',
        EMAIL: 'btn-suggest-email',
        PREV: 'btn-rich-prev',
        NEXT: 'btn-rich-next',
        MOVE: 'btn-rich-move-marker'
    },
    NAV_CONTROLS: 'rich-poi-nav-controls'
};

let currentMode = 'CREATE'; // 'CREATE' | 'EDIT'
let currentFeatureId = null; // Pour le mode EDIT
let currentDraftCoords = null; // Pour le mode CREATE
let currentPhotos = []; // Pour le mode CREATE (import photos)
let isDirty = false;

// HTML du formulaire (body de la modale V2). IDs préservés à l'identique
// pour que toute la logique métier (setValue/getValue/handleSave/executeCreate
// /executeEdit) reste fonctionnelle sans modification. Le wrapper
// `.rich-poi-form` scope les règles CSS (input-group en colonne, padding
// inputs, etc.) qui étaient préfixées `#rich-poi-modal` avant la migration.
const RICH_POI_BODY_HTML = `
<div class="rich-poi-form">
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
    </div>

    <!-- Source & Notes -->
    <div class="input-group">
        <label for="rich-poi-source">Source (URL ou Texte)</label>
        <input type="text" id="rich-poi-source" class="editable-input" placeholder="https://...">
    </div>
    <div class="input-group">
        <label for="rich-poi-notes">Notes</label>
        <textarea id="rich-poi-notes" class="editable-input" rows="2"></textarea>
    </div>

    <!-- GPS footer : déplacer + coords -->
    <div class="rich-poi-gps-footer">
        <button id="btn-rich-move-marker" class="hw-btn hw-btn-ghost" title="Déplacer le marqueur" aria-label="Déplacer le marqueur" type="button">
            <i data-lucide="move"></i><span>Déplacer</span>
        </button>
        <span>📍 GPS : <span id="rich-poi-coords">...</span></span>
    </div>
</div>
`;

// Subheader : nav controls (prev/next dans circuit). Caché en mode CREATE
// ou si le POI courant n'est pas dans un circuit affiché.
const RICH_POI_SUBHEADER_HTML = `
    <div id="rich-poi-nav-controls" class="rich-poi-nav-controls is-hidden">
        <button id="btn-rich-prev" class="hw-btn hw-btn-ghost" title="Précédent" aria-label="Précédent" type="button"><i data-lucide="chevron-left"></i></button>
        <button id="btn-rich-next" class="hw-btn hw-btn-ghost" title="Suivant" aria-label="Suivant" type="button"><i data-lucide="chevron-right"></i></button>
    </div>
`;

// Footer : Annuler (ghost) + Enregistrer (primary, désactivable via updateSaveButtonState)
const RICH_POI_FOOTER_HTML = `
    <button id="btn-cancel-rich-poi" class="hw-btn hw-btn-ghost" type="button">Annuler</button>
    <button id="btn-save-rich-poi" class="hw-btn hw-btn-primary" type="button">
        <i data-lucide="save"></i><span>Enregistrer</span>
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

        setValue(DOM_IDS.INPUTS.DESC_SHORT, "");
        setValue(DOM_IDS.INPUTS.DESC_LONG, "");
        setValue(DOM_IDS.INPUTS.NOTES, "");
        setValue(DOM_IDS.INPUTS.TIME_H, "");
        setValue(DOM_IDS.INPUTS.TIME_M, "");
        setValue(DOM_IDS.INPUTS.PRICE, "");
        setValue(DOM_IDS.INPUTS.SOURCE, "");

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
    openForEdit: (poiId) => {
        // Recherche du feature
        const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
        if (!feature) {
            showToast("Erreur : POI introuvable.", "error");
            return;
        }

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

        // Recalculate Zone and Lock
        let zoneVal = merged['Zone'] || "";
        if (feature.geometry && feature.geometry.coordinates) {
             const [lng, lat] = feature.geometry.coordinates;
             zoneVal = getZoneFromCoords(lat, lng);
        }
        setValue(DOM_IDS.INPUTS.ZONE, zoneVal);
        const zoneInput = document.getElementById(DOM_IDS.INPUTS.ZONE);
        if (zoneInput) zoneInput.disabled = true;

        setValue(DOM_IDS.INPUTS.DESC_SHORT, merged['Description_courte'] || merged.Desc_wpt || "");
        setValue(DOM_IDS.INPUTS.DESC_LONG, merged['description'] || merged.Description || "");
        setValue(DOM_IDS.INPUTS.NOTES, merged['notes'] || "");

        // Temps
        let h = merged.timeH;
        let m = merged.timeM;
        if (h === undefined && merged['Temps de visite']) {
             const parts = merged['Temps de visite'].split(':');
             h = parts[0]; m = parts[1];
        }
        setValue(DOM_IDS.INPUTS.TIME_H, h !== undefined ? h : "");
        setValue(DOM_IDS.INPUTS.TIME_M, m !== undefined ? m : "");

        // Prix
        const price = merged.price !== undefined ? merged.price : merged['Prix d\'entrée'];
        setValue(DOM_IDS.INPUTS.PRICE, price !== undefined ? price : "");

        setValue(DOM_IDS.INPUTS.SOURCE, merged.Source || "");

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
        closeHwModal();
        window.dispatchEvent(new CustomEvent('richEditor:closed', {
            detail: { poiId: currentFeatureId, mode: currentMode, created: wasCreated }
        }));
    }
};

// Listener eventBus au module-load (pas besoin de DOM pour cet écouteur — init()
// reste lazy pour les écouteurs DOM). Permet aux modules externes de déclencher
// l'ouverture sans import direct de RichEditor (casse admin-control-center → richEditor).
eventBus.on('richEditor:open-for-edit', (id) => RichEditor.openForEdit(id));

// --- PRIVATE HELPERS ---

async function handleMove() {
    // Migration V2 : on hide l'overlay actif au lieu de toggle .is-hidden sur
    // la modale statique. La modale reste dans le DOM (et tous les setValue
    // ne sont pas perdus), elle est juste invisible le temps du drag.
    const modal = document.querySelector('.hw-modal-overlay.is-active');
    if (modal) modal.style.display = 'none';

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
                if (modal) modal.style.display = '';
            }
        );

        if (!success && modal) modal.style.display = '';

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
            if (modal) modal.style.display = '';
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

    // Sauvegarde
    document.getElementById(DOM_IDS.BTNS.SAVE)?.addEventListener('click', handleSave);

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

    // Migration V2 : crée la modale via openHwModal. Le titre + l'icône sont
    // passés en options (au lieu de l'h2 statique). Le close (croix/Escape)
    // déclenche directement la fermeture sans confirm — pour conserver le
    // contrôle isDirty, on laisse le bouton "Annuler" gérer ça via close().
    const isCreate = currentMode === 'CREATE';
    openHwModal({
        size: 'lg',
        icon: isCreate ? 'map-pin-plus' : 'edit-3',
        title: isCreate ? 'Nouveau Lieu' : 'Éditer le Lieu',
        subheader: RICH_POI_SUBHEADER_HTML,
        body: RICH_POI_BODY_HTML,
        footer: RICH_POI_FOOTER_HTML,
        // closeOnBackdrop: true par défaut — formulaire long, on évite la perte
        closeOnBackdrop: false,
    });

    // DOM prêt après openHwModal (synchrone). Bind + remplissage.
    bindModalEvents();
    populateCategorySelect();
    createIcons({ icons: appIcons });
}

function updateSaveButtonState() {
    const saveBtn = document.getElementById(DOM_IDS.BTNS.SAVE);
    if (!saveBtn) return;

    const name = getValue(DOM_IDS.INPUTS.NAME_FR);
    const cat = getValue(DOM_IDS.INPUTS.CATEGORY);
    const desc = getValue(DOM_IDS.INPUTS.DESC_LONG);
    const source = getValue(DOM_IDS.INPUTS.SOURCE);

    let error = null;
    if (!name) error = "Le nom est obligatoire";
    else if (!cat || cat === "A définir") error = "Veuillez sélectionner une catégorie";
    // else if (desc && !source) error = "Source non remplie (obligatoire avec description)"; // Désactivé pour assouplir la validation

    if (error) {
        saveBtn.disabled = true;
        saveBtn.title = error;
        saveBtn.style.opacity = '0.5';
        saveBtn.style.cursor = 'not-allowed';
    } else {
        saveBtn.disabled = false;
        saveBtn.title = "Enregistrer";
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
    }
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

function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
}

async function handleSave() {
    const nameFr = getValue(DOM_IDS.INPUTS.NAME_FR);
    if (!nameFr) {
        showToast("Le nom est obligatoire.", "warning");
        return;
    }

    const data = {
        'Nom du site FR': nameFr,
        'Nom du site arabe': getValue(DOM_IDS.INPUTS.NAME_AR),
        'Catégorie': getValue(DOM_IDS.INPUTS.CATEGORY),
        'Zone': getValue(DOM_IDS.INPUTS.ZONE),
        'Description_courte': getValue(DOM_IDS.INPUTS.DESC_SHORT),
        'description': getValue(DOM_IDS.INPUTS.DESC_LONG),
        'notes': getValue(DOM_IDS.INPUTS.NOTES),
        'timeH': parseInt(getValue(DOM_IDS.INPUTS.TIME_H)) || 0,
        'timeM': parseInt(getValue(DOM_IDS.INPUTS.TIME_M)) || 0,
        'price': parseFloat(getValue(DOM_IDS.INPUTS.PRICE)) || 0,
        'Source': getValue(DOM_IDS.INPUTS.SOURCE)
    };

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
            await executeEdit(data);
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
            "HW_ID": newPoiId,
            "Description": "Ajouté via Rich Editor"
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
    await saveAppState('lastGeoJSON', { type: 'FeatureCollection', features: state.loadedFeatures });

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
}

async function executeEdit(data) {
    const poiId = currentFeatureId;

    // En mode Édition, on sauvegarde dans userData pour ne pas toucher au GeoJSON original trop violemment
    // (Mais si c'est pour l'Admin, l'idée est que ça devienne "la vérité".
    // Comme l'app merge userData sur properties à l'affichage, c'est OK.)

    // On met à jour state.userData[poiId] champ par champ
    if (!state.userData[poiId]) state.userData[poiId] = {};

    Object.assign(state.userData[poiId], data);

    // Rebind feature.properties.userData au cas où une opération antérieure
    // (ex: recalculatePlannedCountersForMap) aurait cassé la référence entre
    // state.userData[poiId] et feature.properties.userData en créant un spread
    // au lieu d'un alias. Sans ça, la modification est persistée mais le panel
    // Détails continue de lire l'ancienne copie → description pas visible
    // avant F5.
    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    if (feature) {
        feature.properties.userData = state.userData[poiId];
    }

    await savePoiData(state.currentMapId, poiId, state.userData[poiId]);

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
        showToast("Modification enregistrée localement.", "success");
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
        'Zone': getValue(DOM_IDS.INPUTS.ZONE),
        'Description_courte': getValue(DOM_IDS.INPUTS.DESC_SHORT),
        'description': getValue(DOM_IDS.INPUTS.DESC_LONG),
        'notes': getValue(DOM_IDS.INPUTS.NOTES),
        'timeH': parseInt(getValue(DOM_IDS.INPUTS.TIME_H)) || 0,
        'timeM': parseInt(getValue(DOM_IDS.INPUTS.TIME_M)) || 0,
        'price': parseFloat(getValue(DOM_IDS.INPUTS.PRICE)) || 0,
        'Source': getValue(DOM_IDS.INPUTS.SOURCE)
    };

    const mapName = state.currentMapId ? (state.currentMapId.charAt(0).toUpperCase() + state.currentMapId.slice(1)) : 'Inconnue';
    const poiName = data['Nom du site FR'] || 'Lieu';

    const subject = encodeURIComponent(`History Walk - Modification [${mapName}] : ${poiName}`);

    const bodyText = `Bonjour,\n\nVoici une suggestion de modification pour le lieu "${poiName}" sur la carte ${mapName}.\n\nDonnées JSON :\n${JSON.stringify(data, null, 2)}\n\nCordialement,`;
    const body = encodeURIComponent(bodyText);

    const mailtoLink = `mailto:history.walk.007@gmail.com?subject=${subject}&body=${body}`;

    window.open(mailtoLink, '_blank');
}
