// Tests du générateur de pages SEO statiques (scripts/generate-poi-pages.mjs).
// Helpers purs uniquement — la génération complète (I/O dist/) est vérifiée
// au build (npm run build → postbuild).
import { describe, it, expect } from 'vitest';
import {
    slugify,
    escapeHtml,
    isEligible,
    assignSlugs,
    metaDescription,
    getLatLng,
    safeSource,
    renderPoiPage,
    renderSitemap,
    MIN_DESCRIPTION_CHARS,
} from '../scripts/generate-poi-pages.mjs';

const makeFeature = (props = {}, coords = [10.88, 33.87825]) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coords },
    properties: {
        'Nom du site FR': 'Mosquée Sidi Zekri',
        'Nom du site arabe': 'مسجد سيدي زكري',
        'Catégorie': 'Mosquée',
        'Sous-type': 'À coupoles',
        Zone: 'Mazraia',
        HW_ID: 'HW-01TEST',
        description: 'x'.repeat(MIN_DESCRIPTION_CHARS),
        photos: [],
        ...props,
    },
});

describe('slugify', () => {
    it('kebab-case sans diacritiques', () => {
        expect(slugify('Mosquée Sidi Zekri')).toBe('mosquee-sidi-zekri');
        expect(slugify('Église Saint-Joseph (Houmt Souk)')).toBe('eglise-saint-joseph-houmt-souk');
    });
    it('replie sur le fallback si le nom ne produit rien (nom arabe)', () => {
        expect(slugify('مسجد', 'HW-01ABC')).toBe('hw-01abc');
        expect(slugify('', 'HW-01ABC')).toBe('hw-01abc');
    });
});

describe('assignSlugs', () => {
    it('déduplique les collisions par suffixe -2, -3', () => {
        const features = [
            makeFeature({ HW_ID: 'HW-A', 'Nom du site FR': 'Mosquée El Abied' }),
            makeFeature({ HW_ID: 'HW-B', 'Nom du site FR': 'Mosquée El Abied' }),
            makeFeature({ HW_ID: 'HW-C', 'Nom du site FR': 'Mosquée El Abied' }),
        ];
        const slugs = assignSlugs(features);
        expect(slugs.get('HW-A')).toBe('mosquee-el-abied');
        expect(slugs.get('HW-B')).toBe('mosquee-el-abied-2');
        expect(slugs.get('HW-C')).toBe('mosquee-el-abied-3');
    });
});

describe('isEligible (pas de thin content)', () => {
    it('refuse description vide ou trop courte, accepte au seuil', () => {
        expect(isEligible(makeFeature({ description: '' }))).toBe(false);
        expect(isEligible(makeFeature({ description: '   ' }))).toBe(false);
        expect(isEligible(makeFeature({ description: 'x'.repeat(MIN_DESCRIPTION_CHARS - 1) }))).toBe(false);
        expect(isEligible(makeFeature({ description: 'x'.repeat(MIN_DESCRIPTION_CHARS) }))).toBe(true);
        expect(isEligible({ properties: {} })).toBe(false);
    });
});

describe('metaDescription', () => {
    it('aplatit les sauts de ligne et coupe au mot', () => {
        expect(metaDescription('ligne 1\nligne 2')).toBe('ligne 1 ligne 2');
        const long = 'mot '.repeat(60).trim();
        const meta = metaDescription(long);
        expect(meta.length).toBeLessThanOrEqual(156);
        expect(meta.endsWith('…')).toBe(true);
        expect(meta).not.toMatch(/mo…$/); // pas coupé en plein mot
    });
});

describe('getLatLng', () => {
    it('geometry prioritaire ([lng,lat] → [lat,lng]), repli properties', () => {
        expect(getLatLng(makeFeature())).toEqual([33.87825, 10.88]);
        expect(getLatLng({ properties: { lat: 1, lng: 2 } })).toEqual([1, 2]);
        expect(getLatLng({ properties: {} })).toBeNull();
    });
});

