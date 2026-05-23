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
    circuitFile: (mapId, filename) => `public/circuits/${mapId}/${filename}`,
    photo:       (filename) => `public/photos/${filename}`,
    tested:      (mapId)    => `public/circuits/tested_${mapId}.json`,
};

/**
 * Clés personnelles synchronisées via Gist privé — JAMAIS poussées dans le geojson public.
 * Source unique partagée par admin-geojson.js (purge au publish), admin-diff-engine.js
 * (filtrage reconcile + display) et data.js (tracking admin) pour éviter les fuites
 * de données perso vers la source publique.
 */
export const PERSONAL_KEYS = [
    'vu',                  // dérivé : visité (manuel ou via circuits)
    'vuManual',            // user a explicitement coché "vu"
    'visitedByCircuits',   // liste des circuits qui marquent ce POI comme fait
    'visited',             // legacy — garde pour rétro-compat
    'notes',               // notes personnelles user
    'incontournable',      // favori user (court-circuite filtres planifiés/visités)
    'planifie',            // legacy — plus stocké depuis 03/05/2026 (calculé à la volée), filet anti-leak data historique
    'planifieCounter',     // legacy — idem `planifie`, calculé via computePlanifieCounter()
    'hidden',              // POI masqué côté user
];
