// src/config.js
// ============================================================
// SOURCE UNIQUE DE VÉRITÉ — Configuration du dépôt GitHub
// Modifier ici si le repo est renommé, forké ou migré.
// ============================================================

export const GITHUB_OWNER  = 'Stefanmartin1967';
export const GITHUB_REPO   = 'History-Walk-V1';
export const GITHUB_BRANCH = 'main';

/** Base URL pour lire les fichiers publics (sans authentification) */
export const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;

/** Chemins standardisés dans le dépôt */
export const GITHUB_PATHS = {
    geojson:     (mapId)    => `public/${mapId}.geojson`,
    circuits:    (mapId)    => `public/circuits/${mapId}.json`,
    circuitFile: (filename) => `public/circuits/djerba/${filename}`,
    photo:       (filename) => `public/photos/${filename}`,
    adminData:   'public/admin/personal_data.json',
    tested:      (mapId)    => `public/circuits/tested_${mapId}.json`,
};
