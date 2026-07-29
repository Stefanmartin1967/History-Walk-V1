// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// renderSource — le RENDU du bloc « Source(s) » sous la description.
// La règle de lecture du champ (texte / URL / « Libellé | URL » / une par
// ligne) est testée à part, sur le module partagé : tests/source_format.test.js.
// Ici on ne vérifie que ce qui est propre à l'app : le HTML produit,
// l'échappement, et le basculement singulier/pluriel.
// ============================================================================

vi.mock('../src/data.js', () => ({ getPatrimonialName: vi.fn(() => '') }));
vi.mock('../src/patrimonial-names.js', () => ({ getCurrentPatrimonialLang: vi.fn(() => 'fr') }));
vi.mock('../src/state.js', () => ({ state: { currentMapId: 'djerba', destinations: { maps: {} } } }));
vi.mock('../src/mobile-state.js', () => ({ isMobileView: vi.fn(() => false) }));
vi.mock('../src/access-point.js', () => ({ getAccessPointStatus: vi.fn(() => null) }));

import { renderSource } from '../src/templates.js';

const rendu = (Source) => renderSource({ Source });
const estUnLien = (html) => html.includes('<a href=');

describe('renderSource — une seule source', () => {
    // 56 des 57 lieux sourcés de Djerba sont dans ce cas : leur fiche ne doit
    // pas bouger d'un pixel. D'où l'étiquette au singulier, sur la même ligne.
    it('garde le rendu historique « Source : … » sur une ligne', () => {
        expect(rendu('martine gendron')).toBe('<div class="poi-source-link">Source : <span>martine gendron</span></div>');
        expect(rendu('https://exemple.org/a')).not.toContain('poi-source-item');
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

    it('« Texte | URL » : le texte devient le libellé du lien', () => {
        const html = rendu('Jalel Fathallah, « Mosquée Bouziri » | https://www.youtube.com/watch?v=QIpMeR9OnDQ');
        expect(html).toContain('href="https://www.youtube.com/watch?v=QIpMeR9OnDQ"');
        expect(html).toContain('Jalel Fathallah');
        expect(html).not.toContain('>youtube.com</a>'); // plus le domaine nu
    });

    it('un nom de personne s\'affiche en texte, pas en lien', () => {
        const html = rendu('martine gendron');
        expect(estUnLien(html)).toBe(false);
        expect(html).not.toContain('%20');
    });

    it('une phrase accentuée s\'affiche en texte, sans punycode', () => {
        const html = rendu('Martine Gendron — groupe mosquées de djerba');
        expect(estUnLien(html)).toBe(false);
        expect(html).not.toContain('xn--');
    });

    it('rien de masqué quand la partie droite n\'est pas une URL', () => {
        const html = rendu('Relevé sur place | mai 2026');
        expect(estUnLien(html)).toBe(false);
        expect(html).toContain('Relevé sur place | mai 2026');
    });
});

describe('renderSource — plusieurs sources', () => {
    const multi = 'https://exemple.org/a\nTémoignage d\'un habitant\nJalel Fathallah | https://exemple.org/b';

    it('bascule l\'étiquette au pluriel', () => {
        expect(rendu(multi)).toContain('Sources :');
        expect(rendu(multi)).not.toContain('Source :</div>');
    });

    it('rend UNE ligne par source', () => {
        const html = rendu(multi);
        expect(html.match(/poi-source-item/g)).toHaveLength(3);
        expect(html).toContain('href="https://exemple.org/a"');
        expect(html).toContain('Témoignage');
        expect(html).toContain('>Jalel Fathallah</a>');
    });

    it('RÉGRESSION : les lignes 2+ ne sont plus perdues', () => {
        // Cas réel « Mosquée Ouilihi » : la 2ᵉ source existait dans la donnée
        // depuis toujours, mais renderSource ne lisait que la 1ʳᵉ ligne.
        const html = rendu('https://www.flickr.com/photos/x/8008665414\nhttps://www.facebook.com/Assidje.org/posts/y');
        expect(html).toContain('flickr.com');
        expect(html).toContain('facebook.com');
    });

    it('une ligne vide ne crée pas de source fantôme', () => {
        expect(rendu('a.org\n\n\nb.org').match(/poi-source-item/g)).toHaveLength(2);
    });
});

describe('renderSource — échappement et champ vide', () => {
    it('échappe le HTML du texte libre', () => {
        expect(rendu('<script>x</script>')).not.toContain('<script>');
    });

    it('échappe le libellé d\'un lien (pas d\'injection)', () => {
        const html = rendu('<img src=x onerror=alert(1)> | https://exemple.org');
        expect(html).not.toContain('<img');
        expect(html).toContain('href="https://exemple.org"');
    });

    it.each([[undefined], [null], [''], ['   '], [42]])('ne rend rien pour %s', (saisie) => {
        expect(rendu(saisie)).toBe('');
    });
});
