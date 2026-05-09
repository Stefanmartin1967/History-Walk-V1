// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// DM dirty flag — fiabilisation PR C1
//
// Avant C1, le flag `dm_has_unpublished_changes` était mis à '1' à chaque
// mutation et clear UNIQUEMENT à la publication GitHub. Donc un undo qui
// ramenait le draft à l'état exact du dernier load/publish laissait le flag
// à '1' → faux positif côté HW (warning cross-app affiché à tort).
//
// Avec C1, on suit `cleanHistoryIndex` (l'index de l'historique = état
// "propre"). À chaque mutation/undo/redo, refreshDirtyFlag clear le flag SI
// historyIndex === cleanHistoryIndex.
// ============================================================================

vi.mock('../history_walk_datamanager/../src/modal.js', () => ({
    hwConfirm: vi.fn(() => Promise.resolve(true)),
    hwAlert: vi.fn()
}));

import {
    saveFeature,
    deleteFeature,
    undo,
    redo,
    markDmClean,
    markDmDirty,
    clearDmDirty,
    _initStateForTests,
    _getInternalStateForTests,
    _resetCleanHistoryIndexForTests,
} from '../history_walk_datamanager/src/storage.js';

const FLAG_KEY = 'dm_has_unpublished_changes';

function isDirty() { return localStorage.getItem(FLAG_KEY) === '1'; }

const baseFeature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [10, 33] },
    properties: { 'Nom du site FR': 'Initial', HW_ID: 'HW-INIT' }
};

const validFormData = {
    nom: 'Nouveau Lieu',
    gps: '34.5, 10.7',
    categorie: 'Plage',
    zone: 'Test',
};

beforeEach(() => {
    localStorage.clear();
    _resetCleanHistoryIndexForTests();
});

// ─────────────────────────────────────────────────────────────────────────────
// markDmDirty / clearDmDirty (helpers de base)
// ─────────────────────────────────────────────────────────────────────────────
describe('markDmDirty / clearDmDirty', () => {
    it('markDmDirty pose le flag à "1"', () => {
        markDmDirty();
        expect(localStorage.getItem(FLAG_KEY)).toBe('1');
    });

    it('clearDmDirty retire le flag', () => {
        markDmDirty();
        clearDmDirty();
        expect(localStorage.getItem(FLAG_KEY)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// markDmClean : aligne cleanHistoryIndex sur l'état courant
// ─────────────────────────────────────────────────────────────────────────────
describe('markDmClean (PR C1)', () => {
    it('clear le flag et aligne cleanHistoryIndex sur historyIndex', () => {
        _initStateForTests({ type: 'FeatureCollection', features: [baseFeature] });
        const stateAfterInit = _getInternalStateForTests();
        // _initStateForTests a déjà appelé markDmClean → indices alignés
        expect(stateAfterInit.cleanHistoryIndex).toBe(stateAfterInit.historyIndex);
        expect(isDirty()).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cycle : modif → undo → flag clean
// ─────────────────────────────────────────────────────────────────────────────
describe('cycle modification → undo (PR C1)', () => {
    beforeEach(() => {
        _initStateForTests({ type: 'FeatureCollection', features: [baseFeature] });
    });

    it('saveFeature met le flag à dirty', () => {
        saveFeature(validFormData);
        expect(isDirty()).toBe(true);
    });

    it('undo après une modif unique → revient à clean (flag = false)', () => {
        saveFeature(validFormData);
        expect(isDirty()).toBe(true);
        undo();
        expect(isDirty()).toBe(false);
    });

    it('undo + redo → flag re-dirty', () => {
        saveFeature(validFormData);
        undo();
        expect(isDirty()).toBe(false);
        redo();
        expect(isDirty()).toBe(true);
    });

    it('2 modifs consécutives + 2 undos → flag clean', () => {
        saveFeature({ ...validFormData, nom: 'A' });
        saveFeature({ ...validFormData, nom: 'B' });
        expect(isDirty()).toBe(true);
        undo();
        expect(isDirty()).toBe(true); // Encore une modif au-dessus de clean
        undo();
        expect(isDirty()).toBe(false); // Retour exact à l'état clean
    });

    it('undo en dessous de clean (impossible via UI — historyIndex>0 garde) reste cohérent', async () => {
        // L'API undo() a la garde `if (historyIndex > 0)` donc on ne peut pas
        // descendre sous l'index 0. À l'init, cleanHistoryIndex = 0 et
        // historyIndex = 0. Tenter undo() → no-op, flag reste clean.
        expect(isDirty()).toBe(false);
        undo(); // no-op (historyIndex === 0)
        expect(isDirty()).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cycle : modif → publish (markDmClean) → modif → undo
// ─────────────────────────────────────────────────────────────────────────────
describe('cycle publish → modif → undo (PR C1)', () => {
    beforeEach(() => {
        _initStateForTests({ type: 'FeatureCollection', features: [baseFeature] });
    });

    it('après publish (markDmClean), une modif passe le flag à dirty', () => {
        saveFeature(validFormData);
        // Simule la publication GitHub
        markDmClean();
        expect(isDirty()).toBe(false);

        // Une nouvelle modif
        saveFeature({ ...validFormData, nom: 'Encore' });
        expect(isDirty()).toBe(true);
    });

    it('après publish + modif + undo → revient à clean (= état post-publish)', () => {
        saveFeature(validFormData);
        markDmClean(); // simulate publish
        const afterPublish = _getInternalStateForTests();

        saveFeature({ ...validFormData, nom: 'Encore' });
        expect(isDirty()).toBe(true);

        undo();
        const afterUndo = _getInternalStateForTests();
        expect(afterUndo.historyIndex).toBe(afterPublish.cleanHistoryIndex);
        expect(isDirty()).toBe(false);
    });

    it('publish suivi de undo (avant nouvelle modif) → flag reste clean', () => {
        saveFeature(validFormData);
        markDmClean();
        // L'admin n'a rien fait depuis la publication mais clique undo par
        // mégarde : il revient à l'état pré-modif.
        undo();
        // historyIndex < cleanHistoryIndex → flag dirty (l'état actuel n'est
        // PLUS l'état publié, c'est un état antérieur).
        expect(isDirty()).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteFeature : même comportement que saveFeature
// ─────────────────────────────────────────────────────────────────────────────
describe('deleteFeature (PR C1)', () => {
    beforeEach(() => {
        _initStateForTests({
            type: 'FeatureCollection',
            features: [baseFeature, { ...baseFeature, properties: { ...baseFeature.properties, HW_ID: 'HW-2' } }]
        });
    });

    it('deleteFeature met le flag à dirty', async () => {
        await deleteFeature(0);
        expect(isDirty()).toBe(true);
    });

    it('deleteFeature + undo → flag clean', async () => {
        await deleteFeature(0);
        undo();
        expect(isDirty()).toBe(false);
    });
});
