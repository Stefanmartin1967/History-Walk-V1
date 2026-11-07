// photo-focus.js
// ─── Cadrage vertical d'une photo d'en-tête (admin, 07/11/2026) ──────────────
// Le bandeau photo (hero) fait 200 px de haut pour environ deux fois plus de
// large : une photo paysage y entre toujours en largeur et n'est coupée qu'en
// haut et en bas. L'admin choisit, sur PC, quelle hauteur garder (mode
// « Cadrer » de la fiche). Résultat affiché partout : fiche PC et mobile,
// couverture de circuit PC et mobile.
//
// DONNÉE : champ patrimonial `photoFocus` du POI, publié avec le data :
//   { "<nom du fichier>": <0..100> }   0 = haut de la photo, 100 = bas.
// Absent = photo centrée (50), comme avant. Clé = NOM DE FICHIER, pas l'adresse
// complète : le déménagement vers un dépôt de photos (photos-move.js) change
// l'adresse mais garde le nom. Réglage PAR PHOTO : changer de photo principale
// ne lui applique pas le cadrage de l'ancienne. Lecture via getPoiProp
// (overlay d'abord), écriture via updatePoiData (overlay → Centre de Contrôle).
import { getPoiProp } from './utils.js';

export const FOCUS_KEY = 'photoFocus';

/** Nom de fichier d'une photo publiée ; null pour un blob/data (pas de clé stable). */
export function photoKey(url) {
    if (typeof url !== 'string' || !url) return null;
    if (/^(blob|data):/i.test(url)) return null;
    const clean = url.split(/[?#]/)[0];
    const name = clean.slice(clean.lastIndexOf('/') + 1);
    return name || null;
}

/** Borne et arrondit une position verticale (%). */
export function clampFocus(y) {
    const n = Math.round(Number(y));
    if (!Number.isFinite(n)) return 50;
    return Math.min(100, Math.max(0, n));
}

/** Position verticale enregistrée pour cette photo de ce lieu, ou null (centrée). */
export function getPhotoFocus(feature, url) {
    const key = photoKey(url);
    if (!key) return null;
    const map = getPoiProp(feature, FOCUS_KEY);
    const y = map && typeof map === 'object' ? map[key] : undefined;
    return Number.isFinite(y) ? clampFocus(y) : null;
}

/**
 * Nouvelle valeur du champ après réglage de `url` à `y`. Pure. Ne garde que les
 * photos encore présentes dans `photos` (les cadrages de photos retirées
 * partent au passage). y = 50 (centre) retire la clé : c'est le défaut.
 * Renvoie null quand plus aucune photo n'est cadrée (le champ est alors vidé).
 */
export function withPhotoFocus(current, photos, url, y) {
    const keep = new Set((Array.isArray(photos) ? photos : []).map(photoKey).filter(Boolean));
    const next = {};
    if (current && typeof current === 'object') {
        for (const [k, v] of Object.entries(current)) {
            if (keep.has(k) && Number.isFinite(v)) next[k] = clampFocus(v);
        }
    }
    const key = photoKey(url);
    if (key && keep.has(key)) {
        const v = clampFocus(y);
        if (v === 50) delete next[key];
        else next[key] = v;
    }
    // Clés triées : même objet = même JSON, quel que soit l'ordre des réglages
    // (le Centre de Contrôle compare au publié par JSON).
    const keys = Object.keys(next).sort();
    if (keys.length === 0) return null;
    return Object.fromEntries(keys.map((k) => [k, next[k]]));
}

/** Nombre de photos cadrées (résumé du Centre de Contrôle). */
export function countFramed(map) {
    return map && typeof map === 'object' ? Object.values(map).filter(Number.isFinite).length : 0;
}
