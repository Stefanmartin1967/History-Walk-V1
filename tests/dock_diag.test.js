// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startDockDiag, measureLayout, formatBoot, getDockDiagBlocks } from '../src/dock-diag.js';

// ============================================================================
// Dock absent au démarrage qui suit une mise à jour (téléphone de Stefan,
// 20/10/2026). Mesure provisoire : chaque démarrage mobile est relevé et les
// trois derniers s'affichent en bas du Menu. Et une mise à jour ne recharge
// plus qu'une fois (le contrôle de version de main.js en ajoutait un second).
// ============================================================================

const KEY = 'hw_dock_diag';
const stored = () => JSON.parse(localStorage.getItem(KEY));

let stop;
beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '<div id="mobile-view-footer"></div><div id="mobile-dock"></div>';
});
afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('startDockDiag', () => {
    it('note le démarrage tout de suite, puis le relevé après 3 s', () => {
        stop = startDockDiag('3.7.448');
        expect(stored()).toHaveLength(1);
        expect(stored()[0]).toMatchObject({ version: '3.7.448', mesure: null, changements: [] });

        vi.advanceTimersByTime(3000);
        expect(stored()[0].mesure).toMatchObject({
            fenetre: window.innerHeight,
            page: document.documentElement.clientHeight,
            dock: '0→0',
        });
    });

    it('ne garde que les trois derniers démarrages', () => {
        for (const v of ['1', '2', '3', '4']) {
            startDockDiag(v)();
        }
        expect(stored().map(b => b.version)).toEqual(['2', '3', '4']);
    });

    it('note les changements de taille de la fenêtre, six au plus', () => {
        stop = startDockDiag('3.7.448');
        for (let i = 0; i < 8; i++) {
            window.dispatchEvent(new Event('resize'));
            vi.advanceTimersByTime(500);
        }
        const changes = stored()[0].changements;
        expect(changes).toHaveLength(6);
        expect(changes[5].s).toBe(3);
        expect(changes[0]).toEqual({ s: 0, fenetre: window.innerHeight, dock: '0→0' });
    });

    it('regroupe une rafale de changements de taille en un seul relevé', () => {
        stop = startDockDiag('3.7.448');
        for (let i = 0; i < 5; i++) {
            window.dispatchEvent(new Event('resize'));
            vi.advanceTimersByTime(100);
        }
        vi.advanceTimersByTime(400);
        expect(stored()[0].changements).toHaveLength(1);
    });

    it('repart de zéro si le stockage est illisible', () => {
        localStorage.setItem(KEY, '{pas du json');
        stop = startDockDiag('3.7.448');
        expect(stored()).toHaveLength(1);
    });
});

describe('measureLayout', () => {
    it('dit « masqué » quand le dock est caché', () => {
        document.getElementById('mobile-dock').style.display = 'none';
        expect(measureLayout().dock).toBe('masqué');
    });

    it('dit « absent » sans dock', () => {
        document.body.innerHTML = '';
        expect(measureLayout().dock).toBe('absent');
    });

    it("ne laisse pas l'élément témoin dans la page", () => {
        measureLayout();
        expect(document.body.children).toHaveLength(2);
    });
});

describe('formatBoot', () => {
    const at = new Date(2026, 9, 20, 14, 32).toISOString();

    it('met un démarrage mesuré en lignes lisibles', () => {
        const boot = {
            at, version: '3.7.448', nav: 'reload', appli: true,
            mesure: { fenetre: 805, page: 805, ecran: 915, dispo: 869, svh: 805, dvh: 805, lvh: 805, marge: 0, dock: '743→805' },
            changements: [{ s: 12, fenetre: 749, dock: '687→749' }],
        };
        expect(formatBoot(boot)).toEqual([
            '20/10 14:32 · v3.7.448 · rechargement · appli',
            'fenêtre 805 · page 805 (écran 915, dispo 869) · svh 805 dvh 805 lvh 805 · marge bas 0',
            'dock 743→805',
            'après 12 s : fenêtre 749, dock 687→749',
        ]);
    });

    it("lit un relevé de la v3.7.448, d'avant la hauteur de la page", () => {
        const boot = {
            at, version: '3.7.448', nav: 'reload', appli: true,
            mesure: { fenetre: 750, ecran: 832, dispo: 750, svh: 750, dvh: 750, lvh: 750, marge: 0, dock: '744→805' },
            changements: [],
        };
        expect(formatBoot(boot)[1]).toBe('fenêtre 750 · page ? (écran 832, dispo 750) · svh 750 dvh 750 lvh 750 · marge bas 0');
    });

    it('signale un démarrage pas encore mesuré', () => {
        const boot = { at, version: '3.7.448', nav: 'navigate', appli: false, mesure: null, changements: [] };
        expect(formatBoot(boot)).toEqual(['20/10 14:32 · v3.7.448 · ouverture · onglet', 'pas encore mesuré']);
    });
});

describe('getDockDiagBlocks', () => {
    it('rend les démarrages du plus récent au plus ancien', () => {
        startDockDiag('1')();
        startDockDiag('2')();
        expect(getDockDiagBlocks().map(lines => lines[0])).toEqual([
            expect.stringContaining('v2'),
            expect.stringContaining('v1'),
        ]);
    });

    it('ne rend rien sans mesure', () => {
        expect(getDockDiagBlocks()).toEqual([]);
    });
});

describe('main.js — un seul rechargement par mise à jour', () => {
    it('ne recharge plus la page quand la version change', () => {
        const code = readFileSync(resolve(__dirname, '..', 'src', 'main.js'), 'utf8')
            .replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(/hw_app_version/);
    });
});
