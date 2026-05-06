// src/main.js
import './style.css';
import { createIcons, icons } from 'lucide';
import { parseGps } from './utils.js';
import { initMap, renderMarkers, focusFeature, startEditMarker, stopEditMarker, moveEditMarker, flyToLocation } from './map.js';

import {
    initStorage, loadGeoJSON, getGeoJSONForExport,
    undo, redo, runMaintenance, getUniqueValues,
    saveFeature, getFeatureByIndex, detectZone,
    getAllFeatures, getPoiCategories
} from './storage.js';

import { publishToGitHub } from './github-sync.js';

import { initTable, renderTableRows, setFilter, refreshToolbarDropdowns, getAdvancedFilterCounts } from './table.js'
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

// Inputs Datalists / Selects
const selCategorie = document.getElementById('categorie-select');
const dlZones = document.getElementById('list-zones');

// État édition
let currentEditIndex = null;

// --- STATUS ---
// Le thème est désormais hérité de HW (cf. <script> bootstrap dans index.html
// qui lit localStorage 'hw_theme'). Plus de switcher dédié dans le DM.

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
    (features) => {
        renderTableRows(features);
        renderMarkers(features);
        refreshToolbarDropdowns();
        refreshAdvancedCounts();
    },
    (type, msg) => updateStatus(type, msg)
);
initTable();
initFilterToolbar();

// Bandeau cross-app : si HW a un brouillon admin non publié, on alerte
// (même origin = localStorage partagé en prod, en dev les ports diffèrent
// donc le bandeau ne se déclenche qu'en prod).
function maybeShowCrossAppWarn() {
    const warn = document.getElementById('cross-app-warn');
    if (!warn) return;
    if (localStorage.getItem('hw_has_unpublished_changes') === '1') {
        warn.classList.remove('hidden');
    }
}
maybeShowCrossAppWarn();

document.getElementById('btn-goto-hw')?.addEventListener('click', () => {
    const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const url = isDev ? 'http://localhost:5173/History-Walk-V1/' : '/History-Walk-V1/';
    window.open(url, '_blank');
});
document.getElementById('btn-dismiss-warn')?.addEventListener('click', () => {
    document.getElementById('cross-app-warn')?.classList.add('hidden');
});

// Mise à jour live si HW publie pendant que le DM est ouvert (storage event
// déclenché par les autres tabs même origin).
window.addEventListener('storage', (e) => {
    if (e.key === 'hw_has_unpublished_changes') {
        const warn = document.getElementById('cross-app-warn');
        if (!warn) return;
        if (e.newValue === '1') warn.classList.remove('hidden');
        else warn.classList.add('hidden');
    }
});

// --- TOOLBAR DE FILTRES (PR C chantier DM v2) ---
const ADVANCED_KEYS = ['noDesc', 'noPhoto', 'notVerified'];
function initFilterToolbar() {
    const inputSearch = document.getElementById('filter-search');
    const clearSearch = document.getElementById('filter-search-clear');
    const selCat = document.getElementById('filter-categorie');
    const selZone = document.getElementById('filter-zone');
    const btnAdvanced = document.getElementById('btn-advanced-filters');
    const panelAdvanced = document.getElementById('advanced-filters-panel');
    const btnResetAll = document.getElementById('btn-reset-filters');

    inputSearch.addEventListener('input', (e) => {
        setFilter('nom', e.target.value);
        clearSearch.classList.toggle('hidden', !e.target.value);
        refreshResetVisibility();
    });
    clearSearch.addEventListener('click', () => {
        inputSearch.value = '';
        setFilter('nom', '');
        clearSearch.classList.add('hidden');
        refreshResetVisibility();
    });

    selCat.addEventListener('change', (e) => {
        setFilter('categorie', e.target.value);
        refreshResetVisibility();
    });
    selZone.addEventListener('change', (e) => {
        setFilter('zone', e.target.value);
        refreshResetVisibility();
    });

    btnAdvanced.addEventListener('click', () => {
        const open = panelAdvanced.classList.toggle('hidden');
        btnAdvanced.classList.toggle('is-active', !open);
    });

    // Délégation : un seul listener sur le panneau, plus robuste qu'un forEach
    // qui attache 3 listeners individuels (qui ne s'attachaient pas en preview).
    panelAdvanced.addEventListener('change', (e) => {
        if (!e.target.matches('input[type="checkbox"]')) return;
        const id = e.target.id;
        const key = id === 'filter-no-desc' ? 'noDesc'
                  : id === 'filter-no-photo' ? 'noPhoto'
                  : id === 'filter-not-verified' ? 'notVerified'
                  : null;
        if (!key) return;
        setFilter(key, e.target.checked);
        refreshAdvancedBadge();
        refreshResetVisibility();
    });

    btnResetAll.addEventListener('click', () => {
        inputSearch.value = '';
        clearSearch.classList.add('hidden');
        setFilter('nom', '');
        selCat.value = ''; setFilter('categorie', '');
        selZone.value = ''; setFilter('zone', '');
        ADVANCED_KEYS.forEach(key => {
            const checkboxId = `filter-${key === 'noDesc' ? 'no-desc' : key === 'noPhoto' ? 'no-photo' : 'not-verified'}`;
            const cb = document.getElementById(checkboxId);
            if (cb) cb.checked = false;
            setFilter(key, false);
        });
        refreshAdvancedBadge();
        refreshResetVisibility();
    });
}

