// scripts/check-trace-osm.mjs
// ============================================================
// Contrôle d'une trace GPX contre OSM et l'Atlas des chemins vicinaux (12/11/2026).
//
// Né de la marche ADEPS de Mellet (8/11/2026) : la trace suivait 660 m de
// chemins marqués access=private sur OSM, que le routeur de l'app (BRouter)
// refuse. L'Atlas de 1841 montrait pourtant le « Sentier n° 28 », public.
// Ce cas reviendra à chaque marche : ce script fait le contrôle d'un coup.
//
// Ce qu'il fait, sans rien écrire ailleurs que le rapport :
//   1. lit la trace (trkpt ou rtept) ;
//   2. charge les voies OSM (highway=*) autour, via Overpass ;
//   3. repère les tronçons à plus de 20 m de toute voie OSM (chemin absent ?) ;
//   4. repère les voies suivies qui sont fermées au marcheur sur OSM
//      (access=private/no sans foot=yes, ou foot=private/no) ;
//   5. pour chaque tronçon repéré, interroge le Géoportail de Wallonie :
//      plan de l'Atlas de 1841 et cadastre 2025, avec la trace dessinée dessus,
//      modifications de l'Atlas enregistrées sur la zone, parcelles traversées.
//   6. écrit un rapport HTML autonome (images incluses) à côté du GPX.
//
// Usage :
//   npm run trace -- "C:\Users\...\Downloads\marche.gpx"
//   npm run trace -- marche.gpx --sortie rapport.html
//
// Limites : hors Wallonie, les plans du Géoportail sont vides. L'Atlas
// consolidé ne montre pas une suppression votée par la commune mais pas encore
// reportée. Une trace dessinée à la main (points tous les 100 m et plus) coupe
// les virages : un écart de 20 à 40 m le long d'une voie de même forme n'est
// pas un chemin manquant. Le rapport le rappelle.
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SEUIL_SUR_VOIE = 15;   // m : la trace suit cette voie
export const SEUIL_HORS_OSM = 20;   // m : aucune voie OSM aussi près
export const LONGUEUR_MIN = 20;     // m : tronçon plus court = ignoré
const PAS = 5;                      // m : échantillonnage de la trace

const OVERPASS = [
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
];
const GEO = 'https://geoservices.wallonie.be/arcgis/rest/services';
const ATLAS = `${GEO}/PLAN_REGLEMENT/ATLAS_VV_MODIF/MapServer`;
const CADASTRE = `${GEO}/PLAN_REGLEMENT/CADMAP_2025_PARCELLES/MapServer`;
const PROJECTION = `${GEO}/Utilities/Geometry/GeometryServer/project`;
const UA = { 'User-Agent': 'heripia-controle-trace/1.0' };

// ---------- Calculs (purs, testés) ----------

/** Points d'une trace GPX (trkpt, sinon rtept), dans l'ordre. */
export function lirePointsGpx(xml) {
    const lire = (balise) => [...xml.matchAll(new RegExp(`<${balise}\\b([^>]*)>`, 'g'))].map(m => {
        const lat = /lat="([-\d.]+)"/.exec(m[1]);
        const lon = /lon="([-\d.]+)"/.exec(m[1]);
        return lat && lon ? { lat: +lat[1], lon: +lon[1] } : null;
    }).filter(Boolean);
    const trk = lire('trkpt');
    return trk.length ? trk : lire('rtept');
}

/** Projection locale en mètres (équirectangulaire), suffisante sur quelques km. */
export function projeteur(lat0, lon0) {
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    return (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
}

function distSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    const u = L === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
    return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
}

/** Voie fermée au marcheur sur OSM, telle que la lit un routeur de randonnée. */
export function estFermeeAuMarcheur(tags = {}) {
    if (['yes', 'designated', 'permissive'].includes(tags.foot)) return false;
    if (['private', 'no'].includes(tags.foot)) return true;
    return ['private', 'no'].includes(tags.access);
}

/**
 * Échantillonne la trace tous les PAS mètres et associe à chaque échantillon
 * la voie OSM la plus proche. ways = éléments Overpass (`out tags geom`).
 */
