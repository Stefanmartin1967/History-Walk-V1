// overlay-base.js — conflits à la publication (18/11/2026, maquette « Conflits
// à la publication » validée par Stefan).
//
// Le problème : une fiche modifiée sur deux appareils avant publication. Le
// premier publie ; le second publie ensuite par-dessus, champ par champ, sans
// alerte (la « Grotte des Sarrasins », 17/11/2026).
//
// Le principe : quand un champ publié entre dans l'overlay d'un appareil
// (première modification), on note la VERSION de la carte sur laquelle il a été
// modifié — le SHA git du geojson chargé (`_baseSha[champ]`). Au Centre de
// contrôle, si la carte en ligne a changé depuis, on relit cette ancienne
// version pour connaître la « valeur de départ » du champ :
//   - en ligne = départ         → personne d'autre n'y a touché : modification normale ;
//   - en ligne = valeur d'ici   → l'autre appareil a publié la même chose : rien à faire ;
//   - sinon                     → CONFLIT : quelqu'un a publié autre chose entre-temps.
//
// Pourquoi la version (SHA) plutôt que la valeur elle-même : l'estampille se pose
// à UN seul endroit (savePoiData, par où passent toutes les écritures de fiche,
// une vingtaine de sites), sans avoir à retrouver la valeur publiée au moment
// d'écrire — impossible pour la position, que le déplacement a déjà réécrite.
// Pas d'heure d'appareil non plus (fausse sur un téléphone).

import { PERSONAL_KEYS } from './config.js';

/** Clé de l'overlay qui porte les estampilles { champ: sha }. */
export const BASE_KEY = '_baseSha';

// Champs publiés mais hors du suivi : photos et cadrage ont leur propre flux de
// publication ; candidate est une curation (pas une valeur disputée) ; Zone est
// dérivée des coordonnées.
const UNTRACKED = new Set(['photos', 'photoFocus', 'candidate', 'Zone', 'mapId', 'poiId']);

/** Clé de l'overlay soumise au suivi des conflits. */
export function isTrackedKey(key) {
    return typeof key === 'string'
        && !key.startsWith('_')
        && !PERSONAL_KEYS.includes(key)
        && !UNTRACKED.has(key);
}

/**
 * Estampilles à ajouter quand un enregistrement est écrit : les champs suivis
 * qui ENTRENT dans l'overlay (absents de l'enregistrement déjà en base) et
 * n'ont pas encore d'estampille. Un champ déjà présent sans estampille (écrit
 * avant le 18/11/2026) reste sans : sa valeur de départ est inconnue.
 * @param {object|null} existing enregistrement en base avant écriture
 * @param {object} data valeurs écrites
 * @param {string|null} sha version de la carte chargée
 * @returns {object|null} { champ: sha } ou null
 */
export function newStamps(existing, data, sha) {
    if (!sha || !data) return null;
    const known = { ...(existing?.[BASE_KEY] || {}), ...(data[BASE_KEY] || {}) };
    const out = {};
    for (const key of Object.keys(data)) {
        if (!isTrackedKey(key) || key in known) continue;
        if (existing && existing[key] !== undefined) continue;
        if (data[key] === undefined) continue;
        out[key] = sha;
    }
    return Object.keys(out).length > 0 ? out : null;
}

/**
 * Retire d'un overlay les estampilles des champs qui n'y sont plus ; supprime
 * `_baseSha` s'il est vide. Modifie l'objet en place et le renvoie.
 */
export function pruneStamps(overlay) {
    if (!overlay || !overlay[BASE_KEY]) return overlay;
    const stamps = overlay[BASE_KEY];
    for (const key of Object.keys(stamps)) {
        if (overlay[key] === undefined) delete stamps[key];
    }
    if (Object.keys(stamps).length === 0) delete overlay[BASE_KEY];
    return overlay;
}

// ─── Comparaison ─────────────────────────────────────────────────────────────

function norm(v) {
    if (v === undefined || v === null || v === '') return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v).replace(/\r\n/g, '\n').trim();
}

/** Deux valeurs de champ équivalentes (vide = absent ; texte sans blancs de bord). */
export function sameValue(a, b) {
    return norm(a) === norm(b);
}

const TEXT_KEYS = new Set(['description', 'Description', 'Source', 'Horaires', 'info_gpx']);

/** 'text' (trois zones) ou 'simple' (un choix). */
export function kindOf(key, ...values) {
    if (TEXT_KEYS.has(key)) return 'text';
    return values.some(v => typeof v === 'string' && v.length > 80) ? 'text' : 'simple';
}

const fmtPos = (lng, lat) => `${(+lat).toFixed(5)}, ${(+lng).toFixed(5)}`;

function coordsOf(feature) {
    const c = feature?.geometry?.coordinates;
    return Array.isArray(c) && c.length >= 2 ? [c[0], c[1]] : null;
}

/**
 * Conflits d'une fiche.
 * @param {object} p
 * @param {object} p.userData overlay de la fiche (avec `_baseSha`)
 * @param {object|null} p.online fiche en ligne (null : absente)
 * @param {string|null} p.onlineSha version en ligne
 * @param {(sha: string) => (object|null|undefined)} p.baseOf fiche dans une
 *   ancienne version : objet, null (absente de cette version) ou undefined
 *   (version illisible → on ne conclut rien)
 * @returns {Array<{key: string, kind: 'simple'|'text'|'position', base: *, online: *, local: *}>}
 */
