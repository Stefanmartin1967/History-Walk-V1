// @vitest-environment jsdom
// Cadrage vertical des photos d'en-tête (photo-focus.js, hero-photo.js,
// hero-framing.js — v3.7.488).
import { describe, it, expect, vi } from 'vitest';
import { photoKey, clampFocus, getPhotoFocus, withPhotoFocus, countFramed } from '../src/photo-focus.js';
import { setHeroFocus, verticalSlack } from '../src/hero-photo.js';

vi.mock('../src/state.js', () => ({ state: { isAdmin: true } }));
vi.mock('../src/data.js', () => ({ updatePoiData: vi.fn() }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
import { state } from '../src/state.js';
import { canFrameHero } from '../src/hero-framing.js';

const feat = (props, userData) => ({ properties: { ...props, ...(userData ? { userData } : {}) } });

describe('photoKey — clé = nom de fichier', () => {
    it('chemin court et adresse d\'un dépôt de photos donnent la même clé', () => {
        expect(photoKey('photos/poi_HW-1_17.jpg')).toBe('poi_HW-1_17.jpg');
        expect(photoKey('https://stefanmartin1967.github.io/heripia-photos-charleroi/poi_HW-1_17.jpg?v=2')).toBe('poi_HW-1_17.jpg');
    });
    it('blob, data, vide : pas de clé', () => {
        expect(photoKey('blob:http://localhost/abc')).toBeNull();
        expect(photoKey('data:image/jpeg;base64,xx')).toBeNull();
        expect(photoKey('')).toBeNull();
        expect(photoKey(undefined)).toBeNull();
    });
});

describe('clampFocus', () => {
    it('borne à 0..100 et arrondit ; invalide = centre', () => {
        expect(clampFocus(-5)).toBe(0);
        expect(clampFocus(140)).toBe(100);
        expect(clampFocus(33.6)).toBe(34);
        expect(clampFocus('abc')).toBe(50);
    });
});

describe('getPhotoFocus — lecture via l\'overlay', () => {
    it('lit la valeur de la photo, overlay prioritaire', () => {
        const f = feat({ photoFocus: { 'a.jpg': 10 } }, { photoFocus: { 'a.jpg': 80 } });
        expect(getPhotoFocus(f, 'photos/a.jpg')).toBe(80);
    });
    it('photo sans réglage ou champ vidé (null) : centrée (null)', () => {
        expect(getPhotoFocus(feat({ photoFocus: { 'a.jpg': 10 } }), 'photos/b.jpg')).toBeNull();
        expect(getPhotoFocus(feat({ photoFocus: { 'a.jpg': 10 } }, { photoFocus: null }), 'photos/a.jpg')).toBeNull();
        expect(getPhotoFocus(feat({}), 'photos/a.jpg')).toBeNull();
    });
});

describe('withPhotoFocus — nouvelle valeur du champ', () => {
    const photos = ['photos/a.jpg', 'photos/b.jpg'];
    it('ajoute le réglage d\'une photo, clés triées', () => {
        expect(withPhotoFocus({ 'b.jpg': 30 }, photos, 'photos/a.jpg', 12)).toEqual({ 'a.jpg': 12, 'b.jpg': 30 });
        expect(Object.keys(withPhotoFocus({ 'b.jpg': 30 }, photos, 'photos/a.jpg', 12))).toEqual(['a.jpg', 'b.jpg']);
    });
    it('remettre au centre (50) retire la clé ; plus rien → null', () => {
        expect(withPhotoFocus({ 'a.jpg': 12, 'b.jpg': 30 }, photos, 'photos/a.jpg', 50)).toEqual({ 'b.jpg': 30 });
        expect(withPhotoFocus({ 'a.jpg': 12 }, photos, 'photos/a.jpg', 50)).toBeNull();
    });
    it('les réglages de photos retirées du lieu partent au passage', () => {
        expect(withPhotoFocus({ 'old.jpg': 10 }, photos, 'photos/a.jpg', 20)).toEqual({ 'a.jpg': 20 });
    });
    it('photo absente de la liste ou sans clé (blob) : ignorée', () => {
        expect(withPhotoFocus(null, photos, 'photos/z.jpg', 20)).toBeNull();
        expect(withPhotoFocus(null, photos, 'blob:x', 20)).toBeNull();
    });
    it('countFramed', () => {
        expect(countFramed({ 'a.jpg': 1, 'b.jpg': 2 })).toBe(2);
        expect(countFramed(null)).toBe(0);
    });
});

describe('hero : position et marge verticale', () => {
    it('setHeroFocus pose la position verticale, null la retire', () => {
        const el = document.createElement('div');
        setHeroFocus(el, 20);
        expect(el.style.backgroundPosition).toBe('center 20%');
        setHeroFocus(el, null);
        expect(el.style.backgroundPosition).toBe('');
    });
    it('verticalSlack : 4:3 dans un bandeau 450×200 → 137,5 px de marge', () => {
        expect(verticalSlack(450, 200, 1200, 900)).toBeCloseTo(137.5);
    });
    it('verticalSlack : panorama plus large que le bandeau → 0 (rien à cadrer)', () => {
        expect(verticalSlack(450, 200, 3000, 1000)).toBe(0);
    });
});

describe('canFrameHero — admin, PC, photo publiée', () => {
    it('admin sur PC avec une photo publiée : oui', () => {
        state.isAdmin = true;
        expect(canFrameHero({ isMobile: false, url: 'photos/a.jpg' })).toBe(true);
    });
    it('mobile, non-admin ou photo locale (blob) : non', () => {
        state.isAdmin = true;
        expect(canFrameHero({ isMobile: true, url: 'photos/a.jpg' })).toBe(false);
        expect(canFrameHero({ isMobile: false, url: 'blob:http://x/1' })).toBe(false);
        state.isAdmin = false;
        expect(canFrameHero({ isMobile: false, url: 'photos/a.jpg' })).toBe(false);
    });
});
