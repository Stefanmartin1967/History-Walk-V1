// src/config.js
// ============================================================
// SOURCE UNIQUE DE VÉRITÉ — Configuration du dépôt GitHub
// Modifier ici si le repo est renommé, forké ou migré.
// ============================================================

export const GITHUB_OWNER  = 'Stefanmartin1967';
export const GITHUB_REPO   = 'History-Walk-V1';
export const GITHUB_BRANCH = 'main';

/**
 * Dépôt PRIVÉ des photos de travail (chantier 10/08/2026).
 *
 * Photos de tiers (Facebook, envois de contacts, extraits de PDF) servant à
 * identifier un lieu pas encore visité. Elles ne sont JAMAIS publiées — règle
 * absolue de Stefan : rien de public qui ne soit de lui.
 *
 * Dépôt SÉPARÉ et non un simple drapeau, pour trois raisons :
 *  - le pipeline de publication ne lit pas ce dépôt → aucun filtre à oublier ;
 *  - privé = on ne republie pas le travail d'autrui (question de droit d'auteur,
 *    pas seulement d'affichage) ;
 *  - hors du dépôt public → aucun poids ajouté au site GitHub Pages.
 *
 * Lecture : dépôt privé ⇒ pas de `raw.githubusercontent` anonyme, il faut
 * l'API Contents authentifiée (cf. work-photos.js).
 */
export const GITHUB_WORK_REPO = 'heripia-travail';

/** Base URL pour lire les fichiers publics (sans authentification) */
export const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;

/** Chemins standardisés dans le dépôt */
export const GITHUB_PATHS = {
    geojson:     (mapId)    => `public/${mapId}.geojson`,
    zones:       (mapId)    => `public/${mapId}-zones.geojson`,
    rejected:    (mapId)    => `public/${mapId}-rejected.json`,
    circuits:    (mapId)    => `public/circuits/${mapId}.json`,
    circuitFile: (mapId, filename) => `public/circuits/${mapId}/${filename}`,
    photo:       (filename) => `public/photos/${filename}`,
    tested:      (mapId)    => `public/circuits/tested_${mapId}.json`,
    destinations: ()        => `public/destinations.json`,
};

/** Chemins dans le dépôt privé des photos de travail (cf. GITHUB_WORK_REPO). */
export const WORK_PATHS = {
    photo: (mapId, filename) => `${mapId}/${filename}`,
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
    'accessPointStatus',   // état de travail du drapeau (osm/moved/locked/on-track/failed) — admin only, dérivé de accessPoint ; ne pas publier ni diffuser (seul lecteur map.js est gardé isAdmin + userData-first)
    'workPhotos',          // photos de travail : chemins dans le dépôt PRIVÉ (cf. GITHUB_WORK_REPO). Photos de tiers, jamais publiables — leur place ici est la garantie structurelle qu'elles ne fuient pas dans le geojson public.
];