function countActiveAdvanced() {
    let n = 0;
    ADVANCED_KEYS.forEach(key => {
        const checkboxId = `filter-${key === 'noDesc' ? 'no-desc' : key === 'noPhoto' ? 'no-photo' : 'not-verified'}`;
        if (document.getElementById(checkboxId)?.checked) n++;
    });
    return n;
}
function refreshAdvancedBadge() {
    const badge = document.getElementById('advanced-filters-badge');
    const n = countActiveAdvanced();
    if (n > 0) { badge.textContent = String(n); badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
}
function refreshResetVisibility() {
    const inputSearch = document.getElementById('filter-search');
    const selCat = document.getElementById('filter-categorie');
    const selZone = document.getElementById('filter-zone');
    const anyActive = !!inputSearch.value || !!selCat.value || !!selZone.value || countActiveAdvanced() > 0;
    document.getElementById('btn-reset-filters').classList.toggle('hidden', !anyActive);
}
function refreshAdvancedCounts() {
    const counts = getAdvancedFilterCounts();
    document.getElementById('count-no-desc').textContent = String(counts.noDesc);
    document.getElementById('count-no-photo').textContent = String(counts.noPhoto);
    document.getElementById('count-not-verified').textContent = String(counts.notVerified);
}

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
    const currentCategorie = feature?.properties?.['Catégorie'] || '';
    populateDatalists(currentCategorie);

    const photosRow = document.getElementById('photos-readonly-row');
    const photosCount = document.getElementById('photos-count-display');
    photosRow.style.display = 'none';

    if (feature) {
        modalTitle.textContent = "Modifier le lieu";
        const p = feature.properties;

        form.nom.value = p['Nom du site FR'] || '';
        // Source canonique = geometry.coordinates (GeoJSON standard).
        // Les champs textuels Coordonnées GPS/Latitude/Longitude ont été
        // retirés du data (cleanup script 06/05/2026).
        const c = feature.geometry?.coordinates;
        form.gps.value = (c?.length >= 2) ? `${c[1]}, ${c[0]}` : '';
        form.categorie.value = p['Catégorie'] || '';
        form.zone.value = p['Zone'] || '';
        form.description.value = p['Description'] || '';
        form.source.value = p['Source'] || '';
        form.descCourte.value = p['Description_courte'] || '';
        form.nomArabe.value = p['Nom du site arabe'] || '';
        // Temps_minutes (number) → décomposé en h + min pour le form
        const totalMin = Number.isFinite(p['Temps_minutes']) ? p['Temps_minutes'] : null;
        form.tempsH.value = totalMin != null ? Math.floor(totalMin / 60) : '';
        form.tempsM.value = totalMin != null ? totalMin % 60 : '';
        form.prixTND.value = Number.isFinite(p['Prix_TND']) ? p['Prix_TND'] : '';
        form.telephone.value = p['Téléphone'] || p['telephone'] || '';
        form.horaires.value = p['Horaires'] || p['horaires'] || '';
        form.verified.checked = !!p['verified'];

        if (Array.isArray(p.photos) && p.photos.length > 0) {
            const n = p.photos.length;
            photosCount.textContent = `${n} photo${n > 1 ? 's' : ''}`;
            photosRow.style.display = '';
        }

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

    // Master-detail : tableau toujours visible, on bascule juste l'état du
    // panneau central (empty placeholder ↔ form).
    document.getElementById('edit-panel-empty')?.classList.add('hidden');
    document.getElementById('edit-panel-content')?.classList.remove('hidden');
    setTimeout(() => form.nom.focus(), 100);
}

function closeModal() {
    document.getElementById('edit-panel-content')?.classList.add('hidden');
    document.getElementById('edit-panel-empty')?.classList.remove('hidden');
    document.querySelectorAll('#data-table tbody tr').forEach(r => r.classList.remove('row-active'));
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
    // Temps : combiner h + min en minutes (number) ; null si tout vide
    const tH = parseInt(form.tempsH.value, 10);
    const tM = parseInt(form.tempsM.value, 10);
    const hasTime = !isNaN(tH) || !isNaN(tM);
    const tempsMinutes = hasTime ? (isNaN(tH) ? 0 : tH) * 60 + (isNaN(tM) ? 0 : tM) : null;

    // Prix : float ; null si vide
    const prixRaw = form.prixTND.value;
    const prixTND = prixRaw === '' ? null : parseFloat(prixRaw);

    const formData = {
        nom: form.nom.value,
        gps: form.gps.value,
        categorie: form.categorie.value,
        zone: form.zone.value,
        descCourte: form.descCourte.value,
        description: form.description.value,
        source: form.source.value,
        nomArabe: form.nomArabe.value,
        tempsMinutes,
        prixTND: Number.isFinite(prixTND) ? prixTND : null,
        telephone: form.telephone.value,
        horaires: form.horaires.value,
        verified: form.verified.checked
    };

    const success = saveFeature(formData, currentEditIndex);
    if (success) closeModal();
});

function populateDatalists(currentCategorie = '') {
    // Categories : <select> peuplé depuis poi-categories.json (source unique HW/DM)
    // Si la valeur actuelle du POI n'est pas dans la liste officielle, on l'ajoute
    // dynamiquement avec un suffixe pour la signaler (cas rétro-compat / typo legacy).
    const cats = getPoiCategories();
    const officielle = cats.includes(currentCategorie);
    selCategorie.innerHTML = '<option value="">— Choisir —</option>';
    cats.forEach(c => {
        const op = document.createElement('option');
        op.value = c;
        op.textContent = c;
        selCategorie.appendChild(op);
    });
    if (currentCategorie && !officielle) {
        const op = document.createElement('option');
        op.value = currentCategorie;
        op.textContent = `${currentCategorie} (non standard)`;
        op.dataset.nonStandard = 'true';
        selCategorie.appendChild(op);
    }

    // Zones : datalist libre (chantier zones reste hors scope DM)
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

                // Si on est en train d'éditer un POI (panneau content visible),
                // pré-remplir les champs
                if (!document.getElementById('edit-panel-content').classList.contains('hidden')) {
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