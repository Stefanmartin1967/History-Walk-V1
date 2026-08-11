// ============================================================================
// src/description-format.mjs — paragraphes + gras + liens du champ
// Description, partagé par l'app (templates.js) et le générateur de pages SEO
// (generate-poi-pages.mjs). Module pur : ni DOM, ni jsdom nécessaires.
//
// Chantier 10/08/2026 (Stefan, exemple église Saint-Joseph). Décisions
// validées : **texte** pour le gras, CHAQUE retour à la ligne = nouveau
// paragraphe (pas besoin de ligne vide), liens http(s) auto-détectés.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { parseDescription, renderDescriptionHtml } from '../src/description-format.mjs';

const escapeHtml = (s) => String(s ?? '').replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
}[c]));

describe('parseDescription — paragraphes', () => {
    it('vide ou absent → tableau vide', () => {
        expect(parseDescription('')).toEqual([]);
        expect(parseDescription(null)).toEqual([]);
        expect(parseDescription(undefined)).toEqual([]);
        expect(parseDescription('   ')).toEqual([]);
    });

    it('un seul retour à la ligne suffit à séparer deux paragraphes', () => {
        const paragraphs = parseDescription('Première idée.\nDeuxième idée.');
        expect(paragraphs).toHaveLength(2);
    });

    it('une ligne vide (double retour) ne crée pas de 3ᵉ paragraphe fantôme', () => {
        const paragraphs = parseDescription('Un.\n\nDeux.');
        expect(paragraphs).toHaveLength(2);
    });

    it('espaces en début/fin de paragraphe retirés', () => {
        const [[seg]] = parseDescription('  texte avec espaces  ');
        expect(seg).toEqual({ type: 'text', value: 'texte avec espaces' });
    });
});

describe('parseDescription — gras', () => {
    it('**texte** devient un segment bold', () => {
        const [paragraph] = parseDescription('Avant **important** après.');
        expect(paragraph).toEqual([
            { type: 'text', value: 'Avant ' },
            { type: 'bold', value: 'important' },
            { type: 'text', value: ' après.' },
        ]);
    });

    it('un seul ** non apparié reste du texte littéral (pas de gras fantôme)', () => {
        const [paragraph] = parseDescription('Ceci n\'est **pas fermé');
        expect(paragraph.every(s => s.type !== 'bold')).toBe(true);
    });

    it('plusieurs mots en gras dans le même paragraphe', () => {
        const [paragraph] = parseDescription('**Un** et **deux**.');
        const bolds = paragraph.filter(s => s.type === 'bold').map(s => s.value);
        expect(bolds).toEqual(['Un', 'deux']);
    });
});

describe('parseDescription — liens', () => {
    it('une URL http(s) nue devient un segment link', () => {
        const [paragraph] = parseDescription('Voir https://example.com/x ici.');
        expect(paragraph).toEqual([
            { type: 'text', value: 'Voir ' },
            { type: 'link', value: 'https://example.com/x' },
            { type: 'text', value: ' ici.' },
        ]);
    });

    it('un domaine nu SANS http(s):// n\'est PAS un lien (contrairement au champ Source)', () => {
        // Choix assumé, différent de source-format.mjs : une description est
        // de la prose, pas un champ dédié aux sources — on ne devine pas.
        const [paragraph] = parseDescription('Voir exemple.com pour plus.');
        expect(paragraph.some(s => s.type === 'link')).toBe(false);
    });

    it('ftp:// ou javascript: ne sont jamais reconnus comme lien', () => {
        const [paragraph] = parseDescription('Voir javascript:alert(1) et ftp://x.com ici.');
        expect(paragraph.some(s => s.type === 'link')).toBe(false);
    });
});

describe('renderDescriptionHtml — sécurité (échappement AVANT tout)', () => {
    it('un <script> injecté est neutralisé', () => {
        const html = renderDescriptionHtml('Test <script>alert(1)</script> fin.', escapeHtml, 'noopener noreferrer');
        expect(html).not.toContain('<script>alert');
        expect(html).toContain('&lt;script&gt;');
    });

    it('un & dans une URL reste intact dans le href réel malgré l\'échappement HTML', () => {
        const html = renderDescriptionHtml('Voir https://example.com/a&b=1 ici.', escapeHtml, 'noopener noreferrer');
        expect(html).toContain('href="https://example.com/a&amp;b=1"');
        // Un navigateur restitue &amp; → & en lisant l'attribut : le href réel est correct.
    });

    it('les guillemets dans le texte ne cassent pas l\'attribut href', () => {
        const html = renderDescriptionHtml('Il a dit "voir" https://example.com ici.', escapeHtml, 'noopener noreferrer');
        expect(html).toContain('href="https://example.com"');
    });
});

describe('renderDescriptionHtml — rendu', () => {
    it('un paragraphe par retour à la ligne, avec le rel injecté par l\'appelant', () => {
        const html = renderDescriptionHtml('Un.\nDeux https://x.com trois.', escapeHtml, 'nofollow noopener');
        expect(html).toBe('<p>Un.</p><p>Deux <a href="https://x.com" target="_blank" rel="nofollow noopener">https://x.com</a> trois.</p>');
    });

    it('le gras devient <strong>, échappé', () => {
        const html = renderDescriptionHtml('**Titre**', escapeHtml, 'noopener noreferrer');
        expect(html).toBe('<p><strong>Titre</strong></p>');
    });

    it('texte vide → chaîne vide (pas de <p></p> fantôme)', () => {
        expect(renderDescriptionHtml('', escapeHtml, 'noopener noreferrer')).toBe('');
        expect(renderDescriptionHtml('   ', escapeHtml, 'noopener noreferrer')).toBe('');
    });

    it('le rel diffère selon l\'appelant (app vs page SEO) — pas hardcodé dans le module', () => {
        const app = renderDescriptionHtml('https://x.com', escapeHtml, 'noopener noreferrer');
        const seo = renderDescriptionHtml('https://x.com', escapeHtml, 'nofollow noopener');
        expect(app).toContain('rel="noopener noreferrer"');
        expect(seo).toContain('rel="nofollow noopener"');
    });
});

describe('renderDescriptionHtml — l\'exemple qui a motivé ce chantier (église Saint-Joseph)', () => {
    it('amorces en gras + paragraphes multiples, comme dans le document de Stefan', () => {
        const text = "**Introduction**\nL'église catholique de Djerba est construite en 1848.\n**En 1906**\nL'intérieur est renouvelé.";
        const html = renderDescriptionHtml(text, escapeHtml, 'noopener noreferrer');
        expect(html).toContain('<p><strong>Introduction</strong></p>');
        expect(html).toContain('<p><strong>En 1906</strong></p>');
        expect(html).toContain('<p>L&apos;église catholique de Djerba est construite en 1848.</p>');
    });
});
