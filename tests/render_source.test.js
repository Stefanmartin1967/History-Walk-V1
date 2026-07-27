// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// Champ Source : « URL ou Texte ». Le mode texte n'a jamais fonctionné, parce
// que le code s'en remettait à `new URL()` pour trancher — or le parseur des
// navigateurs ne rejette quasiment rien :
//   https://martine gendron                  -> hostname « martine%20gendron »
//   https://Répertoire Jalel Fathallah, #207 -> hostname « xn--rpertoire%20…-b6c »
// Le repli texte du catch était donc du code mort en production.
//
// Piège de mesure : Node ET jsdom, eux, REJETTENT ces chaînes. Un test qui
// s'appuierait sur `new URL()` passerait donc même sans le correctif — il
// mesurerait le parseur de l'environnement de test, pas la règle. D'où des
// tests portés sur `looksLikeUrl`, la décision elle-même, qui ne dépend
// d'aucun parseur et se comporte à l'identique sous Node et sous Chrome.
// ============================================================================

vi.mock('../src/data.js', () => ({ getPatrimonialName: vi.fn(() => '') }));
vi.mock('../src/patrimonial-names.js', () => ({ getCurrentPatrimonialLang: vi.fn(() => 'fr') }));
vi.mock('../src/state.js', () => ({ state: { currentMapId: 'djerba', destinations: { maps: {} } } }));
vi.mock('../src/mobile-state.js', () => ({ isMobileView: vi.fn(() => false) }));
vi.mock('../src/access-point.js', () => ({ getAccessPointStatus: vi.fn(() => null) }));

import { renderSource, looksLikeUrl } from '../src/templates.js';

const rendu = (Source) => renderSource({ Source });
const estUnLien = (html) => html.includes('<a href=');

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

describe('renderSource — forme « Texte | URL »', () => {
    it('le texte devient le libellé du lien', () => {
        const html = rendu('Jalel Fathallah, « Mosquée Bouziri » | https://www.youtube.com/watch?v=QIpMeR9OnDQ');
        expect(html).toContain('href="https://www.youtube.com/watch?v=QIpMeR9OnDQ"');
        expect(html).toContain('Jalel Fathallah');
        expect(html).not.toContain('>youtube.com</a>'); // plus le domaine nu
    });

    it('accepte un domaine nu à droite et lui ajoute le schéma', () => {
        const html = rendu('Répertoire des mosquées | palaisbenayed.com/doc.pdf');
        expect(html).toContain('href="https://palaisbenayed.com/doc.pdf"');
        expect(html).toContain('>Répertoire des mosquées</a>');
    });

    it('tolère les espaces autour du séparateur', () => {
        expect(rendu('Wikipédia|https://fr.wikipedia.org/wiki/Djerba')).toContain('>Wikipédia</a>');
    });

    it('coupe au DERNIER séparateur — un libellé peut contenir une barre', () => {
        const html = rendu('Jalel | répertoire | https://exemple.org/a');
        expect(html).toContain('href="https://exemple.org/a"');
        expect(html).toContain('>Jalel | répertoire</a>');
    });

    it("échappe le libellé (pas d'injection dans le lien)", () => {
        const html = rendu('<img src=x onerror=alert(1)> | https://exemple.org');
        expect(html).not.toContain('<img');
        expect(html).toContain('href="https://exemple.org"');
    });

    it.each([
        ['Martine Gendron | témoignage oral'],   // droite pas une URL
        ['| https://exemple.org'],               // libellé vide
        ['Relevé sur place | mai 2026'],
    ])('« %s » reste du texte intégral (rien de masqué)', (saisie) => {
        const html = rendu(saisie);
        expect(estUnLien(html)).toBe(false);
        expect(html).toContain(saisie.replace(/&/g, '&amp;'));
    });

    it("RÉGRESSION : sans séparateur, le comportement d'avant est inchangé", () => {
        expect(rendu('https://exemple.org/a')).toContain('>exemple.org</a>');
        expect(rendu('martine gendron')).toContain('<span>martine gendron</span>');
    });
});

describe('renderSource — rendu', () => {
    it('RÉGRESSION : un nom de personne s\'affiche en texte, pas en lien', () => {
        const html = rendu('martine gendron');
        expect(estUnLien(html)).toBe(false);
        expect(html).toContain('<span>martine gendron</span>');
        expect(html).not.toContain('%20');
    });

    it('une phrase accentuée s\'affiche en texte, sans punycode', () => {
        const html = rendu('Martine Gendron — groupe mosquées de djerba');
        expect(estUnLien(html)).toBe(false);
        expect(html).not.toContain('xn--');
    });

    it.each([
        ['http://palaisbenayed.com/doc.pdf', 'palaisbenayed.com'],
        ['https://www.openstreetmap.org/way/1426153008', 'openstreetmap.org'],
        ['galaxytours.com/x/', 'galaxytours.com'],
    ])('%s reste un lien vers %s', (saisie, domaineAttendu) => {
        const html = rendu(saisie);
        expect(estUnLien(html)).toBe(true);
        expect(html).toContain(`>${domaineAttendu}</a>`);
        expect(html).toContain('rel="noopener noreferrer"');
    });

    it('échappe le HTML du texte libre', () => {
        expect(rendu('<script>x</script>')).not.toContain('<script>');
    });

    it('ne garde que la première ligne', () => {
        const html = rendu('https://exemple.org/a\nligne ignorée');
        expect(html).toContain('exemple.org');
        expect(html).not.toContain('ignorée');
    });

    it.each([[undefined], [null], [''], ['   '], [42]])('ne rend rien pour %s', (saisie) => {
        expect(rendu(saisie)).toBe('');
    });
});
