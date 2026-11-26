// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';

// Position indisponible ou introuvable (audit avant publication, tests S25 des
// 24-26/11/2026, écrans 68-70) : textes communs, vouvoiement, jamais le message
// brut du navigateur. Code 1 = refus OU localisation du téléphone coupée,
// indiscernables : on nomme les deux réglages.

const h = vi.hoisted(() => ({ openHwModal: vi.fn() }));
vi.mock('../src/modal.js', () => ({ openHwModal: h.openHwModal }));
vi.mock('../src/install-pwa-banner.js', () => ({ isIOS: () => false }));

import {
    geoErrorTexts, geoErrorSentence, geoHelpSteps, isGeoBlocked, openGeoPermissionHelp,
} from '../src/geo-permission.js';

describe('geo-permission', () => {
    it('bloquée (code 1) ≠ introuvable (codes 2, 3)', () => {
        expect(isGeoBlocked({ code: 1 })).toBe(true);
        expect(isGeoBlocked({ code: 3 })).toBe(false);
        expect(geoErrorTexts({ code: 1, message: 'User denied Geolocation' })).toEqual({
            title: 'Position indisponible',
            text: "Vérifiez la localisation du téléphone et l'autorisation du navigateur.",
        });
        expect(geoErrorTexts({ code: 2 }).title).toBe('Position introuvable');
        expect(geoErrorTexts(null).title).toBe('Position introuvable');
    });

    it('phrase de toast, sans message du navigateur', () => {
        expect(geoErrorSentence({ code: 1, message: 'User denied Geolocation' }))
            .toBe("Position indisponible : vérifiez la localisation du téléphone et l'autorisation du navigateur.");
        expect(geoErrorSentence({ code: 3 }, ', ou choisissez un lieu'))
            .toBe('Position introuvable : vérifiez que la localisation du téléphone est activée, ou choisissez un lieu.');
    });

    it('aide en deux volets (Android : volet du haut, puis chemin Brave), au vouvoiement', () => {
        const a = geoHelpSteps(false);
        expect(a.phone.join(' ')).toContain('Localisation');
        expect(a.browser.join(' ')).toContain('Paramètres des sites → Position');
        expect(a.browser.join(' ')).toContain('heripia.com');
        const i = geoHelpSteps(true);
        expect([...i.phone, ...i.browser].join(' ')).toContain('Service de localisation');
        for (const s of [...a.phone, ...a.browser, ...i.phone, ...i.browser]) {
            expect(s).not.toMatch(/\b(tu|ta|te|ton|tes)\b/);
        }
    });

    it('la fenêtre « Retrouver votre position » numérote les deux volets à la suite', () => {
        openGeoPermissionHelp();
        const { title, body } = h.openHwModal.mock.calls.at(-1)[0];
        expect(title).toBe('Retrouver votre position');
        expect(body).toContain('1 · La localisation du téléphone');
        expect(body).toContain("2 · L'autorisation du navigateur");
        const nums = [...body.matchAll(/ios-install-num">(\d+)</g)].map((m) => Number(m[1]));
        expect(nums).toEqual([1, 2, 3, 4, 5]);
    });
});