describe('safeSource', () => {
    it('http(s) uniquement (leçon S4), domaine sans www.', () => {
        expect(safeSource('https://www.example.com/x?y=1')).toEqual({ url: 'https://www.example.com/x?y=1', domain: 'example.com' });
        expect(safeSource('https://djerba.holiday/page-tres-longue/')).toEqual({ url: 'https://djerba.holiday/page-tres-longue/', domain: 'djerba.holiday' });
        expect(safeSource('javascript:alert(1)')).toBeNull();
        expect(safeSource('ftp://x')).toBeNull();
        expect(safeSource('')).toBeNull();
    });
});

describe('renderPoiPage', () => {
    const render = (over = {}, opts = {}) => renderPoiPage({
        feature: makeFeature(over),
        slug: 'mosquee-sidi-zekri',
        mapId: 'djerba',
        mapName: 'Djerba',
        photoExists: () => true,
        ...opts,
    });

    it('échappe le HTML des données', () => {
        const html = render({ 'Nom du site FR': 'Café <script>"&"</script>', description: 'desc & <b>brute</b> '.repeat(10) });
        expect(html).not.toContain('<script>"&"');
        expect(html).toContain('Café &lt;script&gt;');
        expect(html).toContain('desc &amp; &lt;b&gt;');
    });

    it('porte le noindex en prélancement, pas après', () => {
        expect(render({}, { prelaunch: true })).toContain('noindex, nofollow');
        expect(render({}, { prelaunch: false })).not.toContain('noindex');
    });

    it('canonical + CTA deep-link + JSON-LD TouristAttraction valide', () => {
        const html = render();
        expect(html).toContain('https://heripia.com/lieux/djerba/mosquee-sidi-zekri/');
        expect(html).toContain('href="/?poi=HW-01TEST"');
        const jsonLd = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
        expect(jsonLd['@type']).toBe('TouristAttraction');
        expect(jsonLd.geo.latitude).toBe(33.87825);
        expect(jsonLd.alternateName).toBe('مسجد سيدي زكري');
    });

    it('photo : 1ère existante du geojson, sinon og-image et pas de <img>', () => {
        const withPhoto = render({ photos: ['photos/poi_HW-01TEST_1.jpg'] });
        expect(withPhoto).toContain('<img class="photo" src="/photos/poi_HW-01TEST_1.jpg"');
        expect(withPhoto).toContain('og:image" content="https://heripia.com/photos/poi_HW-01TEST_1.jpg"');
        const noPhoto = render({ photos: [] });
        expect(noPhoto).not.toContain('<img class="photo"');
        expect(noPhoto).toContain('og:image" content="https://heripia.com/og-image.png"');
        const stale = render({ photos: ['photos/disparue.jpg'] }, { photoExists: () => false });
        expect(stale).not.toContain('<img class="photo"');
    });

    it('source : domaine affiché (pas l\'URL brute), absente si pas http(s)', () => {
        expect(render({ Source: 'javascript:alert(1)' })).not.toContain('class="source"');
        const html = render({ Source: 'https://www.djerba.holiday/page-longue/x' });
        expect(html).toContain('class="source"');
        expect(html).toContain('>djerba.holiday</a>');               // libellé = domaine
        expect(html).toContain('href="https://www.djerba.holiday/page-longue/x"'); // href = URL complète
        expect(html).not.toContain('>https://www.djerba.holiday/page-longue/x</a>');
    });

    it('description multi-lignes → paragraphes', () => {
        const html = render({ description: ('para 1.' + 'x'.repeat(80)) + '\n\npara 2.' });
        expect(html).toContain('<p>para 1.');
        expect(html).toContain('<p>para 2.</p>');
    });
});

describe('renderSitemap', () => {
    it('urlset valide avec échappement XML', () => {
        const xml = renderSitemap([
            { url: 'https://heripia.com/' },
            { url: 'https://heripia.com/lieux/djerba/a-b/', lastmod: '2026-06-12' },
        ]);
        expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
        expect(xml).toContain('<loc>https://heripia.com/lieux/djerba/a-b/</loc>');
        expect(xml).toContain('<lastmod>2026-06-12</lastmod>');
        const escaped = renderSitemap([{ url: 'https://x.com/?a=1&b=2' }]);
        expect(escaped).toContain('&amp;');
    });
});
