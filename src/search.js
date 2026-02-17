// search.js
import { state } from './state.js';
import { getPoiId, getPoiName } from './data.js';

/**
 * Filtre les POIs chargés en fonction d'une requête textuelle.
 * Prend en compte le nom officiel, le nom personnalisé et les filtres de visibilité (POI cachés).
 *
 * @param {string} query - Le texte recherché (sera mis en minuscules).
 * @param {Array} features - La liste des features à filtrer (par défaut state.loadedFeatures).
 * @returns {Array} - Liste des features correspondantes.
 */
export function getSearchResults(query, features = state.loadedFeatures) {
    if (!query || query.trim().length === 0) return [];

    const normalizedQuery = query.toLowerCase().trim();

    return features.filter(f => {
        const poiId = getPoiId(f);

        // On ne montre pas les lieux cachés/supprimés
        if (state.hiddenPoiIds && state.hiddenPoiIds.includes(poiId)) {
            return false;
        }

        // Recherche sur le nom affiché (qui prend en compte les modifications utilisateur)
        const displayedName = getPoiName(f).toLowerCase();

        return displayedName.includes(normalizedQuery);
    });
}
