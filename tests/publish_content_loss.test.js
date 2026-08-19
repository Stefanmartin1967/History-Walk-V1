import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Garde-fou « perte de contenu » à la publication.
//
// Cas réel du 26/07 : la fiche « Mosquée de Midoun » a été republiée depuis un
// état ancien — la description est repassée d'une version longue à une version
// courte et la Source a été vidée, SANS que ce soit vu (le diff les affichait,
// mais à l'identique d'une correction voulue). On marque donc ces changements.
// ============================================================================

vi.mock('../src/state.js', () => ({ state: { currentMapId: 'djerba', loadedFeatures: [], userData: {} }, setUserData: vi.fn(), setCustomFeatures: vi.fn(), setOfficialCircuits: vi.fn(), setDeletedOfficialCircuitIds: vi.fn() }));
vi.mock('../src/circuit-deletion-state.js', () => ({ setOfficialCircuitDeleted: vi.fn(), isOfficialCircuitDeleted: vi.fn(() => false) }));
vi.mock('../src/net.js', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('../src/utils.js', () => ({
    getPoiId: (f) => f.properties.HW_ID,
    getPoiName: (f) => f.properties['Nom du site FR'],
    isCandidate: () => false,
}));
vi.mock('../src/config.js', () => ({
    RAW_BASE: 'https://example.com',
    GITHUB_PATHS: { geojson: () => '', circuits: () => '', tested: () => '' },
    PERSONAL_KEYS: ['vu'],
}));
vi.mock('../src/database.js', () => ({
    getAllPendingAdminPhotos: vi.fn(() => Promise.resolve({})),
    savePoiData: vi.fn(),
    deletePoiData: vi.fn(),
}));

vi.mock('../src/events.js', () => ({ eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/github-sync.js', () => ({ uploadFileToGitHub: vi.fn(), deleteFileFromGitHub: vi.fn(), getStoredToken: vi.fn(() => 't') }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/modal.js', () => ({ showConfirm: vi.fn(() => Promise.resolve(false)), closeModal: vi.fn() }));
vi.mock('../src/admin-geojson.js', () => ({ generateMasterGeoJSONData: vi.fn(() => ({ features: [] })) }));
vi.mock('../src/admin-control-ui.js', () => ({ openControlCenterModal: vi.fn(), renderTab: vi.fn(), closeCCModal: vi.fn() }));
vi.mock('../src/gpx.js', () => ({ generateGPXString: vi.fn() }));

import { diffData, annotateLosses } from '../src/admin-diff-engine.js';
import { buildPublishWarning } from '../src/admin-control-center.js';

beforeEach(() => {
    diffData.stats = { contentLosses: 0 };
    diffData.pois = [];
});

const run = (changes) => { annotateLosses(changes); return changes; };

describe('annotateLosses — ce qui doit alerter', () => {
    it('marque un champ rempli qui devient vide (cas Source du 26/07)', () => {
        const [c] = run([{ key: 'Source', old: 'http://palaisbenayed.com/…/repertoire.pdf', new: '' }]);
        expect(c.loss).toBe('cleared');
        expect(diffData.stats.contentLosses).toBe(1);
    });

    it('marque un texte nettement raccourci (cas Description du 26/07)', () => {
        const [c] = run([{
            key: 'Description',
            old: 'La grande mosquée au centre de Midoun. Mosquée malékite à origine nokkarite ibadite',
            new: 'Egalement appelée ancienne mosquée de Midoun.',
        }]);
        expect(c.loss).toBe('shortened');
    });

    it('compte plusieurs pertes sur une même fiche', () => {
        run([
            { key: 'Source', old: 'http://exemple.org/doc.pdf', new: '' },
            { key: 'Description', old: 'Une description longue et détaillée du lieu patrimonial.', new: 'Court.' },
        ]);
        expect(diffData.stats.contentLosses).toBe(2);
    });
});

describe('annotateLosses — ce qui ne doit PAS alerter (garder le signal rare)', () => {
    it("ignore une correction de même longueur (nom arabe مدنين → ميدون)", () => {
        const [c] = run([{ key: 'Nom du site arabe', old: 'جامع مدنين', new: 'جامع ميدون' }]);
        expect(c.loss).toBeUndefined();
        expect(diffData.stats.contentLosses).toBe(0);
    });

    it('ignore un enrichissement (champ vide → contenu)', () => {
        const [c] = run([{ key: 'Description', old: '—', new: 'La grande mosquée au centre de Midoun.' }]);
        expect(c.loss).toBeUndefined();
    });

    it('ignore un allongement de texte', () => {
        const [c] = run([{ key: 'Description', old: 'Court.', new: 'Une description bien plus complète du lieu.' }]);
        expect(c.loss).toBeUndefined();
    });

    it('ignore une reformulation de longueur voisine (sous le seuil)', () => {
        const [c] = run([{ key: 'Description', old: 'Mosquée ibadite wahbite abandonnée.', new: 'Mosquée ibadite wahbite.' }]);
        expect(c.loss).toBeUndefined();
    });

    it('ignore le champ photos (géré par sa grille dédiée)', () => {
        const [c] = run([{ key: 'Photos', rawKey: 'photos', old: '5 photo(s)', new: '0 photo(s)' }]);
        expect(c.loss).toBeUndefined();
    });

    it("ne s'emballe pas sur un champ absent au départ (old undefined/—)", () => {
        const out = run([
            { key: 'Horaires', old: undefined, new: '' },
            { key: 'Téléphone', old: '—', new: '' },
        ]);
        expect(out.every(c => c.loss === undefined)).toBe(true);
        expect(diffData.stats.contentLosses).toBe(0);
    });
});

describe('buildPublishWarning — le message du dialogue de publication', () => {
    it("reste VIDE quand aucun contenu n'est perdu (l'alerte doit rester rare)", () => {
        diffData.pois = [{
            name: 'Mosquée de Midoun',
            changes: run([{ key: 'Nom du site arabe', old: 'جامع مدنين', new: 'جامع ميدون' }]),
        }];
        expect(buildPublishWarning()).toBe('');
    });

    it('nomme la fiche et chaque champ perdu (reconstitution du cas du 26/07)', () => {
        diffData.pois = [{
            name: 'Mosquée de Midoun',
            changes: run([
                { key: 'Nom du site arabe', old: 'جامع مدنين', new: 'جامع ميدون' },
                { key: 'Description', old: 'La grande mosquée au centre de Midoun. Mosquée malékite à origine nokkarite ibadite', new: 'Egalement appelée ancienne mosquée de Midoun.' },
                { key: 'Source', old: 'http://palaisbenayed.com/doc.pdf', new: '' },
            ]),
        }];
        const msg = buildPublishWarning();
        expect(msg).toContain('retire du contenu déjà en ligne');
        expect(msg).toContain('Mosquée de Midoun');
        expect(msg).toContain('Description (raccourci)');
        expect(msg).toContain('Source (vidé)');
        // le champ corrigé volontairement n'est PAS listé
        expect(msg).not.toContain('Nom du site arabe');
    });

    it('agrège plusieurs fiches', () => {
        diffData.pois = [
            { name: 'Fiche A', changes: run([{ key: 'Source', old: 'http://a.org/x.pdf', new: '' }]) },
            { name: 'Fiche B', changes: run([{ key: 'Description', old: 'Un texte descriptif assez long pour compter.', new: 'Bref.' }]) },
        ];
        const msg = buildPublishWarning();
        expect(msg).toContain('Fiche A');
        expect(msg).toContain('Fiche B');
    });
});
