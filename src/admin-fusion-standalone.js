import { getAppState, saveAppState, savePoiData, getAllPoiDataForMap } from './database.js';
import { uploadFileToGitHub, getStoredToken } from './github-sync.js';
import { getPoiId, getPoiName, escapeHtml } from './utils.js';

const DOM = {
    loading: document.getElementById('loading-state'),
    empty: document.getElementById('empty-state'),
    dashboard: document.getElementById('dashboard'),
    listNew: document.getElementById('list-new'),
    listGps: document.getElementById('list-gps'),
    listContent: document.getElementById('list-content'),
    listDel: document.getElementById('list-del'),
    btnFusion: document.getElementById('btn-fusion'),
    toast: document.getElementById('toast-container')
};

let originalData = null;
let localUserData = {};
let localCustomFeatures = [];
let localHiddenPoiIds = [];

// Récupérer la carte courante (sauvegardée avant l'ouverture de l'onglet, par défaut djerba)
let currentMapId = localStorage.getItem('hw_admin_fusion_map') || 'djerba';

let pendingChanges = { newPois: [], gpsUpdates: [], contentUpdates: [], deletes: [] };

function showToastMsg(msg, type = "info") {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    DOM.toast.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

async function init() {
    try {
        // 1. Charger les données locales depuis IndexedDB
        if (window.indexedDBMockData) {
            localUserData = window.indexedDBMockData['userData'] || {};
            localCustomFeatures = window.indexedDBMockData[`customPois_${currentMapId}`] || [];
            localHiddenPoiIds = window.indexedDBMockData[`hiddenPois_${currentMapId}`] || [];
        } else {
            const appStateUserData = await getAppState('userData') || {};
            const mapUserData = await getAllPoiDataForMap(currentMapId) || {};
            localUserData = { ...appStateUserData, ...mapUserData };

            localCustomFeatures = (await getAppState(`customPois_${currentMapId}`)) || [];
            localHiddenPoiIds = (await getAppState(`hiddenPois_${currentMapId}`)) || [];
        }

        // 2. Charger les données distantes (GeoJSON officiel)
        const url = `https://raw.githubusercontent.com/Stefanmartin1967/History-Walk-V1/main/public/${currentMapId}.geojson?t=${Date.now()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("Impossible de télécharger le fichier source depuis GitHub.");

        originalData = await response.json();

        analyzeData();
    } catch (e) {
        console.error(e);
        DOM.loading.innerHTML = `<i data-lucide="alert-triangle" style="width:48px;height:48px;color:var(--danger);"></i><br><br>Erreur: ${e.message}`;
        lucide.createIcons();
    }
}

function analyzeData() {
    const origFeatures = originalData.features || [];
    const origMap = new Map();
    origFeatures.forEach(f => {
        const id = getPoiId(f);
        if (id) origMap.set(id, f);
    });

    pendingChanges = { newPois: [], gpsUpdates: [], contentUpdates: [], deletes: [] };

    // --- A. ANALYSE DES SUPPRESSIONS ---
    // Les suppressions peuvent venir de hiddenPoiIds OU de userData._deleted
    const deletedIds = new Set(localHiddenPoiIds);
    Object.keys(localUserData).forEach(id => {
        if (localUserData[id] && localUserData[id]._deleted) deletedIds.add(id);
    });

    deletedIds.forEach(id => {
        const origFeat = origMap.get(id);
        if (origFeat) {
            pendingChanges.deletes.push({
                id: id,
                name: getPoiName(origFeat) || 'Lieu inconnu',
                feature: origFeat
            });
        }
    });

    // --- B. ANALYSE DES NOUVEAUX LIEUX ---
    localCustomFeatures.forEach(localFeat => {
        const id = getPoiId(localFeat);
        if (!id || deletedIds.has(id)) return; // Ignore if deleted right after creation

        if (!origMap.has(id)) {
            pendingChanges.newPois.push({
                id: id,
                name: getPoiName(localFeat) || 'Nouveau Lieu',
                feature: localFeat
            });
        }
    });

    // --- C. ANALYSE DES MODIFICATIONS (GPS & Content) ---
    origFeatures.forEach(origFeat => {
        const id = getPoiId(origFeat);
        if (!id || deletedIds.has(id)) return;

        const uData = localUserData[id] || {};

        // C1. GPS Check
        if (uData.lat !== undefined && uData.lng !== undefined) {
            const oCoords = origFeat.geometry.coordinates;
            const nLat = parseFloat(uData.lat);
            const nLng = parseFloat(uData.lng);

            if (oCoords[1].toFixed(5) !== nLat.toFixed(5) || oCoords[0].toFixed(5) !== nLng.toFixed(5)) {
                pendingChanges.gpsUpdates.push({
                    id: id,
                    name: getPoiName(origFeat),
                    oldCoords: [oCoords[1], oCoords[0]], // [lat, lng]
                    newCoords: [nLat, nLng]
                });
            }
        }

        // C2. Content Check
        const ignoredKeys = ['visited', 'vu', 'planifie', 'planifieCounter', 'lat', 'lng', '_deleted'];
        const contentChanges = [];
        let updatedName = getPoiName(origFeat); // Default to original name

        const DATA_DICTIONARY = {
            'description': 'Description',
            'Description_courte': 'Desc_wpt',
            'notes': 'Notes_internes',
            'price': "Prix d'entrée",
            'timeH': 'Temps de visite',
            'timeM': 'Temps de visite',
            'Catégorie': 'Catégorie'
        };

        const processedTime = { timeH: false, timeM: false };

        Object.keys(uData).forEach(key => {
            if (ignoredKeys.includes(key)) return;

            // Déterminer la clé cible officielle
            let targetKey = key;
            if (DATA_DICTIONARY[key]) {
                targetKey = DATA_DICTIONARY[key];
            }

            let oldVal = origFeat.properties[targetKey];

            // Si la propriété officielle n'existe pas sous le nom mappé, mais existe sous le nom exact
            if (oldVal === undefined && origFeat.properties[key] !== undefined) {
                oldVal = origFeat.properties[key];
                targetKey = key;
                }

            let newVal = uData[key];

            // Traitements spécifiques (Prix, Temps)
            if (key === 'price' && newVal !== undefined && newVal !== 0 && newVal !== "") {
                newVal = newVal + ' TND';
            } else if (key === 'timeH' || key === 'timeM') {
                if (processedTime[key]) return; // Déjà traité

                const h = uData.timeH || 0;
                const m = uData.timeM || 0;

                // Si le temps n'a pas été défini ou est 0, on l'ignore sauf si on veut explicitement l'effacer
                if (h === 0 && m === 0) return;

                newVal = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
                targetKey = 'Temps de visite';
                oldVal = origFeat.properties['Temps de visite'];

                processedTime.timeH = true;
                processedTime.timeM = true;
            }

            // Comparaison des chaînes pour éviter les faux positifs
            if (String(oldVal) !== String(newVal) && !(oldVal === undefined && (newVal === "" || newVal === "00:00" || newVal === "0 TND"))) {
                let displayKey = targetKey;
                if (key === 'timeH' || key === 'timeM') displayKey = 'Temps de visite';

                // Éviter d'ajouter des lignes en double si timeH/timeM ont été traités ensemble
                if (contentChanges.some(c => c.targetKey === targetKey && c.sourceKey === key)) return;
                // Éviter d'ajouter 2 fois Temps de visite
                if ((key === 'timeH' || key === 'timeM') && contentChanges.some(c => c.targetKey === 'Temps de visite')) return;

                contentChanges.push({
                    sourceKey: key, // Clé dans uData
                    targetKey: targetKey, // Clé officielle à modifier
                    displayKey: displayKey,
                    old: oldVal !== undefined ? oldVal : '—',
                    new: newVal
                });

                // Si le nom a été modifié, le refléter dans l'UI
                if (key === 'Nom du site FR' || key === 'Nom du site arabe' || key === 'Nom du site AR') {
                    if (key === 'Nom du site FR') updatedName = newVal;
                }
            }
            });

        if (contentChanges.length > 0) {
            pendingChanges.contentUpdates.push({
                id: id,
                name: updatedName,
                changes: contentChanges
            });
        }
    });

    renderDashboard();
}

function renderDashboard() {
    DOM.loading.style.display = 'none';

    const { newPois, gpsUpdates, contentUpdates, deletes } = pendingChanges;
    const total = newPois.length + gpsUpdates.length + contentUpdates.length + deletes.length;

    if (total === 0) {
        DOM.empty.style.display = 'block';
        return;
    }

    DOM.dashboard.style.display = 'block';

    // Helpers
    const renderSection = (container, title, badgeClass, data, renderItemFn) => {
        if (data.length === 0) { container.innerHTML = ''; return; }
        let html = `<div class="group-title">${title} <span class="badge ${badgeClass}">${data.length}</span></div>`;
        html += data.map((item, idx) => `
            <div class="change-item" id="item-${item.id}">
                <div class="checkbox-wrapper"><input type="checkbox" checked id="chk-${badgeClass}-${idx}" data-id="${item.id}" data-type="${badgeClass}"></div>
                <div class="change-content">
                    <div class="poi-name" style="display:flex; justify-content:space-between; align-items:center;">
                        <span>${escapeHtml(item.name)}</span>
                        ${badgeClass === 'badge-del' ?
                            `<button class="btn-restore" data-action="restore" data-id="${item.id}"><i data-lucide="rotate-ccw" style="width:12px;height:12px;"></i> Restaurer localement</button>`
                            : badgeClass !== 'badge-del' ?
                            `<button class="btn-edit-poi" data-id="${item.id}" data-type="${badgeClass}" title="Éditer avec l'éditeur riche" aria-label="Éditer avec l'éditeur riche"><i data-lucide="edit-3" style="width:14px;height:14px;"></i> Éditer / Vérifier</button>`
                            : ''}
                    </div>
                    ${renderItemFn(item, idx)}
                </div>
            </div>
        `).join('');
        container.innerHTML = html;
    };

    // 1. Nouveaux
    renderSection(DOM.listNew, 'Nouveaux Lieux à Créer', 'badge-new', newPois, (item, idx) => `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
            <div>
                <label style="font-size:11px; color:var(--ink-light); font-weight:600;">Nom FR</label>
                <input type="text" class="new-poi-input" id="name-new-${idx}" value="${escapeHtml(item.name)}">
            </div>
            <div>
                <label style="font-size:11px; color:var(--ink-light); font-weight:600;">Nom AR (Optionnel)</label>
                <input type="text" class="new-poi-input" id="name-ar-new-${idx}" placeholder="الاسم بالعربية" dir="rtl">
            </div>
        </div>
    `);

    // 2. GPS
    renderSection(DOM.listGps, 'Corrections GPS', 'badge-gps', gpsUpdates, (item) => `
        <div class="change-detail">
            <span class="old-val">[${item.oldCoords[0].toFixed(5)}, ${item.oldCoords[1].toFixed(5)}]</span>
            <span class="arrow">➜</span>
            <span class="new-val">[${item.newCoords[0].toFixed(5)}, ${item.newCoords[1].toFixed(5)}]</span>
        </div>
    `);

    // 3. Contenu
    renderSection(DOM.listContent, 'Mises à jour Contenu', 'badge-content', contentUpdates, (item) => {
        return item.changes.map(c => `
            <div class="change-detail">
                <span class="badge badge-content" style="min-width:60px; text-align:center;">${escapeHtml(c.displayKey)}</span>
                <span class="old-val">${escapeHtml(String(c.old))}</span>
                <span class="arrow">➜</span>
                <span class="new-val">${escapeHtml(String(c.new))}</span>
            </div>
        `).join('');
    });

    // 4. Suppressions
    renderSection(DOM.listDel, 'Suppressions Demandées', 'badge-del', deletes, (item) => `
        <div class="change-detail" style="background:#FEF2F2; color:#991B1B;">
            ⚠️ Ce lieu sera définitivement supprimé de la carte officielle.
        </div>
    `);

    lucide.createIcons();
    attachEditorListeners();
}

// Global Editor Interactivity
function attachEditorListeners() {
    const editBtns = document.querySelectorAll('.btn-edit-poi');
    editBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const poiId = e.currentTarget.dataset.id;
            openEditorForPoi(poiId);
        });
    });

    const restoreBtns = document.querySelectorAll('.btn-restore');
    restoreBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const poiId = e.currentTarget.dataset.id;
            if (e.currentTarget.dataset.action === 'restore') {
                restorePoi(poiId);
            }
        });
    });

    const closeBtn = document.getElementById('close-rich-poi-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeEditor);

    const cancelBtn = document.getElementById('btn-cancel-rich-poi');
    if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);

    const saveBtn = document.getElementById('btn-save-rich-poi');
    if (saveBtn) saveBtn.addEventListener('click', saveEditorChanges);
}

let editingPoiId = null;

function openEditorForPoi(poiId) {
    editingPoiId = poiId;
    const modal = document.getElementById('rich-poi-modal');
    const title = document.getElementById('rich-poi-modal-title');

    // Find the original feature and apply current local user data
    const origFeat = originalData.features.find(f => getPoiId(f) === poiId);
    let featToEdit = null;

    if (origFeat) {
        // Mode Edition of existing POI
        featToEdit = JSON.parse(JSON.stringify(origFeat)); // Deep copy
        const uData = localUserData[poiId] || {};
        Object.assign(featToEdit.properties, uData);
        title.textContent = `Éditer le Lieu : ${featToEdit.properties['Nom du site FR'] || poiId}`;
    } else {
        // Mode Creation (New POI from customFeatures)
        const updateInfo = pendingChanges.newPois.find(u => u.id === poiId);
        if (updateInfo) {
             featToEdit = JSON.parse(JSON.stringify(updateInfo.feature));
             title.textContent = `Nouveau Lieu : ${featToEdit.properties['Nom du site FR'] || 'Nouveau'}`;
        }
    }

    if (!featToEdit) return;

    // Fill Categories
    const catSelect = document.getElementById('rich-poi-category');
    const categories = [
        "A définir", "Café", "Commerce", "Culture et tradition",
        "Curiosité", "Hôtel", "Mosquée", "Pâtisserie", "Photo", "Puits",
        "Restaurant", "Salon de thé", "Site historique", "Site religieux", "Taxi"
    ].sort();

    catSelect.innerHTML = '<option value="" disabled selected>Choisir une catégorie...</option>';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        catSelect.appendChild(opt);
    });

    const props = featToEdit.properties;

    // Set Values
    document.getElementById('rich-poi-name-fr').value = props['Nom du site FR'] || '';
    document.getElementById('rich-poi-name-ar').value = props['Nom du site AR'] || props['Nom du site arabe'] || '';
    document.getElementById('rich-poi-category').value = props['Catégorie'] || '';
    document.getElementById('rich-poi-zone').value = props['Zone'] || '';
    document.getElementById('rich-poi-desc-short').value = props['Description_courte'] || '';
    document.getElementById('rich-poi-desc-long').value = props['description'] || props['Description'] || '';
    document.getElementById('rich-poi-time-h').value = props['timeH'] || '';
    document.getElementById('rich-poi-time-m').value = props['timeM'] || '';
    document.getElementById('rich-poi-price').value = props['price'] || '';
    document.getElementById('rich-poi-source').value = props['Source'] || '';
    document.getElementById('rich-poi-notes').value = props['notes'] || '';

    // GPS Info
    let coordsText = '...';
    if (featToEdit.geometry && featToEdit.geometry.coordinates) {
        coordsText = `${featToEdit.geometry.coordinates[1].toFixed(5)}, ${featToEdit.geometry.coordinates[0].toFixed(5)}`;
    }
    document.getElementById('rich-poi-coords').textContent = coordsText;

    // Show modal
    modal.style.display = 'flex';
}

function closeEditor() {
    const modal = document.getElementById('rich-poi-modal');
    modal.style.display = 'none';
    editingPoiId = null;
}

async function saveEditorChanges() {
    if (!editingPoiId) return;

    const data = {
        'Nom du site FR': document.getElementById('rich-poi-name-fr').value,
        'Nom du site arabe': document.getElementById('rich-poi-name-ar').value,
        'Catégorie': document.getElementById('rich-poi-category').value,
        'Zone': document.getElementById('rich-poi-zone').value,
        'Description_courte': document.getElementById('rich-poi-desc-short').value,
        'description': document.getElementById('rich-poi-desc-long').value,
        'timeH': parseInt(document.getElementById('rich-poi-time-h').value) || 0,
        'timeM': parseInt(document.getElementById('rich-poi-time-m').value) || 0,
        'price': parseFloat(document.getElementById('rich-poi-price').value) || 0,
        'Source': document.getElementById('rich-poi-source').value,
        'notes': document.getElementById('rich-poi-notes').value
    };

    // Nettoyage des champs vides pour ne pas surcharger la base
    Object.keys(data).forEach(k => {
        if (data[k] === '' || data[k] === null || data[k] === 0) {
            if (k !== 'price' && k !== 'timeH' && k !== 'timeM') { // Garde explicitement les valeurs numériques 0 si modifiées (bien qu'ici 0 soit fallback)
               delete data[k];
            }
        }
    });

    // Enregistrement dans la base locale
    if (!localUserData[editingPoiId]) localUserData[editingPoiId] = {};
    Object.assign(localUserData[editingPoiId], data);

    // Si c'est un point local (customFeature), on met aussi à jour le JSON local complet
    const isNew = pendingChanges.newPois.some(u => u.id === editingPoiId);
    if (isNew) {
        const updateInfo = pendingChanges.newPois.find(u => u.id === editingPoiId);
        Object.assign(updateInfo.feature.properties, data);

        // update customFeatures IDB
        let customFeatures = (await getAppState(`customPois_${currentMapId}`)) || [];
        const index = customFeatures.findIndex(f => getPoiId(f) === editingPoiId);
        if (index > -1) {
            Object.assign(customFeatures[index].properties, data);
            await saveAppState(`customPois_${currentMapId}`, customFeatures);
        }
    }

    // Save userData IDB
    await savePoiData(currentMapId, editingPoiId, localUserData[editingPoiId]);

    closeEditor();

    // Rafraîchir l'analyse complète
    showToastMsg("Lieu mis à jour localement. Rechargement des modifications...", "info");
    analyzeData();
}

// Global Restore Function
async function restorePoi(poiId) {
    // 1. Remove from hiddenPoiIds
    if (localHiddenPoiIds.includes(poiId)) {
        localHiddenPoiIds = localHiddenPoiIds.filter(id => id !== poiId);
        await saveAppState(`hiddenPois_${currentMapId}`, localHiddenPoiIds);
    }

    // 2. Remove _deleted flag from userData
    if (localUserData[poiId] && localUserData[poiId]._deleted) {
        localUserData[poiId]._deleted = false; // or delete localUserData[poiId]._deleted;
        await savePoiData(currentMapId, poiId, localUserData[poiId]);
    }

    showToastMsg(`Lieu restauré. Il ne sera pas supprimé.`, "success");

    // 3. Hide visually
    const el = document.getElementById(`item-${poiId}`);
    if (el) {
        el.style.opacity = '0.5';
        el.style.pointerEvents = 'none';
        const chk = el.querySelector('input[type="checkbox"]');
        if (chk) chk.checked = false; // Ensure it won't be sent anyway

        // Change button text
        const btn = el.querySelector('.btn-restore');
        if(btn) btn.innerHTML = `<i data-lucide="check"></i> Restauré`;
        lucide.createIcons();
    }
};

// --- PUBLISH ---
DOM.btnFusion.addEventListener('click', async () => {
    const token = getStoredToken();
    if (!token) {
        showToastMsg("Token GitHub manquant. Configurez-le dans l'application.", "error");
        return;
    }

    DOM.btnFusion.disabled = true;
    DOM.btnFusion.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Préparation...`;
    lucide.createIcons();

    try {
        let finalFeatures = JSON.parse(JSON.stringify(originalData.features));

        // 1. Deletions
        const deleteIds = Array.from(document.querySelectorAll('input[data-type="badge-del"]:checked')).map(cb => cb.dataset.id);
        if (deleteIds.length > 0) {
            finalFeatures = finalFeatures.filter(f => !deleteIds.includes(getPoiId(f)));
        }

        // 2. Content Updates
        const contentIds = Array.from(document.querySelectorAll('input[data-type="badge-content"]:checked')).map(cb => cb.dataset.id);
        contentIds.forEach(id => {
            const feat = finalFeatures.find(f => getPoiId(f) === id);
            const updates = pendingChanges.contentUpdates.find(u => u.id === id);
            if (feat && updates) {
                updates.changes.forEach(c => {
                    feat.properties[c.targetKey] = c.new;
                });
            }
        });

        // 3. GPS Updates
        const gpsIds = Array.from(document.querySelectorAll('input[data-type="badge-gps"]:checked')).map(cb => cb.dataset.id);
        gpsIds.forEach(id => {
            const feat = finalFeatures.find(f => getPoiId(f) === id);
            const updates = pendingChanges.gpsUpdates.find(u => u.id === id);
            if (feat && updates) {
                feat.geometry.coordinates = [updates.newCoords[1], updates.newCoords[0]]; // [lng, lat]
            }
        });

        // 4. New POIs
        const newCb = Array.from(document.querySelectorAll('input[data-type="badge-new"]:checked'));
        newCb.forEach((cb) => {
            const idx = cb.id.split('-').pop(); // e.g., chk-badge-new-0 -> 0
            const id = cb.dataset.id;
            const updates = pendingChanges.newPois.find(u => u.id === id);

            if (updates) {
                const newFeat = JSON.parse(JSON.stringify(updates.feature));

                // Le nettoyage de userData est fait plus bas pour TOUS les POIs

                // Apply mapped names if edited in the UI
                const nameFrInput = document.getElementById(`name-new-${idx}`);
                const nameArInput = document.getElementById(`name-ar-new-${idx}`);

                if (nameFrInput) newFeat.properties['Nom du site FR'] = nameFrInput.value;
                if (nameArInput && nameArInput.value) newFeat.properties['Nom du site AR'] = nameArInput.value;

                finalFeatures.push(newFeat);
            }
        });

        // 5. NETTOYAGE COMPLET ET FINAL DES DOUBLONS AVANT ENVOI
        finalFeatures.forEach(feat => {
            if (feat.properties) {
                if (feat.properties.userData) {
                    // On s'assure que le champ userData (qui cause les doublons) ne part JAMAIS sur GitHub
                    delete feat.properties.userData;
                }

                // Nettoyage des clés redondantes qui pourraient être enregistrées en minuscule à la racine
                // par erreur dans le passé, pour forcer l'usage des clés officielles (avec Majuscule)
                const redundantKeys = ['description', 'Description_courte', 'notes', 'price', 'timeH', 'timeM'];
                redundantKeys.forEach(k => {
                    if (feat.properties.hasOwnProperty(k)) {
                        delete feat.properties[k];
                    }
                });
            }
        });

        const newGeoJSON = {
            type: "FeatureCollection",
            features: finalFeatures
        };

        const filename = `${currentMapId}.geojson`;
        const blob = new Blob([JSON.stringify(newGeoJSON, null, 2)], { type: 'application/geo+json' });
        const file = new File([blob], filename, { type: 'application/geo+json' });

        DOM.btnFusion.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Envoi sur GitHub...`;
        lucide.createIcons();

        await uploadFileToGitHub(file, token, 'Stefanmartin1967', 'History-Walk-V1', `public/${filename}`, `Update via Console Fusion ++`);

        showToastMsg("Succès ! La carte officielle a été mise à jour.", "success");
        DOM.btnFusion.innerHTML = `<i data-lucide="check-circle"></i> Mise à jour réussie`;
        DOM.btnFusion.classList.remove('btn-success');
        DOM.btnFusion.style.backgroundColor = '#10B981';

        // Nettoyage optionnel des données locales ?
        // On laisse l'utilisateur recharger l'app pour voir les effets.

    } catch (err) {
        console.error(err);
        showToastMsg("Erreur: " + err.message, "error");
        DOM.btnFusion.innerHTML = `<i data-lucide="upload-cloud"></i> Envoyer sur le serveur`;
        DOM.btnFusion.disabled = false;
        lucide.createIcons();
    }
});

// Launch
init();
