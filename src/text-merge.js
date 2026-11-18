// text-merge.js — fusion de deux versions d'un texte à partir de leur départ
// commun, phrase par phrase (18/11/2026, conflits à la publication).
//
// Écran « Texte : trois zones » : « En ligne » et « Ici » ont chacune changé la
// description. Quand leurs changements touchent des phrases différentes, la
// version finale est pré-remplie avec les deux réunis ; quand la même phrase a
// été changée des deux côtés, la version finale garde celle d'ici et le passage
// est signalé, avec l'autre version à côté. Module pur (testé sans DOM).

/** Découpe un texte en phrases, blancs de fin compris (concaténer rend le texte). */
export function splitSentences(text) {
    const t = String(text ?? '');
    if (!t) return [];
    return t.match(/[^.!?…\n]*(?:[.!?…]+["»”')\]]*|\n|$)\s*/g).filter(s => s.length > 0);
}

const key = (s) => s.replace(/\s+/g, ' ').trim();

/** Indices appariés (plus longue sous-suite commune) entre deux listes de phrases. */
function lcsPairs(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = key(a[i]) === key(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const pairs = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (key(a[i]) === key(b[j])) { pairs.push([i, j]); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
    }
    return pairs;
}

/**
 * Phrases d'une version, marquées « changée » quand elles ne viennent pas du
 * départ (surlignage des zones « En ligne » et « Ici »).
 * @returns {Array<{text: string, changed: boolean}>}
 */
export function markChanges(base, version) {
    const b = splitSentences(base);
    const v = splitSentences(version);
    const kept = new Set(lcsPairs(b, v).map(([, j]) => j));
    return v.map((text, j) => ({ text, changed: !kept.has(j) }));
}

/** Recolle des phrases ; une espace entre deux phrases qui n'en ont pas. */
function join(parts) {
    let out = '';
    for (const p of parts) {
        if (out && p && !/\s$/.test(out) && !/^\s/.test(p)) out += ' ';
        out += p;
    }
    return out;
}

/**
 * Changements d'une version par rapport au départ : remplacer les phrases
 * [s, e) du départ par `repl` (s = e : insertion avant la phrase s).
 */
function editsOf(B, X) {
    const pairs = [...lcsPairs(B, X), [B.length, X.length]];
    const edits = [];
    let pb = 0, px = 0;
    for (const [i, j] of pairs) {
        // `lead` : blanc qui suit, dans cette version, la phrase d'avant le
        // changement (ex. retour à la ligne avant une phrase ajoutée en fin).
        const lead = px > 0 ? X[px - 1].match(/\s*$/)[0] : '';
        if (i > pb || j > px) edits.push({ s: pb, e: i, repl: X.slice(px, j), lead });
        pb = i + 1; px = j + 1;
    }
    return edits;
}

// Deux changements touchent-ils la même partie du départ ?
// Deux AJOUTS au même endroit ne se gênent pas : ils sont réunis (celui d'ici
// d'abord) — sauf si le départ était vide, où chacun a écrit son propre texte
// (« Grotte des Sarrasins », 18/11/2026) : là, c'est un conflit.
function overlaps(a, b, baseEmpty) {
    const insA = a.s === a.e, insB = b.s === b.e;
    if (insA && insB) return baseEmpty && a.s === b.s;
    if (insA) return a.s > b.s && a.s < b.e;
    if (insB) return b.s > a.s && b.s < a.e;
    return a.s < b.e && b.s < a.e;
}

const sameEdit = (a, b) => a.s === b.s && a.e === b.e && key(join(a.repl)) === key(join(b.repl));

// Texte d'une version sur la partie [s, e) du départ.
function regionText(B, edits, s, e) {
    const out = [];
    let i = s;
    const inside = edits.filter(d => d.s >= s && d.e <= e).sort((x, y) => x.s - y.s || x.e - y.e);
    for (const d of inside) {
        out.push(...B.slice(i, d.s), ...d.repl);
        i = Math.max(i, d.e);
    }
    out.push(...B.slice(i, e));
    // Texte BRUT : retours à la ligne compris (avant le 18/11/2026, il était
    // normalisé → la version finale perdait les retours à la ligne du passage
    // disputé ; constaté par Stefan sur la « Grotte des Sarrasins »).
    return join(out);
}

/**
 * Fusion à trois : départ, ici, en ligne.
 * @returns {{ text: string, clean: boolean, conflicts: Array<{ here: string, online: string }> }}
 *   `text` : version finale proposée (en cas de conflit, la version d'ici du
 *   passage) ; `conflicts` : passages changés des deux côtés.
 */
export function mergeTexts(base, here, online) {
    const B = splitSentences(base), H = splitSentences(here), O = splitSentences(online);
    const eh = editsOf(B, H).map(d => ({ ...d, side: 'h' }));
    const eo = editsOf(B, O).map(d => ({ ...d, side: 'o' }))
        .filter(o => !eh.some(h => sameEdit(h, o))); // même changement des deux côtés : une fois

    // Groupes de changements qui se touchent (d'un côté et de l'autre).
    const all = [...eh, ...eo].sort((x, y) => x.s - y.s || x.e - y.e);
    const groups = [];
    for (const d of all) {
        const g = groups.find(gr => gr.items.some(x => x.side !== d.side && overlaps(x, d, B.length === 0)));
        if (g) { g.items.push(d); g.s = Math.min(g.s, d.s); g.e = Math.max(g.e, d.e); }
        else groups.push({ s: d.s, e: d.e, items: [d] });
    }
    groups.sort((x, y) => x.s - y.s || x.e - y.e);

    const out = [];
    const conflicts = [];
    let i = 0;
    for (const g of groups) {
        out.push(...B.slice(i, g.s));
        const sides = new Set(g.items.map(d => d.side));
        if (sides.size === 1) {
            for (const d of g.items) {
                const last = out.length - 1;
                if (d.lead && last >= 0 && !/\s$/.test(out[last])) out[last] += d.lead;
                out.push(...d.repl);
            }
        } else {
            const hereText = regionText(B, eh, g.s, g.e);
            if (hereText) out.push(hereText);
            // Passages affichés sans blancs de fin (le retour à la ligne qui les
            // suit reste dans la version finale) : sous-chaînes de la version finale.
            conflicts.push({ here: hereText.replace(/\s+$/, ''), online: regionText(B, eo, g.s, g.e).replace(/\s+$/, '') });
        }
        i = Math.max(i, g.e);
    }
    out.push(...B.slice(i));
    return { text: join(out).replace(/\s+$/, ''), clean: conflicts.length === 0, conflicts };
}

// ─── Une case par phrase (18/11/2026, maquette « Texte : une case par phrase ») ──
// Cocher une phrase l'ajoute à la fin de la version finale ; la décocher la
// retire. Rien d'autre ne bouge : les retouches faites à la main restent.

/**
 * La phrase figure-t-elle, ENTIÈRE, dans le texte (blancs ignorés) ? Une phrase
 * contenue dans une autre ne compte pas (« Grotte » ≠ « Grotte visitable »).
 */
export function hasSentence(text, sentence) {
    const s = key(sentence);
    return !!s && splitSentences(text).some(x => key(x) === s);
}

/** Ajoute la phrase à la fin, sur une nouvelle ligne ; sans effet si elle y est déjà. */
export function addSentence(text, sentence) {
    const t = String(text ?? '');
    const s = String(sentence ?? '').trim();
    if (!s || hasSentence(t, s)) return t;
    const head = t.replace(/\s+$/, '');
    return head ? `${head}\n${s}` : s;
}

/**
 * Retire la phrase (première occurrence entière) avec le blanc qui la suit ;
 * en fin de texte, avec le blanc qui la précède. Sans effet si elle a été
 * retouchée à la main et ne se retrouve plus telle quelle.
 */
export function removeSentence(text, sentence) {
    const s = key(sentence);
    const segs = splitSentences(text);
    const at = s ? segs.findIndex(x => key(x) === s) : -1;
    if (at < 0) return String(text ?? '');
    segs.splice(at, 1);
    if (at === segs.length && at > 0) segs[at - 1] = segs[at - 1].replace(/\s+$/, '');
    return segs.join('');
}
