// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Lieux au même endroit (PR 8 « synchro users », maquette écrans 47-51, 22/11/2026).

const h = vi.hoisted(() => ({ photos: {}, saved: [], circuits: [], removed: [], deleted: [] }));

vi.mock('../src/database.js', () => ({
    getAppState: vi.fn(async () => ({})),
    saveAppState: vi.fn(async () => {}),
    savePoiData: vi.fn(async (m, id, data) => { h.saved.push({ id, data }); }),
    getPoiPhotos: vi.fn(async (m, id) => h.photos[id] || []),
    savePoiPhotos: vi.fn(async (m, id, list) => { h.photos[id] = list; }),
    deletePoiPhotos: vi.fn(async (m, id) => { delete h.photos[id]; }),
}));
vi.mock('../src/circuit-store.js', () => ({ persistCircuit: vi.fn(async (c) => { h.circuits.push(c); }) }));
vi.mock('../src/data.js', () => ({ removeUnpublishedPoi: vi.fn(async (id) => { h.removed.push(id); }) }));
vi.mock('../src/google-sync.js', () => ({ recordPlaceDeletion: vi.fn(async (m, id) => { h.deleted.push(id); }) }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));

import { state } from '../src/state.js';
import { nearbyPlaces, officialTwinOf, listOfficialTwins, setTwinAnswers, twinKey, twinBannerHtml, setArrivedPlaces, listPersoTwins, pairKey } from '../src/place-twins.js';
import { mergeIntoOfficial, mergePersoPlaces } from '../src/place-twins-ui.js';

// ~0,00009° de latitude ≈ 10 m.
const feat = (id, lat, lng, props = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { HW_ID: id, 'Nom du site FR': id, ...props } });

beforeEach(() => {
    Object.assign(h, { photos: {}, saved: [], circuits: [], removed: [], deleted: [] });
    const official = feat('OFF', 33.80000, 10.90000, { 'Catégorie': 'Mosquée', description: 'Texte officiel.' });
    const far = feat('FAR', 33.81000, 10.90000);
    const mine = feat('MINE', 33.80010, 10.90000, { description: '' });
    state.loadedFeatures = [official, far, mine];
    state.customFeatures = [mine];
    state.hiddenPoiIds = [];
    state.userData = { MINE: { vuManual: true, vu: true, notes: 'Ma note' }, OFF: { notes: 'Note officielle à moi' } };
    state.myCircuits = [{ id: 'c1', name: 'Boucle', poiIds: ['A', 'MINE', 'B'] }];
    state.isAdmin = false;
    state.currentMapId = 'djerba';
    setTwinAnswers({});
    setArrivedPlaces([]);
});

describe('nearbyPlaces (avant de créer, écran 47)', () => {
    it('lieux à moins de 50 m, du plus proche au plus loin', () => {
        const r = nearbyPlaces(33.80008, 10.90000); // ~2 m de MINE, ~9 m de OFF
        expect(r.map(n => n.id)).toEqual(['MINE', 'OFF']);
        expect(r[0].dist).toBeLessThan(5);
    });
    it('rien au-delà de 50 m', () => {
        expect(nearbyPlaces(33.82, 10.9)).toEqual([]);
    });
    it('un lieu masqué ou en attente ne compte pas', () => {
        state.hiddenPoiIds = ['OFF'];
        state.loadedFeatures[2].properties._pending = true;
        expect(nearbyPlaces(33.80005, 10.90000)).toEqual([]);
    });
});

describe('lieu officiel au même endroit (écran 48)', () => {
    it('trouve le lieu officiel près d’un de vos lieux', () => {
        const t = officialTwinOf('MINE');
        expect(t.officialId).toBe('OFF');
        expect(listOfficialTwins()).toHaveLength(1);
        expect(twinBannerHtml('MINE')).toContain('poi-twin-see');
    });
    it('« Pas le même lieu » est retenu pour la paire', () => {
        setTwinAnswers({ [twinKey('MINE', 'OFF')]: 'different' });
        expect(officialTwinOf('MINE')).toBeNull();
        expect(twinBannerHtml('MINE')).toBe('');
    });
    it('jamais en admin, jamais pour un lieu officiel', () => {
        expect(officialTwinOf('OFF')).toBeNull();
        state.isAdmin = true;
        expect(listOfficialTwins()).toEqual([]);
    });
});

