// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// admin-control-ui.computeChangesSubviewItems (PR B2)
//
// Le sub-router de l'onglet Modifications sépare le contenu en 3 sous-vues :
// Lieux (POI texte/coords) / Photos (grille pending) / Circuits.
// Cette fonction pure produit les 3 listes filtrées depuis diffData.
// ============================================================================

// Mocks minimaux — on ne touche pas au rendu, juste à la pure function.
vi.mock('../src/state.js', () => ({ state: {} }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn(() => null),
    getStoredUsername: vi.fn(() => null),
    saveToken: vi.fn(),
    validateToken: vi.fn(),
    uploadFileToGitHub: vi.fn(),
}));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/modal.js', () => ({ openHwModal: vi.fn(), closeHwModal: vi.fn() }));
vi.mock('../src/admin-maintenance.js', () => ({ renderMaintenanceTab: vi.fn() }));

import { computeChangesSubviewItems, setChangesSubView, getChangesSubView } from '../src/admin-control-ui.js';

describe('computeChangesSubviewItems', () => {
    it('retourne 3 listes vides si diffData vide', () => {
        const r = computeChangesSubviewItems({ pois: [], circuits: [] });
        expect(r).toEqual({ lieux: [], photos: [], circuits: [] });
    });

    it('résiste aux propriétés manquantes (pois/circuits absents)', () => {
        const r = computeChangesSubviewItems({});
        expect(r.lieux).toEqual([]);
        expect(r.photos).toEqual([]);
        expect(r.circuits).toEqual([]);
    });

    it('classe un POI avec changes meaningful dans Lieux uniquement', () => {
        const poi = { id: 'p1', name: 'A', changes: [{ key: 'Description', new: 'x', old: 'y' }] };
        const r = computeChangesSubviewItems({ pois: [poi], circuits: [] });
        expect(r.lieux).toEqual([poi]);
        expect(r.photos).toEqual([]);
    });

    it('classe un POI isCreation dans Lieux (même sans changes)', () => {
        const poi = { id: 'p1', name: 'A', changes: [], isCreation: true };
        const r = computeChangesSubviewItems({ pois: [poi], circuits: [] });
        expect(r.lieux).toEqual([poi]);
    });

    it('classe un POI isDeletion dans Lieux', () => {
        const poi = { id: 'p1', name: 'A', changes: [], isDeletion: true };
        const r = computeChangesSubviewItems({ pois: [poi], circuits: [] });
        expect(r.lieux).toEqual([poi]);
    });

    it('classe un POI isMigration dans Lieux', () => {
        const poi = { id: 'p1', name: 'A', changes: [], isMigration: true };
        const r = computeChangesSubviewItems({ pois: [poi], circuits: [] });
        expect(r.lieux).toEqual([poi]);
    });

    it('classe un POI avec UNIQUEMENT photos pending dans Photos (PAS Lieux)', () => {
        // Un POI qui n'a aucune modif texte mais des photos pending est ajouté
        // par le diff engine avec changes=[] — il ne doit pas apparaître dans
        // Lieux (rien à voir côté texte) mais bien dans Photos.
        const poi = { id: 'p1', name: 'A', changes: [], hasPendingPhotos: true, pendingPhotos: [{ id: 'ph1' }] };
        const r = computeChangesSubviewItems({ pois: [poi], circuits: [] });
        expect(r.lieux).toEqual([]);
        expect(r.photos).toEqual([poi]);
    });

    it('classe un POI avec changes ET photos dans Lieux ET Photos (deux entrées)', () => {
        const poi = { id: 'p1', name: 'A', changes: [{ key: 'Description', new: 'x', old: 'y' }], hasPendingPhotos: true };
        const r = computeChangesSubviewItems({ pois: [poi], circuits: [] });
        expect(r.lieux).toEqual([poi]);
        expect(r.photos).toEqual([poi]);
    });

    it('classe les circuits dans Circuits indépendamment de Lieux/Photos', () => {
        const circuits = [
            { id: 'c1', name: 'CircuitA', changes: [], isCreation: true },
            { id: 'c2', name: 'CircuitB', changes: [{ key: 'Nom', old: 'X', new: 'Y' }] }
        ];
        const r = computeChangesSubviewItems({ pois: [], circuits });
        expect(r.circuits).toEqual(circuits);
        expect(r.lieux).toEqual([]);
        expect(r.photos).toEqual([]);
    });

    it('mix complet : 5 POIs + 2 circuits → bons compteurs', () => {
        const diffData = {
            pois: [
                { id: 'p1', changes: [{ key: 'Nom' }] },                                          // Lieux
                { id: 'p2', changes: [], isCreation: true },                                      // Lieux
                { id: 'p3', changes: [], isDeletion: true },                                      // Lieux
                { id: 'p4', changes: [], hasPendingPhotos: true, pendingPhotos: [{}] },           // Photos seul
                { id: 'p5', changes: [{ key: 'Description' }], hasPendingPhotos: true },         // Lieux + Photos
            ],
            circuits: [{ id: 'c1' }, { id: 'c2' }]
        };
        const r = computeChangesSubviewItems(diffData);
        expect(r.lieux.map(p => p.id)).toEqual(['p1', 'p2', 'p3', 'p5']);
        expect(r.photos.map(p => p.id)).toEqual(['p4', 'p5']);
        expect(r.circuits.map(c => c.id)).toEqual(['c1', 'c2']);
    });

    it('ne mute pas le diffData en entrée', () => {
        const poi = { id: 'p1', changes: [{ key: 'Nom' }] };
        const diffData = { pois: [poi], circuits: [] };
        const before = JSON.stringify(diffData);
        computeChangesSubviewItems(diffData);
        expect(JSON.stringify(diffData)).toBe(before);
    });
});

describe('setChangesSubView / getChangesSubView', () => {
    it('défaut = lieux', () => {
        // Note : l'état est module-level. Si un autre test a changé la valeur
        // avant celui-ci, on remet à lieux pour vérifier le getter pur.
        setChangesSubView('lieux');
        expect(getChangesSubView()).toBe('lieux');
    });

    it('accepte lieux / photos / circuits', () => {
        setChangesSubView('photos');
        expect(getChangesSubView()).toBe('photos');
        setChangesSubView('circuits');
        expect(getChangesSubView()).toBe('circuits');
        setChangesSubView('lieux');
        expect(getChangesSubView()).toBe('lieux');
    });

    it('ignore une valeur invalide (pas de mutation)', () => {
        setChangesSubView('lieux');
        setChangesSubView('foobar');
        expect(getChangesSubView()).toBe('lieux');
    });
});
