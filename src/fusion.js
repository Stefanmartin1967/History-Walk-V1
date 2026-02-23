import { escapeHtml, getZoneFromCoords, calculateDistance } from './utils.js';

// fusion.js - Version avec Dictionnaire de Données et Support Arabe

const DOM = {
    sourceInput: document.getElementById('source-file'),
    backupInput: document.getElementById('backup-file'),
    btnAnalyze: document.getElementById('btn-analyze'),
    dashboard: document.getElementById('dashboard'),
    uploadCard: document.getElementById('upload-card'),
    listNew: document.getElementById('list-new'),
    listGps: document.getElementById('list-gps'),
    listContent: document.getElementById('list-content'),
    btnFusion: document.getElementById('btn-fusion')
};

let sourceData = null;
let backupData = null;
let pendingChanges = { newPois: [], gpsUpdates: [], contentUpdates: [] };

// --- 1. DICTIONNAIRE DE DONNÉES (La source de vérité) ---
const DATA_DICTIONARY = {
    // Clé Mobile (userData) : Clé GeoJSON (properties)
    'description': 'Description',
    'Description_courte': 'Desc_wpt',
    'notes': 'Notes_internes', // On sépare les notes pour ne pas polluer la description publique
    'price': "Prix d'entrée",
    'timeH': 'Temps de visite', // Traitement spécial requis
    'verified': 'Vérifié',
    'incontournable': 'Incontournable',
    'vu': 'Visité'
};

// --- 2. FONCTIONS UI ---

function updateAnalyzeButton() {
    if (sourceData && backupData) {
        DOM.btnAnalyze.disabled = false;
        DOM.btnAnalyze.innerHTML = `<i data-lucide="scan-search"></i> Analyser les différences`;
        DOM.btnAnalyze.classList.add('btn-success');
        lucide.createIcons();
    } else {
        DOM.btnAnalyze.disabled = true;
    }
}

function setupFileInput(inputElement, nameDisplayId, boxId, isSource) {
    inputElement.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const nameDisplay = document.getElementById(nameDisplayId);
        const box = document.getElementById(boxId);
        nameDisplay.innerHTML = `<span style="color:var(--ink);">Chargement...</span>`;

        try {
            const text = await file.text();
            const json = JSON.parse(text);

            if (isSource) {
                if (!json.features) throw new Error("Pas de 'features' trouvé.");
                sourceData = json;
                nameDisplay.innerHTML = `<span style="color:var(--ok);">✅ ${file.name} (${json.features.length} POIs)</span>`;
            } else {
                if (!json.userData) throw new Error("Backup invalide.");
                backupData = json;
                const count = Object.keys(json.userData || {}).length;
                nameDisplay.innerHTML = `<span style="color:var(--ok);">✅ ${file.name} (${count} entrées)</span>`;
            }

            box.classList.add('active');
            box.style.borderColor = "var(--ok)";
            updateAnalyzeButton();
        } catch (err) {
            console.error(err);
            nameDisplay.innerHTML = `<span style="color:var(--danger);">❌ Erreur: ${err.message}</span>`;
            if (isSource) sourceData = null; else backupData = null;
            updateAnalyzeButton();
        }
    });
}

setupFileInput(DOM.sourceInput, 'source-name', 'box-source', true);
setupFileInput(DOM.backupInput, 'backup-name', 'box-backup', false);

// --- 3. ANALYSE ---

DOM.btnAnalyze.addEventListener('click', () => {
    if (!sourceData || !backupData) return;
    DOM.btnAnalyze.textContent = "Analyse en cours...";
    setTimeout(analyzeFiles, 50);
});

