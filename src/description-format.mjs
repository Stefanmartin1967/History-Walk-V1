// src/description-format.mjs
// ============================================================================
// Champ « Description » (longue) d'un lieu — paragraphes + gras (**texte**) +
// liens cliquables, partagé par les DEUX surfaces qui l'affichent :
//   • l'app          → templates.js, rendu dans la fiche ;
//   • les pages SEO  → scripts/generate-poi-pages.mjs (hook postbuild, Node).
//
// Même raison d'être que source-format.mjs (même en-tête, même dépendance
// zéro DOM pour rester importable par un script Node) : la page SEO scindait
// DÉJÀ les paragraphes sur CHAQUE retour à la ligne (`desc.split(/\n+/)`),
// l'app ne faisait que des `<br>` sans distinction de paragraphe — divergence
// silencieuse entre les deux, malgré un commentaire affirmant « même
// traitement que templates.js ». Ce module devient la source unique.
//
// Chantier 10/08/2026 (Stefan, exemple église Saint-Joseph) : ajout du gras
// `**texte**` et des liens cliquables, absents jusque-là des deux surfaces.
//
// `parseDescription` rend de la DONNÉE typée, jamais du HTML — chaque surface
// écrit sa propre boucle si elle a besoin d'un rendu different. `renderHtml`
// est un raccourci pour le cas commun (échappement + attribut rel injectés
// par l'appelant, PAS hardcodés ici) : l'app pose rel="noopener noreferrer",
// les pages SEO rel="nofollow noopener" pour ne pas transmettre d'autorité
// SEO vers un site tiers cité dans une description.
// ============================================================================

const URL_REGEX = /(https?:\/\/[^\s<>"]+)/gi;
const BOLD_REGEX = /\*\*(.+?)\*\*/g;

/**
 * Découpe un paragraphe en segments typés : 'text' (normal), 'bold'
 * (`**...**`), 'link' (URL http/https nue trouvée dans le texte).
 *
 * Ordre volontaire : URL d'abord, gras ensuite DANS les segments non-URL.
 * Cas dégradé assumé (pas de parseur croisé) : un `**gras**` qui engloberait
 * une URL rendrait les `**` littéralement plutôt que du gras — rare en
 * pratique (un titre en gras ne contient normalement pas de lien collé), et
 * sans risque : jamais de HTML mal formé, juste un gras raté.
 */
function parseParagraph(paragraph) {
    const segments = [];
    paragraph.split(URL_REGEX).forEach((part, i) => {
        if (i % 2 === 1) {
            segments.push({ type: 'link', value: part });
            return;
        }
        if (!part) return;
        part.split(BOLD_REGEX).forEach((seg, j) => {
            if (!seg) return;
            segments.push({ type: j % 2 === 1 ? 'bold' : 'text', value: seg });
        });
    });
    return segments;
}

/**
 * Découpe un texte en paragraphes. CHAQUE retour à la ligne = nouveau
 * paragraphe (décision Stefan 10/08/2026 — correspond à sa façon de taper :
 * une idée par ligne, jamais besoin d'une ligne vide pour marquer une
 * coupure). Pas de notion de saut de ligne SANS nouveau paragraphe.
 *
 * @param {string} raw
 * @returns {Array<Array<{type: 'text'|'bold'|'link', value: string}>>}
 */
export function parseDescription(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return [];
    return text.split(/\n+/)
        .map(p => p.trim())
        .filter(Boolean)
        .map(parseParagraph);
}

/**
 * Rendu HTML du cas commun : un `<p>` par paragraphe, `<strong>` pour le
 * gras, `<a>` pour les liens. `escapeFn` et `linkRel` sont fournis par
 * l'appelant — ce module ne décide ni de l'échappement ni des attributs de
 * lien, cohérent avec source-format.mjs.
 *
 * @param {string} raw
 * @param {(s: string) => string} escapeFn
 * @param {string} linkRel attribut rel des liens, ex. "noopener noreferrer"
 * @returns {string} HTML (chaîne vide si `raw` est vide)
 */
export function renderDescriptionHtml(raw, escapeFn, linkRel) {
    return parseDescription(raw).map(segments => {
        const inner = segments.map(({ type, value }) => {
            const esc = escapeFn(value);
            if (type === 'bold') return `<strong>${esc}</strong>`;
            if (type === 'link') return `<a href="${esc}" target="_blank" rel="${linkRel}">${esc}</a>`;
            return esc;
        }).join('');
        return `<p>${inner}</p>`;
    }).join('');
}
