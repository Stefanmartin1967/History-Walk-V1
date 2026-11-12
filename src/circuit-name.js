// circuit-name.js — Un nom de circuit = un fichier GPX publié : il doit être UNIQUE
// dans la destination (12/11/2026).
//
// Le GPX publié s'appelle `public/circuits/<dest>/<nom>.gpx`. Deux circuits au
// même nom écrivaient donc le MÊME fichier : le second écrasait le premier, et
// renommer l'un supprimait le fichier de l'autre. Arrivé aux deux boucles de Rym
// Beach : « Boucler » recalcule le nom, et les deux sont devenues « Boucle autour
// de Rym Beach ».
//
// Règles (décidées avec Stefan le 12/11/2026) :
//  - nom AUTOMATIQUE déjà pris → on ajoute « via <lieu du milieu> » au circuit
//    en cours (jamais à l'autre : on ne touche pas à ce qu'on ne modifie pas) ;
//    lieu pris ensuite, en s'écartant du milieu ; en dernier recours « (2) »…
//  - nom TAPÉ À LA MAIN déjà pris → on ne le change pas (c'est un choix de
//    l'auteur) : message à l'enregistrement, publication refusée tant qu'il
//    reste en double (admin-control-center.js).
//  - deux noms qui ne diffèrent que par la casse ou les accents comptent comme un
//    doublon : sur Windows, deux fichiers ainsi nommés n'en font qu'un.
//
// Module pur : pas d'état, pas de DOM. Les appelants lui passent les circuits.

/** Forme de comparaison : minuscules, sans accents, espaces réduits. */
export function normalizeCircuitName(name) {
    return String(name || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Noms (normalisés) déjà pris par les AUTRES circuits de la destination.
 * @param {Array<{id:any,name:string,isDeleted?:boolean}>} circuits
 * @param {any} selfId id du circuit en cours (exclu) ; null pour une création
 * @returns {Set<string>}
 */
export function takenCircuitNames(circuits, selfId) {
    const taken = new Set();
    for (const c of circuits || []) {
        if (!c || c.isDeleted) continue;
        if (selfId != null && String(c.id) === String(selfId)) continue;
        if (c.name) taken.add(normalizeCircuitName(c.name));
    }
    return taken;
}

/**
 * Autre circuit portant déjà ce nom (comparaison normalisée), ou null.
 * @returns {object|null}
 */
export function findCircuitWithSameName(name, circuits, selfId) {
    const n = normalizeCircuitName(name);
    if (!n) return null;
    return (circuits || []).find(c => c && !c.isDeleted
        && !(selfId != null && String(c.id) === String(selfId))
        && normalizeCircuitName(c.name) === n) || null;
}

/**
 * Nom automatique rendu unique.
 * @param {string} baseName nom calculé (« Circuit de A à B », « Boucle autour de A »)
 * @param {string[]} stepNames noms des étapes, dans l'ordre (extrémités comprises)
 * @param {Set<string>} taken noms normalisés déjà pris (takenCircuitNames)
 * @returns {string}
 */
export function uniqueAutoCircuitName(baseName, stepNames, taken) {
    const free = (n) => !taken.has(normalizeCircuitName(n));
    if (free(baseName)) return baseName;

    // Lieux du milieu (extrémités exclues), du centre vers les bords :
    // milieu, puis le suivant, le précédent, etc. Sans les noms des extrémités
    // ni les répétitions.
    const names = stepNames || [];
    const ends = new Set([names[0], names[names.length - 1]].map(normalizeCircuitName));
    const inner = names.slice(1, -1);
    const mid = Math.floor((inner.length - 1) / 2);
    const order = [];
    for (let d = 0; d < inner.length; d++) {
        if (mid + d < inner.length) order.push(mid + d);
        if (d > 0 && mid - d >= 0) order.push(mid - d);
    }
    const seen = new Set();
    for (const i of order) {
        const poi = inner[i];
        const key = normalizeCircuitName(poi);
        if (!key || ends.has(key) || seen.has(key)) continue;
        seen.add(key);
        const candidate = `${baseName} via ${poi}`;
        if (free(candidate)) return candidate;
    }
    for (let k = 2; ; k++) {
        const candidate = `${baseName} (${k})`;
        if (free(candidate)) return candidate;
    }
}
