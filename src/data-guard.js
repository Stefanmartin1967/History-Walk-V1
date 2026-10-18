// data-guard.js — écarter une donnée mal formée SANS perdre le reste.
//
// Mesuré le 18/10/2026 : une seule entrée invalide suffisait à faire tomber tout
// un pan de l'app, pour tous les visiteurs à la fois —
//   - un lieu aux coordonnées invalides (ou un Point sans coordonnées) : la
//     reconstruction des marqueurs levait une erreur → 0 marqueur sur 437 ;
//   - un lieu sans `properties` : displayGeoJSON levait → carte vide ;
//   - une entrée d'index de circuit sans id ni nom, aux poiIds non-liste, ou
//     null : loadOfficialCircuits levait → aucun circuit officiel au démarrage.
// Les données arrivent par « Tout publier », des scripts ou une retouche à la
// main sur GitHub : rares, mais l'effet est total. On trie donc à l'entrée,
// entrée par entrée, en le disant dans la console (et à l'admin, une fois).
// Module feuille : aucune dépendance.

// Entrées écartées depuis le dernier rapport (takeInvalidDataReport).
let report = { lieux: 0, circuits: 0 };

/**
 * Pourquoi ce lieu ne peut pas être affiché, ou null s'il est valide. Un lieu
 * valide a des `properties` et un Point dont les deux coordonnées sont des
 * nombres — sans position, il ne peut de toute façon pas s'afficher.
 * @param {*} feature
 * @returns {string|null}
 */
export function invalidFeatureReason(feature) {
    if (!feature || typeof feature !== 'object') return "ce n'est pas un objet";
    if (!feature.properties || typeof feature.properties !== 'object') return 'pas de properties';
    const geometry = feature.geometry;
    const c = geometry?.coordinates;
    if (geometry?.type !== 'Point' || !Array.isArray(c) || c.length < 2
        || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
        return 'position invalide';
    }
    return null;
}

/**
 * Les lieux valides de `features`, dans l'ordre. Chaque lieu écarté est signalé
 * dans la console (identifiant + raison) et compté pour le rapport admin. Ne
 * modifie pas la liste reçue.
 * @param {*} features  liste lue (un non-tableau donne [])
 * @param {string} source  d'où vient la liste, pour la console
 * @returns {Array}
 */
export function keepValidFeatures(features, source) {
    if (!Array.isArray(features)) return [];
    return features.filter((feature) => {
        const reason = invalidFeatureReason(feature);
        if (!reason) return true;
        report.lieux++;
        const id = feature?.properties?.HW_ID ?? feature?.id ?? '(sans identifiant)';
        console.warn(`[Données] Lieu ignoré (${source}) : ${id} — ${reason}.`);
        return false;
    });
}

/**
 * Pourquoi cette entrée de l'index des circuits est inutilisable, ou null.
 * `poiIds` absent reste accepté (liste vide), comme avant.
 * @param {*} entry
 * @returns {string|null}
 */
export function invalidCircuitEntryReason(entry) {
    if (!entry || typeof entry !== 'object') return "ce n'est pas un objet";
    const hasId = entry.id !== undefined && entry.id !== null && entry.id !== '';
    const hasName = typeof entry.name === 'string' && entry.name.trim() !== '';
    if (!hasId && !hasName) return 'ni identifiant ni nom';
    if (entry.poiIds !== undefined && !Array.isArray(entry.poiIds)) return "poiIds n'est pas une liste";
    return null;
}

/**
 * Les entrées valides de l'index des circuits, dans l'ordre. Même signalement
 * que keepValidFeatures.
 * @param {*} entries  index lu (un non-tableau donne [])
 * @param {string} source
 * @returns {Array}
 */
export function keepValidCircuitEntries(entries, source) {
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry) => {
        const reason = invalidCircuitEntryReason(entry);
        if (!reason) return true;
        report.circuits++;
        const label = entry?.id ?? entry?.name ?? '(sans identifiant)';
        console.warn(`[Données] Circuit ignoré (${source}) : ${label} — ${reason}.`);
        return false;
    });
}

/**
 * Nombre d'entrées écartées depuis le dernier appel, puis remise à zéro.
 * @returns {{lieux: number, circuits: number}}
 */
export function takeInvalidDataReport() {
    const taken = report;
    report = { lieux: 0, circuits: 0 };
    return taken;
}

/**
 * Texte du toast admin, ou null si rien n'a été écarté. Publier avant d'avoir
 * corrigé la source retirerait ces lieux du fichier publié (« Tout publier »
 * régénère le fichier depuis les lieux chargés).
 * @param {{lieux: number, circuits: number}} r
 * @returns {string|null}
 */
export function invalidDataMessage({ lieux, circuits }) {
    const parts = [];
    if (lieux > 0) parts.push(`${lieux} lieu${lieux > 1 ? 'x' : ''}`);
    if (circuits > 0) parts.push(`${circuits} circuit${circuits > 1 ? 's' : ''}`);
    if (parts.length === 0) return null;
    const plural = lieux + circuits > 1;
    return `${parts.join(' et ')} ignoré${plural ? 's' : ''} : données invalides, à corriger avant de publier (détail dans la console).`;
}
