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
    getLinkedAccount: vi.fn(() => ({ email: 'x' })),
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

describe('dernier point commun (22/11 : essai de Stefan, tracé perdu sans question)', () => {
    // Deux appareils déconnectés modifient chacun le tracé PLUSIEURS fois. Le
    // point de départ de la dernière modification est la modification
    // précédente du même appareil, plus récente que celle de l'autre qu'il n'a
    // jamais vue : l'ancienne règle « descend » (comparaison d'heures) gardait
    // chaque version sans rien demander, puis l'une écrasait l'autre.
    const base = (over = {}) => ({ id: 'c1', name: 'Boucle', poiIds: ['A', 'B'], realTrack: [[1, 1], [2, 2]], updatedAt: 1000, _partDates: { name: 1000, description: 1000, steps: 1000, trace: 1000 }, ...over });

    it('tracé modifié des deux côtés depuis le dernier échange : à choisir', async () => {
        // Appareil A : a synchronisé la version 1000, puis retracé deux fois (3000, puis 5000 partie de 3000).
        h.device.circuits = [base({ realTrack: [[1, 1], [9, 9]], _partDates: { name: 1000, description: 1000, steps: 1000, trace: 5000 }, _partFrom: { trace: 3000 } })];
        h.app.syncBase_djerba = { email: 'x', circuits: { c1: { name: 1000, description: 1000, steps: 1000, trace: 1000 } }, poi: {}, places: {} };
        // Compte : l'appareil B a retracé une fois (2000, partie de 1000).
        h.drive[fileNameFor('djerba')] = remoteFile({ circuits: [base({ realTrack: [[1, 1], [7, 7]], _partDates: { name: 1000, description: 1000, steps: 1000, trace: 2000 }, _partFrom: { trace: 1000 } })] });
        const r = await syncMap('djerba', { email: 'x' });
        expect(r.conflicts.map(c => c.key)).toEqual(['trace']);
        expect(h.device.circuits[0].realTrack).toEqual([[1, 1], [9, 9]]);
    });

    it('note modifiée deux fois ici, une fois ailleurs : à choisir aussi', async () => {
        h.device.userData.G = { notes: 'ici v2', _fieldDates: { notes: 5000 }, _fieldFrom: { notes: 3000 } };
        h.app.syncBase_djerba = { email: 'x', poi: { G: { notes: 1000 } }, places: {}, circuits: {} };
        h.drive[fileNameFor('djerba')] = remoteFile({ userData: { G: { notes: 'ailleurs', _fieldDates: { notes: 2000 }, _fieldFrom: { notes: 1000 } } } });
        const r = await syncMap('djerba', { email: 'x' });
        expect(r.conflicts.map(c => c.key)).toEqual(['notes']);
    });

    it('seul le compte a changé depuis le dernier échange : il arrive, sans question', async () => {
        h.device.userData.G = { notes: 'commun', _fieldDates: { notes: 1000 } };
        h.app.syncBase_djerba = { email: 'x', poi: { G: { notes: 1000 } }, places: {}, circuits: {} };
        h.drive[fileNameFor('djerba')] = remoteFile({ userData: { G: { notes: 'nouveau', _fieldDates: { notes: 900 } } } }); // heure plus ancienne : l'heure ne compte plus
        const r = await syncMap('djerba', { email: 'x' });
        expect(r.conflicts).toEqual([]);
        expect(h.device.userData.G.notes).toBe('nouveau');
    });

    it('seul cet appareil a changé : il part, sans question', async () => {
        h.device.userData.G = { notes: 'mien', _fieldDates: { notes: 4000 }, _fieldFrom: { notes: 3500 } };
        h.app.syncBase_djerba = { email: 'x', poi: { G: { notes: 1000 } }, places: {}, circuits: {} };
        h.drive[fileNameFor('djerba')] = remoteFile({ userData: { G: { notes: 'commun', _fieldDates: { notes: 1000 } } } });
        const r = await syncMap('djerba', { email: 'x' });
        expect(r.conflicts).toEqual([]);
        expect(h.writes.at(-1).content.state.userData.G.notes).toBe('mien');
    });

    it('le point commun est retenu après la synchronisation (texte à choisir : celui du compte)', async () => {
        h.device.userData.G = { notes: 'ici', _fieldDates: { notes: 5000 } };
        h.app.syncBase_djerba = { email: 'x', poi: { G: { notes: 1000 } }, places: {}, circuits: {} };
        h.drive[fileNameFor('djerba')] = remoteFile({ userData: { G: { notes: 'ailleurs', _fieldDates: { notes: 2000 } } } });
        await syncMap('djerba', { email: 'x' });
        expect(h.app.syncBase_djerba.poi.G.notes).toBe(2000);
        expect(h.app.syncBase_djerba.email).toBe('x');
    });

    it('point commun d’un autre compte : ignoré (règle d’avant)', async () => {
        h.device.userData.G = { notes: 'commun', _fieldDates: { notes: 1000 } };
        h.app.syncBase_djerba = { email: 'autre@x', poi: { G: { notes: 1000 } }, places: {}, circuits: {} };
        h.drive[fileNameFor('djerba')] = remoteFile({ userData: { G: { notes: 'nouveau', _fieldDates: { notes: 900 } } } });
        await syncMap('djerba', { email: 'x' });
        expect(h.device.userData.G.notes).toBe('commun'); // sans point commun : ici plus récent
    });
});

