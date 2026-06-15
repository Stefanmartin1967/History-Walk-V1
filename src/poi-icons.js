// poi-icons.js — référentiel des icônes POI v2 (handoff #22, 27 icônes ocre).
// Refonte 20/05/2026 (PR2 chantier iconification) : remplace les icônes MDI
// legacy par les SVGs custom validés. viewBox 0 0 96 96. Variante OCRE PLEINE
// pour la carte (markers). Variante outline = PR3 (panneau filtres, fiche).
//
// Lookup hiérarchique : Catégorie → Sous-type (si applicable) → SVG.
// - Mosquée : 4 sous-types (À minaret / À coupoles / Fortifiée / Générique).
// - Église : 2 sous-types (Catholique / Orthodoxe).
// - Artisanat : 3 sous-types (Poterie / Huilerie / Tissage) + icône
//   « Atelier » comme générique de la catégorie (sans sous-type).
// - Les autres catégories sont mono-niveau.
//
// Utilisé par map.js (markers) + mobile-nav.js + mobile-poi.js + info-popover.

// ───── Constantes communes (issues du handoff) ─────
const G = '<line x1="10" y1="82" x2="86" y2="82" stroke="#C9A876" stroke-width="3.5" fill="none" stroke-linecap="round"/>';

function door(d) {
    return '<path d="' + d + '" fill="#5C4538" stroke="#2C2825" stroke-width="1.2"/>';
}

