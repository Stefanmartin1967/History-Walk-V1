// official-updates.js — « La fiche officielle a été mise à jour depuis votre
// modification » (20/11/2026, PR 4 du chantier « synchro users », maquette
// écrans 20-22 validée par Stefan).
//
// Un user a modifié un champ d'une fiche officielle (sa version prime, overlay
// userData) ; l'officiel a changé depuis. Principe et détection : overlay-base.js
// (`_officialBase`, noté à la première modification par overlay-base-hook.js).
//   - au démarrage : une modification devenue identique à l'officiel est retirée
//     sans rien dire ; les fiches mises à jour depuis sont annoncées UNE fois ;
//   - dans la fiche : bandeau + « Voir » (templates.js, ui-details.js) ;
//   - « Voir » : version officielle (nouvelle) / votre version, une case par
//     phrase, ce qui sera affiché ; « Revenir à la version officielle »,
//     « Plus tard », « Garder ce texte ».
// Rien pour l'admin (il a les conflits à la publication) ni pour un lieu créé.

// Ce module-ci : la détection et le bandeau, sans écriture (lu par templates.js,
// qui ne doit pas tirer la base de données). La passe du démarrage, la fenêtre
// et l'enregistrement : official-update-ui.js.

import { state } from './state.js';
import { getPoiId } from './utils.js';
import { findOfficialUpdates } from './overlay-base.js';

export function featureOf(poiId) {
    return state.loadedFeatures?.find(f => getPoiId(f) === poiId) || null;
}

/** Ni admin, ni lieu créé (même règle qu'isCustomPoi, poi-persistence.js, qui tire la base). */
export function applies(poiId) {
    return !state.isAdmin && !(state.customFeatures || []).some(f => getPoiId(f) === poiId);
}

/** Champs de la fiche dont l'officiel a changé depuis la modification du user. */
export function officialUpdatesOf(poiId) {
    if (!applies(poiId)) return [];
    const feature = featureOf(poiId);
    return feature ? findOfficialUpdates(state.userData?.[poiId], feature.properties).updates : [];
}

/** Bandeau de la fiche (templates.js). Téléphone : bouton sous le texte. */
export function officialBannerHtml(poiId, mobile) {
    if (!officialUpdatesOf(poiId).length) return '';
    return `<div class="poi-official-update${mobile ? ' poi-official-update--stack' : ''}" role="status"><i data-lucide="refresh-cw"></i><span><strong>La fiche officielle a été mise à jour depuis votre modification.</strong> Vous voyez votre version.</span><button class="poi-official-update-btn" type="button" id="poi-official-see">Voir</button></div>`;
}
