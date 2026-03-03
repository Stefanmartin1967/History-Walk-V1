const fs = require('fs');

const counters_code = `
/**
 * Calcule les compteurs "Planifié" pour chaque POI de manière optimisée.
 * @param {Array} features - La liste des POIs chargés (state.loadedFeatures)
 * @param {Array} circuits - La liste des circuits à analyser
 * @returns {Object} Un objet { poiId: count }
 */
export function computeCircuitCounters(features, circuits) {
    const counters = {};

    // OPTIMISATION V2 : Création d'une Map pour accès O(1)
    // Au lieu de features.find() dans la boucle (O(N*M)), on prépare l'index (O(N)).
    const featureMap = new Map();
    features.forEach(f => {
        const id = getPoiId(f);
        featureMap.set(id, f);
        counters[id] = 0; // Init à 0
    });

    const activeCircuits = circuits.filter(c => !c.isDeleted);

    activeCircuits.forEach(circuit => {
        const poiIds = circuit.poiIds || [];
        // Set pour éviter de compter 2 fois le même POI dans un même circuit
        [...new Set(poiIds)].forEach(poiId => {
            if (counters.hasOwnProperty(poiId)) {
                // Recherche O(1) grâce à la Map
                const feature = featureMap.get(poiId);

                // CORRECTION : On ne compte QUE si le POI n'est pas marqué supprimé
                const isDeleted = feature && feature.properties.userData && feature.properties.userData.deleted;

                if (!isDeleted) {
                    counters[poiId]++;
                }
            }
        });
    });

    return counters;
}

export async function recalculatePlannedCountersForMap(mapId) {
    if (!mapId) return;
    try {
        const poiDataForMap = await getAllPoiDataForMap(mapId);
        const circuitsForMap = await getAllCircuitsForMap(mapId);

        // FIX: On ne prend que les circuits NON supprimés
        const activeLocalCircuits = circuitsForMap.filter(c => !c.isDeleted);

        // FIX: On inclut aussi les circuits officiels (qui ne sont pas en base)
        const officialCircuits = state.officialCircuits || [];

        const allCircuits = [...activeLocalCircuits, ...officialCircuits];

        // APPEL DE LA FONCTION OPTIMISÉE
        const counters = computeCircuitCounters(state.loadedFeatures, allCircuits);

        const updatesToBatch = [];
        for (const [poiId, count] of Object.entries(counters)) {
            const currentCount = (poiDataForMap[poiId] && poiDataForMap[poiId].planifieCounter) || 0;
            if (currentCount !== count) {
                updatesToBatch.push({ poiId: poiId, data: { planifieCounter: count } });
            }
        }

        if (updatesToBatch.length > 0) {
            await batchSavePoiData(mapId, updatesToBatch);
        }

        // ... Mise à jour de l'état local ...
        setUserData(await getAllPoiDataForMap(mapId));
        state.loadedFeatures.forEach(feature => {
            const poiId = getPoiId(feature);
            if (state.userData[poiId]) {
                feature.properties.userData = { ...feature.properties.userData, ...state.userData[poiId] };
            }
        });
    } catch (error) {
        console.error("Erreur lors du recalcul des compteurs:", error);
    }
}
`;

const save_code = `
export async function saveAndExportCircuit() {
    if (state.currentCircuit.length === 0) return;

    // 1. Détermination du nom : Priorité à l'interface (User) sur la génération auto
    let circuitName = generateCircuitName();
    if (DOM.circuitTitleText && DOM.circuitTitleText.textContent) {
        const uiTitle = DOM.circuitTitleText.textContent.trim();
        // Si le titre de l'UI n'est pas le placeholder par défaut, on le garde
        if (uiTitle && uiTitle !== "Nouveau Circuit") {
            circuitName = uiTitle;
        }
    }

    const draft = await getAppState(\`circuitDraft_\${state.currentMapId}\`);
    let description = (draft && draft.description) ? draft.description : '';
    const transportData = (draft && draft.transport) ? draft.transport : {};

    // --- MODIFICATION V2 : AJOUT SIGNATURE AUTOMATIQUE ---
    const signature = "\\n\\n(Créé par History Walk)";
    if (!description.includes("History Walk")) {
        description += signature;
    }
    // ----------------------------------------------------

    const poiIds = state.currentCircuit.map(getPoiId);

    let circuitToSave;

    if (state.activeCircuitId) {
        const index = state.myCircuits.findIndex(c => c.id === state.activeCircuitId);
        if (index > -1) {
            circuitToSave = { ...state.myCircuits[index] };
            circuitToSave.name = circuitName;
            circuitToSave.description = description;
            circuitToSave.poiIds = poiIds;
            circuitToSave.transport = transportData;
            updateMyCircuit(circuitToSave);
        } else {
             // Recherche dans les circuits officiels (si on est en train d'éditer une version officielle)
             const offIndex = state.officialCircuits ? state.officialCircuits.findIndex(c => c.id === state.activeCircuitId) : -1;
             if (offIndex > -1) {
                 // On met à jour l'objet en mémoire
                 const offCircuit = state.officialCircuits[offIndex];
                 offCircuit.name = circuitName;
                 offCircuit.description = description;
                 offCircuit.poiIds = poiIds;
                 offCircuit.transport = transportData;
                 // On prépare l'objet pour la sauvegarde DB
                 circuitToSave = offCircuit;
             }
        }
    }

    if (!circuitToSave) {
        const newId = generateHWID();
        circuitToSave = {
            id: newId,
            mapId: state.currentMapId,
            name: circuitName,
            description: description,
            poiIds: poiIds,
            realTrack: null,
            transport: transportData
        };
        // It seems addMyCircuit wasn't added to imports, let's fix it manually later if needed. It's in state.js
        const { addMyCircuit } = require('./state.js'); // just to know it's there
        import('./state.js').then(module => module.addMyCircuit(circuitToSave));
        setActiveCircuitId(newId);
    }

    try {
        await saveCircuit(circuitToSave);
        setHasUnexportedChanges(true); // FLAG CHANGEMENT
        await recalculatePlannedCountersForMap(state.currentMapId);
        applyFilters();
        generateAndDownloadGPX(state.currentCircuit, circuitToSave.id, circuitToSave.name, circuitToSave.description, circuitToSave.realTrack);
        showToast(\`Circuit "\${circuitToSave.name}" sauvegardé et exporté !\`, 'success');
    } catch (error) {
        console.error("Erreur lors de la sauvegarde du circuit :", error);
        showToast("Erreur lors de la sauvegarde du circuit.", 'error');
    }
}
`;


let fileContent = fs.readFileSync('src/circuit-actions.js', 'utf8');

// The file might be missing imports for `addMyCircuit` and `saveCircuit`
// let's add them to the imports at the top
const importLine1 = "import { addMyCircuit } from './state.js';";
const importLine2 = "import { saveCircuit } from './database.js';";

if (!fileContent.includes("import { addMyCircuit")) {
    fileContent = importLine1 + "\n" + fileContent;
}
if (!fileContent.includes("import { saveCircuit")) {
    fileContent = fileContent.replace("import { getAllPoiDataForMap", "import { saveCircuit, getAllPoiDataForMap");
}
if (!fileContent.includes("computeCircuitCounters")) {
    fileContent += "\n\n" + counters_code + "\n\n" + save_code;
}

// Fix dynamic import in save_code
fileContent = fileContent.replace(/import\('\.\/state\.js'\)\.then\(module => module\.addMyCircuit\(circuitToSave\)\);/, "addMyCircuit(circuitToSave);");

fs.writeFileSync('src/circuit-actions.js', fileContent);