function analyzeFiles() {
    pendingChanges = { newPois: [], gpsUpdates: [], contentUpdates: [] };

    const sourceFeatures = sourceData.features || [];
    const backupFeatures = (backupData.baseGeoJSON && backupData.baseGeoJSON.features) ? backupData.baseGeoJSON.features : [];
    const userDataMap = backupData.userData || {};
    const sourceIds = new Set(sourceFeatures.map(f => f.properties.HW_ID));

    // A. Nouveaux POI
    backupFeatures.forEach(feature => {
        if (!sourceIds.has(feature.properties.HW_ID)) {
            const uData = userDataMap[feature.properties.HW_ID] || {};
            pendingChanges.newPois.push({
                feature: feature,
                proposedName: uData.custom_title || uData['Nom du site FR'] || feature.properties['Nom du site FR'] || "Nouveau Lieu",
                proposedDesc: uData.notes || "",
                id: feature.properties.HW_ID
            });
        }
    });

    // B. Modifications (GPS & Contenu)
    sourceFeatures.forEach(sourceFeat => {
        const id = sourceFeat.properties.HW_ID;
        const uData = userDataMap[id];
        const backupFeat = backupFeatures.find(f => f.properties.HW_ID === id);

        if (!uData && !backupFeat) return;

        // GPS Check
        if (backupFeat) {
            const oldC = sourceFeat.geometry.coordinates;
            const newC = backupFeat.geometry.coordinates;
            const dist = calculateDistance(oldC[1], oldC[0], newC[1], newC[0]);
            if (dist > 5) {
                pendingChanges.gpsUpdates.push({
                    id: id,
                    name: sourceFeat.properties['Nom du site FR'],
                    oldCoords: oldC,
                    newCoords: newC,
                    distance: Math.round(dist)
                });
            }
        }

        // Content Check (Enrichissements simples)
        if (uData) {
            const changes = [];
            const newName = uData.custom_title || uData['Nom du site FR'];
            if (newName && newName !== sourceFeat.properties['Nom du site FR']) {
                changes.push({ type: 'Nom', old: sourceFeat.properties['Nom du site FR'], new: newName });
            }
            if (uData.notes) {
                changes.push({ type: 'Note', old: '(vide)', new: uData.notes });
            }
            if (changes.length > 0) {
                pendingChanges.contentUpdates.push({
                    id: id,
                    name: sourceFeat.properties['Nom du site FR'],
                    changes: changes
                });
            }
        }
    });

    renderDashboard();
}

// --- 4. RENDU VISUEL ---

function renderDashboard() {
    DOM.uploadCard.style.display = 'none';
    DOM.dashboard.style.display = 'block';

    // Rendu Nouveaux POIs avec CHAMP ARABE
    renderSection(DOM.listNew, 'Nouveaux Lieux à Créer', 'badge-new', pendingChanges.newPois, (item, idx) => `
        <div class="change-item">
            <div class="checkbox-wrapper"><input type="checkbox" checked id="new-${idx}"></div>
            <div class="change-content">
                <div class="poi-name">Nouveau Lieu <span class="badge badge-new">Création</span></div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:5px;">
                    <div>
                        <label style="font-size:11px; color:#64748B;">Nom FR</label>
                        <input type="text" class="new-poi-input" id="name-new-${idx}" value="${escapeHtml(item.proposedName)}">
                    </div>
                    <div>
                        <label style="font-size:11px; color:#64748B;">Nom AR (Optionnel)</label>
                        <input type="text" class="new-poi-input" id="name-ar-new-${idx}" placeholder="الاسم بالعربية" dir="rtl" style="text-align:right;">
                    </div>
                </div>

                ${item.proposedDesc ? `<div class="change-detail"><span style="font-style:italic">Note mobile : ${escapeHtml(item.proposedDesc)}</span></div>` : ''}
            </div>
        </div>`);

    // Rendu GPS
    renderSection(DOM.listGps, 'Corrections GPS', 'badge-gps', pendingChanges.gpsUpdates, (item, idx) => `
        <div class="change-item">
            <div class="checkbox-wrapper"><input type="checkbox" checked id="gps-${idx}"></div>
            <div class="change-content">
                <div class="poi-name">${escapeHtml(item.name)}</div>
                <div class="change-detail">
                    <span class="badge badge-gps">${item.distance}m</span>
                    <span class="old-val">[${item.oldCoords[1].toFixed(5)}, ${item.oldCoords[0].toFixed(5)}]</span>
                    <span class="arrow">➜</span>
                    <span class="new-val">[${item.newCoords[1].toFixed(5)}, ${item.newCoords[0].toFixed(5)}]</span>
                </div>
            </div>
        </div>`);

    // Rendu Contenu
    renderSection(DOM.listContent, 'Mises à jour Contenu', 'badge-content', pendingChanges.contentUpdates, (item, idx) => {
        const details = item.changes.map(c => `
            <div class="change-detail">
                <span class="badge badge-content">${escapeHtml(c.type)}</span>
                <span class="new-val">${escapeHtml(c.new)}</span>
            </div>`).join('');
        return `
            <div class="change-item">
                <div class="checkbox-wrapper"><input type="checkbox" checked id="content-${idx}"></div>
                <div class="change-content"><div class="poi-name">${escapeHtml(item.name)}</div>${details}</div>
            </div>`;
    });

    lucide.createIcons();
}

