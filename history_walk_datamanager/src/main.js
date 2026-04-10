// src/main.js
import './style.css';
import { createIcons, icons } from 'lucide';
import { parseGps } from './utils.js';
import { initMap, renderMarkers, focusFeature, startEditMarker, stopEditMarker, moveEditMarker, flyToLocation } from './map.js';

import {
    initStorage, loadGeoJSON, getGeoJSONForExport,
    undo, redo, runMaintenance, getUniqueValues,
    saveFeature, getFeatureByIndex, detectZone,
    getAllFeatures
} from './storage.js';

import { publishToGitHub } from './github-sync.js';

import { initTable, renderTableRows } from './table.js'
// UI
const btnLoad = document.getElementById('btn-load');
const btnSave = document.getElementById('btn-save');
const btnPublish = document.getElementById('btn-publish');
const btnAdd = document.getElementById('btn-add'); // NOUVEAU BOUTON
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnMaintenance = document.getElementById('btn-maintenance');
const statusBarText = document.getElementById('status-text');
const statusBarIcon = document.querySelector('.status-bar i');

// PANNEAU D'ÉDITION
const tableView = document.getElementById('table-view');
const editPanel = document.getElementById('edit-panel');
const btnBack = document.getElementById('btn-back');
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
    const statusBar = document.getElementById('status-bar');
    statusBar.className = 'status-bar' + (type === 'draft' ? ' status-draft' : '');
    statusBarText.style.color = type === 'error' ? 'var(--danger)' : type === 'draft' ? 'var(--warn)' : 'var(--ink)';
    createIcons({ icons });
}

// --- INITIALISATION ---
initMap('map-container');

initStorage(
    (features) => { renderTableRows(features); renderMarkers(features); },
    (type, msg) => updateStatus(type, msg)
);
initTable();

// Chargement automatique du GeoJSON au démarrage
(async () => {
    const ok = await loadGeoJSON(false);
    if (ok) {
        btnSave.disabled = false;
        btnAdd.disabled = false;
        btnPublish.disabled = false;
    }
})();

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
    if (feature) openModal(feature, index);
});

// 3. Clic sur une ligne → focus carte
document.addEventListener('request:preview', (e) => {
    const index = e.detail.index;
    const feature = getFeatureByIndex(index);
    if (feature) focusFeature(feature, index);
});

function openModal(feature = null, index = null) {
    currentEditIndex = index;
    form.reset();
    populateDatalists();

    if (feature) {
        modalTitle.textContent = "Modifier le lieu";
        const p = feature.properties;

        form.nom.value = p['Nom du site FR'] || '';
        form.gps.value = p['Coordonnées GPS'] || '';
        form.categorie.value = p['Catégorie'] || '';
        form.zone.value = p['Zone'] || '';
        form.description.value = p['Description'] || '';
        form.source.value = p['Source'] || '';
        form.descWpt.value = p['Desc_wpt'] || '';
        form.nomArabe.value = p['Nom du site arabe'] || '';
        form.temps.value = p['Temps de visite'] || '';
        form.prix.value = p["Prix d'entrée"] || '';
        form.verified.checked = !!p['verified'];

        // Marqueur draggable sur la carte
        const coords = feature.geometry?.coordinates;
        if (coords?.length >= 2) {
            startEditMarker(coords[1], coords[0], (lat, lng) => {
                form.gps.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                const zone = detectZone(lat, lng);
                if (zone) form.zone.value = zone;
            });
        }
    } else {
        modalTitle.textContent = "Ajouter un lieu";
    }

    tableView.classList.add('hidden');
    editPanel.classList.remove('hidden');
    setTimeout(() => form.nom.focus(), 100);
}

function closeModal() {
    editPanel.classList.add('hidden');
    tableView.classList.remove('hidden');
    currentEditIndex = null;
    stopEditMarker();
}

btnBack.addEventListener('click', closeModal);

