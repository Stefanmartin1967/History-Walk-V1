
import { state, POI_CATEGORIES } from './state.js';
import { getPoiId } from './data.js';
import { getZoneFromCoords } from './utils.js';
import { addPoiFeature } from './data.js';
import { saveAppState, savePoiData } from './database.js';
import { logModification } from './logger.js';
import { showToast } from './toast.js';
import { openDetailsPanel, closeDetailsPanel } from './ui.js';
import { showConfirm } from './modal.js';
import { createIcons, icons } from 'lucide';

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
        NEXT: 'btn-rich-next'
    },
    NAV_CONTROLS: 'rich-poi-nav-controls'
};

let currentMode = 'CREATE'; // 'CREATE' | 'EDIT'
let currentFeatureId = null; // Pour le mode EDIT
let currentDraftCoords = null; // Pour le mode CREATE
let currentPhotos = []; // Pour le mode CREATE (import photos)
let isDirty = false;

export const RichEditor = {
    /**
     * Initialise les écouteurs d'événements (à appeler une fois au démarrage si besoin,
     * ou on le fait à l'ouverture pour être sûr que le DOM existe)
     */
    init: () => {
        const modal = document.getElementById(DOM_IDS.MODAL);
        if (!modal) return;

        // Fermeture
        document.getElementById(DOM_IDS.BTNS.CLOSE)?.addEventListener('click', () => RichEditor.close());

        // Navigation
        document.getElementById(DOM_IDS.BTNS.PREV)?.addEventListener('click', () => navigate(-1));
        document.getElementById(DOM_IDS.BTNS.NEXT)?.addEventListener('click', () => navigate(1));

        // Hide explicit Cancel and Suggest buttons (New workflow)
        const btnCancel = document.getElementById(DOM_IDS.BTNS.CANCEL);
        if (btnCancel) btnCancel.style.display = 'none';

        const btnSuggest = document.getElementById(DOM_IDS.BTNS.EMAIL);
        if (btnSuggest) btnSuggest.style.display = 'none';

        // Sauvegarde
        const saveBtn = document.getElementById(DOM_IDS.BTNS.SAVE);
        // On clone pour éviter les multiples listeners si init est appelé plusieurs fois
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        newSaveBtn.addEventListener('click', handleSave);

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

        // Dirty tracking for other fields
        Object.values(DOM_IDS.INPUTS).forEach(id => {
            if (!fieldsToCheck.includes(id)) {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('input', () => { isDirty = true; });
                }
            }
        });
    },

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

        prepareModal("Nouveau Lieu");

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
        if (navControls) navControls.style.display = 'none';

        showModal();
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

        prepareModal("Éditer le Lieu");

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
        showModal();
    },

    close: async () => {
        if (isDirty) {
            if (!await showConfirm("Modifications non enregistrées", "Voulez-vous fermer sans enregistrer ?", "Fermer sans sauver", "Annuler", true)) {
                return;
            }
        }
        const modal = document.getElementById(DOM_IDS.MODAL);
        if (modal) modal.style.display = 'none';
        isDirty = false;
    }
};

// --- PRIVATE HELPERS ---

function updateNavigationControls(currentPoiId) {
    const navControls = document.getElementById(DOM_IDS.NAV_CONTROLS);
    const prevBtn = document.getElementById(DOM_IDS.BTNS.PREV);
    const nextBtn = document.getElementById(DOM_IDS.BTNS.NEXT);

    if (!navControls) return;

    // Check if we are in a circuit context
    if (!state.currentCircuit || state.currentCircuit.length === 0) {
        navControls.style.display = 'none';
        return;
    }

    // Find index in current circuit
    const index = state.currentCircuit.findIndex(f => getPoiId(f) === currentPoiId);

    if (index === -1) {
        navControls.style.display = 'none';
        return;
    }

    // Show controls
    navControls.style.display = 'flex';

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

function showModal() {
    isDirty = false; // Reset on open
    updateSaveButtonState();
    const modal = document.getElementById(DOM_IDS.MODAL);
    if (modal) {
        modal.style.display = 'flex';
        // Focus premier champ
        const firstInput = document.getElementById(DOM_IDS.INPUTS.NAME_FR);
        if (firstInput) firstInput.focus();
    }
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

function prepareModal(title) {
    const titleEl = document.getElementById(DOM_IDS.TITLE);
    if (titleEl) titleEl.textContent = title;

    // Remplir le select Catégories (Toujours reconstruire pour être à jour)
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

    // showConfirm returns true if primary button clicked
    if (await showConfirm("Suggestion", msg, "Oui, suggérer", "Non, enregistrer seul", false)) {
        handleEmailSuggestion();
    }

    if (currentMode === 'CREATE') {
        await executeCreate(data);
    } else {
        await executeEdit(data);
    }

    isDirty = false; // Prevent warning on successful close
    RichEditor.close();
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
    await saveAppState('lastGeoJSON', { type: 'FeatureCollection', features: state.loadedFeatures });

    // Si photos en attente (Import Photo Desktop)
    if (currentPhotos && currentPhotos.length > 0) {
         // Import dynamique pour éviter les dépendances circulaires
         const { addPhotosToPoi } = await import('./desktopMode.js');
         await addPhotosToPoi(newFeature, currentPhotos);
    }

    await logModification(newPoiId, 'Création (Admin)', 'All', null, `Nouveau lieu : ${data['Nom du site FR']}`);
}

async function executeEdit(data) {
    const poiId = currentFeatureId;

    // En mode Édition, on sauvegarde dans userData pour ne pas toucher au GeoJSON original trop violemment
    // (Mais si c'est pour l'Admin, l'idée est que ça devienne "la vérité".
    // Comme l'app merge userData sur properties à l'affichage, c'est OK.)

    // On met à jour state.userData[poiId] champ par champ
    if (!state.userData[poiId]) state.userData[poiId] = {};

    Object.assign(state.userData[poiId], data);

    await savePoiData(state.currentMapId, poiId, state.userData[poiId]);

    // Log adapté selon admin ou non
    const logType = state.isAdmin ? 'Edition (Admin)' : 'Edition (User)';
    await logModification(poiId, logType, 'All', null, `Mise à jour via Rich Editor`);

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