export function associer(points, ways) {
    if (points.length < 2) return [];
    const P = projeteur(points[0].lat, points[0].lon);
    const CELL = 100, grille = new Map();
    const cle = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    for (const w of ways) {
        const g = (w.geometry || []).map(n => P(n.lat, n.lon));
        for (let i = 0; i < g.length - 1; i++) {
            const s = { a: g[i], b: g[i + 1], way: w };
            const [x0, x1] = [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0])];
            const [y0, y1] = [Math.min(s.a[1], s.b[1]), Math.max(s.a[1], s.b[1])];
            for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
                for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
                    const k = `${cx},${cy}`;
                    if (!grille.has(k)) grille.set(k, []);
                    grille.get(k).push(s);
                }
        }
    }
    const plusProche = (p) => {
        // dLibre : distance à la voie OUVERTE la plus proche. Une voie privée qui longe
        // ou croise une route publique ne doit pas être signalée (cas de la jonction
        // Rue de Chassart / chemin privé, sur la trace enregistrée de Mellet).
        let best = { d: Infinity, way: null, dLibre: Infinity };
        const [cx, cy] = cle(p[0], p[1]).split(',').map(Number);
        for (let r = 0; r <= 3; r++) {               // anneaux de cellules, jusqu'à ~300 m
            for (let i = cx - r; i <= cx + r; i++)
                for (let j = cy - r; j <= cy + r; j++) {
                    if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;
                    for (const s of grille.get(`${i},${j}`) || []) {
                        const d = distSegment(p, s.a, s.b);
                        if (d < best.d) { best.d = d; best.way = s.way; }
                        if (d < best.dLibre && !estFermeeAuMarcheur(s.way.tags)) best.dLibre = d;
                    }
                }
            if (r >= 1 && best.d <= r * CELL) break;  // rien de plus proche hors de l'anneau (et dLibre sûr jusqu'à 100 m)
        }
        return best;
    };
    const ech = [];
    let cumul = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const A = points[i], B = points[i + 1];
        const a = P(A.lat, A.lon), b = P(B.lat, B.lon);
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(L / PAS));
        for (let k = 0; k < n; k++) {
            const u = k / n;
            const p = [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])];
            ech.push({
                km: (cumul + u * L) / 1000,
                lat: A.lat + u * (B.lat - A.lat), lon: A.lon + u * (B.lon - A.lon),
                ...plusProche(p),
            });
        }
        cumul += L;
    }
    const Z = points.at(-1);
    ech.push({ km: cumul / 1000, lat: Z.lat, lon: Z.lon, ...plusProche(P(Z.lat, Z.lon)) });
    return ech;
}

/** Suites d'échantillons qui vérifient `test`, d'au moins LONGUEUR_MIN m ; trous < `trou` m comblés. */
export function tronconsOu(ech, test, trou = 0) {
    const runs = [];
    let cur = null;
    for (let i = 0; i < ech.length; i++) {
        if (test(ech[i])) {
            if (cur && (ech[i].km - ech[cur.fin].km) * 1000 <= trou + PAS + 0.01) cur.fin = i;
            else { cur = { debut: i, fin: i }; runs.push(cur); }
        }
    }
    return runs
        .map(r => ({ ...r, ech: ech.slice(r.debut, r.fin + 1) }))
        .filter(r => (ech[r.fin].km - ech[r.debut].km) * 1000 >= LONGUEUR_MIN);
}

export const tronconsHorsOsm = (ech) => tronconsOu(ech, e => e.d > SEUIL_HORS_OSM);
export const tronconsFermes = (ech) =>
    tronconsOu(ech, e => e.d <= SEUIL_SUR_VOIE && estFermeeAuMarcheur(e.way?.tags) && e.dLibre > SEUIL_SUR_VOIE, 30);

/** Longueur suivie (m) par voie, de la plus longue à la plus courte. */
export function voiesSuivies(ech) {
    const m = new Map();
    for (let i = 1; i < ech.length; i++) {
        const e = ech[i];
        if (e.d > SEUIL_SUR_VOIE || !e.way) continue;
        const l = (e.km - ech[i - 1].km) * 1000;
        const cur = m.get(e.way.id) || { way: e.way, m: 0 };
        cur.m += l;
        m.set(e.way.id, cur);
    }
    return [...m.values()].sort((a, b) => b.m - a.m);
}

// ---------- Réseau ----------

