// search.js
import { state } from './state.js';
import { getPoiId, getPatrimonialName, getSearchableNames } from './data.js';
import { getCurrentPatrimonialLang } from './patrimonial-names.js';

/**
 * Filtre les POIs chargés en fonction d'une requête textuelle.
 *
 * Recherche AGNOSTIQUE à la langue : le matching porte sur TOUTES les variantes
 * de nom (FR, arabe, custom — getSearchableNames), donc on retrouve un lieu en
 * tapant son nom FR OU arabe quel que soit le réglage d'affichage (chercher ≠
 * afficher). Le tri, lui, suit la langue affichée (collation locale).
 *
 * @param {string} query - Le texte recherché (sera mis en minuscules).
 * @param {Array} features - La liste des features à filtrer (par défaut state.loadedFeatures).
 * @returns {Array} - Liste des features correspondantes.
 */
export function getSearchResults(query, features = state.loadedFeatures) {
    if (!query || query.trim().length === 0) return [];

    const normalizedQuery = query.toLowerCase().trim();

    const filteredFeatures = features.filter(f => {
        const poiId = getPoiId(f);

        // On ne montre pas les lieux cachés/supprimés
        if (state.hiddenPoiIds && state.hiddenPoiIds.includes(poiId)) {
            return false;
        }

        // Matche n'importe quelle variante de nom (FR, arabe, custom).
        return getSearchableNames(f).some(n => n.toLowerCase().includes(normalizedQuery));
    });

    // Tri alphabétique dans la langue AFFICHÉE (collation arabe en AR, française
    // sinon) → l'ordre suit ce que l'utilisateur lit.
    const locale = getCurrentPatrimonialLang() === 'ar' ? 'ar' : 'fr';
    return filteredFeatures.sort((a, b) =>
        getPatrimonialName(a).localeCompare(getPatrimonialName(b), locale, { sensitivity: 'base' })
    );
}
