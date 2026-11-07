// @vitest-environment jsdom
// Photo d'en-tête : une photo portrait est affichée entière sur fond flou
// (src/hero-photo.js, v3.7.487). La sonde de ratio est simulée : jsdom ne
// charge pas d'images.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setHeroPhoto, isPortrait } from '../src/hero-photo.js';

const GRADIENT = 'linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.35))';

// Image factice : déclenche onload au prochain tick avec les dimensions voulues.
let nextSize = { w: 0, h: 0 };
class FakeImage {
    constructor() { this.naturalWidth = 0; this.naturalHeight = 0; this.onload = null; }
    set src(v) {
        this._src = v;
        const { w, h } = nextSize;
        setTimeout(() => { this.naturalWidth = w; this.naturalHeight = h; this.onload?.(); }, 0);
    }
    get src() { return this._src; }
}
const tick = () => new Promise(r => setTimeout(r, 5));

describe('isPortrait', () => {
    it('plus haute que large = portrait ; carré et paysage = non', () => {
        expect(isPortrait(600, 900)).toBe(true);
        expect(isPortrait(900, 900)).toBe(false);
        expect(isPortrait(1200, 800)).toBe(false);
        expect(isPortrait(0, 0)).toBe(false);
    });
});

describe('setHeroPhoto', () => {
    let hero;
    let RealImage;
    beforeEach(() => {
        RealImage = globalThis.Image;
        globalThis.Image = FakeImage;
        hero = document.createElement('div');
        hero.innerHTML = '<span class="cartel-hero-count"></span>';
        document.body.appendChild(hero);
    });
    afterEach(() => {
        globalThis.Image = RealImage;
        hero.remove();
        vi.restoreAllMocks();
    });

    it('pose toujours la photo en fond (cover) avec la variable CSS', () => {
        nextSize = { w: 1200, h: 800 };
        setHeroPhoto(hero, 'photos/a.jpg', { gradient: GRADIENT, cssVar: '--poi-hero-bg' });
        expect(hero.style.backgroundImage).toContain('photos/a.jpg');
        expect(hero.style.getPropertyValue('--poi-hero-bg')).toBe('url("photos/a.jpg")');
    });

    it('paysage : aucun calque portrait', async () => {
        nextSize = { w: 1200, h: 800 };
        setHeroPhoto(hero, 'photos/a.jpg', { gradient: GRADIENT });
        await tick();
        expect(hero.querySelector('.hero-portrait')).toBeNull();
    });

    it('portrait : calque en premier enfant, photo par-dessus le fond flou', async () => {
        nextSize = { w: 600, h: 900 };
        setHeroPhoto(hero, 'photos/p.jpg', { gradient: GRADIENT });
        await tick();
        const layer = hero.querySelector('.hero-portrait');
        expect(layer).not.toBeNull();
        expect(hero.firstElementChild).toBe(layer);
        expect(layer.style.backgroundImage).toContain('photos/p.jpg');
        expect(layer.getAttribute('aria-hidden')).toBe('true');
    });

    it('une sonde en retard (autre photo posée entre-temps) n\'applique rien', async () => {
        nextSize = { w: 600, h: 900 };
        setHeroPhoto(hero, 'photos/p.jpg', { gradient: GRADIENT });
        nextSize = { w: 1200, h: 800 };
        setHeroPhoto(hero, 'photos/a.jpg', { gradient: GRADIENT });
        await tick();
        expect(hero.querySelector('.hero-portrait')).toBeNull();
    });

    it('hero retiré du DOM avant la fin de la sonde : rien', async () => {
        nextSize = { w: 600, h: 900 };
        setHeroPhoto(hero, 'photos/p.jpg', { gradient: GRADIENT });
        hero.remove();
        await tick();
        expect(hero.querySelector('.hero-portrait')).toBeNull();
    });

    it('nouvelle photo : l\'ancien calque portrait est retiré', async () => {
        nextSize = { w: 600, h: 900 };
        setHeroPhoto(hero, 'photos/p.jpg', { gradient: GRADIENT });
        await tick();
        nextSize = { w: 1200, h: 800 };
        setHeroPhoto(hero, 'photos/a.jpg', { gradient: GRADIENT });
        expect(hero.querySelector('.hero-portrait')).toBeNull();
    });
});
