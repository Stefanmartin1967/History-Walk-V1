import { describe, it, expect, vi, beforeEach } from 'vitest';

// Synchronisation avec le compte Google (PR 6 « synchro users », 20/11/2026) :
// réunion appareil + compte (règles de la restauration), envoi du résultat,
// textes à choisir gardés côté compte, versions écartées 30 jours.

const h = vi.hoisted(() => ({
    device: null,   // état de l'appareil (forme readDeviceState)
    app: {},        // getAppState / saveAppState
    drive: {},      // nom → { id, content }
    writes: [],
}));

vi.mock('../src/state.js', () => ({
    state: { currentMapId: 'other', userData: {}, loadedFeatures: [], customFeatures: [], destinations: { maps: { djerba: {}, other: {} } } },
    setHiddenPoiIds: vi.fn(), setHiddenCircuitIds: vi.fn(), setHiddenCircuitIdsUpdatedAt: vi.fn(),
    setOfficialCircuitsStatus: vi.fn(), setOfficialCircuitsStatusUpdatedAt: vi.fn(),
}));
vi.mock('../src/database.js', () => ({
    replacePoiData: vi.fn(async (mapId, id, data) => { h.device.userData[id] = JSON.parse(JSON.stringify(data)); }),
    saveAppState: vi.fn(async (k, v) => { h.app[k] = v; }),
    getAppState: vi.fn(async (k) => h.app[k]),
}));
vi.mock('../src/restore-apply.js', () => ({
    readDeviceState: vi.fn(async () => JSON.parse(JSON.stringify(h.device))),
}));
vi.mock('../src/google-account.js', () => ({
    listAppFileIds: vi.fn(async () => Object.fromEntries(Object.entries(h.drive).map(([n, f]) => [n, f.id]))),
    readAppFile: vi.fn(async (id) => JSON.parse(JSON.stringify(Object.values(h.drive).find(f => f.id === id).content))),
    writeAppFile: vi.fn(async (id, name, content) => {
        h.writes.push({ id, name, content });
        h.drive[name] = { id: id || `id-${name}`, content: JSON.parse(JSON.stringify(content)) };
        return h.drive[name].id;
    }),
}));

import { syncMap, resolveSyncConflict, getSyncConflicts, buildUpload, fileNameFor } from '../src/google-sync.js';

const empty = () => ({
    userData: {}, places: [], circuits: [], hiddenPoiIds: [], circuitsStatus: {}, circuitsStatusUpdatedAt: {},
    hiddenCircuitIds: [], hiddenCircuitIdsUpdatedAt: {},
});
const remoteFile = (state, extra = {}) => ({ id: 'f1', content: { v: 1, mapId: 'djerba', savedAt: 1, state: { ...empty(), ...state }, ...extra } });

beforeEach(() => {
    h.device = empty();
    h.app = {};
    h.drive = {};
    h.writes = [];
});

describe('compte encore vide pour la destination', () => {
    it('copie l’appareil dans le compte', async () => {
        h.device.userData.A = { vuManual: true, vu: true, vuUpdatedAt: 10 };
        const r = await syncMap('djerba');
        expect(r.created).toBe(true);
        expect(h.writes).toHaveLength(1);
        expect(h.writes[0].name).toBe(fileNameFor('djerba'));
        expect(h.writes[0].content.state.userData.A.vuManual).toBe(true);
    });

    it('rien sur l’appareil : rien n’est écrit', async () => {
        const r = await syncMap('djerba');
        expect(r.created).toBe(false);
        expect(h.writes).toHaveLength(0);
    });

    it('les circuits perso ne partent pas encore (PR 7)', async () => {
        h.device.userData.A = { notes: 'x', _fieldDates: { notes: 5 } };
        h.device.circuits = [{ id: 'c1', name: 'Boucle', poiIds: [] }];
        await syncMap('djerba');
        expect(h.writes[0].content.state.circuits).toEqual([]);
    });
});

