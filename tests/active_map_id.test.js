// Tests pour getActiveMapId / DEFAULT_MAP_ID (src/state.js).
// Ce helper remplace 17 `state.currentMapId || 'djerba'` disséminés : il résout
// l'identifiant de destination servant de CLÉ (IndexedDB, chemins GitHub, URLs).
// Ce qui est verrouillé ici, c'est l'ORDRE de priorité et la garantie de ne
// jamais renvoyer de valeur vide — une clé vide casserait la lecture des données.
import { describe, it, expect, beforeEach } from 'vitest';
import { state, getActiveMapId, DEFAULT_MAP_ID } from '../src/state.js';

describe('getActiveMapId — chaîne de résolution', () => {
    beforeEach(() => {
        state.currentMapId = null;
        state.destinations = { activeMapId: DEFAULT_MAP_ID, maps: {} };
    });

    it('priorité 1 : la destination courante gagne sur la config', () => {
        state.currentMapId = 'hammamet';
        state.destinations.activeMapId = 'djerba';
        expect(getActiveMapId()).toBe('hammamet');
    });

    it("priorité 2 : sans destination courante, retombe sur l'activeMapId de la config", () => {
        state.currentMapId = null;
        state.destinations.activeMapId = 'hammamet';
        expect(getActiveMapId()).toBe('hammamet');
    });

    it('priorité 3 : sans config exploitable, retombe sur DEFAULT_MAP_ID', () => {
        state.currentMapId = null;
        state.destinations = { maps: {} };          // activeMapId absent
        expect(getActiveMapId()).toBe(DEFAULT_MAP_ID);
        state.destinations = undefined;             // config entièrement perdue
        expect(getActiveMapId()).toBe(DEFAULT_MAP_ID);
    });

    it('ne renvoie JAMAIS de valeur vide — c\'est une clé de données', () => {
        for (const d of [undefined, null, {}, { maps: {} }, { activeMapId: '' }]) {
            state.currentMapId = null;
            state.destinations = d;
            const id = getActiveMapId();
            expect(typeof id).toBe('string');
            expect(id.length).toBeGreaterThan(0);
        }
    });

    it('DEFAULT_MAP_ID est le SEUL nom de destination en dur du code', () => {
        // Verrouille l'intention : si cette valeur change un jour, ce doit être
        // une décision explicite (modifier ce test), pas une dérive.
        expect(DEFAULT_MAP_ID).toBe('djerba');
    });
});
