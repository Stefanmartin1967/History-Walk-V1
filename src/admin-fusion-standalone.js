import { getAppState, saveAppState, savePoiData } from './database.js';
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
        localUserData = await getAppState('userData') || {};

        // Try to get mapId from somewhere, fallback to djerba
        // We'll assume the most recent edited map, or hardcode for now
        localCustomFeatures = (await getAppState(`customPois_${currentMapId}`)) || [];
        localHiddenPoiIds = (await getAppState(`hiddenPois_${currentMapId}`)) || [];

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
        const ignoredKeys = ['visited', 'vu', 'planifie', 'planifieCounter', 'notes', 'lat', 'lng', '_deleted'];
        const contentChanges = [];

        Object.keys(uData).forEach(key => {
            if (ignoredKeys.includes(key)) return;

            const oldVal = origFeat.properties[key];
            const newVal = uData[key];

            if (String(oldVal) !== String(newVal) && !(oldVal === undefined && newVal === "")) {
                let displayKey = key;
                if (key === 'timeH') displayKey = 'Heures';
                if (key === 'timeM') displayKey = 'Minutes';

                contentChanges.push({
                    key: key,
                    displayKey: displayKey,
                    old: oldVal !== undefined ? oldVal : '—',
                    new: newVal
                });
            }
        });

        if (contentChanges.length > 0) {
            pendingChanges.contentUpdates.push({
                id: id,
                name: getPoiName(origFeat),
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
                    <div class="poi-name">
                        ${escapeHtml(item.name)}
                        ${badgeClass === 'badge-del' ?
                            `<button class="btn-restore" onclick="restorePoi('${item.id}')"><i data-lucide="rotate-ccw" style="width:12px;height:12px;"></i> Restaurer localement</button>`
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
}

// Global Restore Function
window.restorePoi = async (poiId) => {
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
                    feat.properties[c.key] = c.new;
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
                if (newFeat.properties.userData) delete newFeat.properties.userData;

                // Apply mapped names if edited in the UI
                const nameFrInput = document.getElementById(`name-new-${idx}`);
                const nameArInput = document.getElementById(`name-ar-new-${idx}`);

                if (nameFrInput) newFeat.properties['Nom du site FR'] = nameFrInput.value;
                if (nameArInput && nameArInput.value) newFeat.properties['Nom du site AR'] = nameArInput.value;

                finalFeatures.push(newFeat);
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
