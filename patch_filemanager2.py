import re

with open('src/fileManager.js', 'r') as f:
    content = f.read()

clean_function = """
/**
 * Nettoie un objet en supprimant les clés ayant des valeurs null ou undefined.
 * Pour les tableaux, on supprime les éléments nulls/undefined.
 * @param {any} obj L'objet ou tableau à nettoyer
 * @returns {any} L'objet nettoyé
 */
function cleanDataForExport(obj) {
    if (obj === null || obj === undefined) return undefined;

    if (Array.isArray(obj)) {
        return obj.filter(item => item !== null && item !== undefined).map(cleanDataForExport);
    }

    if (typeof obj === 'object') {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            const cleanedValue = cleanDataForExport(value);
            if (cleanedValue !== undefined) {
                cleaned[key] = cleanedValue;
            }
        }
        return cleaned;
    }

    return obj;
}

"""

if 'function cleanDataForExport' not in content:
    content = content.replace('async function prepareExportData(includePhotos = false) {', clean_function + 'async function prepareExportData(includePhotos = false) {')

# Modify prepareExportData to use cleanDataForExport
replacement_prepare = """
    // On retourne le format "Carton avec étiquette" attendu par la Fusion
    const exportData = {
        backupVersion: "3.0",
        mapId: state.currentMapId || 'djerba',
        date: new Date().toISOString(),
        baseGeoJSON: geojson,
        userData: state.userData || {},
        myCircuits: state.myCircuits || [],
        hiddenPoiIds: state.hiddenPoiIds || [],
        officialCircuitsStatus: state.officialCircuitsStatus || {}
    };

    return cleanDataForExport(exportData);
"""

content = re.sub(
    r'return \{\s*backupVersion: "3\.0",\s*mapId: state\.currentMapId \|\| \'djerba\',\s*date: new Date\(\)\.toISOString\(\),\s*baseGeoJSON: geojson,\s*userData: state\.userData \|\| \{\},\s*myCircuits: state\.myCircuits \|\| \[\],\s*hiddenPoiIds: state\.hiddenPoiIds \|\| \[\],\s*officialCircuitsStatus: state\.officialCircuitsStatus \|\| \{\}\s*\};',
    replacement_prepare,
    content
)


# Modify saveUserData to use cleanDataForExport as well
replacement_saveUser = """const exportData = cleanDataForExport({
        backupVersion: state.appVersion || "3.0",
        date: new Date().toISOString(),
        mapId: state.currentMapId,
        baseGeoJSON: {
            type: "FeatureCollection",
            features: state.loadedFeatures.map(f => {
                const featureClone = JSON.parse(JSON.stringify(f));
                const poiId = getPoiId(f);
                if (state.userData[poiId]) {
                    featureClone.properties.userData = JSON.parse(JSON.stringify(state.userData[poiId]));
                }
                if (!includePhotos && featureClone.properties.userData && featureClone.properties.userData.photos) {
                    featureClone.properties.userData.photos = [];
                }
                return featureClone;
            })
        },
        userData: JSON.parse(JSON.stringify(state.userData)),
        myCircuits: state.myCircuits,
        hiddenPoiIds: state.hiddenPoiIds,
        officialCircuitsStatus: state.officialCircuitsStatus || {}
    });"""

content = re.sub(
    r'const exportData = \{\s*backupVersion: state\.appVersion \|\| "3\.0",\s*date: new Date\(\)\.toISOString\(\),\s*mapId: state\.currentMapId,\s*baseGeoJSON: \{\s*type: "FeatureCollection",\s*features: state\.loadedFeatures\.map\(f => \{\s*const featureClone = JSON\.parse\(JSON\.stringify\(f\)\);\s*const poiId = getPoiId\(f\);\s*if \(state\.userData\[poiId\]\) \{\s*featureClone\.properties\.userData = JSON\.parse\(JSON\.stringify\(state\.userData\[poiId\]\)\);\s*\}\s*if \(\!includePhotos && featureClone\.properties\.userData && featureClone\.properties\.userData\.photos\) \{\s*featureClone\.properties\.userData\.photos = \[\];\s*\}\s*return featureClone;\s*\}\)\s*\},\s*userData: JSON\.parse\(JSON\.stringify\(state\.userData\)\), \s*myCircuits: state\.myCircuits,\s*hiddenPoiIds: state\.hiddenPoiIds,\s*officialCircuitsStatus: state\.officialCircuitsStatus \|\| \{\}\s*\};',
    replacement_saveUser,
    content
)


with open('src/fileManager.js', 'w') as f:
    f.write(content)
