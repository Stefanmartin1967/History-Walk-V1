// place-twins.js — lieux au même endroit (PR 8 du chantier « synchro users »,
// maquette écrans 47-51 validée par Stefan le 22/11/2026). Détection SANS base de
// données (templates.js l'utilise pour le bandeau de la fiche). Fenêtres et
// écritures : place-twins-ui.js.
//
//  - Avant de créer un lieu : les lieux à moins de 50 m (officiels ou à vous) —
//    une question, jamais un refus (deux lieux proches ne sont pas forcément le
//    même : une église et le monument à son pied, leçon Scout du 13/11).
//  - Un lieu officiel publié plus tard au même endroit qu'un lieu que vous aviez
//    créé : « Même lieu ? » (bandeau dans la fiche, ligne dans « À choisir »).
//    « Pas le même lieu » est retenu pour la paire (setTwinAnswers).

import { state } from './state.js';
import { getPoiId, calculateDistance, isCandidate, escapeXml } from './utils.js';

export const TWIN_RADIUS_M = 50;

let answers = {}; // « custom|officiel » → 'different'

/** Réponses retenues (chargées par place-twins-ui.js au démarrage). */
export function setTwinAnswers(next) { answers = next && typeof next === 'object' ? next : {}; }
export const twinKey = (customId, officialId) => `${customId}|${officialId}`;

const latLngOf = (f) => {
    const c = f?.geometry?.coordinates;
    return Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? { lat: c[1], lng: c[0] } : null;
};
const isCustom = (id) => (state.customFeatures || []).some(f => getPoiId(f) === id);
const isHidden = (id) => (state.hiddenPoiIds || []).includes(id);

/** « 20 m » */
export function formatMeters(m) {
    return `${Math.max(1, Math.round(m))} m`;
}

/**
 * Lieux affichés à moins de `radius` mètres d'un point, du plus proche au plus loin.
 * @returns {Array<{feature:object, id:string, dist:number}>}
 */
export function nearbyPlaces(lat, lng, { radius = TWIN_RADIUS_M, max = 3, excludeId = null, officialOnly = false } = {}) {
    const out = [];
    for (const f of state.loadedFeatures || []) {
        const id = getPoiId(f);
        if (!id || id === excludeId || f?.properties?._pending || isHidden(id)) continue;
        if (officialOnly && (isCustom(id) || isCandidate(f))) continue;
        const p = latLngOf(f);
        if (!p) continue;
        const dist = calculateDistance(lat, lng, p.lat, p.lng);
        if (dist <= radius) out.push({ feature: f, id, dist });
    }
    return out.sort((a, b) => a.dist - b.dist).slice(0, max);
}

/** Le lieu officiel au même endroit qu'un de vos lieux (sauf « pas le même »), ou null. */
export function officialTwinOf(customId) {
    if (state.isAdmin || !isCustom(customId)) return null;
    const f = (state.loadedFeatures || []).find(x => getPoiId(x) === customId);
    const p = latLngOf(f);
    if (!f || !p || f.properties?._pending) return null;
    const found = nearbyPlaces(p.lat, p.lng, { excludeId: customId, officialOnly: true, max: 5 })
        .find(n => answers[twinKey(customId, n.id)] !== 'different');
    return found ? { customId, officialId: found.id, official: found.feature, custom: f, dist: found.dist } : null;
}

/** Tous vos lieux qui ont un lieu officiel au même endroit (« À choisir »). */
export function listOfficialTwins() {
    if (state.isAdmin) return [];
    return (state.customFeatures || []).map(f => officialTwinOf(getPoiId(f))).filter(Boolean);
}

/** Bandeau de la fiche d'un de vos lieux (écran 48). */
export function twinBannerHtml(poiId, mobile = false) {
    const twin = officialTwinOf(poiId);
    if (!twin) return '';
    const name = twin.official.properties?.['Nom du site FR'] || 'Lieu officiel';
    return `
        <div class="poi-twin${mobile ? ' poi-twin--stack' : ''}" role="note">
            <span class="poi-twin-text"><i data-lucide="copy"></i><span>Un lieu officiel a été publié au même endroit : <b>${escapeXml(name)}</b> (à ${formatMeters(twin.dist)}). C'est le même ?</span></span>
            <button type="button" class="poi-twin-see" id="poi-twin-see" data-poi="${escapeXml(poiId)}">Voir</button>
        </div>`;
}
