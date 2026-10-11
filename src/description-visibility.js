// description-visibility.js — la description d'un lieu est-elle visible pour
// l'utilisateur courant ? Source unique pour la fiche (templates.js) et le
// filtre « Lieux avec description » (data.js) : le filtre ne doit pas annoncer
// un résultat que la fiche dément à l'ouverture. Module feuille (state + utils).
import { state } from './state.js';
import { getPoiId, getPoiProp } from './utils.js';

/**
 * Faux s'il n'y a pas de texte (lecture overlay : un texte vidé localement
 * compte comme absent). Sinon :
 * - Admin : toujours (une description non publiée porte l'étiquette « Brouillon »).
 * - Description publiée (`descriptionPublic`) : pour tous.
 * - Sinon, seulement si c'est la SIENNE (11/10/2026, avec le masquage des blocs
 *   de curation de l'éditeur : un utilisateur n'a plus la case « Description
 *   publiée ») :
 *     · un lieu qu'il a créé (lieu local, `state.customFeatures`) ;
 *     · une fiche officielle dont il a RÉÉCRIT le texte. L'éditeur recopie TOUS
 *       les champs dans l'overlay `userData` à chaque enregistrement, description
 *       comprise : « présente dans userData » ne prouve donc pas qu'il l'a
 *       écrite. Seul un texte différent du texte officiel est le sien.
 * @param {object} feature
 * @returns {boolean}
 */
export function isDescriptionVisible(feature) {
    const props = feature?.properties;
    if (!props) return false;
    const text = (getPoiProp(feature, 'description') || '').trim();
    if (text === '') return false;
    if (state.isAdmin) return true;
    if (getPoiProp(feature, 'descriptionPublic')) return true;
    const poiId = getPoiId(feature);
    if ((state.customFeatures || []).some(f => getPoiId(f) === poiId)) return true;
    return text !== (props.description || '').trim();
}
