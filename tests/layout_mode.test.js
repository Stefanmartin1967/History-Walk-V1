// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 18/10/2026 — affichage mobile/bureau choisi UNE fois au démarrage
// (lockLayoutMode), et message « Recharger » quand la fenêtre franchit ensuite
// la frontière. Avant : isMobileView() relisait la largeur à chaque appel alors
// que l'interface avait été construite pour l'autre affichage, et la fenêtre
// passée en demi-écran (ou le téléphone tourné) montrait un écran mort.
// Module rechargé à chaque test : la décision verrouillée est un état de module.

let mql;
function stubMatchMedia(matches) {
    const listeners = [];
    mql = {
        matches,
        media: '',
        addEventListener: (type, fn) => { if (type === 'change') listeners.push(fn); },
        removeEventListener: vi.fn(),
        // Simule un redimensionnement qui fait (ou non) basculer la requête.
        flip(next) { this.matches = next; listeners.forEach(fn => fn({ matches: next })); },
    };
    window.matchMedia = vi.fn((q) => { mql.media = q; return mql; });
}

async function load() {
    vi.resetModules();
    const state = await import('../src/mobile-state.js');
    const prompt = await import('../src/layout-reload-prompt.js');
    return { ...state, ...prompt };
}

const promptEl = () => document.getElementById('layout-reload-prompt');

beforeEach(() => {
    document.body.innerHTML = '';
    delete window.matchMedia;
    window.innerWidth = 1366;
});
afterEach(() => {
    delete window.matchMedia;
});

describe('critère et verrou', () => {
    it('matchesMobileLayout interroge MOBILE_LAYOUT_QUERY', async () => {
        stubMatchMedia(true);
        const { matchesMobileLayout, MOBILE_LAYOUT_QUERY } = await load();
        expect(matchesMobileLayout()).toBe(true);
        expect(window.matchMedia).toHaveBeenCalledWith(MOBILE_LAYOUT_QUERY);
    });

    it('sans matchMedia (jsdom) : repli sur la largeur seule', async () => {
        const { matchesMobileLayout } = await load();
        window.innerWidth = 683;
        expect(matchesMobileLayout()).toBe(true);
        window.innerWidth = 1366;
        expect(matchesMobileLayout()).toBe(false);
    });

    it('avant verrou : isMobileView suit la fenêtre', async () => {
        const { isMobileView } = await load();
        window.innerWidth = 683;
        expect(isMobileView()).toBe(true);
        window.innerWidth = 1366;
        expect(isMobileView()).toBe(false);
    });

    it('après verrou en bureau : isMobileView reste false même si la fenêtre rétrécit', async () => {
        const { lockLayoutMode, isMobileView } = await load();
        window.innerWidth = 1366;
        expect(lockLayoutMode()).toBe(false);
        window.innerWidth = 683;
        expect(isMobileView()).toBe(false);
    });

    it('après verrou en mobile : isMobileView reste true même si la fenêtre s\'élargit', async () => {
        const { lockLayoutMode, isMobileView } = await load();
        window.innerWidth = 390;
        expect(lockLayoutMode()).toBe(true);
        window.innerWidth = 1366;
        expect(isMobileView()).toBe(true);
    });
});

describe('message « Affichage à adapter »', () => {
    it('rien d\'affiché tant que la fenêtre garde l\'affichage construit', async () => {
        stubMatchMedia(false);
        const { lockLayoutMode, startLayoutReloadPrompt } = await load();
        lockLayoutMode();
        startLayoutReloadPrompt();
        expect(promptEl()).toBeNull();
    });

    it('bureau puis fenêtre étroite : message + bouton « Recharger » ; retour à la taille d\'origine : message masqué', async () => {
        stubMatchMedia(false);
        const { lockLayoutMode, startLayoutReloadPrompt } = await load();
        lockLayoutMode();
        startLayoutReloadPrompt();

        mql.flip(true);
        const el = promptEl();
        expect(el).not.toBeNull();
        expect(el.hidden).toBe(false);
        expect(el.getAttribute('role')).toBe('alertdialog');
        expect(el.querySelector('.layout-reload-title').textContent).toBe('Affichage à adapter');
        const btn = el.querySelector('button');
        expect(btn.textContent).toBe('Recharger');
        expect(document.activeElement).toBe(btn);

        mql.flip(false);
        expect(promptEl().hidden).toBe(true);
    });

    it('mobile puis fenêtre large (tablette tournée) : même message', async () => {
        stubMatchMedia(true);
        const { lockLayoutMode, startLayoutReloadPrompt } = await load();
        lockLayoutMode();
        startLayoutReloadPrompt();

        mql.flip(false);
        expect(promptEl().hidden).toBe(false);
    });

    it('une modale ouverte garde le focus (saisie en cours)', async () => {
        stubMatchMedia(false);
        const { lockLayoutMode, startLayoutReloadPrompt } = await load();
        lockLayoutMode();
        startLayoutReloadPrompt();
        document.body.insertAdjacentHTML('beforeend',
            '<div class="hw-modal-overlay is-active"><input id="champ-en-cours"></div>');
        const field = document.getElementById('champ-en-cours');
        field.focus();

        mql.flip(true);
        expect(promptEl().hidden).toBe(false);
        expect(document.activeElement).toBe(field);
    });

    it('un seul message, même après plusieurs bascules', async () => {
        stubMatchMedia(false);
        const { lockLayoutMode, startLayoutReloadPrompt } = await load();
        lockLayoutMode();
        startLayoutReloadPrompt();
        mql.flip(true);
        mql.flip(false);
        mql.flip(true);
        expect(document.querySelectorAll('#layout-reload-prompt')).toHaveLength(1);
    });
});
