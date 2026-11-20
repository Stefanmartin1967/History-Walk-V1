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
    removeMyCircuit: vi.fn(), setHiddenPoiIds: vi.fn(), setHiddenCircuitIds: vi.fn(), setHiddenCircuitIdsUpdatedAt: vi.fn(),
    setOfficialCircuitsStatus: vi.fn(), setOfficialCircuitsStatusUpdatedAt: vi.fn(),
}));
vi.mock('../src/database.js', () => ({
    saveCircuit: vi.fn(async (c) => {
        const i = h.device.circuits.findIndex(x => x.id === c.id);
        if (i > -1) h.device.circuits[i] = JSON.parse(JSON.stringify(c)); else h.device.circuits.push(JSON.parse(JSON.stringify(c)));
    }),
    deleteCircuitById: vi.fn(async (id) => { h.device.circuits = h.device.circuits.filter(c => c.id !== id); }),
    replacePoiData: vi.fn(async (mapId, id, data) => { h.device.userData[id] = JSON.parse(JSON.stringify(data)); }),
    saveAppState: vi.fn(async (k, v) => { h.app[k] = v; }),
    getAppState: vi.fn(async (k) => h.app[k]),
}));
vi.mock('../src/circuit-store.js', () => ({ placeCircuitInState: vi.fn(), persistCircuit: vi.fn() }));
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

    it('les circuits perso partent aussi (PR 7)', async () => {
        h.device.circuits = [{ id: 'c1', name: 'Boucle', poiIds: ['A'] }];
        await syncMap('djerba');
        expect(h.writes[0].content.state.circuits.map(c => c.id)).toEqual(['c1']);
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

describe('circuits perso (PR 7)', () => {
    const circuit = (over = {}) => ({ id: 'c1', name: 'Boucle', poiIds: ['A', 'B'], realTrack: [[1, 1], [2, 2]], updatedAt: 1000, _partDates: { name: 1000, description: 1000, steps: 1000, trace: 1000 }, ...over });

    it('un circuit créé sur l’autre appareil arrive ici', async () => {
        h.device.userData.X = { notes: 'x', _fieldDates: { notes: 5 } };
        h.drive[fileNameFor('djerba')] = remoteFile({ circuits: [circuit()] });
        const r = await syncMap('djerba');
        expect(h.device.circuits.map(c => c.id)).toEqual(['c1']);
        expect(r.summary.circuits).toEqual(['Boucle']);
    });

    it('supprimé définitivement ailleurs : supprimé ici aussi, sans question', async () => {
        h.device.circuits = [circuit()];
        h.drive[fileNameFor('djerba')] = remoteFile({}, { deletedCircuits: { c1: 5000 } });
        await syncMap('djerba');
        expect(h.device.circuits).toEqual([]);
        expect(h.writes.at(-1).content.deletedCircuits).toEqual({ c1: 5000 });
    });

    it('modifié ici après la suppression : gardé dans la Corbeille, annoncé', async () => {
        h.device.circuits = [circuit({ updatedAt: 9000, _partDates: { name: 9000 } })];
        h.drive[fileNameFor('djerba')] = remoteFile({}, { deletedCircuits: { c1: 5000 } });
        const r = await syncMap('djerba');
        expect(h.device.circuits[0].isDeleted).toBe(true);
        expect(r.survivors.map(c => c.id)).toEqual(['c1']);
    });

    it('étapes modifiées des deux côtés : à choisir, le compte garde ses étapes et son tracé', async () => {
        h.device.circuits = [circuit({ poiIds: ['A', 'B', 'C'], realTrack: [[1, 1], [3, 3]], _partDates: { name: 1000, description: 1000, steps: 2000, trace: 2000 } })];
        h.drive[fileNameFor('djerba')] = remoteFile({ circuits: [circuit({ poiIds: ['A', 'D'], realTrack: [[1, 1], [4, 4]], _partDates: { name: 1000, description: 1000, steps: 3000, trace: 3000 } })] });
        const r = await syncMap('djerba');
        expect(r.conflicts.map(c => c.key)).toEqual(['steps']); // le tracé suit les étapes
        expect(h.device.circuits[0].poiIds).toEqual(['A', 'B', 'C']);
        const sent = h.writes.at(-1).content.state.circuits[0];
        expect(sent.poiIds).toEqual(['A', 'D']);
        expect(sent.realTrack).toEqual([[1, 1], [4, 4]]);
    });

    it('nom changé d’un seul côté : passe sans question', async () => {
        h.device.circuits = [circuit()];
        h.drive[fileNameFor('djerba')] = remoteFile({ circuits: [circuit({ name: 'Boucle du sud', _partDates: { name: 4000, description: 1000, steps: 1000, trace: 1000 }, _partFrom: { name: 1000 } })] });
        const r = await syncMap('djerba');
        expect(r.conflicts).toEqual([]);
        expect(h.device.circuits[0].name).toBe('Boucle du sud');
    });
});

describe('annonce des choix', () => {
    it('un choix déjà en attente n’est pas réannoncé à la synchronisation suivante', async () => {
        h.device.userData.G = { description: 'Version PC.', _fieldDates: { description: 2000 } };
        h.drive[fileNameFor('djerba')] = remoteFile({ userData: { G: { description: 'Version téléphone.', _fieldDates: { description: 3000 } } } });
        const first = await syncMap('djerba');
        expect(first.newConflicts).toHaveLength(1);
        const second = await syncMap('djerba');
        expect(second.conflicts).toHaveLength(1);
        expect(second.newConflicts).toHaveLength(0);
    });
});
