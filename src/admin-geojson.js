// admin-geojson.js
// Génération du GeoJSON maître à partir de state.loadedFeatures.
// Extrait d'admin.js pour casser le cycle admin.js ↔ admin-control-center.js.
// Aucune dépendance DOM / UI : pure transformation de données.

import { state } from './state.js';
import { getPoiId, isCandidate, deriveZoneSafe } from './utils.js';
import { PERSONAL_KEYS } from './config.js';

// `keepCandidates` : faut-il laisser passer les candidats Scout non curés
// (`properties.candidate`) ? Défaut = false (sûr) → ils sont EXCLUS. Un candidat
// ne voyage QUE dans le geojson d'un brouillon (status:draft, admin-only), où
// l'appelant passe explicitement keepCandidates:true. C'est la 4e couche du
// garde-fou candidat : les 3 autres (draft:false, reconcileLocalChanges,
// prepareDiffData) ne protègent que le DIFF, alors que ce générateur régénère le
// geojson ENTIER depuis state.loadedFeatures → sans cette exclusion, un candidat
// capturé en « Repasse » sur une destination publiée fuirait dans sa source
// publique au prochain « Tout publier ».
export function generateMasterGeoJSONData(excludedIds = [], { keepCandidates = false } = {}) {
    if (!state.loadedFeatures || state.loadedFeatures.length === 0) {
        return null;
    }

    const features = state.loadedFeatures
        .filter(f => {
             const id = getPoiId(f);
             if (excludedIds.includes(id)) return false;
             if (f.properties.userData && f.properties.userData._deleted) return false;
             // isCandidate (overlay) et non properties.candidate brut : un candidat de
             // base CURÉ (userData.candidate=false) n'est PLUS un candidat → il doit
             // être publié (la clé candidate:false résiduelle est retirée plus bas).
             if (!keepCandidates && isCandidate(f)) return false;
             return true;
        })
        .map(f => {
            const properties = JSON.parse(JSON.stringify(f.properties));
            const standardizedHWID = properties.HW_ID;

            if (properties.userData) {
                Object.assign(properties, properties.userData);
                delete properties.userData;
            }

            // Dégel de Zone : on cuit une Zone FRAÎCHE (dérivée des coordonnées sur le
            // jeu de quartiers courant) dans le geojson public, pour qu'un visiteur
            // dont le fetch des quartiers échoue garde quand même une Zone correcte
            // (filet de robustesse). deriveZoneSafe NE recalcule PAS si zonesData est
            // vide → on conserve alors la valeur déjà aplatie (jamais « Hors zone »
            // fabriqué en masse). Le visiteur, lui, re-dérive de toute façon à la volée.
            const coords = f.geometry && f.geometry.coordinates; // [lng, lat]
            if (Array.isArray(coords) && coords.length >= 2) {
                properties.Zone = deriveZoneSafe(coords[1], coords[0], properties.Zone);
            }

            // Réunif PR1 : un candidat de base curé porte candidate:false (via overlay
            // userData) → on retire la clé pour un geojson propre. Un candidat NON curé
            // garde candidate:true (et n'arrive ici que sur le chemin keepCandidates,
            // i.e. un brouillon admin-only ; ailleurs il est exclu en amont).
            if (properties.candidate === false) delete properties.candidate;

            // Blindage : l'ID unifié ne doit pas être écrasé par une vieille valeur dans userData.
            if (standardizedHWID) {
                properties.HW_ID = standardizedHWID;
            }

            // Purge des champs perso (Gist privé) — ne JAMAIS pousser dans le geojson public.
            PERSONAL_KEYS.forEach(k => { delete properties[k]; });

            // Nettoyage critique : photos base64 exclues (on ne garde que les URL).
            if (properties.photos && Array.isArray(properties.photos)) {
                properties.photos = properties.photos.filter(p => !p.startsWith('data:image'));
            }

            // Point d'accès au tracé : on ne publie qu'un couple [lon, lat] valide.
            // Un accessPoint absent ou retiré (null via l'overlay) ne doit pas
            // laisser de résidu (`accessPoint: null`) dans le geojson public.
            const ap = properties.accessPoint;
            if (!Array.isArray(ap) || ap.length !== 2 || !Number.isFinite(ap[0]) || !Number.isFinite(ap[1])) {
                delete properties.accessPoint;
            }

            delete properties._leaflet_id;

            return {
                type: "Feature",
                geometry: f.geometry,
                properties: properties
            };
        });

    return {
        type: "FeatureCollection",
        features: features
    };
}
