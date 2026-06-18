// poi-persistence.js — persistance d'une édition de champs sur un POI, partagée
// par les DEUX éditeurs de POI (richEditor.executeEdit ET ui-photo-batch
// .saveTaxonomyBatch). Module FEUILLE (n'importe que state / database / utils →
// aucun cycle), pour empêcher la dérive entre les deux éditeurs (cf. l'historique
// « deux éditeurs de POI » où l'un corrige un bug que l'autre réintroduit).
//
// RÈGLE CARDINALE (extraite de richEditor.executeEdit) :
//   - POI de BASE / officiel → modèle d'OVERLAY `userData` : userData prime sur
//     properties à l'affichage (getPoiProp) et est aplati dans le geojson à la
//     publication. On écrit donc l'édition dans userData.
//   - POI CUSTOM (capturé par le Scout / créé en local) → PAS de patrimoine de
//     base à surcoucher : l'édition s'écrit DANS le POI (feature.properties +
//     customPois_{id}), et on retire de l'overlay UNIQUEMENT les clés qu'on vient
//     de réécrire (un overlay obsolète sur CES clés les masquerait). On NE touche
//     PAS au reste de l'overlay (photos, accessPoint, vu…) qui, pour un custom,
//     n'existe QUE là. Sans cette règle, à la publication (overlay aplati puis
//     effacé) la fusion « custom gagne » remettrait les properties BRUTES par-
//     dessus et MASQUERAIT la version curée de GitHub — c'est le revert de
//     curation qu'on évite, SANS détruire l'enrichissement (perte de données).
import { state } from './state.js';
import { saveAppState, savePoiData, deletePoiData } from './database.js';
import { getPoiId } from './utils.js';

/**
 * Persiste `data` (paires champ→valeur) sur le POI `poiId`, en routant vers le
 * bon canal selon que le POI est custom ou de base. Ne fait QUE la persistance —
 * l'appelant garde ses effets propres (commitPendingPoi, log, toast, addToDraft,
 * eventBus, applyFilters, refresh markers).
 *
 * @param {string} poiId
 * @param {Object} data  champs à écrire (ex. { 'Catégorie': 'Musée', 'Sous-type': '' })
 */
export async function persistPoiEdit(poiId, data) {
    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    const isCustom = (state.customFeatures || []).some(f => getPoiId(f) === poiId);

    if (isCustom && feature) {
        Object.assign(feature.properties, data);
        // Champ vidé ("" / null) → on retire la clé (parité avec executeCreate) ;
        // les valeurs false / 0 (verified, Temps_minutes, Prix_TND) sont conservées.
        Object.keys(data).forEach(k => {
            if (feature.properties[k] === '' || feature.properties[k] === null) {
                delete feature.properties[k];
            }
        });
        // Anti-revert SANS perte de données : getPoiProp lit l'overlay EN PREMIER,
        // donc un overlay obsolète sur une clé qu'on vient d'écrire dans properties
        // la masquerait. On retire donc de l'overlay UNIQUEMENT les clés réécrites
        // (celles de `data`) — JAMAIS le reste (photos, accessPoint, vu/vuManual…),
        // qui pour un POI custom n'existe QUE dans l'overlay : le purger en bloc
        // effacerait l'enrichissement (capture Scout enrichie puis re-catégorisée).
        // Le store per-POI (savePoiData/deletePoiData) est la source rechargée au
        // boot (getAllPoiDataForMap) → on l'aligne sur l'overlay restant.
        const overlay = state.userData[poiId];
        if (overlay) {
            Object.keys(data).forEach((k) => { delete overlay[k]; });
            if (Object.keys(overlay).length === 0) {
                delete state.userData[poiId];
                delete feature.properties.userData;
                try { await deletePoiData(state.currentMapId, poiId); } catch (e) { console.warn('[persistPoiEdit] purge du store poiUserData échouée (une clé obsolète pourrait réapparaître au reload) :', e); }
            } else {
                feature.properties.userData = overlay; // enrichissement résiduel reste lisible
                // savePoiData MERGE (database.js) → il ne SUPPRIME jamais une clé du
                // store. Or on vient d'en retirer (la clé taxonomie réécrite) : sans
                // remplacement, le store garderait la version obsolète, getAllPoiDataForMap
                // la ressortirait au boot et masquerait la valeur curée (revert au reload).
                // On REMPLACE donc l'entrée (delete puis save) pour que le store reflète
                // EXACTEMENT l'overlay courant.
                try { await deletePoiData(state.currentMapId, poiId); } catch (e) { console.warn('[persistPoiEdit] purge du store poiUserData échouée (une clé obsolète pourrait réapparaître au reload) :', e); }
                await savePoiData(state.currentMapId, poiId, overlay);
            }
            await saveAppState('userData', state.userData);
        } else {
            delete feature.properties.userData;
        }
        // Réplique dans le tableau custom (même référence en général ; défensif sinon).
        const cIdx = (state.customFeatures || []).findIndex(f => getPoiId(f) === poiId);
        if (cIdx !== -1) state.customFeatures[cIdx].properties = feature.properties;
        await saveAppState(`customPois_${state.currentMapId}`, state.customFeatures);
        await saveAppState('lastGeoJSON', { type: 'FeatureCollection', features: state.loadedFeatures });
    } else {
        // POI de base / officiel : overlay userData.
        if (!state.userData[poiId]) state.userData[poiId] = {};
        Object.assign(state.userData[poiId], data);
        // Rebind feature.properties.userData au cas où une opération antérieure
        // aurait cassé la référence (spread au lieu d'alias) → sinon modif persistée
        // mais le panel Détails lit l'ancienne copie.
        if (feature) feature.properties.userData = state.userData[poiId];
        await savePoiData(state.currentMapId, poiId, state.userData[poiId]);
    }
}
