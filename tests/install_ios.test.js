// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// Installer Heripia sur iPhone (audit du 23/11/2026, écrans 55-56 validés par Stefan).

const h = vi.hoisted(() => ({ linked: null, opened: [] }));
vi.mock('../src/google-account.js', () => ({ getLinkedAccount: () => h.linked }));
vi.mock('../src/modal.js', () => ({ openHwModal: vi.fn((o) => { h.opened.push(o); return Promise.resolve(); }) }));
vi.mock('../src/ui-utils.js', () => ({ closeAllDropdowns: vi.fn() }));
window.matchMedia = window.matchMedia || (() => ({ matches: false }));

import { isIOS, iosBannerSentence, iosInstallSteps, openIosInstallHelp, isDesktopFirefox, installEntryVisible, installEntrySub, installHelpContent, startInstallFromMenu, checkAlreadyInstalled } from '../src/install-pwa-banner.js';

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

// Entrée « Installer Heripia » des menus (écrans 57-60, 23/11/2026).
const UA = {
    chromePC: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
    firefoxPC: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0',
    android: 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
};
const withUA = (ua, fn) => { const s = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua); try { return fn(); } finally { s.mockRestore(); } };

describe('entrée « Installer Heripia » du menu', () => {
    it('visible partout sauf Firefox sur PC', () => {
        expect(withUA(UA.chromePC, installEntryVisible)).toBe(true);
        expect(withUA(UA.android, installEntryVisible)).toBe(true);
        expect(withUA(UA.iphone, installEntryVisible)).toBe(true);
        expect(withUA(UA.firefoxAndroid, installEntryVisible)).toBe(true);
        expect(withUA(UA.firefoxPC, installEntryVisible)).toBe(false);
        expect(isDesktopFirefox(nav(UA.firefoxAndroid))).toBe(false);
    });
    it('cachée une fois installée', () => {
        const mm = window.matchMedia;
        window.matchMedia = () => ({ matches: true });
        try { expect(withUA(UA.chromePC, installEntryVisible)).toBe(false); } finally { window.matchMedia = mm; }
    });
    it('sous-titres : PC, téléphone, iPhone', () => {
        expect(withUA(UA.chromePC, () => installEntrySub(false))).toBe('Accès rapide, usage hors-ligne');
        expect(withUA(UA.android, () => installEntrySub(true))).toBe("Accès rapide depuis l'écran d'accueil, usage hors-ligne.");
        h.linked = null;
        expect(withUA(UA.iphone, () => installEntrySub(true))).toBe("Sur iPhone, c'est le seul moyen de garder vos visites et vos circuits.");
    });
    it('navigateur pas prêt : la bonne fenêtre selon l’appareil', () => {
        withUA(UA.android, startInstallFromMenu);
        expect(h.opened.at(-1).body).toContain('commence par « Installer »');
        withUA(UA.chromePC, startInstallFromMenu);
        expect(h.opened.at(-1).body).toContain('cherchez « Installer »');
        withUA(UA.macSafari, startInstallFromMenu);
        expect(h.opened.at(-1).body).toContain('« Ajouter au Dock »');
        withUA(UA.iphone, startInstallFromMenu);
        expect(h.opened.at(-1).title).toBe("Installer Heripia sur l'iPhone");
    });
    it('Android : 3 gestes, sans place ni libellé exacts (essai S25 : Brave, Samsung Internet)', () => {
        const html = installHelpContent('android');
        expect(html.match(/<li>/g)).toHaveLength(3);
        expect(html).toContain("en haut ou en bas de l'écran");
        expect(html).toContain('commence par « Installer »');
        expect(html).toContain("« Installer en tant qu'application Web »");
        expect(html).not.toContain('≡');
    });
    it('déjà installée depuis ce navigateur : l’entrée disparaît', async () => {
        expect(await checkAlreadyInstalled({ getInstalledRelatedApps: async () => [{ platform: 'webapp' }] })).toBe(true);
        expect(withUA(UA.android, installEntryVisible)).toBe(false);
        expect(await checkAlreadyInstalled({ getInstalledRelatedApps: async () => [] })).toBe(false);
        expect(withUA(UA.android, installEntryVisible)).toBe(true);
        expect(await checkAlreadyInstalled({})).toBe(false);
    });
});
