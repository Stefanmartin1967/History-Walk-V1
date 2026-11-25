// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';

// Position refusée ou introuvable (audit avant publication, test S25 du
// 24/11/2026, écrans 65-67) : textes communs, vouvoiement, jamais le message
// brut du navigateur.

vi.mock('../src/modal.js', () => ({ openHwModal: vi.fn() }));
vi.mock('../src/install-pwa-banner.js', () => ({ isIOS: () => false }));

import { geoErrorTexts, geoErrorSentence, geoPermissionSteps, isGeoDenied } from '../src/geo-permission.js';

describe('geo-permission', () => {
    it('refusée (code 1) ≠ introuvable (codes 2, 3)', () => {
        expect(isGeoDenied({ code: 1 })).toBe(true);
        expect(isGeoDenied({ code: 3 })).toBe(false);
        expect(geoErrorTexts({ code: 1, message: 'User denied Geolocation' }))
            .toEqual({ title: 'Position refusée', text: 'Autorisez-la dans les réglages du navigateur.' });
        expect(geoErrorTexts({ code: 2 }).title).toBe('Position introuvable');
        expect(geoErrorTexts(null).title).toBe('Position introuvable');
    });

    it('phrase de toast, sans message du navigateur', () => {
        expect(geoErrorSentence({ code: 1, message: 'User denied Geolocation' }))
            .toBe('Position refusée : autorisez-la dans les réglages du navigateur.');
        expect(geoErrorSentence({ code: 3 }, ', ou choisissez un lieu'))
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
