// scripts/check-gabarit.mjs
// ============================================================
// Contrôle du Gabarit des descriptions de fiche (20/10/2026).
//
// Le Gabarit (C:\Heripia\Documentation\Gabarit des descriptions de fiche.md)
// est la référence de forme de la « Description complète » et du champ
// « Source ». Chaque fil de travail le relit, mais rien ne vérifiait le
// résultat : une dérive passait inaperçue jusqu'à ce qu'un autre fil tombe
// dessus (cas du 20/10 : dix fiches avaient repris la date des publications
// Facebook dans la phrase « Sur place, le 7 novembre 2025, … »).
//
// Ce script LIT les données publiées (public/<destination>.geojson) et liste,
// fiche par fiche, les écarts de FORME qu'on peut vérifier mécaniquement. Il
// n'écrit rien. Il ne remplace pas la relecture de fond (d'où vient chaque
// phrase, Gabarit §0) : il retient la forme, quel que soit le fil.
//
// Usage :
//   npm run gabarit                              toutes les fiches publiques de Djerba
//   npm run gabarit -- --fiche "Mosquée Ténafsa" seulement ces fiches (option répétable,
//                                                nom exact ou HW_ID) : à lancer avant
//                                                de dire « fait » sur une série
//   npm run gabarit -- --regle date-dans-la-phrase
//   npm run gabarit -- --dest hammamet --brouillons
// Code de sortie : 1 s'il reste au moins un écart, 0 sinon.
//
// Une règle nouvelle du Gabarit qui se vérifie mécaniquement s'ajoute ici,
// avec son test (tests/check_gabarit.test.js) et son paragraphe du Gabarit.
// Caractères spéciaux visés par une règle : toujours en séquence \uXXXX dans
// ce fichier, jamais en clair (un caractère invisible ne se relit pas).
// ============================================================

import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeOsmRef } from '../src/osm-ref.mjs';

const MOIS = '(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)';
const DATE_EN_LETTRES = new RegExp(`\\b\\d{1,2}(?:er)? ${MOIS} \\d{4}\\b`, 'i');
const MOIS_ANNEE = new RegExp(`\\b${MOIS} \\d{4}\\b`, 'i');
const URL_JALEL = 'http://palaisbenayed.com/wp-content/uploads/2021/03/r%C3%A9pertoire-des-mosqu%C3%A9es-de-Djerba.pdf';

/** Le texte sans ce qui est entre guillemets (« … » ou "…") : une citation
 *  garde ses mots (« très récente » chez Jalel n'est pas un intensif). */
export function horsGuillemets(texte) {
    return String(texte ?? '').replace(/«[^»]*»/g, '« »').replace(/"[^"]*"/g, '""');
}

const lignes = (texte) => String(texte ?? '').split('\n').map(l => l.trim()).filter(Boolean);
const phrases = (ligne) => ligne.split(/(?<=[.!?])\s+(?=\p{Lu})/u);
const estPhrase = (l) => !l.includes(' | ') && !estUrl(l) && (mots(/^sur place\b/i).test(l) || /\.$/.test(l));
const estUrl = (s) => /^(https?:\/\/|www\.)\S+$/i.test(s);
const extrait = (s, max = 110) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

// `\b` ne connaît que les lettres ASCII : une lettre accentuée devant ou
// derrière crée une fausse frontière de mot (« mêmes » contenait « mes »,
// faux positif du 23/10/2026). Les règles qui cherchent des mots français
// passent par `mots()`, qui remplace `\b` par une frontière Unicode.
const LETTRE = '[\\p{L}\\p{N}_]';
const BORNE = `(?:(?<=${LETTRE})(?!${LETTRE})|(?<!${LETTRE})(?=${LETTRE}))`;
/** La même expression, avec des frontières de mot Unicode (drapeau u). */
export const mots = (re) => new RegExp(re.source.replace(/\\b/g, BORNE), re.flags.includes('u') ? re.flags : re.flags + 'u');

// Marques de sens (U+200E/F, U+202A-E, U+2066-9), espaces et jointures sans
// largeur (U+200B-D, U+2060-4), BOM. Les espaces insécables (U+00A0, U+202F)
// sont de la typographie normale et ne sont PAS visés.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;
/** Champs en français où l'on colle du texte : titre, description, Source, Description GPX. */
const champsColles = (p) => [p['Nom du site FR'] || '', ...lignes(p.description), ...lignes(p.Source), ...lignes(p.info_gpx)]
    .filter(Boolean);

/** Chaque règle : un identifiant stable, le paragraphe du Gabarit, un titre,
 *  et `trouver(props)` qui rend la liste des extraits fautifs (vide = conforme). */
