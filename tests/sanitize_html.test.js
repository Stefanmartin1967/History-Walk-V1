// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeHTML } from '../src/utils.js';

describe('sanitizeHTML', () => {
    it('renvoie une chaîne vide pour une entrée vide ou nulle', () => {
        expect(sanitizeHTML('')).toBe('');
        expect(sanitizeHTML(null)).toBe('');
        expect(sanitizeHTML(undefined)).toBe('');
    });

    it('laisse passer le texte simple sans balise (chemin optimisé)', () => {
        expect(sanitizeHTML('Bonjour Djerba')).toBe('Bonjour Djerba');
    });

    it('préserve le balisage éditorial légitime', () => {
        const out = sanitizeHTML('<p>Un <b>café</b> et un <em>thé</em></p>');
        expect(out).toContain('<b>café</b>');
        expect(out).toContain('<em>thé</em>');
    });

    it('supprime les balises <script>', () => {
        const out = sanitizeHTML('<p>ok</p><script>alert(1)</script>');
        expect(out).toContain('ok');
        expect(out.toLowerCase()).not.toContain('<script');
        expect(out).not.toContain('alert(1)');
    });

    it('retire un gestionnaire onclick inline en conservant l\'élément', () => {
        const out = sanitizeHTML('<button onclick="steal()">Clic</button>');
        expect(out).toContain('Clic');
        expect(out).toContain('<button');
        expect(out.toLowerCase()).not.toContain('onclick');
        expect(out).not.toContain('steal()');
    });

    it('retire onerror sur une <img> (vecteur XSS classique)', () => {
        const out = sanitizeHTML('<img src="x" onerror="alert(document.cookie)">');
        expect(out).toContain('<img');
        expect(out.toLowerCase()).not.toContain('onerror');
        expect(out).not.toContain('document.cookie');
    });

    it('retire les handlers quelle que soit la casse', () => {
        const out = sanitizeHTML('<div ONCLICK="a()" onMouseOver="b()">x</div>');
        const lower = out.toLowerCase();
        expect(lower).not.toContain('onclick');
        expect(lower).not.toContain('onmouseover');
        expect(out).toContain('x');
    });

    it('retire les handlers sur des éléments imbriqués', () => {
        const out = sanitizeHTML('<div onclick="a()"><span onmouseover="b()">y</span></div>');
        const lower = out.toLowerCase();
        expect(lower).not.toContain('onclick');
        expect(lower).not.toContain('onmouseover');
        expect(out).toContain('y');
    });

    it('neutralise un href javascript: (toute casse / espaces)', () => {
        const out = sanitizeHTML('<a href="  JavaScript:alert(1)">lien</a>');
        expect(out).toContain('lien');
        expect(out.toLowerCase()).not.toContain('javascript:');
    });

    it('préserve un href légitime (http/https)', () => {
        const out = sanitizeHTML('<a href="https://example.com">site</a>');
        expect(out).toContain('https://example.com');
        expect(out).toContain('site');
    });

    it('préserve les attributs légitimes ne commençant pas par « on »', () => {
        const out = sanitizeHTML('<span class="poi" id="p1">z</span>');
        expect(out).toContain('class="poi"');
        expect(out).toContain('id="p1"');
    });
});