describe('réunion avec le compte', () => {
    it('une visite faite sur l’autre appareil arrive ici, et repart réunie', async () => {
        h.device.userData.B = { notes: 'ici', _fieldDates: { notes: 5 } };
        h.drive[fileNameFor('djerba')] = remoteFile({ userData: { A: { vuManual: true, vu: true, vuUpdatedAt: 10 } } });
        const r = await syncMap('djerba');
        expect(h.device.userData.A.vuManual).toBe(true);
        expect(r.summary.visits).toBe(1);
        expect(r.changed).toBe(true);
        const sent = h.writes.at(-1).content.state.userData;
        expect(Object.keys(sent).sort()).toEqual(['A', 'B']);
    });

    it('un texte écrit des deux côtés : à choisir ; l’appareil garde le sien, le compte garde le sien', async () => {
        h.device.userData.G = { description: 'Version PC.', _fieldDates: { description: 2000 } };
        h.drive[fileNameFor('djerba')] = remoteFile({ userData: { G: { description: 'Version téléphone.', _fieldDates: { description: 3000 } } } });
        const r = await syncMap('djerba');
        expect(r.conflicts).toHaveLength(1);
        expect(h.device.userData.G.description).toBe('Version PC.');
        expect(await getSyncConflicts('djerba')).toHaveLength(1);
        const sent = h.writes.at(-1).content.state.userData.G;
        expect(sent.description).toBe('Version téléphone.');
        expect(sent._fieldDates.description).toBe(3000);
    });

    it('le plus récent gagne pour un champ de choix, sans question', async () => {
        h.device.userData.G = { Catégorie: 'Mosquée', _fieldDates: { Catégorie: 2000 } };
        h.drive[fileNameFor('djerba')] = remoteFile({ userData: { G: { Catégorie: 'Mausolée', _fieldDates: { Catégorie: 3000 } } } });
        const r = await syncMap('djerba');
        expect(r.conflicts).toHaveLength(0);
        expect(h.device.userData.G.Catégorie).toBe('Mausolée');
    });
});

describe('versions écartées', () => {
    const conflict = { kind: 'poi', id: 'G', key: 'description', here: 'Version PC.', file: 'Version téléphone.', fileDate: 3000 };

    it('un choix retire le texte de la liste et garde la version écartée pour l’envoi suivant', async () => {
        h.app.syncConflicts_djerba = [conflict];
        const left = await resolveSyncConflict('djerba', conflict, 'Version PC.');
        expect(left).toEqual([]);
        expect(h.app.syncDiscards_djerba).toEqual([expect.objectContaining({ side: 'compte', value: 'Version téléphone.' })]);
        h.device.userData.G = { description: 'Version PC.', _fieldDates: { description: 4000 }, _fieldFrom: { description: 3000 } };
        h.drive[fileNameFor('djerba')] = remoteFile({ userData: { G: { description: 'Version téléphone.', _fieldDates: { description: 3000 } } } });
        await syncMap('djerba');
        const sent = h.writes.at(-1).content;
        expect(sent.state.userData.G.description).toBe('Version PC.');
        expect(sent.discarded).toEqual([expect.objectContaining({ value: 'Version téléphone.' })]);
        expect(h.app.syncDiscards_djerba).toEqual([]);
    });

    it('un texte mêlé des deux : les deux versions sont gardées', async () => {
        await resolveSyncConflict('djerba', conflict, 'Version PC. Version téléphone.');
        expect(h.app.syncDiscards_djerba.map(d => d.side).sort()).toEqual(['appareil', 'compte']);
    });

    it('au-delà de 30 jours, une version écartée disparaît du compte', async () => {
        const old = { at: Date.now() - 31 * 24 * 3600 * 1000, value: 'vieux' };
        const recent = { at: Date.now() - 2 * 24 * 3600 * 1000, value: 'récent' };
        h.device.userData.A = { notes: 'x', _fieldDates: { notes: 5 } };
        h.drive[fileNameFor('djerba')] = remoteFile({}, { discarded: [old, recent] });
        await syncMap('djerba');
        expect(h.writes.at(-1).content.discarded.map(d => d.value)).toEqual(['récent']);
    });
});

describe('buildUpload', () => {
    it('lieu créé : le compte garde sa version du texte à choisir', () => {
        const place = (desc, date) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { HW_ID: 'P', description: desc, _fieldDates: { description: date } } });
        const after = { ...empty(), places: [place('ici', 2000)] };
        const remote = { ...empty(), places: [place('là-bas', 3000)] };
        const out = buildUpload(after, remote, [{ kind: 'place', id: 'P', key: 'description' }]);
        expect(out.places[0].properties.description).toBe('là-bas');
        expect(out.places[0].properties._fieldDates.description).toBe(3000);
        expect(after.places[0].properties.description).toBe('ici'); // l'appareil n'est pas touché
    });
});
