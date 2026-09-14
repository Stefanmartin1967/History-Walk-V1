// circuit-description.js — description d'un circuit : texte de l'auteur, sans signature.
//
// Pourquoi (14/09/2026) : la signature « Circuit généré par Heripia — heripia.com »
// était collée dans la description elle-même à l'enregistrement, et l'index
// publié portait cette constante pour TOUS les circuits. Résultat : aucune vraie
// description n'était visible dans l'app hors du poste de l'auteur, et la
// comparaison au diff du CC était impossible (désactivée).
//
// Règle : le circuit (mémoire, IndexedDB, index publié) ne porte QUE le texte de
// l'auteur — vide s'il n'y en a pas, et alors rien ne s'affiche (décision Stefan).
// La signature n'est ajoutée qu'au GPX (`<trk><desc>`), pour Wikiloc.
//
// Module feuille, sans dépendance.

export const CIRCUIT_SIGNATURE = 'Circuit généré par Heripia — heripia.com';

// Signatures connues, anciennes comprises : « (Créé par History Walk) »,
// « (Créé par Heripia) », « Circuit généré par History Walk. », la signature
// actuelle. Insensible à la casse, tolérant aux espaces.
const SIGNATURE_PATTERNS = [
    /\(?\s*Créé par (?:Heripia|History Walk)\s*\)?/gi,
    /Circuit généré par (?:Heripia|History Walk)(?:\s*[—–-]\s*heripia\.com)?\s*\.?/gi,
];

/**
 * Texte de l'auteur, signatures retirées, espaces de début et de fin supprimés.
 * @param {string|null|undefined} text
 * @returns {string} '' si la description ne contenait qu'une signature.
 */
export function stripCircuitSignature(text) {
    let clean = String(text ?? '');
    for (const pattern of SIGNATURE_PATTERNS) clean = clean.replace(pattern, '');
    return clean.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Description destinée au GPX : texte de l'auteur puis la signature, ou la
 * signature seule s'il n'y a pas de texte.
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function withCircuitSignature(text) {
    const clean = stripCircuitSignature(text);
    return clean ? `${clean}\n\n${CIRCUIT_SIGNATURE}` : CIRCUIT_SIGNATURE;
}
