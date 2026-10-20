// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// circuit-photos-offline.js — photos des étapes gardées à l'ouverture d'un
// circuit (3ᵉ PR du chantier hors-ligne, 20/10/2026)
//
// Avant, une photo n'était gardée que si on avait ouvert la fiche de son lieu
// en ligne : hors-ligne, 1 photo sur 5 pour un circuit préparé (mesuré).
// Publiées : la 1re de chaque étape. Photos de travail (admin) : toutes.
// ============================================================================

const h = vi.hoisted(() => ({ offline: false, back: [], work: {} }));

vi.mock('../src/state.js', () => ({ state: { isAdmin: false, activeCircuitId: null, currentCircuit: [] } }));
vi.mock('../src/data.js', () => ({ getPoiId: (f) => f.id }));
vi.mock('../src/utils.js', () => ({ getPoiProp: (f, key) => f.properties?.[key] }));
vi.mock('../src/network-status.js', () => ({
    isOffline: () => h.offline,
    onNetworkBack: (fn) => { h.back.push(fn); },
}));
vi.mock('../src/work-photos.js', () => ({
    getWorkPhotosById: (id) => h.work[id] || [],
    loadWorkPhotoBlob: vi.fn(async () => new Blob(['x'])),
}));

import { state } from '../src/state.js';
import { loadWorkPhotoBlob } from '../src/work-photos.js';
import { keepCircuitPhotosOffline } from '../src/circuit-photos-offline.js';

const step = (id, photos) => ({ id, properties: { photos } });
const fetched = () => globalThis.fetch.mock.calls.map(([url]) => url);
const okResponse = () => ({ blob: async () => new Blob(['jpg']) });

beforeEach(() => {
    h.offline = false;
    h.work = {};
    state.isAdmin = false;
    state.activeCircuitId = null;
    state.currentCircuit = [];
    globalThis.fetch = vi.fn(async () => okResponse());
    loadWorkPhotoBlob.mockClear();
});
afterEach(() => {
    delete globalThis.fetch;
    delete navigator.connection;
});

describe('photos publiées', () => {
    it("garde la 1re photo de chaque étape, une à une, en basse priorité", async () => {
        await keepCircuitPhotosOffline([
            step('a', ['photos/a1.jpg', 'photos/a2.jpg']),
            step('b', []),
            step('c', undefined),
            step('d', ['photos/d1.jpg']),
        ]);

        expect(fetched()).toEqual(['photos/a1.jpg', 'photos/d1.jpg']);
        expect(globalThis.fetch.mock.calls[0][1]).toEqual({ priority: 'low' });
    });

    it("ignore une photo que le service worker ne garderait pas", async () => {
        await keepCircuitPhotosOffline([
            step('a', ['https://upload.wikimedia.org/a.jpg']),
            step('b', ['photos/b.png']),
            step('c', ['photos/c.jpg?v=2']),
        ]);

        expect(fetched()).toEqual(['photos/c.jpg?v=2']);
    });

    it('une photo à la fois', async () => {
        let release;
        globalThis.fetch = vi.fn()
            .mockImplementationOnce(() => new Promise((r) => { release = r; }))
            .mockImplementation(async () => okResponse());

        const run = keepCircuitPhotosOffline([step('a', ['photos/a.jpg']), step('b', ['photos/b.jpg'])]);
        await Promise.resolve();
        expect(fetched()).toEqual(['photos/a.jpg']);

        release(okResponse());
        await run;
        expect(fetched()).toEqual(['photos/a.jpg', 'photos/b.jpg']);
    });

    it("un autre circuit ouvert arrête le précédent", async () => {
        let release;
        globalThis.fetch = vi.fn()
            .mockImplementationOnce(() => new Promise((r) => { release = r; }))
            .mockImplementation(async () => okResponse());

        const first = keepCircuitPhotosOffline([step('a', ['photos/a.jpg']), step('b', ['photos/b.jpg'])]);
        await Promise.resolve();
        const second = keepCircuitPhotosOffline([step('x', ['photos/x.jpg'])]);
        release(okResponse());
        await Promise.all([first, second]);

        expect(fetched()).toEqual(['photos/a.jpg', 'photos/x.jpg']); // jamais b
    });
});

describe('quand ne rien faire', () => {
    it('hors-ligne : rien', async () => {
        h.offline = true;
        state.isAdmin = true;
        h.work = { a: ['djerba/a.jpg'] };

        await keepCircuitPhotosOffline([step('a', ['photos/a.jpg'])]);

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(loadWorkPhotoBlob).not.toHaveBeenCalled();
    });

    it('mode « économie de données » : rien', async () => {
        Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });

        await keepCircuitPhotosOffline([step('a', ['photos/a.jpg'])]);

        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('réseau perdu en route : on s\'arrête', async () => {
        globalThis.fetch = vi.fn(async () => { h.offline = true; throw new TypeError('Failed to fetch'); });

        await keepCircuitPhotosOffline([step('a', ['photos/a.jpg']), step('b', ['photos/b.jpg'])]);

        expect(fetched()).toEqual(['photos/a.jpg']);
    });
});

describe('photos de travail', () => {
    it("admin : toutes celles des étapes (gardées comprises)", async () => {
        state.isAdmin = true;
        h.work = { a: ['djerba/a1.jpg', 'djerba/a2-gardee.jpg'], c: ['djerba/c1.jpg'] };

        await keepCircuitPhotosOffline([step('a', []), step('b', []), step('c', [])]);

        expect(loadWorkPhotoBlob.mock.calls.map(([p]) => p)).toEqual(['djerba/a1.jpg', 'djerba/a2-gardee.jpg', 'djerba/c1.jpg']);
    });

    it('hors admin : aucune', async () => {
        h.work = { a: ['djerba/a1.jpg'] };

        await keepCircuitPhotosOffline([step('a', ['photos/a.jpg'])]);

        expect(loadWorkPhotoBlob).not.toHaveBeenCalled();
    });
});

describe('retour du réseau', () => {
    it('garde les photos du circuit ouvert', async () => {
        state.activeCircuitId = 'HW-1';
        state.currentCircuit = [step('a', ['photos/a.jpg'])];

        h.back.forEach((fn) => fn());
        await vi.waitFor(() => expect(fetched()).toEqual(['photos/a.jpg']));
    });

    it('aucun circuit ouvert : rien', async () => {
        h.back.forEach((fn) => fn());
        await Promise.resolve();

        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});
