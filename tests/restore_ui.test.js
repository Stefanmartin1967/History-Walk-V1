// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Choix d'un texte après restauration (19/11/2026, PR 2 « synchro users ») :
// la version finale est datée et part de la version du fichier ; le choix entre
// dans la copie de sécurité (« Annuler la restauration » le défait aussi).

const h = vi.hoisted(() => ({ stored: {} }));
vi.mock('../src/state.js', () => ({ state: { userData: {}, customFeatures: [], loadedFeatures: [] }, getDestinationLabel: () => 'Djerba' }));
vi.mock('../src/database.js', () => ({
    savePoiData: vi.fn(async () => {}),
    saveAppState: vi.fn(async () => {}),
    getAllPoiDataForMap: vi.fn(async () => h.stored),
}));
vi.mock('../src/restore-apply.js', async () => ({
    describeBackup: vi.fn(), getLastRestore: vi.fn(), saveLastRestore: vi.fn(), undoLastRestore: vi.fn(),
    // L'écriture du texte choisi est la vraie (partagée avec la synchronisation).
    writeChosenText: (await vi.importActual('../src/restore-apply.js')).writeChosenText,
}));
vi.mock('../src/events.js', () => ({ eventBus: { emit: vi.fn() } }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));

import { state } from '../src/state.js';
import { savePoiData } from '../src/database.js';
import { keepFinal } from '../src/restore-ui.js';

beforeEach(() => {
    vi.clearAllMocks();
    state.userData = {};
    h.stored = { G: { description: 'Version PC.', _fieldDates: { description: 2000 } } };
});

describe('keepFinal', () => {
    it('version finale datée maintenant, partie de la version du fichier', async () => {
        await keepFinal('djerba', { kind: 'poi', id: 'G', key: 'description', fileDate: 1500 }, 'Version PC. Version téléphone.');
        const [, id, data] = vi.mocked(savePoiData).mock.calls[0];
        expect(id).toBe('G');
        expect(data.description).toBe('Version PC. Version téléphone.');
        expect(data._fieldFrom).toEqual({ description: 1500 });
        expect(data._fieldDates.description).toBeGreaterThan(2000);
    });

    it('la copie de sécurité reçoit l’état d’avant du texte choisi', async () => {
        const last = await keepFinal('djerba', { kind: 'poi', id: 'G', key: 'description', fileDate: 1500 }, 'X', { undo: { userData: {} } });
        expect(last.undo.userData.G).toEqual({ description: 'Version PC.', _fieldDates: { description: 2000 } });
    });

    it('une fiche déjà dans la copie de sécurité n’est pas écrasée par l’état intermédiaire', async () => {
        const before = { description: 'Origine' };
        const last = await keepFinal('djerba', { kind: 'poi', id: 'G', key: 'description', fileDate: 1500 }, 'X', { undo: { userData: { G: before } } });
        expect(last.undo.userData.G).toBe(before);
    });
});
