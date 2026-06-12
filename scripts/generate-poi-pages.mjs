// scripts/generate-poi-pages.mjs
// ============================================================
// SEO — pages statiques par lieu (audit F3/SEO1).
//
// L'app charge tout en JavaScript sur une URL unique : sans ces pages,
// les ~300 lieux n'existent pour aucun moteur de recherche. Ce script
// génère, APRÈS le build Vite (hook npm `postbuild`), une page HTML
// statique par lieu publié dans dist/lieux/<mapId>/<slug>/index.html,
// plus dist/sitemap.xml et dist/404.html.
//
// Règles :
//  - destinations `status: "published"` uniquement (destinations.json) ;
//  - lieux avec une vraie description uniquement (>= MIN_DESCRIPTION_CHARS,
//    décision Stefan 12/06/2026 : pas de « thin content ») — le nombre de
//    pages grandit tout seul au fil de l'enrichissement ;
//  - tourne APRÈS `vite build` → rien n'entre dans le precache du SW
//    (le manifest Workbox est déjà figé) ; côté SW, /lieux/ est dans
//    navigateFallbackDenylist pour que les visiteurs avec l'app installée
//    reçoivent bien la page statique, pas index.html.
//
// ⚠ PRELAUNCH : tant que l'app porte son <meta noindex> (index.html),
// les pages générées portent le même. Au lancement public, passer
// PRELAUNCH à false EN MÊME TEMPS que le retrait du noindex de
// index.html (checklist SEO2 de AUDIT-2026-06), puis soumettre
// https://heripia.com/sitemap.xml à Google Search Console et Bing.
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PRELAUNCH = true;
export const SITE_ORIGIN = 'https://heripia.com';
export const MIN_DESCRIPTION_CHARS = 80;

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const DIST_DIR = join(ROOT, 'dist');

// ─── Helpers purs (testés dans tests/generate_poi_pages.test.js) ────────────

export function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** kebab-case sans diacritiques. Repli sur le HW_ID si le nom ne produit rien
 *  (nom 100 % arabe par ex.) — une URL vide n'est pas une URL. */