async function getJson(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(90000) });
    if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 80)}`);
    const d = await r.json();
    if (d.error) throw new Error(`${d.error.message} ${url.slice(0, 80)}`);
    return d;
}

async function voiesOsm(points) {
    const lats = points.map(p => p.lat), lons = points.map(p => p.lon);
    const m = 0.003;
    const bbox = [Math.min(...lats) - m, Math.min(...lons) - m, Math.max(...lats) + m, Math.max(...lons) + m].map(v => v.toFixed(5));
    const q = `[out:json][timeout:90];way["highway"](${bbox.join(',')});out tags geom;`;
    let derniere;
    for (const s of OVERPASS) {
        try {
            const d = await getJson(s, { method: 'POST', body: new URLSearchParams({ data: q }) });
            return { ways: d.elements, date: d.osm3s?.timestamp_osm_base, serveur: s };
        } catch (e) { derniere = e; }
    }
    throw new Error(`Overpass injoignable (${derniere?.message})`);
}

/** WGS84 → `sr` (31370 = Lambert 72, 3812 = Lambert 2008) via le service du Géoportail. */
async function projeter(pts, sr) {
    const body = new URLSearchParams({
        inSR: 4326, outSR: sr, f: 'json',
        // Un point par géométrie : un multipoint perd ses doublons et décale tout l'ordre.
        geometries: JSON.stringify({ geometryType: 'esriGeometryPoint', geometries: pts.map(p => ({ x: p.lon, y: p.lat })) }),
    });
    const d = await getJson(PROJECTION, { method: 'POST', body });
    if (d.geometries?.length !== pts.length) throw new Error('projection incomplète');
    return d.geometries.map(g => [g.x, g.y]);
}

async function image(service, bbox, layers, larg) {
    // L'image est demandée directement (f=image) : le lien renvoyé par f=json
    // expire parfois avant qu'on le lise (« Invalid URL »). Le cadre a exactement
    // les proportions de l'image, donc le serveur le garde tel quel.
    const [x0, y0, x1] = bbox.map(Math.round);
    const haut = Math.round(larg * (bbox[3] - bbox[1]) / (bbox[2] - bbox[0]));
    const y1 = y0 + haut * (x1 - x0) / larg;
    const p = new URLSearchParams({ bbox: [x0, y0, x1, y1].join(','), bboxSR: 31370, imageSR: 31370, size: `${larg},${haut}`, format: 'png', transparent: 'false', f: 'image' });
    if (layers) p.set('layers', layers);
    const r = await fetch(`${service}/export?${p}`, { headers: UA, signal: AbortSignal.timeout(90000) });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok || buf.subarray(1, 4).toString() !== 'PNG') throw new Error(`pas d'image (${r.status})`);
    return { src: `data:image/png;base64,${buf.toString('base64')}`, w: larg, h: haut, extent: { xmin: x0, ymin: y0, xmax: x1, ymax: y1 } };
}

async function requete(url, params) {
    const p = new URLSearchParams({ inSR: 4326, spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'false', f: 'json', ...params });
    return (await getJson(`${url}/query?${p}`)).features || [];
}

