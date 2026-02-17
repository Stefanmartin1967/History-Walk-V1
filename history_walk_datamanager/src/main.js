// src/main.js
import './style.css';
import { createIcons, icons } from 'lucide';

// --- CORRECTION ICI : On importe parseGps depuis utils.js ---
import { parseGps } from './utils.js'; 

import { 
    initStorage, loadGeoJSON, getGeoJSONForExport, 
    undo, redo, runMaintenance, getUniqueValues, 
    saveFeature, getFeatureByIndex, detectZone
    // (J'ai retiré parseGps de cette liste ci-dessus)
} from './storage.js';

import { initTable, renderTableRows } from './table.js'
// UI
const btnLoad = document.getElementById('btn-load');
const btnSave = document.getElementById('btn-save');
const btnAdd = document.getElementById('btn-add'); // NOUVEAU BOUTON
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnMaintenance = document.getElementById('btn-maintenance');
const statusBarText = document.getElementById('status-text');
const statusBarIcon = document.querySelector('.status-bar i');

// MODAL
const modal = document.getElementById('modal-form');
const modalOverlay = document.getElementById('modal-overlay');
const btnCloseModal = document.getElementById('btn-close-modal');
const form = document.getElementById('feature-form');
const modalTitle = document.getElementById('modal-title');

// Inputs Datalists
const dlCategories = document.getElementById('list-categories');
const dlZones = document.getElementById('list-zones');

// État édition
let currentEditIndex = null;

// --- STATUS & THEME ---
// (Même code que précédemment pour le thème, je l'abrège ici pour la lisibilité)
const themeBtn = document.getElementById('theme-btn');
const themeMenu = document.getElementById('theme-menu');
themeBtn.addEventListener('click', (e) => { e.stopPropagation(); themeMenu.classList.toggle('hidden'); });
document.addEventListener('click', (e) => { if(!themeBtn.contains(e.target)) themeMenu.classList.add('hidden'); });
document.querySelectorAll('.theme-option').forEach(o => o.addEventListener('click', () => {
    document.documentElement.setAttribute('data-theme', o.dataset.value);
}));

function updateStatus(type, msg) {
    statusBarText.textContent = msg;
    statusBarText.style.color = type === 'error' ? 'var(--danger)' : 'var(--ink)';
    createIcons({ icons });
}

// --- INITIALISATION ---
initStorage(
    (features) => renderTableRows(features),
    (type, msg) => updateStatus(type, msg)
);
initTable();

document.addEventListener('table:rendered', () => createIcons({ icons }));
document.addEventListener('status:update', (e) => updateStatus(e.detail.type, e.detail.msg));

// --- MODALE LOGIC ---

// 1. Ouvrir pour AJOUTER
btnAdd.addEventListener('click', () => {
    openModal();
});

// 2. Ouvrir pour ÉDITER (via event depuis table.js)
document.addEventListener('request:edit', (e) => {
    const index = e.detail.index;
    const feature = getFeatureByIndex(index);
    if(feature) openModal(feature, index);
});

function openModal(feature = null, index = null) {
    currentEditIndex = index;
    form.reset();
    populateDatalists(); // Rafraichir les suggestions

    if (feature) {
        modalTitle.textContent = "Modifier le lieu";
        const p = feature.properties;
        
        // Remplissage form
        form.nom.value = p['Nom du site FR'] || '';
        form.gps.value = p['Coordonnées GPS'] || '';
        form.categorie.value = p['Catégorie'] || '';
        form.zone.value = p['Zone'] || '';
        form.description.value = p['Description'] || '';
        form.source.value = p['Source'] || '';
        
        // Champs cachés/détails
        form.descWpt.value = p['Desc_wpt'] || '';
        form.nomArabe.value = p['Nom du site arabe'] || '';
        form.temps.value = p['Temps de visite'] || '';
        
        // --- CORRECTION ICI (Guillemets doubles autour de la clé) ---
        form.prix.value = p["Prix d'entrée"] || '';
        // -----------------------------------------------------------
        
    } else {
        modalTitle.textContent = "Ajouter un lieu";
    }

    modalOverlay.classList.remove('hidden');
    // Focus sur le nom
    setTimeout(() => form.nom.focus(), 100);
}

function closeModal() {
    modalOverlay.classList.add('hidden');
    currentEditIndex = null;
}

btnCloseModal.addEventListener('click', closeModal);

// 3. AUTO-ZONE lors de la saisie GPS
form.gps.addEventListener('blur', () => {
    const val = form.gps.value;
    const coords = parseGps(val);
    if (coords) {
        // Auto-formatage visuel propre
        form.gps.value = `${coords.lat}, ${coords.lon}`;
        
        // Détection Zone si champ vide ou si on veut forcer
        if (form.zone.value === '') {
            const detected = detectZone(coords.lat, coords.lon);
            if (detected) {
                form.zone.value = detected;
                // Petit effet visuel pour montrer que ça a changé ? (Optionnel)
                form.zone.style.backgroundColor = 'var(--brand-soft)';
                setTimeout(() => form.zone.style.backgroundColor = '', 500);
            }
        }
    }
});

// 4. Soumission Formulaire
form.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = {
        nom: form.nom.value,
        gps: form.gps.value,
        categorie: form.categorie.value,
        zone: form.zone.value,
        descWpt: form.descWpt.value,
        description: form.description.value,
        source: form.source.value,
        nomArabe: form.nomArabe.value,
        temps: form.temps.value,
        prix: form.prix.value
    };

    const success = saveFeature(formData, currentEditIndex);
    if (success) closeModal();
});

function populateDatalists() {
    // Categories
    const cats = getUniqueValues('Catégorie');
    dlCategories.innerHTML = '';
    cats.forEach(c => {
        const op = document.createElement('option');
        op.value = c;
        dlCategories.appendChild(op);
    });

    // Zones
    const zones = getUniqueValues('Zone');
    dlZones.innerHTML = '';
    zones.forEach(z => {
        const op = document.createElement('option');
        op.value = z;
        dlZones.appendChild(op);
    });
}

// --- BUTTONS LISTENERS ---
btnLoad.addEventListener('click', async () => {
    btnLoad.disabled = true;
    await loadGeoJSON(false);
    btnLoad.disabled = false;
    btnSave.disabled = false;
    btnAdd.disabled = false;
});

btnSave.addEventListener('click', () => {
    const data = getGeoJSONForExport();
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = "djerba_updated.geojson";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
});

btnUndo.addEventListener('click', () => { undo(); });
btnRedo.addEventListener('click', () => { redo(); });
btnMaintenance.addEventListener('click', runMaintenance);

// Init icons
createIcons({ icons });