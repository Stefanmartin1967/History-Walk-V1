// src/source-format.mjs
// ============================================================================
// Champ « Source » d'un lieu — analyse partagée par les DEUX surfaces qui
// l'affichent :
//   • l'app          → renderSource (src/templates.js), rendu dans la fiche ;
//   • les pages SEO  → scripts/generate-poi-pages.mjs (hook postbuild, Node).
//
// Pourquoi un module, et pourquoi .mjs alors que tout src/ est en .js :
// la seconde surface avait sa propre lecture du champ (`safeSource`), qui ne
// reconnaissait que l'URL nue. La forme « Libellé | URL » introduite en #908
// y retournait null — la source DISPARAISSAIT de la page statique. Une seule
// règle, deux consommateurs. Le package est `type: "commonjs"` : un `.js`
// importé par un script Node serait chargé en CommonJS et sa syntaxe `export`
// planterait ; `.mjs` est de l'ESM sous Node comme sous Vite. L'extension
// SIGNALE donc « module partagé avec les scripts de build » → garder ce
// fichier pur : aucune dépendance au DOM, aucun import d'état applicatif.
//
// Ce module rend de la DONNÉE, jamais du HTML : chaque surface applique son
// propre échappement (escapeXml côté app, escapeHtml côté script) et ses
// propres attributs de lien (l'app met rel="noopener noreferrer", les pages
// SEO y ajoutent nofollow).
// ============================================================================

// Le champ accepte du texte libre (« Répertoire Jalel Fathallah, #207 »,
// « Martine Gendron — groupe mosquées de djerba »). On ne peut PAS s'en
// remettre à `new URL()` pour trancher texte/URL : le parseur des navigateurs
// n'échoue quasiment jamais — `https://martine gendron` devient un lien vers
// « martine%20gendron », et une phrase accentuée un hostname punycode
// illisible (xn--…). Le repli texte du catch était du code mort côté Chrome.
// D'où ce test de forme explicite, AVANT toute construction d'URL. Exporté
// pour être testé directement : un test qui passerait par `new URL()`
// mesurerait le parseur de l'environnement (Node/jsdom rejette, Chrome
// accepte) et non la règle.
export function looksLikeUrl(value) {
    if (/^https?:\/\//i.test(value)) return true;
    // Domaine nu : aucun espace, un point, puis un TLD alphabétique.
    return /^[^\s/]+\.[a-z]{2,}(?:[/?#]|$)/i.test(value);
}

/**
 * Découpe une saisie « Libellé | URL ». Le séparateur est le DERNIER `|` : un
 * libellé de source peut contenir une barre verticale, une URL non (elle
 * serait percent-encodée). Retourne null si la forme n'est pas celle-là —
 * auquel cas l'appelant retombe sur « URL seule ou texte seul ».
 */
function splitLabelledSource(value) {
    const i = value.lastIndexOf('|');
    if (i === -1) return null;
    const label = value.slice(0, i).trim();
    const url = value.slice(i + 1).trim();
    if (!label || !looksLikeUrl(url)) return null;
    return { label, url };
}

/**
 * Complète le schéma d'un domaine nu et extrait le domaine d'affichage.
 * Null si l'URL casse malgré `looksLikeUrl`.
 *
 * On renvoie la chaîne COMPLÉTÉE, pas `new URL().href` : le parseur normalise
 * (« exemple.org » → « https://exemple.org/ », caractères ré-encodés) et
 * changerait le href de fiches déjà publiées sans rien apporter. `new URL` ne
 * sert donc qu'à deux choses — valider, et lire le hostname.
 *
 * Le schéma est ainsi toujours http(s) par construction : soit la saisie
 * commençait par `https?://`, soit on l'a préfixée. Aucun `javascript:` ni
 * `data:` ne peut ressortir d'ici (leçon audit S4).
 */
function toHref(url) {
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    try {
        return { href: full, domain: new URL(full).hostname.replace(/^www\./, '') };
    } catch (_) {
        return null;
    }
}

/**
 * Analyse UNE ligne du champ. Retourne toujours quelque chose d'affichable :
 * `{ text, url }` avec `url` à null quand la ligne est du texte.
 *
 * Garde-fou de non-masquage : si la partie droite d'un `|` n'est pas une URL
 * (« Relevé sur place | mai 2026 »), on n'invente pas de lien et on n'escamote
 * pas la moitié de la saisie — la ligne ENTIÈRE s'affiche en texte.
 */
function parseSourceLine(line) {
    const labellisee = splitLabelledSource(line);
    if (labellisee) {
        const lien = toHref(labellisee.url);
        if (lien) return { text: labellisee.label, url: lien.href };
    }
    if (looksLikeUrl(line)) {
        const lien = toHref(line);
        // Sans libellé, on montre le DOMAINE : une URL brute est illisible.
        if (lien) return { text: lien.domain, url: lien.href };
    }
    return { text: line, url: null };
}

/**
 * Analyse le champ complet — UNE SOURCE PAR LIGNE. Les lignes vides sont
 * ignorées. Retourne [] si le champ est vide ou n'est pas une chaîne.
 *
 * Avant ce module, seule la première ligne était lue et les suivantes étaient
 * silencieusement perdues (cas mesuré : « Mosquée Ouilihi » portait une
 * seconde source que personne n'avait jamais vue).
 */
export function parseSources(raw) {
    if (!raw || typeof raw !== 'string') return [];
    return raw
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(parseSourceLine);
}
