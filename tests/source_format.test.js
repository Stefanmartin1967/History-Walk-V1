// ============================================================================
// src/source-format.mjs — la RÈGLE de lecture du champ Source, partagée par
// l'app (renderSource) et le générateur de pages SEO. Module pur : ni DOM, ni
// jsdom nécessaires ici.
//
// Piège de mesure, à ne pas défaire : les tests portent sur `looksLikeUrl`, la
// décision elle-même, et jamais sur `new URL()`. Node et jsdom REJETTENT
// « https://martine gendron » là où Chrome l'accepte et en fait un lien vers
// « martine%20gendron » — un test bâti sur `new URL()` mesurerait le parseur de
// l'environnement de test et passerait même sans le correctif.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { looksLikeUrl, parseSources } from '../src/source-format.mjs';

describe('looksLikeUrl — ce qui N\'EST PAS une URL', () => {
    it.each([
        ['martine gendron'],                              // le cas signalé
        ['Martine Gendron — groupe mosquées de djerba'],
        ['Répertoire Jalel Fathallah, #207'],
        ['Relevé sur place, novembre 2026'],
        ['Plaque de la mosquée'],
        ['Témoignage d\'un habitant'],
        ['p.12'],                                         // point présent, mais pas de TLD alphabétique
        ['voir p.12 du répertoire'],
        ['Jalel Fathallah'],
        ['OSM'],
    ])('« %s » est du texte', (saisie) => {
        expect(looksLikeUrl(saisie)).toBe(false);
    });
});

describe('looksLikeUrl — ce qui EST une URL', () => {
    it.each([
        ['http://palaisbenayed.com/doc.pdf'],
        ['https://www.openstreetmap.org/way/1426153008'],
        ['HTTPS://EXEMPLE.ORG'],
        ['galaxytours.com/x/'],
        ['www.bibliotheque.nat.tn'],
        ['exemple.org'],
        ['exemple.org?a=1'],
        ['exemple.org#ancre'],
    ])('« %s » est une URL', (saisie) => {
        expect(looksLikeUrl(saisie)).toBe(true);
    });
});

describe('parseSources — une source par ligne', () => {
    it('lit TOUTES les lignes', () => {
        // Le cas réel qui a motivé la fonctionnalité : « Mosquée Ouilihi »
        // portait une seconde source que personne n'avait jamais vue.
        const sources = parseSources('https://www.flickr.com/photos/x/8008665414\nhttps://www.facebook.com/Assidje.org/posts/y');
        expect(sources).toHaveLength(2);
        expect(sources[0].text).toBe('flickr.com');
        expect(sources[1].text).toBe('facebook.com');
    });

    it('ignore les lignes vides et les espaces de bord', () => {
        expect(parseSources('  a.org  \n\n   \n  Témoignage  ')).toEqual([
            // href = la saisie complétée du schéma, PAS `new URL().href` : pas
            // de « / » ajouté, les liens déjà publiés ne bougent pas.
            { text: 'a.org', url: 'https://a.org' },
            { text: 'Témoignage', url: null },
        ]);
    });

    it('mélange les trois formes sur des lignes différentes', () => {
        const [lien, texte, labellisee] = parseSources(
            'https://exemple.org/a\nRelevé sur place, novembre 2026\nJalel Fathallah | https://exemple.org/b'
        );
        expect(lien).toEqual({ text: 'exemple.org', url: 'https://exemple.org/a' });
        expect(texte).toEqual({ text: 'Relevé sur place, novembre 2026', url: null });
        expect(labellisee).toEqual({ text: 'Jalel Fathallah', url: 'https://exemple.org/b' });
    });

    it.each([[undefined], [null], [''], ['   '], ['\n\n'], [42]])('rend [] pour %s', (saisie) => {
        expect(parseSources(saisie)).toEqual([]);
    });
});

describe('parseSources — forme « Libellé | URL »', () => {
    it('le texte devient le libellé du lien', () => {
        expect(parseSources('Jalel Fathallah, « Mosquée Bouziri » | https://www.youtube.com/watch?v=QIpMeR9OnDQ')).toEqual([
            { text: 'Jalel Fathallah, « Mosquée Bouziri »', url: 'https://www.youtube.com/watch?v=QIpMeR9OnDQ' },
        ]);
    });

    it('accepte un domaine nu à droite et lui ajoute le schéma', () => {
        expect(parseSources('Répertoire des mosquées | palaisbenayed.com/doc.pdf')).toEqual([
            { text: 'Répertoire des mosquées', url: 'https://palaisbenayed.com/doc.pdf' },
        ]);
    });

    it('tolère l\'absence d\'espaces autour du séparateur', () => {
        expect(parseSources('Wikipédia|https://fr.wikipedia.org/wiki/Djerba')[0].text).toBe('Wikipédia');
    });

    it('coupe au DERNIER séparateur — un libellé peut contenir une barre', () => {
        expect(parseSources('Jalel | répertoire | https://exemple.org/a')).toEqual([
            { text: 'Jalel | répertoire', url: 'https://exemple.org/a' },
        ]);
    });

    it.each([
        ['Martine Gendron | témoignage oral'],   // droite pas une URL
        ['| https://exemple.org'],               // libellé vide
        ['Relevé sur place | mai 2026'],
    ])('« %s » reste du texte INTÉGRAL — rien n\'est masqué', (saisie) => {
        expect(parseSources(saisie)).toEqual([{ text: saisie, url: null }]);
    });
});

describe('parseSources — sécurité des liens', () => {
    it.each([
        ['javascript:alert(1)'],
        ['ftp://exemple.org'],
        ['data:text/html,<script>x</script>'],
    ])('« %s » ne produit jamais d\'URL', (saisie) => {
        expect(parseSources(saisie)[0].url).toBeNull();
    });

    it('toute URL construite est en http(s)', () => {
        for (const saisie of ['exemple.org', 'www.a.tn/x', 'HTTP://B.ORG', 'Libellé | c.org']) {
            expect(parseSources(saisie)[0].url).toMatch(/^https?:\/\//i);
        }
    });
});