/** Tout ce que le Géoportail dit d'un tronçon. Chaque partie échoue seule. */
async function geoportail(troncon, ways, traceEntiere) {
    const out = { erreurs: [] };
    const pts = troncon.ech.map(e => ({ lat: e.lat, lon: e.lon }));
    const geomWays = ways.map(w => w.geometry.map(n => ({ lat: n.lat, lon: n.lon })));
    try {
        const tous = [...pts, ...geomWays.flat(), ...traceEntiere];
        const l72 = await projeter(tous, 31370);
        let i = pts.length;
        const wl = geomWays.map(g => { const s = l72.slice(i, i + g.length); i += g.length; return s; });
        const cadre = l72.slice(0, pts.length);             // le tronçon seul fixe le cadre
        const xs = cadre.map(p => p[0]), ys = cadre.map(p => p[1]);
        const marge = 120;
        let bb = [Math.min(...xs) - marge, Math.min(...ys) - marge, Math.max(...xs) + marge, Math.max(...ys) + marge];
        const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;   // au moins 400 m de côté
        const dx = Math.max(bb[2] - bb[0], 400) / 2, dy = Math.max(bb[3] - bb[1], 400) / 2;
        bb = [cx - dx, cy - dy, cx + dx, cy + dy];
        out.trace = l72.slice(i);                           // trace entière, pour le contexte
        out.voies = wl;
        const [atlas, cad] = await Promise.all([
            image(ATLAS, bb, 'show:0,1,3', 900).catch(e => { out.erreurs.push(`Atlas : ${e.message}`); return null; }),
            image(CADASTRE, bb, null, 900).catch(e => { out.erreurs.push(`Cadastre : ${e.message}`); return null; }),
        ]);
        out.atlas = atlas;
        out.cadastre = cad;
        const l08 = await projeter([{ lat: troncon.ech[0].lat, lon: troncon.ech[0].lon }], 3812).catch(() => null);
        if (l08) {
            const [x, y] = l08[0];
            out.lienGeoportail = `https://geoportail.wallonie.be/carte#BBOX=${Math.round(x - 400)},${Math.round(x + 400)},${Math.round(y - 300)},${Math.round(y + 300)},3812`;
        }
    } catch (e) { out.erreurs.push(`Projection : ${e.message}`); }
    try {
        const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
        const env = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)].join(',');
        out.modifications = (await requete(`${ATLAS}/1`, { geometry: env, geometryType: 'esriGeometryEnvelope' })).map(f => f.attributes);
    } catch (e) { out.erreurs.push(`Modifications de l'Atlas : ${e.message}`); }
    try {
        const pas = Math.max(1, Math.floor(pts.length / 8));
        const vus = new Map();
        for (const p of pts.filter((_, i) => i % pas === 0)) {
            const f = await requete(`${CADASTRE}/0`, { geometry: `${p.lon},${p.lat}`, geometryType: 'esriGeometryPoint' });
            const k = f.length ? f.map(x => x.attributes.CAPAKEY).join(' / ') : 'aucune parcelle';
            if (!vus.has(k)) vus.set(k, { capakey: k, commune: f[0]?.attributes.DIV_NOM || '', lat: p.lat, lon: p.lon });
        }
        out.parcelles = [...vus.values()];
    } catch (e) { out.erreurs.push(`Cadastre (parcelles) : ${e.message}`); }
    return out;
}

// ---------- Rapport ----------

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const coord = (e) => `${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}`;
const lienWay = (w) => `<a href="https://www.openstreetmap.org/way/${w.id}">way ${w.id}</a>`;
const tagsTexte = (t = {}) => Object.entries(t).map(([k, v]) => `${k}=${v}`).join(' · ');