export const REGLES = [
    // ─── Titre ───────────────────────────────────────────────────────────────
    {
        id: 'titre', gabarit: '§3 bis',
        titre: 'Titre : une qualité qui vieillit ou un numéro n\'est pas un nom (« Mosquée X (Ancienne) »)',
        trouver: (p) => [p['Nom du site FR'] || ''].filter(n =>
            mots(/^(?:Ancienne?|Nouvelle?|Neuve?|Vieille?)\b/i).test(n) || /\s(?:\d|I{1,3})$/.test(n)),
    },
    // ─── Description ─────────────────────────────────────────────────────────
    {
        id: 'date-dans-la-phrase', gabarit: '§1, §3 quater',
        titre: 'Date de visite dans la phrase (elle va dans la Source)',
        trouver: (p) => lignes(p.description).filter(l =>
            mots(new RegExp(`\\bsur place,? (?:le|du) \\d{1,2}(?:er)? ${MOIS}`, 'i')).test(l)
            || mots(/\b(?:lors de|pendant) (?:ma|notre|la) visite (?:du|le) \d/i).test(l)),
    },
    {
        id: 'date-en-chiffres', gabarit: '§2, §3',
        titre: 'Date en chiffres (JJ/MM/AAAA) : l\'écrire en toutes lettres',
        trouver: (p) => [...lignes(p.description), ...lignes(p.Source)]
            .filter(l => /(?<![\w/.%-])\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?![\w/.%-])/.test(l.replace(/https?:\/\/\S+/g, ''))),
    },
    {
        id: 'datation-jalel', gabarit: '§2',
        titre: 'Datation de Jalel sans guillemets : écrire de datation « ancienne »',
        // Seule la phrase du répertoire compte : la phrase suivante peut citer
        // Wikipédia (« la donne également abandonnée et très ancienne »).
        trouver: (p) => lignes(p.description).filter(l => phrases(l).some(ph => /l'inscrit au n°/i.test(ph)
            && mots(/(?:[,:]|\bet)\s+(?:de datation\s+)?(?:très\s+)?(?:ancienne?s?|récente?s?)\s*(?=[.,;)]|$)/i).test(horsGuillemets(ph)))),
    },
    {
        id: 'ancienne-mosquee-en-tete', gabarit: '§2',
        titre: '« Ancienne mosquée » en tête se lit « ex-mosquée »',
        trouver: (p) => lignes(p.description).slice(0, 1).filter(l => mots(/^Ancienne mosquée\b/i).test(l)),
    },
    {
        id: 'siecle', gabarit: '§2',
        titre: 'Siècle : chiffres arabes et ᵉ en exposant (16ᵉ siècle)',
        trouver: (p) => lignes(p.description).filter(l =>
            mots(/\b[IVXL]{1,6}(?:e|è|ème|ᵉ|-ème)?\s+siècle/).test(l)
            || mots(/\b\d{1,2}(?:e|è|ème|eme|-ème|-e)\s+siècle/i).test(l)),
    },
    {
        id: 'hegire-sans-conversion', gabarit: '§2',
        titre: 'Date de l\'hégire sans sa conversion (« 1210 de l\'hégire, soit 1795 »)',
        trouver: (p) => lignes(p.description).filter(l => {
            const re = /\d+(?:ᵉ siècle)? de l'hégire/gi;
            let m;
            while ((m = re.exec(l))) {
                const suite = l.slice(m.index + m[0].length, m.index + m[0].length + 60);
                if (!/\b\d{3,4}\b|\d+ᵉ siècle/.test(suite)) return true;
            }
            return false;
        }),
    },
    {
        id: 'lien-dans-description', gabarit: '§2',
        titre: 'Lien dans la description (les URL vont dans la Source)',
        trouver: (p) => lignes(p.description).filter(l => /https?:\/\/|\bwww\./i.test(l)),
    },
    {
        id: 'facebook', gabarit: '§2',
        titre: 'Publication Facebook citée (exclue depuis le 07/10/2026)',
        // Ramzi Raïs = inventaire publié sur Facebook. « Rais67 » est le compte
        // Commons de Mounir : une photo Commons n'est pas une publication Facebook.
        trouver: (p) => [...lignes(p.description), ...lignes(p.Source)]
            .filter(l => /facebook|fb\.com|Ramzi Ra[iï]s|inventaire de Ra[iï]s/i.test(l)),
    },
    {
        id: 'guillemets', gabarit: '§2',
        titre: 'Guillemets : français, fermés, avec espaces (« … »)',
        trouver: (p) => [...lignes(p.description), ...lignes(p.Source).map(l => l.split(' | ')[0])].filter(l =>
            (l.match(/«/g) || []).length !== (l.match(/»/g) || []).length
            || /"/.test(l)
            || /«(?![\s\u00A0\u202F])/.test(l) || /(?<![\s\u00A0\u202F])»/.test(l)),
    },
    // Les deux règles suivantes portent aussi sur le titre et la Description GPX :
    // ce qu'on y colle vient des mêmes sources (21/10/2026 : 14 apostrophes
    // courbes, dont certaines venues des textes de Claude, et un caractère
    // invisible dans le titre « Mosquée d'Elyounsiine »).
    {
        id: 'apostrophe-courbe', gabarit: '§2',
        titre: 'Apostrophe courbe (\u2019) : l\'apostrophe droite du clavier (\') partout',
        trouver: (p) => champsColles(p).filter(l => /[\u2018\u2019]/.test(l)),
    },
    {
        id: 'caractere-invisible', gabarit: '§2',
        titre: 'Caractère invisible collé (marque de sens, espace sans largeur…)',
        trouver: (p) => [...champsColles(p), ...lignes(p['Nom du site arabe'])]
            .filter(l => INVISIBLE.test(l))
            .map(l => l.replace(new RegExp(INVISIBLE.source, 'g'),
                c => `⟨U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}⟩`)),
    },
    {
        id: 'premiere-personne', gabarit: '§2, §3 ter',
        titre: 'Forme impersonnelle : pas de « nous », « vous », « je »',
        trouver: (p) => lignes(p.description).filter(l =>
            mots(/\b(?:nous|notre|nos|vous|votre|vos|je|mon|mes)\b|\bj['\u2019]/i).test(horsGuillemets(l).replace(mots(/\bnotre ère\b|\bnotre[- ]dame\b/gi), ''))),
    },
    {
        id: 'intensif', gabarit: '§2',
        titre: 'Intensif ou adjectif de remplissage',
        trouver: (p) => lignes(p.description).filter(l =>
            mots(/\b(?:très|clairement|vraiment|absolument|magnifiques?|superbes?|splendides?|sublimes?|incroyables?|extraordinaires?|exceptionnel(?:le)?s?)\b/i)
                .test(horsGuillemets(l).replace(mots(/\btrès (?:ancienne?s?|récente?s?)\b/gi), ''))),
    },
    {
        id: 'remplissage', gabarit: '§2, §3 ter',
        titre: 'Phrase de remplissage ou d\'invitation',
        trouver: (p) => lignes(p.description).filter(l =>
            /à ne pas manquer|vaut le détour|à découvrir|ne manquez pas|incontournable/i.test(horsGuillemets(l))),
    },
    {
        id: 'transcription-jalel', gabarit: '§2',
        titre: 'Entrée de Jalel recopiée (à paraphraser)',
        trouver: (p) => lignes(p.description).filter(l =>
            /Jalel n° ?\d+\s*[—–-]/.test(l) || /«\s*Mosquée [^»]*\.\s[^»]*»/.test(l)),
    },
    {
        id: 'lecture-satellite', gabarit: '§3 ter',
        titre: 'Lecture de satellite ou Street View (note privée, pas description)',
        trouver: (p) => lignes(p.description).filter(l => /satellite|street ?view|vue aérienne/i.test(l)),
    },
    {
        id: 'ligne-vide', gabarit: '§1',
        titre: 'Ligne vide entre deux paragraphes',
        trouver: (p) => (/\n[ \t]*\n/.test(String(p.description ?? '').trim()) ? ['(ligne vide)'] : []),
    },
    {
        // El Cheikh (Houmt Souk), 23/10/2026 : « mosquée ibadite de 1548.Sur place, … »,
        // un retour à la ligne perdu au collage. Minuscule, chiffre ou guillemet
        // fermant, puis un point collé à une majuscule.
        id: 'phrase-collee', gabarit: '§1',
        titre: 'Deux phrases collées (point suivi d\'une majuscule sans espace)',
        trouver: (p) => lignes(p.description).filter(l => /[\p{Ll}\d»)]\.\p{Lu}/u.test(l)),
    },
    {
        // Amghar, 23/10/2026 : la phrase UNESCO collée deux fois, l'ancienne
        // ligne restée au-dessus de la nouvelle.
        id: 'ligne-en-double', gabarit: '§1',
        titre: 'Ligne en double dans la description',
        trouver: (p) => lignes(p.description).filter((l, i, ls) => ls.indexOf(l) !== i),
    },
    {
        id: 'credit-osm', gabarit: '§3 ter',
        titre: 'Crédit OSM : « Prénom Nom - OpenStreetMap, année » (ou pseudonyme) en dernière ligne',
        // Pseudonyme admis tel qu'il est écrit sur OSM, minuscules comprises
        // (« rjaksic - OpenStreetMap, 2023 », Wersighen) : décision du 24/10/2026.
        trouver: (p) => {
            const ls = lignes(p.description);
            return ls.filter((l, i) => /OpenStreetMap, \d{4}\s*$/.test(l)
                && (i !== ls.length - 1 || !/^(?:\p{Lu}[\p{L}'.-]*(?: \p{L}[\p{L}'.-]*)*|[\p{L}\p{N}_.-]+) - OpenStreetMap, \d{4}$/u.test(l)));
        },
    },
    // ─── Source ──────────────────────────────────────────────────────────────
    {
        id: 'url-nue', gabarit: '§3',
        titre: 'URL nue en Source (s\'affiche comme un nom de domaine) : la libeller',
        trouver: (p) => lignes(p.Source).filter(l => !l.includes(' | ') && estUrl(l)),
    },
    {
        // Ben Omran, 21/10/2026 : en retirant la ligne OSM, c'est l'adresse de la
        // ligne Commons qui a été coupée. La partie droite du dernier « | » doit
        // être une adresse, sinon l'app affiche toute la ligne en simple texte.
        id: 'libelle-sans-adresse', gabarit: '§3',
        titre: 'Ligne « Libellé | … » sans adresse après la barre (s\'affiche en simple texte)',
        trouver: (p) => lignes(p.Source).filter(l => l.includes('|')
            && !estUrl(l.slice(l.lastIndexOf('|') + 1).trim())),
    },
    {
        // Règle du 21/10/2026 : le lien vers l'objet OSM de la fiche vient de
        // osm_ref (bouton de l'app, lien des pages publiques) ; une ligne de Source
        // vers le MÊME objet fait doublon. Un autre objet reste admis.
        id: 'osm-en-double', gabarit: '§3 ter',
        titre: 'Ligne OSM vers l\'objet de la fiche : doublon du bouton OSM (le lien vient de osm_ref)',
        trouver: (p) => {
            const ref = normalizeOsmRef(p.osm_ref);
            if (!ref) return [];
            return lignes(p.Source).filter(l => {
                const m = l.match(/openstreetmap\.org\/((?:node|way|relation)\/\d+)/i);
                return m && normalizeOsmRef(m[1]) === ref;
            });
        },
    },
    {
        id: 'source-sur-deux-lignes', gabarit: '§3',
        titre: 'Libellé et URL sur deux lignes (retour à la ligne au lieu de « | »)',
        trouver: (p) => {
            const ls = lignes(p.Source);
            return ls.filter((l, i) => i + 1 < ls.length && !l.includes(' | ') && !estUrl(l) && estUrl(ls[i + 1]));
        },
    },
    {
        id: 'phrase-en-source', gabarit: '§3',
        titre: 'Phrase de description collée dans la Source (ligne sans lien finie par un point)',
        trouver: (p) => lignes(p.Source).filter(estPhrase),
    },
    {
        id: 'sur-place-sans-date', gabarit: '§3',
        titre: 'Relevé sur place sans date en toutes lettres',
        trouver: (p) => lignes(p.Source).filter(l => /sur place/i.test(l) && !l.includes(' | ') && !estPhrase(l)
            && !/\d{1,2}\/\d{1,2}/.test(l) // déjà signalé par date-en-chiffres
            && !DATE_EN_LETTRES.test(l) && !(/visites/i.test(l) && MOIS_ANNEE.test(l))),
    },
    {
        id: 'forme-observation', gabarit: '§3',
        titre: 'Forme de l\'observation : « Observation sur place, le … » ou « … et observation sur place, le … »',
        // Sans date, la ligne relève déjà de sur-place-sans-date : un seul signalement.
        trouver: (p) => lignes(p.Source).filter(l => mots(/observations?\b/i).test(l) && !l.includes(' | ') && !estPhrase(l)
            && (DATE_EN_LETTRES.test(l) || MOIS_ANNEE.test(l) || /\d{1,2}\/\d{1,2}/.test(l))
            && !/^Observation sur place(?: et [^,]+)?, (?:le |lors de )/.test(l) && !/ et observation sur place, le /.test(l)),
    },
    {
        id: 'forme-jalel', gabarit: '§3',
        titre: `Forme du répertoire : « Répertoire J. Fathallah, n° N | ${URL_JALEL.slice(0, 40)}… »`,
        trouver: (p) => lignes(p.Source).filter(l => /palaisbenayed\.com\/wp-content\/uploads\/2021\/03\/r/i.test(l)
            && !new RegExp(`^Répertoire J\\. Fathallah, n° \\d+ \\| ${URL_JALEL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`).test(l)),
    },
    {
        id: 'forme-wikipedia', gabarit: '§3',
        titre: 'Forme Wikipédia : « Wikipédia, « Titre » | URL »',
        // Une URL Wikipédia nue relève déjà de url-nue : un seul signalement.
        trouver: (p) => lignes(p.Source).filter(l => /wikipedia\.org/i.test(l) && !estUrl(l)
            && !/^Wikipédia, « [^»]+ » \| https?:\/\//.test(l)),
    },
];

/** Écarts d'une fiche : [{ regle, extrait }] (vide = conforme au Gabarit). */
export function controlerFiche(props, regles = REGLES) {
    const ecarts = [];
    for (const regle of regles) {
        for (const e of regle.trouver(props || {})) ecarts.push({ regle: regle.id, extrait: extrait(e) });
    }
    return ecarts;
}

/** Fiches à contrôler : publiques par défaut (`descriptionPublic`), ou toutes
 *  celles qui ont une description ou une Source avec `brouillons`. */
export function fichesAControler(features, { brouillons = false, fiches = [] } = {}) {
    let liste = (features || []).filter(f => {
        const p = f.properties || {};
        if (p.userData?._deleted) return false;
        return brouillons ? !!(p.description || p.Source) : !!p.descriptionPublic;
    });
    if (fiches.length) {
        const voulues = new Set(fiches.map(s => s.trim()));
        liste = (features || []).filter(f => voulues.has(f.properties?.['Nom du site FR']) || voulues.has(f.properties?.HW_ID));
        const trouvees = new Set(liste.flatMap(f => [f.properties['Nom du site FR'], f.properties.HW_ID]));
        const absentes = [...voulues].filter(v => !trouvees.has(v));
        if (absentes.length) throw new Error(`Fiche(s) introuvable(s) : ${absentes.join(' ; ')}`);
    }
    return liste;
}

function lireArguments(argv) {
    const opts = { dest: 'djerba', brouillons: false, fiches: [], regle: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dest') opts.dest = argv[++i];
        else if (a === '--brouillons') opts.brouillons = true;
        else if (a === '--fiche') opts.fiches.push(argv[++i]);
        else if (a === '--regle') opts.regle = argv[++i];
        else throw new Error(`Option inconnue : ${a}`);
    }
    return opts;
}

function main() {
    const opts = lireArguments(process.argv.slice(2));
    const racine = resolve(import.meta.dirname, '..');
    const geojson = JSON.parse(readFileSync(join(racine, 'public', `${opts.dest}.geojson`), 'utf8'));
    const regles = opts.regle ? REGLES.filter(r => r.id === opts.regle) : REGLES;
    if (!regles.length) throw new Error(`Règle inconnue : ${opts.regle} (voir REGLES dans ce fichier)`);

    const fiches = fichesAControler(geojson.features, opts);
    const parRegle = new Map(regles.map(r => [r.id, 0]));
    let nbFichesEnEcart = 0;
    const sortie = [];
    for (const f of fiches) {
        const ecarts = controlerFiche(f.properties, regles);
        if (!ecarts.length) continue;
        nbFichesEnEcart++;
        sortie.push(`■ ${f.properties['Nom du site FR']}`);
        for (const e of ecarts) {
            parRegle.set(e.regle, parRegle.get(e.regle) + 1);
            sortie.push(`    [${e.regle}] ${e.extrait}`);
        }
    }

    const portee = opts.fiches.length ? `${fiches.length} fiche(s) demandée(s)`
        : `${fiches.length} fiches ${opts.brouillons ? 'avec description ou Source' : 'à description publique'}`;
    console.log(`Contrôle du Gabarit — ${opts.dest}, ${portee}\n`);
    if (sortie.length) console.log(sortie.join('\n') + '\n');
    console.log('Par règle :');
    for (const r of regles) {
        const n = parRegle.get(r.id);
        if (n || opts.regle) console.log(`  ${String(n).padStart(4)}  ${r.id.padEnd(26)} ${r.gabarit.padEnd(14)} ${r.titre}`);
    }
    const total = [...parRegle.values()].reduce((a, b) => a + b, 0);
    console.log(total ? `\n${total} écart(s) dans ${nbFichesEnEcart} fiche(s).` : '\nAucun écart : conforme au Gabarit.');
    process.exitCode = total ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    try { main(); } catch (e) { console.error(e.message); process.exitCode = 2; }
}