// Wrapper SVG. Mode "raw" = strokes seuls, pas de fill par défaut (utilisé pour
// les icônes qui définissent leur propre palette interne, ex. Site archéo).
function svgFor(paths, raw) {
    if (raw) {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
            '<g stroke="#3A332C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            paths + '</g></svg>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
        '<g fill="#C99A5C" stroke="#3A332C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        paths + '</g></svg>';
}

// ───── Les 27 icônes (paths inline, wrapper appliqué dynamiquement) ─────

// Lieux de culte — Mosquée (4 sous-types)
const I_MOSQUEE_MINARET = svgFor(G +
    '<path d="M6 82 L6 58 L58 58 L58 28 L76 28 L76 82 Z"/>' +
    '<path d="M8 58 Q8 50 16 50 Q24 50 24 58 Z"/>' +
    '<path d="M24 58 Q24 50 32 50 Q40 50 40 58 Z"/>' +
    '<path d="M40 58 Q40 50 48 50 Q56 50 56 58 Z"/>' +
    door('M28 82 L28 68 Q28 64 34 64 Q40 64 40 68 L40 82 Z') +
    '<line x1="58" y1="46" x2="76" y2="46" stroke-width="1.6"/>' +
    '<path d="M64 58 L64 52 Q64 49 67 49 Q70 49 70 52 L70 58 Z" fill="#5C4538" stroke="#2C2825" stroke-width="1.2"/>' +
    '<rect x="56" y="24" width="22" height="4"/>' +
    '<rect x="56" y="20" width="4" height="4"/>' +
    '<rect x="62" y="20" width="4" height="4"/>' +
    '<rect x="68" y="20" width="4" height="4"/>' +
    '<rect x="74" y="20" width="4" height="4"/>' +
    '<rect x="59" y="12" width="16" height="8"/>' +
    '<rect x="64" y="14" width="6" height="4" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    '<path d="M59 12 Q59 6 67 6 Q75 6 75 12 Z"/>' +
    '<line x1="67" y1="6" x2="67" y2="2" stroke-width="2"/>' +
    '<path d="M65.5 4 A 2 2 0 1 0 68.5 4 A 1.4 1.4 0 1 1 65.5 4 Z"/>'
);

const I_MOSQUEE_COUPOLES = svgFor(G +
    '<rect x="14" y="56" width="68" height="26"/>' +
    '<path d="M24 56 Q24 46 33 46 Q42 46 42 56 Z"/>' +
    '<path d="M54 56 Q54 46 63 46 Q72 46 72 56 Z"/>' +
    '<path d="M20 56 Q20 40 33 40 Q46 40 46 56 Z"/>' +
    '<path d="M50 56 Q50 40 63 40 Q76 40 76 56 Z"/>' +
    door('M42 82 L42 68 Q42 64 48 64 Q54 64 54 68 L54 82 Z') +
    '<rect x="20" y="66" width="6" height="6" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    '<rect x="70" y="66" width="6" height="6" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>'
);

const I_MOSQUEE_FORTIFIEE = svgFor(G +
    '<rect x="6" y="60" width="36" height="22"/>' +
    '<path d="M8 60 Q8 52 15 52 Q22 52 22 60 Z"/>' +
    '<path d="M26 60 Q26 52 33 52 Q40 52 40 60 Z"/>' +
    '<rect x="42" y="42" width="32" height="40"/>' +
    '<path d="M74 46 L82 46 L90 82 L74 82 Z"/>' +
    '<rect x="50" y="14" width="16" height="28"/>' +
    '<rect x="52" y="7" width="12" height="7"/>' +
    '<path d="M54 7 Q54 2 58 2 Q62 2 62 7 Z"/>' +
    '<rect x="54" y="20" width="3" height="7" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    '<rect x="59" y="20" width="3" height="7" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    '<rect x="46" y="52" width="3" height="8" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    door('M53 82 L53 66 Q53 62 58 62 Q63 62 63 66 L63 82 Z')
);

const I_MOSQUEE_GENERIQUE = svgFor(G +
    '<rect x="17" y="54" width="46" height="28"/>' +
    '<path d="M17 54 Q17 24 40 24 Q63 24 63 54 Z"/>' +
    '<line x1="40" y1="24" x2="40" y2="16" stroke-width="2.2"/>' +
    '<path d="M40 16 A 4 4 0 1 0 40 8 A 2.8 2.8 0 1 1 40 16 Z"/>' +
    '<rect x="67" y="32" width="8" height="50"/>' +
    '<polygon points="65,32 71,18 77,32"/>' +
    '<rect x="64" y="32" width="14" height="3"/>' +
    '<line x1="71" y1="18" x2="71" y2="12" stroke-width="1.8"/>' +
    '<circle cx="71" cy="9" r="2"/>' +
    door('M34 82 L34 64 Q34 60 40 60 Q46 60 46 64 L46 82 Z') +
    '<rect x="63" y="54" width="4" height="28"/>'
);

// Marabout (catégorie mono-niveau du groupe Lieux de culte)
const I_MARABOUT = svgFor(G +
    '<rect x="16" y="52" width="64" height="30"/>' +
    '<path d="M30 52 Q30 32 48 32 Q66 32 66 52 Z"/>' +
    door('M42 82 L42 64 Q42 60 48 60 Q54 60 54 64 L54 82 Z')
);

// Lieux de culte — Église (2 sous-types)
const I_EGLISE_CATHO = svgFor(G +
    '<path d="M14 82 L14 50 L48 26 L82 50 L82 82 Z"/>' +
    '<rect x="40" y="18" width="16" height="32"/>' +
    '<polygon points="38,18 48,10 58,18"/>' +
    '<line x1="48" y1="2" x2="48" y2="10" stroke-width="2"/>' +
    '<line x1="44" y1="5" x2="52" y2="5" stroke-width="2"/>' +
    '<path d="M44 32 L44 28 Q44 24 48 24 Q52 24 52 28 L52 32 Z" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    door('M42 82 L42 64 Q42 60 48 60 Q54 60 54 64 L54 82 Z')
);

const I_EGLISE_ORTHO = svgFor(G +
    '<rect x="14" y="42" width="68" height="40"/>' +
    '<path d="M38 42 Q28 28 48 14 Q68 28 58 42 Z"/>' +
    '<line x1="48" y1="4" x2="48" y2="14" stroke-width="2"/>' +
    '<line x1="46" y1="7" x2="50" y2="7" stroke-width="2"/>' +
    '<line x1="43" y1="10" x2="53" y2="10" stroke-width="2"/>' +
    '<path d="M14 42 Q10 32 20 24 Q30 32 26 42 Z"/>' +
    '<line x1="20" y1="18" x2="20" y2="24" stroke-width="2"/>' +
    '<line x1="18" y1="21" x2="22" y2="21" stroke-width="2"/>' +
    '<path d="M70 42 Q66 32 76 24 Q86 32 82 42 Z"/>' +
    '<line x1="76" y1="18" x2="76" y2="24" stroke-width="2"/>' +
    '<line x1="74" y1="21" x2="78" y2="21" stroke-width="2"/>' +
    door('M42 82 L42 64 Q42 60 48 60 Q54 60 54 64 L54 82 Z')
);

// Synagogue
const I_SYNAGOGUE = svgFor(G +
    '<rect x="18" y="30" width="60" height="52"/>' +
    '<rect x="14" y="26" width="68" height="4"/>' +
    '<circle cx="48" cy="48" r="14" fill="none" stroke-width="2"/>' +
    '<path d="M 48 36 L 51.46 42 L 58.39 42 L 54.93 48 L 58.39 54 L 51.46 54 L 48 60 L 44.54 54 L 37.61 54 L 41.07 48 L 37.61 42 L 44.54 42 Z M 51.46 42 L 54.93 48 L 51.46 54 L 44.54 54 L 41.07 48 L 44.54 42 Z" fill="#C99A5C" stroke="#3A332C" stroke-width="2" stroke-linejoin="round" fill-rule="evenodd"/>' +
    door('M42 82 L42 70 Q42 66 48 66 Q54 66 54 70 L54 82 Z')
);

// Site historique
const I_FORTIFICATION = svgFor(G +
    '<rect x="18" y="44" width="60" height="36"/>' +
    '<rect x="18" y="36" width="10" height="8"/>' +
    '<rect x="32" y="36" width="10" height="8"/>' +
    '<rect x="54" y="36" width="10" height="8"/>' +
    '<rect x="68" y="36" width="10" height="8"/>' +
    '<rect x="28" y="54" width="4" height="10" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    '<rect x="64" y="54" width="4" height="10" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    door('M40 80 L40 60 Q40 54 48 54 Q56 54 56 60 L56 80 Z')
);

// Site archéologique — raw (palette pierre #C7B795 / #807055, autonome)
const I_SITE_ARCHEO = svgFor(
    '<line x1="10" y1="82" x2="86" y2="82" stroke="#C9A876" stroke-width="3.5" fill="none" stroke-linecap="round"/>' +
    '<rect x="34" y="74" width="28" height="8" fill="#C7B795" stroke="#807055" stroke-width="2.5"/>' +
    '<path d="M40 74 L40 28 L44 26 L46 32 L50 26 L54 30 L56 26 L56 74 Z" fill="#C7B795" stroke="#807055" stroke-width="2.5" stroke-linejoin="round"/>' +
    '<line x1="44" y1="34" x2="44" y2="72" stroke="#807055" stroke-width="0.9"/>' +
    '<line x1="52" y1="34" x2="52" y2="72" stroke="#807055" stroke-width="0.9"/>' +
    '<path d="M14 82 L16 74 L24 74 L28 82 Z" fill="#C7B795" stroke="#807055" stroke-width="2.5" stroke-linejoin="round"/>' +
    '<ellipse cx="72" cy="80" rx="6" ry="3" fill="#C7B795" stroke="#807055" stroke-width="2"/>' +
    '<ellipse cx="82" cy="82" rx="3" ry="1.5" fill="#B8A88C" stroke="none"/>',
    true
);

// Site funéraire
const I_SITE_FUNERAIRE = svgFor(G +
    '<path d="M18 82 L18 60 Q18 52 26 52 Q34 52 34 60 L34 82 Z"/>' +
    '<path d="M40 82 L40 38 Q40 28 48 28 Q56 28 56 38 L56 82 Z"/>' +
    '<line x1="42" y1="50" x2="54" y2="50" stroke-width="1.5"/>' +
    '<line x1="42" y1="60" x2="54" y2="60" stroke-width="1.5"/>' +
    '<path d="M62 82 L62 56 Q62 48 70 48 Q78 48 78 56 L78 82 Z"/>'
);

// Architecture traditionnelle
const I_MENZEL = svgFor(G +
    '<rect x="10" y="64" width="30" height="18"/>' +
    '<rect x="40" y="48" width="42" height="34"/>' +
    '<path d="M48 48 Q48 32 60 32 Q72 32 72 48 Z"/>' +
    '<rect x="18" y="70" width="7" height="7"/>' +
    door('M53 82 L53 64 Q53 58 60 58 Q67 58 67 64 L67 82 Z')
);

const I_PUITS = svgFor(G +
    '<path d="M16 66 L76 66 L76 82 L16 82 Z"/>' +
    '<path d="M76 66 L84 58 L84 74 L76 82 Z"/>' +
    '<path d="M16 66 L76 66 L84 58 L24 58 Z"/>' +
    '<path d="M30 64 L62 64 L66 60 L36 60 Z" fill="#5C4538" stroke="#2C2825" stroke-width="1.2"/>' +
    '<path d="M24 58 L24 28 L26 28 L26 22 L29 22 L29 28 L31 28 L31 22 L34 22 L34 28 L36 28 L36 58 Z"/>' +
    '<path d="M72 58 L72 28 L74 28 L74 22 L77 22 L77 28 L79 28 L79 22 L82 22 L82 28 L84 28 L84 58 Z"/>' +
    '<rect x="34" y="30" width="40" height="6" rx="1.5" fill="#8B6E50" stroke="#3A332C" stroke-width="1.5"/>' +
    '<circle cx="48" cy="41" r="5" fill="#8B6E50" stroke="#3A332C" stroke-width="1.5"/>' +
    '<circle cx="48" cy="41" r="1.5" fill="#5C4538" stroke="none"/>' +
    '<line x1="48" y1="46" x2="48" y2="56" stroke-width="2"/>' +
    '<path d="M42 56 L54 56 L52 66 L44 66 Z" fill="#8B6E50" stroke="#3A332C" stroke-width="1.5"/>'
);

// Artisanat — 3 sous-types + générique « Atelier »
const I_ARTISANAT_GENERIQUE = svgFor(G +  // = Atelier (silhouette en peigne)
    '<path d="M6 60 Q14 38 22 60 Q30 38 38 60 Q46 38 54 60 Q62 38 70 60 Q78 38 86 60 L86 82 L6 82 Z"/>' +
    door('M42 82 L42 70 Q42 66 48 66 Q54 66 54 70 L54 82 Z') +
    '<rect x="14" y="70" width="3" height="7" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    '<rect x="78" y="70" width="3" height="7" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>'
);

const I_HUILERIE = svgFor(  // objet (meule), pas de ligne de sol
    '<path d="M10 82 L10 64 Q10 58 18 58 L78 58 Q86 58 86 64 L86 82 Z"/>' +
    '<ellipse cx="48" cy="60" rx="32" ry="4" fill="#5C4538" stroke="#2C2825" stroke-width="1.2"/>' +
    '<rect x="6" y="35" width="84" height="6" rx="1.5" fill="#8B6E50" stroke="#3A332C" stroke-width="1.5"/>' +
    '<circle cx="48" cy="38" r="20"/>' +
    '<circle cx="48" cy="38" r="4" fill="#5C4538" stroke="#2C2825" stroke-width="1.2"/>'
);

const I_POTERIE = svgFor(  // objet (jarre djerba), pas de ligne de sol
    '<ellipse cx="48" cy="18" rx="10" ry="3"/>' +
    '<path d="M38 18 L38 26 Q26 32 24 52 Q22 76 36 82 L60 82 Q74 76 72 52 Q70 32 58 26 L58 18 Z"/>' +
    '<path d="M28 36 Q16 42 22 56" fill="none" stroke="#3A332C" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M68 36 Q80 42 74 56" fill="none" stroke="#3A332C" stroke-width="3" stroke-linecap="round"/>' +
    '<line x1="30" y1="56" x2="66" y2="56" stroke-width="1.4"/>'
);

const I_TISSAGE = svgFor(G +
    '<rect x="10" y="14" width="76" height="7" rx="1" fill="#8B6E50" stroke="#3A332C" stroke-width="1.5"/>' +
    '<rect x="14" y="21" width="6" height="58"/>' +
    '<rect x="76" y="21" width="6" height="58"/>' +
    '<rect x="10" y="68" width="76" height="11" rx="1" fill="#8B6E50" stroke="#3A332C" stroke-width="1.5"/>' +
    '<line x1="28" y1="22" x2="28" y2="60" stroke-width="1.6"/>' +
    '<line x1="38" y1="22" x2="38" y2="60" stroke-width="1.6"/>' +
    '<line x1="48" y1="22" x2="48" y2="60" stroke-width="1.6"/>' +
    '<line x1="58" y1="22" x2="58" y2="60" stroke-width="1.6"/>' +
    '<line x1="68" y1="22" x2="68" y2="60" stroke-width="1.6"/>' +
    '<rect x="22" y="58" width="52" height="10" fill="#5C4538" stroke="#2C2825" stroke-width="1.2"/>' +
    '<line x1="22" y1="62" x2="74" y2="62" stroke="#C99A5C" stroke-width="1.2"/>' +
    '<line x1="22" y1="66" x2="74" y2="66" stroke="#C99A5C" stroke-width="1.2"/>'
);

// Culture & découvertes
const I_MUSEE = svgFor(G +
    '<rect x="10" y="72" width="76" height="10"/>' +
    '<rect x="18" y="34" width="8" height="38"/>' +
    '<rect x="34" y="34" width="8" height="38"/>' +
    '<rect x="54" y="34" width="8" height="38"/>' +
    '<rect x="70" y="34" width="8" height="38"/>' +
    '<rect x="12" y="28" width="72" height="6"/>' +
    '<polygon points="12,28 48,10 84,28"/>'
);

const I_CURIOSITE = svgFor(  // objet (œil + étoile), pas de ligne de sol
    '<path d="M10 48 Q48 22 86 48 Q48 74 10 48 Z"/>' +
    '<circle cx="48" cy="48" r="12" fill="#5C4538" stroke="#2C2825" stroke-width="1.5"/>' +
    '<circle cx="51" cy="44" r="3" fill="#C99A5C" stroke="none"/>' +
    '<polygon points="76,12 78,20 86,22 78,24 76,32 74,24 66,22 74,20"/>'
);

// Manger & boire
const I_RESTAURANT = svgFor(  // objet (couverts), pas de ligne de sol
    '<path d="M 27 12 L 30 12 L 30 32 L 33 32 L 33 12 L 36 12 L 36 32 L 39 32 L 39 12 L 42 12 L 42 32 L 45 32 L 45 12 L 48 12 L 48 32 Q 47 40 41 46 Q 42 62 40 80 Q 40 84 37.5 84 Q 35 84 35 80 Q 33 62 34 46 Q 28 40 27 32 Z"/>' +
    '<path d="M58.5 12 Q68 16 68 40 L63.5 40 Q65.5 62 63 82 Q63 84 59.5 84 Q56 84 56 82 Q53.5 62 55.5 40 L55.5 12 Z"/>'
);

const I_CAFE = svgFor(  // objet (tasse), pas de ligne de sol
    '<path d="M40 14 Q36 22 40 30" fill="none" stroke="#3A332C" stroke-width="2.6" stroke-linecap="round"/>' +
    '<path d="M52 14 Q48 22 52 30" fill="none" stroke="#3A332C" stroke-width="2.6" stroke-linecap="round"/>' +
    '<path d="M28 38 L64 38 L60 66 Q58 74 46 74 Q34 74 32 66 Z"/>' +
    '<path d="M64 42 Q78 42 78 54 Q78 66 64 66 L64 60 Q72 60 72 54 Q72 48 64 48 Z"/>' +
    '<ellipse cx="46" cy="78" rx="26" ry="4"/>'
);

const I_SALON_THE = svgFor(  // objet (théière + verre), pas de ligne de sol
    '<path d="M14 56 Q14 38 32 38 Q50 38 50 56 Q50 72 32 72 Q14 72 14 56 Z"/>' +
    '<path d="M24 38 Q24 30 32 30 Q40 30 40 38 Z"/>' +
    '<circle cx="32" cy="27" r="2.5"/>' +
    '<path d="M14 50 Q4 46 6 60 Q12 56 16 58 Z"/>' +
    '<path d="M50 46 Q60 46 60 56 Q60 64 52 64 L52 58 Q54 58 54 56 Q54 52 50 52 Z"/>' +
    '<path d="M62 40 L84 40 L80 56 Q78 60 80 64 L84 78 L62 78 L66 64 Q68 60 66 56 Z"/>' +
    '<path d="M67 58 Q72 60 79 58 L80 64 Q72 66 66 64 Z" fill="#5C4538" stroke="#2C2825" stroke-width="1.2"/>'
);

const I_PATISSERIE = svgFor(G +
    '<ellipse cx="48" cy="72" rx="34" ry="5"/>' +
    '<path d="M14 64 Q14 38 36 36 Q60 32 78 50 Q74 60 60 58 Q44 52 32 58 Q20 64 14 64 Z"/>' +
    '<circle cx="32" cy="48" r="1.5" fill="#5C4538" stroke="none"/>' +
    '<circle cx="44" cy="44" r="1.5" fill="#5C4538" stroke="none"/>' +
    '<circle cx="56" cy="46" r="1.5" fill="#5C4538" stroke="none"/>'
);

// Services & commodités
const I_HOTEL = svgFor(G +
    '<rect x="10" y="38" width="76" height="44"/>' +
    '<rect x="10" y="34" width="76" height="4"/>' +
    '<path d="M40 82 L40 60 Q40 52 48 52 Q56 52 56 60 L56 82 Z" fill="#5C4538" stroke="#2C2825" stroke-width="1.2"/>' +
    '<rect x="18" y="60" width="12" height="14" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    '<rect x="66" y="60" width="12" height="14" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    '<rect x="16" y="42" width="8" height="8" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    '<rect x="30" y="42" width="8" height="8" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    '<rect x="58" y="42" width="8" height="8" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>' +
    '<rect x="72" y="42" width="8" height="8" fill="#5C4538" stroke="#2C2825" stroke-width="1"/>'
);

const I_COMMERCE = svgFor(G +
    '<rect x="14" y="46" width="68" height="36"/>' +
    '<path d="M10 46 L86 46 L86 52 Q78 60 70 52 Q62 60 54 52 Q46 60 38 52 Q30 60 22 52 Q14 60 10 52 Z"/>' +
    '<path d="M46 82 L46 60 Q46 56 52 56 Q58 56 58 60 L58 82 Z" fill="#5C4538" stroke="#2C2825" stroke-width="1.2"/>' +
    '<rect x="20" y="58" width="20" height="16" fill="#5C4538" stroke="#2C2825" stroke-width="1.2"/>' +
    '<line x1="30" y1="58" x2="30" y2="74" stroke="#C99A5C" stroke-width="1.4"/>' +
    '<line x1="20" y1="66" x2="40" y2="66" stroke="#C99A5C" stroke-width="1.4"/>'
);

const I_TAXI = svgFor(G +
    '<rect x="38" y="22" width="20" height="10" rx="2"/>' +
    '<rect x="41" y="25" width="3" height="4" fill="#5C4538" stroke="none"/>' +
    '<rect x="47" y="25" width="3" height="4" fill="#5C4538" stroke="none"/>' +
    '<rect x="53" y="25" width="3" height="4" fill="#5C4538" stroke="none"/>' +
    '<path d="M14 64 Q14 52 24 50 L34 50 L42 36 L54 36 L62 50 L72 50 Q82 52 82 64 L82 70 L14 70 Z"/>' +
    '<circle cx="28" cy="70" r="8" fill="#5C4538" stroke="#2C2825" stroke-width="1.5"/>' +
    '<circle cx="68" cy="70" r="8" fill="#5C4538" stroke="#2C2825" stroke-width="1.5"/>' +
    '<circle cx="28" cy="70" r="2.6" fill="#C99A5C" stroke="none"/>' +
    '<circle cx="68" cy="70" r="2.6" fill="#C99A5C" stroke="none"/>'
);

const I_MARCHE = svgFor(G +
    '<polygon points="10,36 48,18 86,36"/>' +
    '<rect x="10" y="36" width="76" height="4"/>' +
    '<rect x="16" y="54" width="64" height="28"/>' +
    '<line x1="16" y1="68" x2="80" y2="68" stroke-width="1.4"/>' +
    '<line x1="36" y1="54" x2="36" y2="82" stroke-width="1.4"/>' +
    '<line x1="60" y1="54" x2="60" y2="82" stroke-width="1.4"/>' +
    '<circle cx="24" cy="48" r="6" fill="#5C4538" stroke="#2C2825" stroke-width="1.2"/>' +
    '<circle cx="48" cy="46" r="8" fill="#5C4538" stroke="#2C2825" stroke-width="1.2"/>' +
    '<circle cx="72" cy="48" r="6" fill="#5C4538" stroke="#2C2825" stroke-width="1.2"/>'
);

// Fallback générique — catégorie inconnue / non couverte / « A définir ».
const I_FALLBACK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
    '<circle cx="48" cy="48" r="38" fill="#C99A5C" stroke="#3A332C" stroke-width="2.5"/>' +
    '<text x="48" y="62" text-anchor="middle" font-size="44" font-family="sans-serif" font-weight="700" fill="#3A332C" stroke="none">?</text>' +
    '</svg>';

// ───── Lookup hiérarchique ─────
// Une entrée POI_ICONS est soit :
//   - une string (icône unique pour la catégorie sans sous-type) ;
//   - un objet { [sous-type]: svg, _default: svg } pour les catégories à
//     sous-types. _default est utilisé quand le sous-type est vide ou inconnu.
const POI_ICONS = {
    'Mosquée': {
        'À minaret': I_MOSQUEE_MINARET,
        'À coupoles': I_MOSQUEE_COUPOLES,
        'Fortifiée': I_MOSQUEE_FORTIFIEE,
        'Générique': I_MOSQUEE_GENERIQUE,
        _default: I_MOSQUEE_GENERIQUE,
    },
    'Marabout': I_MARABOUT,
    'Église': {
        'Catholique': I_EGLISE_CATHO,
        'Orthodoxe': I_EGLISE_ORTHO,
        // Par défaut Catholique : la taxonomie n'a pas de « générique » pour Église.
        _default: I_EGLISE_CATHO,
    },
    'Synagogue': I_SYNAGOGUE,
    'Fortification': I_FORTIFICATION,
    'Site funéraire': I_SITE_FUNERAIRE,
    'Site archéologique': I_SITE_ARCHEO,
    'Menzel': I_MENZEL,
    'Puits': I_PUITS,
    'Artisanat': {
        'Poterie': I_POTERIE,
        'Huilerie': I_HUILERIE,
        'Tissage': I_TISSAGE,
        // « Atelier » sert d'icône Artisanat générique (cas où le sous-type
        // n'est pas connu ou laissé vide à la saisie).
        _default: I_ARTISANAT_GENERIQUE,
    },
    'Musée': I_MUSEE,
    'Curiosité': I_CURIOSITE,
    'Restaurant': I_RESTAURANT,
    'Café': I_CAFE,
    'Salon de thé': I_SALON_THE,
    'Pâtisserie': I_PATISSERIE,
    'Hôtel': I_HOTEL,
    'Commerce': I_COMMERCE,
    'Taxi': I_TAXI,
    'Marché': I_MARCHE,
};

// ───── Exports ─────

/**
 * Map plate { catégorie → SVG } pour rétro-compatibilité. Pour les catégories
 * à sous-types, on retient l'icône `_default` (cat-level générique). Utilisé
 * par les vues qui n'affichent qu'une icône par catégorie (panneau Filtres
 * listing, grille catégories de la recherche mobile, légende info-popover…).
 */
export const iconMap = Object.fromEntries(
    Object.entries(POI_ICONS).map(([cat, entry]) =>
        [cat, typeof entry === 'string' ? entry : entry._default]
    )
);

/**
 * Retourne le HTML SVG pour une catégorie + sous-type (optionnel).
 * - Catégorie inconnue → fallback générique (cercle ocre + ?).
 * - Catégorie avec sous-types : recherche par sous-type, sinon _default.
 * - Catégorie mono-niveau : retourne directement le SVG.
 */
export function getIconHtml(category, sousType) {
    const entry = POI_ICONS[category];
    if (!entry) return I_FALLBACK;
    if (typeof entry === 'string') return entry;
    if (sousType && entry[sousType]) return entry[sousType];
    return entry._default;
}

/**
 * Retourne le HTML SVG pour un POI (feature geojson), en lisant catégorie +
 * sous-type avec priorité aux overrides `userData` sur les `properties`.
 */
export function getIconForFeature(feature) {
    const props = feature.properties || {};
    const userData = props.userData || {};
    const category = userData['Catégorie'] || props['Catégorie'];
    const sousType = userData['Sous-type'] || props['Sous-type'];
    return getIconHtml(category, sousType);
}

/**
 * Catégorie d'une étape de timeline circuit (eyebrow .cartel-step-cat, PC +
 * mobile). Source UNIQUE : icône du pack via getIconForFeature
 * (sous-type-aware) + label + variante de couleur du pill.
 * Extrait de mobile-poi.js (12/06/2026) pour servir aussi circuit-view.js,
 * qui gardait un mapping Lucide parallèle resté sur la taxonomie v1
 * (moon-star absent d'appIcons → icône invisible).
 * Le label lit userData AVANT properties, comme le lookup d'icône — sinon un
 * POI recatégorisé (userData) montre la nouvelle icône avec l'ancien label.
 * @returns {{iconHtml: string, label: string, variant: ''|'amber'|'brand'}}
 */
export function getStepCategoryDisplay(feature) {
    const props = feature?.properties || {};
    const cat = props.userData?.['Catégorie'] || props['Catégorie'] || '';
    const lower = cat.toLowerCase();
    // Resto raccourci en « Resto » sur la timeline, sinon label original.
    const label = lower === 'restaurant' ? 'Resto' : (cat || 'Lieu');
    let variant = '';
    if (lower === 'restaurant' || lower === 'café' || lower === 'cafe'
        || lower === 'curiosité' || lower === 'curiosite'
        || lower === 'pâtisserie' || lower === 'patisserie'
        || lower === 'salon de thé') variant = 'amber';
    else if (lower === 'mosquée' || lower === 'mosquee'
        || lower === 'synagogue'
        || lower === 'église' || lower === 'eglise'
        || lower === 'site religieux') variant = 'brand';
    return { iconHtml: getIconForFeature(feature), label, variant };
}

// Libellés explicites pour le générique (_default) d'une catégorie à sous-types
// quand il N'EST PAS déjà couvert par un sous-type nommé. Seul Artisanat est
// concerné aujourd'hui (son _default = l'icône « Atelier », distincte des
// métiers Poterie/Huilerie/Tissage). Mosquée/Église : leur _default duplique
// un sous-type nommé (Générique / Catholique) → pas d'entrée générique ajoutée.
const GENERIC_LABELS = { 'Artisanat': 'Atelier' };

/**
 * Structure ordonnée pour la légende exhaustive (info-popover) — chaque
 * catégorie avec TOUTES ses icônes distinctes (sous-types inclus).
 * Retourne : `[{ category, isMulti, variants: [{ label, svg }] }]`.
 *  - `isMulti=false` : catégorie mono-icône (variants = 1 entrée = la catégorie).
 *  - `isMulti=true`  : catégorie à sous-types ; variants = chaque sous-type
 *    nommé + une entrée générique si le `_default` n'est pas déjà l'un d'eux.
 * Total des variants sur l'ensemble = 27 (cf. handoff #22).
 */
export function getLegendGroups() {
    return Object.entries(POI_ICONS).map(([category, entry]) => {
        if (typeof entry === 'string') {
            return { category, isMulti: false, variants: [{ label: category, svg: entry }] };
        }
        const variants = [];
        const seenSvgs = new Set();
        for (const [label, svg] of Object.entries(entry)) {
            if (label === '_default') continue;
            variants.push({ label, svg });
            seenSvgs.add(svg);
        }
        // Générique distinct (non couvert par un sous-type nommé) → entrée dédiée.
        if (entry._default && !seenSvgs.has(entry._default)) {
            variants.push({ label: GENERIC_LABELS[category] || 'Générique', svg: entry._default });
        }
        return { category, isMulti: true, variants };
    });
}