describe('un choix fait ici, repris par l’autre appareil sans question (point commun)', () => {
    it('A choisit ; B, resté sur sa version, reçoit le texte choisi', async () => {
        // A : conflit sur une note (ici « A », compte « B » écrit par l'appareil B).
        h.device.userData.G = { notes: 'A', _fieldDates: { notes: 3000 } };
        h.app.syncBase_djerba = { email: 'x', poi: { G: { notes: 1000 } }, places: {}, circuits: {} };
        h.drive[fileNameFor('djerba')] = remoteFile({ userData: { G: { notes: 'B', _fieldDates: { notes: 2000 } } } });
        const first = await syncMap('djerba');
        expect(first.conflicts).toHaveLength(1);
        // A choisit « A et B » : daté maintenant, parti de la version du compte.
        await resolveSyncConflict('djerba', first.conflicts[0], 'A et B');
        h.device.userData.G = { notes: 'A et B', _fieldDates: { notes: 9000 }, _fieldFrom: { notes: 2000 } };
        await syncMap('djerba');
        expect(h.drive[fileNameFor('djerba')].content.state.userData.G.notes).toBe('A et B');

        // B : point commun = sa propre version (2000), qu'il n'a pas changée.
        h.device.userData.G = { notes: 'B', _fieldDates: { notes: 2000 } };
        h.app.syncBase_djerba = { email: 'x', poi: { G: { notes: 2000 } }, places: {}, circuits: {} };
        h.app.syncConflicts_djerba = [];
        const onB = await syncMap('djerba');
        expect(onB.conflicts).toEqual([]);
        expect(h.device.userData.G.notes).toBe('A et B');
    });
});

describe('résumé : circuits envoyés (22/11)', () => {
    it('un tracé modifié ici et envoyé compte dans « Envoyé depuis cet appareil »', async () => {
        const c = (track, date) => ({ id: 'c1', name: 'Boucle', poiIds: ['A'], realTrack: track, updatedAt: date, _partDates: { name: 1000, description: 1000, steps: 1000, trace: date } });
        h.device.circuits = [c([[1, 1], [9, 9]], 5000)];
        h.app.syncBase_djerba = { email: 'x', circuits: { c1: { name: 1000, description: 1000, steps: 1000, trace: 1000 } }, poi: {}, places: {} };
        h.drive[fileNameFor('djerba')] = remoteFile({ circuits: [c([[1, 1], [2, 2]], 1000)] });
        const r = await syncMap('djerba');
        expect(r.sent.circuits).toBe(1);
    });
});

describe('circuits modifiés par la synchro (22/11)', () => {
    it('la synchro dit quels circuits elle a modifiés (le circuit ouvert est redessiné)', async () => {
        const c = (track, date) => ({ id: 'c1', name: 'Boucle', poiIds: ['A'], realTrack: track, updatedAt: date, _partDates: { name: 1000, description: 1000, steps: 1000, trace: date } });
        h.device.circuits = [c([[1, 1], [2, 2]], 1000)];
        h.app.syncBase_djerba = { email: 'x', circuits: { c1: { name: 1000, description: 1000, steps: 1000, trace: 1000 } }, poi: {}, places: {} };
        h.drive[fileNameFor('djerba')] = remoteFile({ circuits: [c([[1, 1], [8, 8]], 6000)] });
        const r = await syncMap('djerba');
        expect(r.circuitsChanged).toEqual(['c1']);
    });
});

describe('lieux créés supprimés (PR 8)', () => {
    const place = (id, date) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { HW_ID: id, 'Nom du site FR': id, _fieldDates: { 'Nom du site FR': date } } });

    it('supprimé ailleurs : retiré ici, et la suppression reste dans le compte', async () => {
        h.device.places = [place('P1', 1000)];
        h.drive[fileNameFor('djerba')] = remoteFile({}, { deletedPlaces: { P1: 5000 } });
        await syncMap('djerba');
        expect(h.app.customPois_djerba).toEqual([]);
        expect(h.writes.at(-1).content.deletedPlaces).toEqual({ P1: 5000 });
    });
    it('supprimé ici : ne revient pas depuis le compte', async () => {
        h.app.deletedPlaces_djerba = { P1: 5000 };
        h.device.userData.X = { notes: 'x', _fieldDates: { notes: 5 } };
        h.drive[fileNameFor('djerba')] = remoteFile({ places: [place('P1', 1000)] });
        await syncMap('djerba');
        expect(h.writes.at(-1).content.state.places).toEqual([]);
    });
    it('modifié après la suppression : il reste', async () => {
        h.device.places = [place('P1', 9000)];
        h.drive[fileNameFor('djerba')] = remoteFile({}, { deletedPlaces: { P1: 5000 } });
        await syncMap('djerba');
        expect(h.writes.at(-1).content.state.places.map(p => p.properties.HW_ID)).toEqual(['P1']);
    });
});

describe('lieux arrivés d’un autre appareil (écran 50)', () => {
    it('la synchro dit quels lieux créés viennent d’arriver', async () => {
        const place = (id) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { HW_ID: id, 'Nom du site FR': id, _fieldDates: { 'Nom du site FR': 1000 } } });
        h.device.places = [place('ICI')];
        h.drive[fileNameFor('djerba')] = remoteFile({ places: [place('ICI'), place('VENU')] });
        const r = await syncMap('djerba');
        expect(r.arrivedPlaces).toEqual(['VENU']);
    });
});
