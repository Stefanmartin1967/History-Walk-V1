// gpx-steps.js — Les étapes (<wpt>) d'un GPX de circuit : écrites, relues, comparées.
//
// Un GPX publié porte, pour chaque étape, le nom de la fiche, sa position, son
// « info GPX » et son lien Source. Jusqu'au 17/11/2026, rien ne surveillait ces
// valeurs : une fiche renommée, déplacée ou complétée laissait les GPX de ses
// circuits tels quels (12 GPX sur 24 périmés à Djerba, mesuré ce jour-là), car
// le Centre de contrôle ne voyait un circuit modifié que si son nom, sa
// description, sa liste de lieux ou son tracé changeaient.
//
// Ce module donne UNE définition des étapes, partagée par l'écriture du GPX
// (gpx.js) et par le diff (admin-diff-engine.js), et une empreinte publiée dans
// l'index (`stepsHash`), comme celle du tracé (track-fingerprint.js).
//
// Module pur (aucun état de l'app, aucun DOM), sauf la petite mémoire des
// empreintes publiées pendant la session.
import { getPoiName } from './utils.js';

/**
 * Étapes telles que le GPX les écrit, dans l'ordre du circuit.
 * @param {object[]} features Fiches du circuit (GeoJSON), dans l'ordre.
 * @returns {{name: string, desc: string, link: string, lat: number, lon: number}[]}
 */
export function gpxStepsOf(features) {
    return (features || []).map(f => {
        const p = f.properties || {};
        const ud = p.userData || {};
        // `info_gpx` : c'est ce texte qui voyage dans le <desc> du waypoint
        // (visible côté Wikiloc / GPX Studio). userData prioritaire.
        const desc = ud.info_gpx || p.info_gpx || '';
        const source = String(ud.Source || p.Source || '').trim();
        const coords = (f.geometry && f.geometry.coordinates) || [];
        return {
            name: getPoiName(f),
            desc: String(desc),
            link: source.startsWith('http') ? source : '',
            lat: coords[1],
            lon: coords[0],
        };
    });
}

const unescapeXml = (s) => String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Étapes (<wpt>) d'un texte GPX, même forme que gpxStepsOf. */
export function parseGpxSteps(gpxText) {
    const steps = [];
    const re = /<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/g;
    let m;
    while ((m = re.exec(String(gpxText || '')))) {
        const attrs = m[1], body = m[2];
        const lat = attrs.match(/\blat="([^"]+)"/);
        const lon = attrs.match(/\blon="([^"]+)"/);
        const tag = (t) => (body.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1] || '';
        const link = (body.match(/<link\b[^>]*\bhref="([^"]*)"/) || [])[1] || '';
        steps.push({
            name: unescapeXml(tag('name')),
            desc: unescapeXml(tag('desc')),
            link: unescapeXml(link),
            lat: lat ? parseFloat(lat[1]) : NaN,
            lon: lon ? parseFloat(lon[1]) : NaN,
        });
    }
    return steps;
}

// Forme de comparaison d'une étape : textes sans espaces de bord, position au
// micro-degré (~10 cm, comme l'empreinte du tracé).
function stepKey(s) {
    const n = (v) => (Number.isFinite(v) ? Number(v).toFixed(6) : '');
    return [String(s.name || '').trim(), String(s.desc || '').trim(), String(s.link || '').trim(), n(s.lat), n(s.lon)].join('␟');
}

/**
 * Empreinte « <nb d'étapes>-<hash> » des étapes, ou null s'il n'y en a pas.
 * Hash FNV-1a 32 bits (même famille que trackFingerprint).
 */
export function stepsFingerprint(steps) {
    if (!Array.isArray(steps) || steps.length === 0) return null;
    let h = 0x811c9dc5;
    for (const s of steps) {
        const k = stepKey(s) + '␞';
        for (let i = 0; i < k.length; i++) {
            h ^= k.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
    }
    return `${steps.length}-${h.toString(16).padStart(8, '0')}`;
}

/**
 * Ce qui a changé entre les étapes publiées et celles d'aujourd'hui, pour le
 * Centre de contrôle : les renommages un par un, le reste compté.
 * @returns {{renamed: {from: string, to: string}[], others: number, countChanged: boolean}}
 */
export function describeStepChanges(oldSteps, newSteps) {
    const olds = oldSteps || [], news = newSteps || [];
    const renamed = [];
    let others = 0;
    const n = Math.min(olds.length, news.length);
    for (let i = 0; i < n; i++) {
        const a = olds[i], b = news[i];
        if (stepKey(a) === stepKey(b)) continue;
        const from = String(a.name || '').trim(), to = String(b.name || '').trim();
        if (from !== to) {
            if (!renamed.some(r => r.from === from && r.to === to)) renamed.push({ from, to });
        } else {
            others++;
        }
    }
    return { renamed, others, countChanged: olds.length !== news.length };
}

/**
 * Nom automatique de base d'un circuit (sans « via … » ni « (2) ») : ses
 * extrémités littérales, ou « Boucle autour de » quand il revient à son départ.
 * Même règle que generateCircuitName (circuit.js), qui s'en sert.
 */
export function autoCircuitBaseName(firstName, lastName, isLoop) {
    return isLoop ? `Boucle autour de ${firstName}` : `Circuit de ${firstName} à ${lastName}`;
}

/**
 * Ce nom est-il le nom automatique calculé avec ces noms d'extrémités ? Le
 * nom de base, ou ce nom suivi de « via <lieu> » ou de « (n) » (noms rendus
 * uniques, circuit-name.js). Un nom tapé à la main ne correspond pas : on n'y
 * touche jamais.
 */
export function isAutoCircuitName(name, firstName, lastName, isLoop) {
    const base = autoCircuitBaseName(firstName, lastName, isLoop);
    const n = String(name || '');
    if (n === base || n.startsWith(`${base} via `)) return true;
    return n.startsWith(base) && /^ \(\d+\)$/.test(n.slice(base.length));
}

// Empreintes des étapes des GPX publiés pendant la session (par id de
// circuit) : après une publication, on se fie à ce qu'on vient d'écrire
// plutôt qu'à une relecture du serveur, qui peut être en retard.
const publishedSteps = new Map();

/** À appeler avec les étapes qu'on vient de publier pour ce circuit. */
export function rememberPublishedSteps(circuitId, steps) {
    const fp = stepsFingerprint(steps);
    if (circuitId != null && fp) publishedSteps.set(String(circuitId), fp);
}

export function publishedStepsFingerprint(circuitId) {
    return publishedSteps.get(String(circuitId)) || null;
}
