// Bandeau « Cette note a changé sur un autre appareil » (note-sync.js).
// 19/11/2026 : 7 notes en conflit sur le téléphone de Stefan, que le PC ne
// voyait pas (ses notes étaient identiques au dépôt). Le téléphone disait « se
// règle sur le PC » : insoluble. Désormais « Résoudre » partout.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/data.js', () => ({ getPatrimonialName: vi.fn(() => 'Musée des Chasseurs à pied') }));
vi.mock('../src/patrimonial-names.js', () => ({ getCurrentPatrimonialLang: vi.fn(() => 'fr') }));
vi.mock('../src/state.js', () => ({
    state: { isAdmin: true, currentMapId: 'charleroi', destinations: { maps: {} }, currentCircuit: [] },
    getActiveDestinationCountry: vi.fn(() => 'be'),
}));
vi.mock('../src/mobile-state.js', () => ({ isMobileView: vi.fn(() => false) }));
vi.mock('../src/access-point.js', () => ({ getAccessPointStatus: vi.fn(() => null) }));

import { buildDetailsPanelHtml } from '../src/templates.js';
import { isMobileView } from '../src/mobile-state.js';

const fiche = (userData) => buildDetailsPanelHtml({
    type: 'Feature',
    properties: { HW_ID: 'HW-M', 'Nom du site FR': 'Musée des Chasseurs à pied', 'Catégorie': 'Musée', userData },
    geometry: { type: 'Point', coordinates: [4.44, 50.41] },
}, null);

const conflict = { notes: 'Version du téléphone.', noteSync: { sha: null, base: '', dirty: true, remote: 'Version du PC.', remoteSha: 's1' } };

beforeEach(() => { vi.mocked(isMobileView).mockReturnValue(false); });

describe('bandeau de conflit de note', () => {
    it('PC : bandeau avec « Résoudre »', () => {
        const html = fiche(conflict);
        expect(html).toContain('poi-note-conflict');
        expect(html).toContain('id="poi-note-resolve"');
        expect(html).not.toContain('poi-note-conflict--stack');
    });

    it('téléphone : « Résoudre » aussi (plus de « se règle sur le PC »), bouton sous le texte', () => {
        vi.mocked(isMobileView).mockReturnValue(true);
        const html = fiche(conflict).body; // téléphone : { header, body, footer }
        expect(html).toContain('id="poi-note-resolve"');
        expect(html).toContain('poi-note-conflict--stack');
        expect(html).not.toContain('sur le PC');
    });

    it('pas de conflit : pas de bandeau', () => {
        const html = fiche({ notes: 'x', noteSync: { sha: 's1', base: 'x', dirty: false } });
        expect(html).not.toContain('poi-note-conflict');
    });
});
