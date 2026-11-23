// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// Installer Heripia sur iPhone (audit du 23/11/2026, écrans 55-56 validés par Stefan).

const h = vi.hoisted(() => ({ linked: null, opened: [] }));
vi.mock('../src/google-account.js', () => ({ getLinkedAccount: () => h.linked }));
vi.mock('../src/modal.js', () => ({ openHwModal: vi.fn((o) => { h.opened.push(o); return Promise.resolve(); }) }));

import { isIOS, iosBannerSentence, iosInstallSteps, openIosInstallHelp } from '../src/install-pwa-banner.js';

const nav = (userAgent, platform = '', maxTouchPoints = 0) => ({ userAgent, platform, maxTouchPoints });

describe('reconnaître un iPhone ou un iPad', () => {
    it('iPhone, iPad, et iPadOS qui se présente comme un Mac tactile', () => {
        expect(isIOS(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'))).toBe(true);
        expect(isIOS(nav('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'))).toBe(true);
        expect(isIOS(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5))).toBe(true);
    });
    it('pas un Mac, ni Android', () => {
        expect(isIOS(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0))).toBe(false);
        expect(isIOS(nav('Mozilla/5.0 (Linux; Android 14; SM-S928B)', 'Linux armv8l', 5))).toBe(false);
    });
});

describe('le bandeau (écran 55)', () => {
    it('dit pourquoi installer ; compte Google relié → la phrase d’Android', () => {
        expect(iosBannerSentence(null)).toBe("Sur iPhone, c'est le seul moyen de garder vos visites et vos circuits.");
        expect(iosBannerSentence({ email: 'x' })).toBe("Accès rapide depuis l'écran d'accueil, usage hors-ligne.");
    });
});

describe('la fenêtre « Comment ? » (écran 56)', () => {
    it('les 3 gestes, Partager en bas pour Safari', () => {
        const s = iosInstallSteps(true);
        expect(s).toHaveLength(3);
        expect(s[0]).toContain("en bas de l'écran");
        expect(s[1]).toContain("Sur l'écran d'accueil");
        expect(s[2]).toContain('« Ajouter »');
    });
    it('autre navigateur : pas de « en bas de l’écran »', () => {
        expect(iosInstallSteps(false)[0]).not.toContain('en bas');
    });
    it('raison en tête, bouton « J’ai compris »', () => {
        openIosInstallHelp();
        const o = h.opened.at(-1);
        expect(o.title).toBe("Installer Heripia sur l'iPhone");
        expect(o.body).toContain('pendant 7 jours');
        expect(o.footer).toContain("J'ai compris");
    });
});