function renderSection(container, title, badgeClass, data, renderFn) {
    if (data.length === 0) { container.innerHTML = ''; return; }
    let html = `<div class="group-title">${title} <span class="badge ${badgeClass}">${data.length}</span></div>`;
    html += data.map((item, idx) => renderFn(item, idx)).join('');
    container.innerHTML = html;
}

// --- 5. FUSION ET TÉLÉCHARGEMENT ---

DOM.btnFusion.addEventListener('click', () => {
    const finalFeatures = JSON.parse(JSON.stringify(sourceData.features));
    let stats = { new: 0, gps: 0, content: 0 };

    // 1. Appliquer GPS
    pendingChanges.gpsUpdates.forEach((item, idx) => {
        if (document.getElementById(`gps-${idx}`).checked) {
            const feat = finalFeatures.find(f => f.properties.HW_ID === item.id);
            if (feat) {
                feat.geometry.coordinates = item.newCoords;
                stats.gps++;
            }
        }
    });

    // 2. Appliquer Contenu existant
    pendingChanges.contentUpdates.forEach((item, idx) => {
        if (document.getElementById(`content-${idx}`).checked) {
            const feat = finalFeatures.find(f => f.properties.HW_ID === item.id);
            if (feat) {
                item.changes.forEach(c => {
                    if (c.type === 'Nom') feat.properties['Nom du site FR'] = c.new;
                    if (c.type === 'Note') feat.properties['Notes_internes'] = (feat.properties['Notes_internes'] || "") + "\n" + c.new;
                });
                stats.content++;
            }
        }
    });

    // 3. Créer Nouveaux POI (Avec mappage strict)
    pendingChanges.newPois.forEach((item, idx) => {
        if (document.getElementById(`new-${idx}`).checked) {
            const newNameFR = document.getElementById(`name-new-${idx}`).value;
            const newNameAR = document.getElementById(`name-ar-new-${idx}`).value; // Récupération Arabe

            // Clone de base
            const newPoi = JSON.parse(JSON.stringify(item.feature));
            const userData = newPoi.properties.userData || {};

            // Calcul de la zone
            const [lng, lat] = newPoi.geometry.coordinates;
            const computedZone = getZoneFromCoords(lat, lng);

            // Nettoyage initial
            newPoi.properties = {
                "HW_ID": item.id,
                "Nom du site FR": newNameFR,
                "Nom du site AR": newNameAR || "", // Injection champ Arabe
                "Catégorie": item.feature.properties.Catégorie || "A définir",
                "Zone": computedZone
            };

            // Mapping intelligent via Dictionnaire
            for (const [mobileKey, geoKey] of Object.entries(DATA_DICTIONARY)) {
                if (userData[mobileKey] !== undefined && userData[mobileKey] !== "") {
                    // Cas particuliers
                    if (mobileKey === 'price') {
                        newPoi.properties[geoKey] = userData.price + " TND";
                    } else if (mobileKey === 'timeH') {
                        const h = userData.timeH || 0;
                        const m = userData.timeM || 0;
                        newPoi.properties[geoKey] = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
                    } else {
                        // Cas général (Copie directe)
                        newPoi.properties[geoKey] = userData[mobileKey];
                    }
                }
            }

            finalFeatures.push(newPoi);
            stats.new++;
        }
    });

    downloadResult({ type: "FeatureCollection", features: finalFeatures }, stats);
});

function downloadResult(jsonObj, stats) {
    const str = JSON.stringify(jsonObj, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0,10);

    const a = document.createElement('a');
    a.href = url;
    a.download = `HistoryWalk_Master_V2_${date}.geojson`; // Nom plus pro
    a.click();

    DOM.btnFusion.textContent = `Succès ! V2 générée (${stats.new} nouveaux, ${stats.gps} GPS)`;
    DOM.btnFusion.classList.remove('btn-success');
    DOM.btnFusion.style.backgroundColor = '#64748B';
}