export function slugify(name, fallback = '') {
    const slug = String(name ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || String(fallback).toLowerCase();
}

/** Éligibilité SEO : une vraie description (pas de thin content). */
export function isEligible(feature) {
    const desc = (feature?.properties?.description || '').trim();
    return desc.length >= MIN_DESCRIPTION_CHARS;
}

/** Slugs uniques pour une liste de features (suffixe -2, -3… en cas de
 *  collision de noms). Retourne Map<HW_ID, slug>. */
export function assignSlugs(features) {
    const used = new Set();
    const map = new Map();
    for (const f of features) {
        const hwId = f.properties.HW_ID;
        const base = slugify(f.properties['Nom du site FR'], hwId);
        let slug = base;
        for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
        used.add(slug);
        map.set(hwId, slug);
    }
    return map;
}

/** Meta description : 1 ligne, coupée au mot, ~155 caractères. */
export function metaDescription(desc, max = 155) {
    const flat = String(desc ?? '').replace(/\s+/g, ' ').trim();
    if (flat.length <= max) return flat;
    const cut = flat.slice(0, max);
    return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

/** Coordonnées [lat, lng] d'une feature (geometry prioritaire, repli properties). */
export function getLatLng(feature) {
    const coords = feature?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) return [coords[1], coords[0]];
    const { lat, lng } = feature?.properties || {};
    return (typeof lat === 'number' && typeof lng === 'number') ? [lat, lng] : null;
}

/** Lien Source — {url, domain} si http(s) valide, sinon null. Comme renderSource
 *  côté app (templates.js) : on affiche le DOMAINE sans `www.` (l'URL brute est
 *  illisible), pas l'URL complète. Garde http(s) only (leçon audit S4 : jamais
 *  d'URL non vérifiée dans un href). */
export function safeSource(source) {
    const raw = String(source ?? '').split('\n')[0].trim();
    if (!/^https?:\/\//i.test(raw)) return null;
    try {
        const url = new URL(raw);
        return { url: url.href, domain: url.hostname.replace(/^www\./, '') };
    } catch {
        return null;
    }
}

// ─── Rendu ───────────────────────────────────────────────────────────────────

const PAGE_CSS = `
:root{--brand:#0D3B66;--bg:#F0F4F8;--ink:#102A43;--ink-soft:#587088;--surface:#fff}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6}
header{background:var(--brand);padding:14px 20px}header a{color:#fff;text-decoration:none;font-weight:700;font-size:1.15rem;letter-spacing:.02em}
main{max-width:720px;margin:0 auto;padding:28px 20px 48px}
.eyebrow{color:var(--ink-soft);font-size:.85rem;text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px}
h1{margin:0;font-size:1.9rem;line-height:1.25}
.name-ar{color:var(--ink-soft);font-size:1.2rem;margin:4px 0 0}
.photo{width:100%;border-radius:12px;margin:20px 0 4px;display:block}
.desc{background:var(--surface);border-radius:12px;padding:20px;margin-top:20px}
.desc p{margin:0 0 1em}.desc p:last-child{margin-bottom:0}
dl{background:var(--surface);border-radius:12px;padding:16px 20px;margin-top:16px;display:grid;grid-template-columns:auto 1fr;gap:6px 16px}
dt{color:var(--ink-soft);font-weight:600}dd{margin:0}
.cta{display:block;text-align:center;background:var(--brand);color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:12px;margin-top:24px}
.source{color:var(--ink-soft);font-size:.85rem;margin-top:16px}
footer{text-align:center;color:var(--ink-soft);font-size:.85rem;padding:24px 20px}
`.trim();

export function renderPoiPage({ feature, slug, mapId, mapName, prelaunch = PRELAUNCH, photoExists = () => true }) {
    const p = feature.properties;
    const name = p['Nom du site FR'] || p.HW_ID;
    const nameAr = (p['Nom du site arabe'] || '').trim();
    const desc = (p.description || '').trim();
    const category = (p['Catégorie'] || '').trim();
    const subtype = (p['Sous-type'] || '').trim();
    const zone = (p.Zone || '').trim();
    const etat = (p['État'] || '').trim();
    const acces = (p['Accès'] || '').trim();
    const horaires = (p.Horaires || '').trim();
    const telephone = (p['Téléphone'] || '').trim();
    const latLng = getLatLng(feature);
    const source = safeSource(p.Source);

    const pageUrl = `${SITE_ORIGIN}/lieux/${mapId}/${slug}/`;
    const photoRel = (p.photos || []).find(ph => photoExists(ph));
    const imageUrl = photoRel ? `${SITE_ORIGIN}/${photoRel}` : `${SITE_ORIGIN}/og-image.png`;
    const metaDesc = metaDescription(desc);

    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'TouristAttraction',
        name,
        ...(nameAr ? { alternateName: nameAr } : {}),
        // Description complète (aplatie) — seule la <meta> est tronquée à ~155.
        description: desc.replace(/\s+/g, ' '),
        url: pageUrl,
        image: imageUrl,
        ...(latLng ? { geo: { '@type': 'GeoCoordinates', latitude: latLng[0], longitude: latLng[1] } } : {}),
        ...(zone || mapName ? { containedInPlace: { '@type': 'Place', name: [zone, mapName].filter(Boolean).join(', ') } } : {}),
    };

    const eyebrow = [
        [category, subtype].filter(Boolean).join(' · '),
        [zone, mapName].filter(Boolean).join(', '),
    ].filter(Boolean).join(' — ');

    const infos = [
        ['État', etat],
        ['Accès', acces],
        ['Horaires', horaires],
        ['Téléphone', telephone],
    ].filter(([, v]) => v);

    // Description : texte brut, échappé, paragraphes sur les sauts de ligne —
    // même traitement que templates.js côté app.
    const descHtml = desc.split(/\n+/)
        .map(par => `<p>${escapeHtml(par)}</p>`)
        .join('\n      ');

    return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
${prelaunch ? '  <meta name="robots" content="noindex, nofollow">\n' : ''}  <title>${escapeHtml(name)} — ${escapeHtml(mapName)} | Heripia</title>
  <meta name="description" content="${escapeHtml(metaDesc)}">
  <link rel="canonical" href="${escapeHtml(pageUrl)}">
  <link rel="icon" href="/favicon.ico">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Heripia">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:title" content="${escapeHtml(name)} — ${escapeHtml(mapName)}">
  <meta property="og:description" content="${escapeHtml(metaDesc)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
  <style>${PAGE_CSS}</style>
</head>
<body>
  <header><a href="/">Heripia</a></header>
  <main>
    <p class="eyebrow">${escapeHtml(eyebrow)}</p>
    <h1>${escapeHtml(name)}</h1>
${nameAr ? `    <p class="name-ar" dir="rtl" lang="ar">${escapeHtml(nameAr)}</p>\n` : ''}${photoRel ? `    <img class="photo" src="/${escapeHtml(photoRel)}" alt="${escapeHtml(name)}" loading="lazy">\n` : ''}    <div class="desc">
      ${descHtml}
    </div>
${infos.length ? `    <dl>\n${infos.map(([k, v]) => `      <dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('\n')}\n    </dl>\n` : ''}    <a class="cta" href="/?poi=${encodeURIComponent(p.HW_ID)}">Voir sur la carte Heripia</a>
${source ? `    <p class="source">Source : <a href="${escapeHtml(source.url)}" rel="nofollow noopener" target="_blank">${escapeHtml(source.domain)}</a></p>\n` : ''}  </main>
  <footer>© Heripia — découverte du patrimoine à pied</footer>
</body>
</html>
`;
}

export function renderSitemap(entries) {
    const urls = entries.map(({ url, lastmod }) =>
        `  <url>\n    <loc>${escapeHtml(url)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`
    ).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function render404() {
    return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Page introuvable | Heripia</title>
  <style>${PAGE_CSS}</style>
</head>
<body>
  <header><a href="/">Heripia</a></header>
  <main>
    <h1>Page introuvable</h1>
    <p>Cette page n'existe pas ou plus.</p>
    <a class="cta" href="/">Ouvrir la carte Heripia</a>
  </main>
  <footer>© Heripia — découverte du patrimoine à pied</footer>
</body>
</html>
`;
}

// ─── Génération ──────────────────────────────────────────────────────────────

export function generate({ publicDir = PUBLIC_DIR, distDir = DIST_DIR, prelaunch = PRELAUNCH } = {}) {
    if (!existsSync(distDir)) {
        throw new Error(`dist/ introuvable (${distDir}) — lancer après \`vite build\`.`);
    }
    const destinations = JSON.parse(readFileSync(join(publicDir, 'destinations.json'), 'utf8'));
    const sitemapEntries = [{ url: `${SITE_ORIGIN}/` }];
    let pageCount = 0;

    for (const [mapId, dest] of Object.entries(destinations.maps || {})) {
        if (dest.status !== 'published') continue;
        const geojsonPath = join(publicDir, dest.file);
        const geojson = JSON.parse(readFileSync(geojsonPath, 'utf8'));
        // lastmod = mtime du geojson source : change à chaque publication de données.
        const lastmod = statSync(geojsonPath).mtime.toISOString().slice(0, 10);

        const eligible = (geojson.features || []).filter(isEligible);
        const slugs = assignSlugs(eligible);
        const photoExists = (rel) => existsSync(join(publicDir, rel));

        for (const feature of eligible) {
            const slug = slugs.get(feature.properties.HW_ID);
            const dir = join(distDir, 'lieux', mapId, slug);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'index.html'), renderPoiPage({
                feature, slug, mapId, mapName: dest.name, prelaunch, photoExists,
            }), 'utf8');
            sitemapEntries.push({ url: `${SITE_ORIGIN}/lieux/${mapId}/${slug}/`, lastmod });
            pageCount++;
        }
        console.log(`✓ ${dest.name} : ${eligible.length} pages (${(geojson.features || []).length} lieux, seuil ${MIN_DESCRIPTION_CHARS} car.)`);
    }

    writeFileSync(join(distDir, 'sitemap.xml'), renderSitemap(sitemapEntries), 'utf8');
    writeFileSync(join(distDir, '404.html'), render404(), 'utf8');
    console.log(`✓ sitemap.xml (${sitemapEntries.length} URLs) + 404.html`);
    if (prelaunch) console.log('ℹ PRELAUNCH actif : pages générées avec noindex (à basculer au lancement, cf. en-tête du script).');
    return pageCount;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    generate();
}