// AUTO-ZONE + mise à jour marqueur lors de la saisie GPS
form.gps.addEventListener('blur', () => {
    const coords = parseGps(form.gps.value);
    if (coords) {
        form.gps.value = `${coords.lat}, ${coords.lon}`;
        // Déplace le marqueur si on a tapé des coords manuellement
        moveEditMarker(coords.lat, coords.lon);
        if (form.zone.value === '') {
            const detected = detectZone(coords.lat, coords.lon);
            if (detected) {
                form.zone.value = detected;
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
        prix: form.prix.value,
        verified: form.verified.checked
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
// Recharger depuis le serveur (bypass brouillon)
btnLoad.addEventListener('click', async () => {
    if (!confirm("Recharger depuis le serveur ? Le brouillon local sera perdu.")) return;
    btnLoad.disabled = true;
    await loadGeoJSON(true);
    btnLoad.disabled = false;
    btnSave.disabled = false;
    btnAdd.disabled = false;
    btnPublish.disabled = false;
});

function showTokenModal() {
    return new Promise((resolve) => {
        const overlay = document.getElementById('token-modal-overlay');
        const input = document.getElementById('token-modal-input');
        const btnConfirm = document.getElementById('token-modal-confirm');
        const btnCancel = document.getElementById('token-modal-cancel');

        input.value = '';
        overlay.classList.remove('hidden');
        setTimeout(() => input.focus(), 50);

        function close(token) {
            overlay.classList.add('hidden');
            btnConfirm.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', onCancel);
            resolve(token);
        }

        function onConfirm() {
            const token = input.value.trim();
            if (!token) { input.focus(); return; }
            localStorage.setItem('github_pat', token);
            close(token);
        }

        function onCancel() { close(null); }

        btnConfirm.addEventListener('click', onConfirm);
        btnCancel.addEventListener('click', onCancel);
    });
}

btnPublish.addEventListener('click', async () => {
    const data = getGeoJSONForExport();
    if (!data) return;

    if (!localStorage.getItem('github_pat')) {
        const token = await showTokenModal();
        if (!token) { updateStatus('error', "Publication annulée : pas de token."); return; }
    }

    btnPublish.disabled = true;
    await publishToGitHub(data, (type, msg) => updateStatus(type, msg));
    btnPublish.disabled = false;
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

// --- GÉOCODEUR NOMINATIM ---
const geocoderInput = document.getElementById('geocoder-input');
const geocoderClear = document.getElementById('geocoder-clear');
const geocoderResults = document.getElementById('geocoder-results');
let geocoderTimer = null;

geocoderInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    geocoderClear.classList.toggle('hidden', !query);
    clearTimeout(geocoderTimer);
    if (query.length < 3) { geocoderResults.classList.add('hidden'); return; }
    geocoderTimer = setTimeout(() => searchPlace(query), 400);
});

geocoderClear.addEventListener('click', () => {
    geocoderInput.value = '';
    geocoderClear.classList.add('hidden');
    geocoderResults.classList.add('hidden');
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('#geocoder-bar')) geocoderResults.classList.add('hidden');
});

async function searchPlace(query) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=20&countrycodes=tn&viewbox=10.5,34.2,11.4,33.4&bounded=1`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
        const results = await res.json();

        geocoderResults.innerHTML = '';
        if (!results.length) {
            geocoderResults.innerHTML = '<div class="geocoder-no-result">Aucun résultat</div>';
            geocoderResults.classList.remove('hidden');
            return;
        }

        results.forEach(r => {
            const item = document.createElement('div');
            item.className = 'geocoder-result-item';
            // Affiche uniquement les 2 premiers segments du nom (plus lisible)
            const parts = r.display_name.split(', ');
            item.textContent = parts.slice(0, 2).join(', ');
            item.title = r.display_name;

            item.addEventListener('click', () => {
                const lat = parseFloat(r.lat);
                const lng = parseFloat(r.lon);

                // Si le formulaire d'édition est ouvert, pré-remplir les champs
                if (!editPanel.classList.contains('hidden')) {
                    form.gps.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                    startEditMarker(lat, lng, (newLat, newLng) => {
                        form.gps.value = `${newLat.toFixed(6)}, ${newLng.toFixed(6)}`;
                        if (!form.zone.value) {
                            const z = detectZone(newLat, newLng);
                            if (z) form.zone.value = z;
                        }
                    });
                    if (!form.zone.value) {
                        const z = detectZone(lat, lng);
                        if (z) form.zone.value = z;
                    }
                }

                flyToLocation(lat, lng);
                geocoderResults.classList.add('hidden');
                geocoderInput.value = parts[0];
            });

            geocoderResults.appendChild(item);
        });

        geocoderResults.classList.remove('hidden');
    } catch (e) {
        console.error('Geocoder error:', e);
    }
}