import re

with open('src/fileManager.js', 'r') as f:
    content = f.read()

# Add isValidBackup function before restoreBackup
new_func = """
/**
 * Vérifie si le fichier JSON fourni est une sauvegarde valide.
 * @param {Object} json L'objet JSON à vérifier
 * @returns {boolean} True si valide, False sinon
 */
function isValidBackup(json) {
    if (!json) return false;

    // Vérification de la version de backup (doit exister)
    if (!json.backupVersion) {
        console.warn("[Validation] Version de backup manquante.");
        return false;
    }

    // Vérification de l'ID de la carte (doit être une chaîne)
    if (typeof json.mapId !== 'string' || json.mapId.trim() === '') {
        console.warn("[Validation] ID de carte invalide ou manquant.");
        return false;
    }

    // Vérification des données utilisateur (userData) si présentes
    if (json.userData !== undefined) {
        if (typeof json.userData !== 'object' || Array.isArray(json.userData) || json.userData === null) {
            console.warn("[Validation] Format de userData invalide (doit être un objet).");
            return false;
        }
    }

    // Vérification des circuits (myCircuits) si présents
    if (json.myCircuits !== undefined) {
        if (!Array.isArray(json.myCircuits)) {
            console.warn("[Validation] Format de myCircuits invalide (doit être un tableau).");
            return false;
        }
    }

    return true;
}

"""

if 'function isValidBackup' not in content:
    content = content.replace('async function restoreBackup(json) {', new_func + 'async function restoreBackup(json) {')

# Use it in handleFileLoad
# Original: else if (json.backupVersion && (json.baseGeoJSON || json.userData)) {
# New: else if (isValidBackup(json) && (json.baseGeoJSON || json.userData)) {
content = content.replace('else if (json.backupVersion && (json.baseGeoJSON || json.userData)) {', 'else if (isValidBackup(json) && (json.baseGeoJSON || json.userData)) {')

# Use it in handleRestoreFile
# Original: const json = JSON.parse(e.target.result);\n            restoreBackup(json);
# New:
replacement_restore = """const json = JSON.parse(e.target.result);
            if (isValidBackup(json)) {
                restoreBackup(json);
            } else {
                showToast("Fichier de sauvegarde corrompu ou invalide.", "error");
            }"""

content = re.sub(r'const json = JSON\.parse\(e\.target\.result\);\s+restoreBackup\(json\);', replacement_restore, content)

with open('src/fileManager.js', 'w') as f:
    f.write(content)