describe('« C’est le même lieu » (écran 49)', () => {
    it('visite, note, photos et circuits passent sur la fiche officielle ; votre lieu est retiré partout', async () => {
        h.photos.MINE = [{ id: 'p1' }, { id: 'p2' }];
        h.photos.OFF = [{ id: 'p0' }];
        await mergeIntoOfficial(officialTwinOf('MINE'));
        const saved = h.saved.find(s => s.id === 'OFF').data;
        expect(saved.vuManual).toBe(true);
        expect(saved.notes).toBe('Note officielle à moi\n\nMa note');
        expect(h.photos.OFF.map(p => p.id)).toEqual(['p0', 'p1', 'p2']);
        expect(h.photos.MINE).toBeUndefined();
        expect(h.circuits[0].poiIds).toEqual(['A', 'OFF', 'B']);
        expect(h.removed).toEqual(['MINE']);
        expect(h.deleted).toEqual(['MINE']);
    });
    it('la description choisie s’affiche sur la fiche officielle', async () => {
        await mergeIntoOfficial(officialTwinOf('MINE'), 'Texte officiel. Ma phrase.');
        expect(h.saved.find(s => s.id === 'OFF').data.description).toBe('Texte officiel. Ma phrase.');
    });
});

describe('deux de vos lieux au même endroit (écran 50)', () => {
    const addPerso = (id, lat, props) => {
        const f = feat(id, lat, 10.95, props);
        state.loadedFeatures.push(f); state.customFeatures.push(f);
        return f;
    };

    it('une paire seulement si l’un des deux est arrivé d’un autre appareil', () => {
        addPerso('A1', 33.85000, { _fieldDates: { 'Nom du site FR': 1000 } });
        addPerso('B1', 33.85005, { _fieldDates: { 'Nom du site FR': 2000 } });
        expect(listPersoTwins()).toEqual([]);
        setArrivedPlaces(['B1']);
        const pairs = listPersoTwins();
        expect(pairs.map(p => `${p.localId}+${p.arrivedId}`)).toEqual(['A1+B1']);
    });
    it('« Garder les deux » est retenu (dans les deux sens)', () => {
        addPerso('A1', 33.85000, {}); addPerso('B1', 33.85005, {});
        setArrivedPlaces(['B1']);
        setTwinAnswers({ [pairKey('B1', 'A1')]: 'different' });
        expect(listPersoTwins()).toEqual([]);
    });
    it('les réunir : le plus ancien gardé, champ le plus récent, notes bout à bout, l’autre retiré partout', async () => {
        const a = addPerso('A1', 33.85000, { 'Catégorie': 'Potale', created_at: '2026-11-12T10:20:00Z', _fieldDates: { 'Nom du site FR': 1000, 'Catégorie': 1000 } });
        const b = addPerso('B1', 33.85005, { 'Nom du site FR': 'Chapelle Saint-Roch', 'Catégorie': 'Chapelle', created_at: '2026-11-12T10:24:00Z', _fieldDates: { 'Nom du site FR': 3000, 'Catégorie': 500 } });
        state.userData.A1 = { vuManual: true, vu: true };
        state.userData.B1 = { notes: 'Note de l’autre appareil' };
        h.photos.B1 = [{ id: 'pb' }];
        state.myCircuits = [{ id: 'c2', name: 'Boucle', poiIds: ['X', 'B1'] }];
        await mergePersoPlaces(a, b);
        expect(a.properties['Nom du site FR']).toBe('Chapelle Saint-Roch'); // plus récent (3000)
        expect(a.properties['Catégorie']).toBe('Potale');                   // le sien plus récent (1000 > 500)
        expect(h.saved.find(x => x.id === 'A1').data.notes).toBe('Note de l’autre appareil');
        expect(h.photos.A1.map(p => p.id)).toEqual(['pb']);
        expect(h.circuits[0].poiIds).toEqual(['X', 'A1']);
        expect(h.removed).toEqual(['B1']);
        expect(h.deleted).toEqual(['B1']);
    });
});