export function findConflicts({ userData, online, onlineSha, baseOf }) {
    const stamps = userData?.[BASE_KEY];
    if (!stamps || !online || !onlineSha) return [];
    const out = [];
    let positionDone = false;

    for (const [key, sha] of Object.entries(stamps)) {
        if (!sha || sha === onlineSha || userData[key] === undefined) continue;
        const baseFeature = baseOf(sha);
        if (baseFeature === undefined) continue;

        if (key === 'lat' || key === 'lng') {
            if (positionDone) continue;
            positionDone = true;
            if (userData.lat === undefined || userData.lng === undefined) continue;
            const onlineC = coordsOf(online);
            const baseC = coordsOf(baseFeature);
            if (!onlineC) continue;
            const onlineS = fmtPos(onlineC[0], onlineC[1]);
            const localS = fmtPos(userData.lng, userData.lat);
            const baseS = baseC ? fmtPos(baseC[0], baseC[1]) : '';
            if (onlineS !== baseS && onlineS !== localS) {
                out.push({
                    key: 'position', kind: 'position',
                    base: baseC ? [baseC[1], baseC[0]] : null,
                    online: [onlineC[1], onlineC[0]],
                    local: [+userData.lat, +userData.lng],
                });
            }
            continue;
        }

        const onlineVal = online.properties?.[key];
        const baseVal = baseFeature ? baseFeature.properties?.[key] : undefined;
        const localVal = userData[key];
        if (!sameValue(onlineVal, baseVal) && !sameValue(onlineVal, localVal)) {
            out.push({ key, kind: kindOf(key, onlineVal, localVal, baseVal), base: baseVal, online: onlineVal, local: localVal });
        }
    }
    return out;
}

// ─── Fiche officielle mise à jour depuis la modification d'un user ──────────
// (20/11/2026, PR 4 du chantier « synchro users », maquette écrans 20-22.)
//
// Un user modifie la description officielle ; plus tard, Stefan la corrige et
// publie. Sans rien de plus, le user voit SA version à jamais (son overlay
// prime) et n'apprend pas qu'il existe mieux. Côté user, pas de SHA de la carte
// (chargée sans GitHub) : on note donc la VALEUR officielle du champ au moment
// où il entre dans l'overlay (`_officialBase[champ]`, null = champ absent).
// Au démarrage et à l'affichage de la fiche :
//   - valeur du user = officielle actuelle → la modification ne sert plus : retirée ;
//   - officielle actuelle ≠ valeur notée  → « mise à jour depuis votre modification » ;
//   - sinon rien.
// La position n'est pas suivie (le déplacement réécrit la géométrie avant
// l'écriture : la valeur de départ n'est plus lisible).

/** Clé de l'overlay : { champ: valeur officielle au moment de la modification }. */
export const OFFICIAL_BASE_KEY = '_officialBase';

const POSITION_KEYS = new Set(['lat', 'lng']);

/**
 * Valeurs officielles à noter quand un enregistrement est écrit : les champs
 * suivis qui ENTRENT dans l'overlay et n'ont pas encore la leur.
 * @param {object|null} existing enregistrement en base avant écriture
 * @param {object} data valeurs écrites
 * @param {object|null} officialProps properties de la fiche officielle chargée
 * @returns {object|null} { champ: valeur } ou null
 */
export function newOfficialBases(existing, data, officialProps) {
    if (!data || !officialProps) return null;
    const known = { ...(existing?.[OFFICIAL_BASE_KEY] || {}), ...(data[OFFICIAL_BASE_KEY] || {}) };
    const out = {};
    for (const key of Object.keys(data)) {
        if (!isTrackedKey(key) || POSITION_KEYS.has(key) || key in known) continue;
        if (existing && existing[key] !== undefined) continue;
        if (data[key] === undefined) continue;
        out[key] = officialProps[key] === undefined ? null : officialProps[key];
    }
    return Object.keys(out).length > 0 ? out : null;
}

/** Retire les valeurs notées des champs qui ne sont plus dans l'overlay (en place). */
export function pruneOfficialBases(overlay) {
    const bases = overlay?.[OFFICIAL_BASE_KEY];
    if (!bases) return overlay;
    for (const key of Object.keys(bases)) {
        if (overlay[key] === undefined) delete bases[key];
    }
    if (Object.keys(bases).length === 0) delete overlay[OFFICIAL_BASE_KEY];
    return overlay;
}

/**
 * Champs d'une fiche dont l'officiel a changé depuis la modification du user.
 * @returns {{updates: Array<{key, kind, base, official, local}>, obsolete: string[]}}
 *          `obsolete` : champs que le user a modifiés comme l'officiel actuel (à retirer)
 */
export function findOfficialUpdates(userData, officialProps) {
    const res = { updates: [], obsolete: [] };
    const bases = userData?.[OFFICIAL_BASE_KEY];
    if (!bases || !officialProps) return res;
    for (const [key, base] of Object.entries(bases)) {
        const local = userData[key];
        if (local === undefined) continue;
        const official = officialProps[key];
        if (sameValue(local, official)) res.obsolete.push(key);
        else if (!sameValue(base, official)) {
            res.updates.push({ key, kind: kindOf(key, official, local, base), base: base ?? '', official: official ?? '', local });
        }
    }
    return res;
}
