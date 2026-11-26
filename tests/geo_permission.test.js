// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';

// Position refusée ou introuvable (audit avant publication, test S25 du
// 24/11/2026, écrans 65-67) : textes communs, vouvoiement, jamais le message
// brut du navigateur.

vi.mock('../src/modal.js', () => ({ openHwModal: vi.fn() }));
vi.mock('../src/install-pwa-banner.js', () => ({ isIOS: () => false }));

import { geoErrorTexts, geoErrorSentence, geoPermissionSteps, isGeoDenied } from '../src/geo-permission.js';

describe('geo-permission', () => {
    const setPerm = (state) => Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: state === undefined ? undefined : { query: async () => ({ state }) },
    });

    it('refusée (code 1) ≠ introuvable (codes 2, 3)', async () => {
        setPerm('denied');
        expect(await isGeoDenied({ code: 1 })).toBe(true);
        expect(await isGeoDenied({ code: 3 })).toBe(false);
        expect(await geoErrorTexts({ code: 1, message: 'User denied Geolocation' }))
            .toEqual({ title: 'Position refusée', text: 'Autorisez-la dans les réglages du navigateur.' });
        expect((await geoErrorTexts({ code: 2 })).title).toBe('Position introuvable');
        expect((await geoErrorTexts(null)).title).toBe('Position introuvable');
    });

    it('test E (S25, 25/11) : code 1 mais site autorisé = localisation du téléphone coupée', async () => {
        setPerm('granted');
        expect(await isGeoDenied({ code: 1 })).toBe(false);
        expect((await geoErrorTexts({ code: 1 })).title).toBe('Position introuvable');
    });

    it('test E bis (S25, 25/11) : code 1 et état « prompt » = introuvable, pas refusée', async () => {
        setPerm('prompt');
        expect(await isGeoDenied({ code: 1 })).toBe(false);
        expect((await geoErrorTexts({ code: 1 })).title).toBe('Position introuvable');
    });

    it('sans Permissions API : on se fie au code', async () => {
        setPerm(undefined);
        expect(await isGeoDenied({ code: 1 })).toBe(true);
        Object.defineProperty(navigator, 'permissions', {
            configurable: true, value: { query: () => Promise.reject(new Error('x')) },
        });
        expect(await isGeoDenied({ code: 1 })).toBe(true);
    });

    it('phrase de toast, sans message du navigateur', async () => {
        setPerm('denied');
        expect(await geoErrorSentence({ code: 1, message: 'User denied Geolocation' }))
            .toBe('Position refusée : autorisez-la dans les réglages du navigateur.');
        expect(await geoErrorSentence({ code: 3 }, ', ou choisissez un lieu'))
            .toBe('Position introuvable : vérifiez que la localisation du téléphone est activée, ou choisissez un lieu.');
    });

    it('marche à suivre Android (chemin Brave) et iPhone, au vouvoiement', () => {
        const android = geoPermissionSteps(false).join(' ');
        expect(android).toContain('Paramètres des sites → Position');
        expect(android).toContain('heripia.com');
        expect(geoPermissionSteps(true).join(' ')).toContain('Service de localisation');
        for (const s of [...geoPermissionSteps(false), ...geoPermissionSteps(true)]) {
            expect(s).not.toMatch(/\b(tu|ta|te|ton|tes)\b/);
        }
    });
});
