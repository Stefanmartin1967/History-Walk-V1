// src/config.js
// ============================================================
// SOURCE UNIQUE DE VÉRITÉ — Configuration du dépôt GitHub
// Modifier ici si le repo est renommé, forké ou migré.
// ============================================================

// Adresse de contact (mentions légales, bouton Contact, suggestion d'un lieu).
// L'ancienne adresse « History Walk » est gardée exprès (Stefan, 11/10/2026).
export const CONTACT_EMAIL = 'history.walk.007@gmail.com';

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

/**
 * Dépôts de photos par destination (chantier du 02/11/2026).
 *
 * Chaque site GitHub Pages est limité à 1 Go, sans offre payante pour relever
 * la limite. Une destination peut donc publier ses photos dans son propre dépôt
 * public, servi par GitHub Pages : champ `photosRepo` de son entrée dans
 * destinations.json. Sans ce champ, elles restent dans public/photos/ du dépôt
 * principal. Le data garde l'adresse COMPLÈTE de chaque photo d'un dépôt :
 * l'affichage n'a rien à calculer, et les deux formes coexistent.
 *
 * Nom imposé `heripia-photos-…` : le service worker (vite.config.js) et le
 * hors-ligne (circuit-photos-offline.js) ne reconnaissent que ce motif.
 */
const PHOTOS_REPO_NAME = /^heripia-photos-[a-z0-9-]+$/;

/**
 * Où publier une photo : dépôt, chemin dans le dépôt, adresse à enregistrer
 * dans le data.
 * @param {string} filename    ex. "poi_HW-xxx_1234567890.jpg"
 * @param {string} [photosRepo] champ `photosRepo` de la destination
 * @returns {{repo: string, path: string, url: string}}
 */
export function photoStorage(filename, photosRepo) {
    if (!photosRepo) {
        return { repo: GITHUB_REPO, path: GITHUB_PATHS.photo(filename), url: `photos/${filename}` };
    }
    if (!PHOTOS_REPO_NAME.test(photosRepo)) {
        throw new Error(`Dépôt de photos invalide : « ${photosRepo} » (attendu : heripia-photos-…).`);
    }
    const path = `photos/${filename}`;
    return { repo: photosRepo, path, url: `https://${GITHUB_OWNER.toLowerCase()}.github.io/${photosRepo}/${path}` };
}

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
    'vuUpdatedAt',         // date (ms) du dernier changement du statut visité — synchro Gist (visited-state.js)
    'visited',             // legacy — garde pour rétro-compat
    'notes',               // notes personnelles user
    'incontournable',      // favori user (court-circuite filtres planifiés/visités)
    'planifie',            // legacy — plus stocké depuis 03/05/2026 (calculé à la volée), filet anti-leak data historique
    'planifieCounter',     // legacy — idem `planifie`, calculé via computePlanifieCounter()
    'hidden',              // POI masqué côté user
    'accessPointStatus',   // état de travail du drapeau (osm/moved/locked/on-track/failed) — admin only, dérivé de accessPoint ; ne pas publier ni diffuser (seul lecteur map.js est gardé isAdmin + userData-first)
    'workPhotos',          // photos de travail : chemins dans le dépôt PRIVÉ (cf. GITHUB_WORK_REPO). Photos de tiers, jamais publiables — leur place ici est la garantie structurelle qu'elles ne fuient pas dans le geojson public.
    'keptWorkPhotos',      // sous-ensemble de workPhotos marqué « gardé » (survit à l'import des photos de Stefan) — mêmes chemins privés, même garantie.
];