/** Une modification de l'Atlas, lisible : champs vides retirés, dates en clair, liens cliquables. */
export function modificationTexte(attrs = {}) {
    return Object.entries(attrs)
        .filter(([k, v]) => v !== null && v !== '' && k !== 'OBJECTID')
        .map(([k, v]) => {
            if (/^DATE/.test(k) && typeof v === 'number') return `${esc(k)} : ${new Date(v).toISOString().slice(0, 10)}`;
            if (/^https?:\/\//.test(String(v))) return `${esc(k)} : <a href="${esc(v)}">${esc(String(v).split('/').pop())}</a>`;
            return `${esc(k)} : ${esc(v)}`;
        }).join(' · ');
}

function carte(img, titre, g) {
    if (!img) return `<figure><figcaption>${esc(titre)} : indisponible</figcaption></figure>`;
    const { xmin, ymin, xmax, ymax } = img.extent;
    const px = ([x, y]) => `${((x - xmin) / (xmax - xmin) * img.w).toFixed(1)},${((ymax - y) / (ymax - ymin) * img.h).toFixed(1)}`;
    const ligne = (pts, cls) => `<polyline class="${cls}" points="${pts.map(px).join(' ')}"/>`;
    return `<figure><div class="carte"><img src="${img.src}" width="${img.w}" height="${img.h}" alt="${esc(titre)}">`
        + `<svg viewBox="0 0 ${img.w} ${img.h}">${(g.voies || []).map(v => ligne(v, 'voie')).join('')}${g.trace ? ligne(g.trace, 'trace') : ''}</svg></div>`
        + `<figcaption>${esc(titre)}</figcaption></figure>`;
}

function blocTroncon(t, n, type) {
    const a = t.ech[0], b = t.ech.at(-1), g = t.geo || {};
    const long = Math.round((b.km - a.km) * 1000);
    const voies = t.ways.map(w => `<li>${lienWay(w)} ${esc(w.tags?.name || '(sans nom)')} <span class="tags">${esc(tagsTexte(w.tags))}</span></li>`).join('');
    const modifs = g.modifications == null ? '' : g.modifications.length
        ? `<p><strong>Modifications de l'Atlas sur la zone :</strong></p><ul>${g.modifications.map(m => `<li class="tags">${modificationTexte(m)}</li>`).join('')}</ul>`
        : `<p><strong>Modifications de l'Atlas :</strong> aucune enregistrée sur ce tronçon.</p>`;
    const parc = (g.parcelles || []).map(p => `<li>${esc(p.capakey)} ${esc(p.commune)} <span class="tags">(${coord(p)})</span></li>`).join('');
    return `<section><h3>${type} ${n} — km ${a.km.toFixed(2)} à ${b.km.toFixed(2)} (${long} m)</h3>
<p>De <code>${coord(a)}</code> à <code>${coord(b)}</code>${type === 'Hors OSM' ? `, écart maximal ${Math.round(Math.max(...t.ech.map(e => e.d)))} m` : ''}.
${g.lienGeoportail ? ` <a href="${g.lienGeoportail}">Ouvrir sur le Géoportail</a>` : ''}</p>
<p><strong>${type === 'Hors OSM' ? 'Voie OSM la plus proche' : 'Voies OSM concernées'} :</strong></p><ul>${voies}</ul>
${modifs}
${parc ? `<p><strong>Parcelles sous le tronçon (cadastre 2025) :</strong></p><ul>${parc}</ul>` : ''}
${(g.erreurs || []).map(e => `<p class="err">${esc(e)}</p>`).join('')}
<div class="cartes">${carte(g.atlas, 'Atlas des chemins vicinaux (1841, consolidé)', g)}${carte(g.cadastre, 'Cadastre 2025', g)}</div>
<p class="leg"><span class="k trace"></span> trace de la marche <span class="k voie"></span> ${type === 'Hors OSM' ? 'voie OSM la plus proche' : 'voie OSM fermée au marcheur'}</p>
</section>`;
}

export function rapportHtml({ nom, longueur, osm, horsOsm, fermes, suivies }) {
    const ferme = suivies.filter(s => estFermeeAuMarcheur(s.way.tags));
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Contrôle OSM — ${esc(nom)}</title><style>
body{font:15px/1.5 system-ui,sans-serif;max-width:1900px;margin:0 auto;padding:16px;color:#1d1d1b;background:#fbfaf7}
h1{font-size:22px}h2{margin-top:32px;border-bottom:1px solid #ccc}h3{font-size:17px}
section{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px 16px;margin:16px 0}
.cartes{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0;flex:1 1 420px;max-width:900px}
.carte{position:relative}.carte img,.carte svg{width:100%;height:auto;display:block}.carte svg{position:absolute;inset:0}
polyline{fill:none;stroke-linejoin:round;stroke-linecap:round}.trace{stroke:#0a5cff;stroke-width:3}.voie{stroke:#e00000;stroke-width:5;opacity:.75}
.k{display:inline-block;width:24px;height:4px;vertical-align:middle;margin:0 4px 0 12px}.k.trace{background:#0a5cff}.k.voie{background:#e00000}
.tags{color:#666;font-size:13px}.err{color:#a00}code{font-size:13px}table{border-collapse:collapse}td,th{padding:2px 10px;border-bottom:1px solid #eee;text-align:left;font-size:13px}
.note{color:#555;font-size:14px}
</style></head><body>
<h1>Contrôle OSM — ${esc(nom)}</h1>
<p>Trace de ${longueur.toFixed(2)} km. Voies OSM à jour au ${esc(osm.date || '?')} (${esc(osm.serveur)}).</p>
<ul><li><strong>${horsOsm.length}</strong> tronçon(s) à plus de ${SEUIL_HORS_OSM} m de toute voie OSM</li>
<li><strong>${fermes.length}</strong> tronçon(s) sur une voie fermée au marcheur sur OSM (le calcul d'itinéraire de l'app la refuse)</li></ul>
<p class="note">Une trace dessinée à la main (Wikiloc, points tous les 100 m et plus) coupe les virages : un écart de 20 à 40 m le long d'une voie OSM de même forme n'est pas un chemin manquant. L'Atlas consolidé ne montre pas une suppression votée par la commune mais pas encore reportée. Un sentier vicinal n'a souvent pas de parcelle à lui : il longe la limite entre deux parcelles privées.</p>
<h2>Voies fermées au marcheur sur OSM</h2>
${fermes.length ? fermes.map((t, i) => blocTroncon(t, i + 1, 'Fermée')).join('') : '<p>Aucune.</p>'}
<h2>Tronçons hors OSM</h2>
${horsOsm.length ? horsOsm.map((t, i) => blocTroncon(t, i + 1, 'Hors OSM')).join('') : '<p>Aucun.</p>'}
<h2>Voies suivies</h2>
<table><tr><th>m</th><th>voie</th><th>nom</th><th>tags</th></tr>
${suivies.map(s => `<tr><td>${Math.round(s.m)}</td><td>${lienWay(s.way)}</td><td>${esc(s.way.tags?.name || '')}</td><td class="tags">${ferme.includes(s) ? '<strong>fermée</strong> · ' : ''}${esc(tagsTexte(s.way.tags))}</td></tr>`).join('')}
</table></body></html>`;
}

// ---------- Ligne de commande ----------

async function main(args) {
    const i = args.indexOf('--sortie');
    const sortie = i >= 0 ? args[i + 1] : null;
    const gpx = args.find((a, k) => !a.startsWith('--') && args[k - 1] !== '--sortie');
    if (!gpx) {
        console.error('Usage : npm run trace -- <fichier.gpx> [--sortie rapport.html]');
        process.exit(2);
    }
    const chemin = resolve(gpx);
    const points = lirePointsGpx(readFileSync(chemin, 'utf8'));
    if (points.length < 2) throw new Error('Aucun point de trace dans ce GPX.');
    console.log(`${points.length} points lus. Chargement des voies OSM…`);
    const osm = await voiesOsm(points);
    console.log(`${osm.ways.length} voies OSM (données du ${osm.date}).`);
    const ech = associer(points, osm.ways);
    const longueur = ech.at(-1).km;
    const garnir = (t, ferme) => {
        const ids = new Set(t.ech.filter(e => !ferme || estFermeeAuMarcheur(e.way?.tags)).map(e => e.way?.id).filter(Boolean));
        t.ways = osm.ways.filter(w => ids.has(w.id));
        return t;
    };
    const horsOsm = tronconsHorsOsm(ech).map(t => garnir(t, false));
    const fermes = tronconsFermes(ech).map(t => garnir(t, true));
    // Le Géoportail ne couvre que la Wallonie : ailleurs (Djerba…), pas d'appel inutile.
    const enWallonie = (e) => e.lat > 49.45 && e.lat < 50.85 && e.lon > 2.8 && e.lon < 6.45;
    for (const [t, type] of [...fermes.map(t => [t, 'fermée']), ...horsOsm.map(t => [t, 'hors OSM'])]) {
        if (!enWallonie(t.ech[0])) { t.geo = { erreurs: ['Hors de Wallonie : pas de plan de l\'Atlas ni de cadastre.'] }; continue; }
        console.log(`Géoportail : tronçon ${type} km ${t.ech[0].km.toFixed(2)}…`);
        t.geo = await geoportail(t, t.ways, points);
    }
    const nom = basename(chemin, extname(chemin));
    const fichier = sortie ? resolve(sortie) : join(dirname(chemin), `${nom}.controle-osm.html`);
    writeFileSync(fichier, rapportHtml({ nom, longueur, osm, horsOsm, fermes, suivies: voiesSuivies(ech) }));
    console.log(`\nTrace : ${longueur.toFixed(2)} km`);
    console.log(`Hors OSM (> ${SEUIL_HORS_OSM} m) : ${horsOsm.length} tronçon(s)`);
    for (const t of horsOsm) console.log(`  km ${t.ech[0].km.toFixed(2)}-${t.ech.at(-1).km.toFixed(2)} à ${coord(t.ech[0])}`);
    console.log(`Fermés au marcheur sur OSM : ${fermes.length} tronçon(s)`);
    for (const t of fermes) console.log(`  km ${t.ech[0].km.toFixed(2)}-${t.ech.at(-1).km.toFixed(2)} : ${t.ways.map(w => `way ${w.id}`).join(', ')}`);
    console.log(`\nRapport : ${fichier}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
}
