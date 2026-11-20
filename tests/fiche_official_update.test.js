// Bandeau « La fiche officielle a été mise à jour depuis votre modification »
// (20/11/2026, maquette écrans 20 et 22).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/data.js', () => ({ getPatrimonialName: vi.fn(() => 'Mosquée Fadhloun') }));
vi.mock('../src/patrimonial-names.js', () => ({ getCurrentPatrimonialLang: vi.fn(() => 'fr') }));
vi.mock('../src/state.js', () => ({
    state: { isAdmin: false, currentMapId: 'djerba', destinations: { maps: {} }, currentCircuit: [], userData: {}, loadedFeatures: [], customFeatures: [] },
    getActiveDestinationCountry: vi.fn(() => 'tn'),
}));
vi.mock('../src/mobile-state.js', () => ({ isMobileView: vi.fn(() => false) }));
vi.mock('../src/access-point.js', () => ({ getAccessPointStatus: vi.fn(() => null) }));

import { buildDetailsPanelHtml } from '../src/templates.js';
import { isMobileView } from '../src/mobile-state.js';
import { state } from '../src/state.js';

const feature = (userData) => ({
    type: 'Feature',
    properties: { HW_ID: 'HW-F', 'Nom du site FR': 'Mosquée Fadhloun', 'Catégorie': 'Mosquée', description: 'Texte officiel corrigé.', descriptionPublic: true, userData },
    geometry: { type: 'Point', coordinates: [10.9, 33.8] },
});
const fiche = (userData) => {
    const f = feature(userData);
    state.loadedFeatures = [f];
    state.userData = { 'HW-F': userData };
    return buildDetailsPanelHtml(f, null);
};
const modified = { description: 'Ma version.', _officialBase: { description: 'Texte officiel.' } };

beforeEach(() => { vi.mocked(isMobileView).mockReturnValue(false); state.isAdmin = false; state.customFeatures = []; });

describe('bandeau « fiche officielle mise à jour »', () => {
    it('PC : bandeau avec « Voir » dans la description', () => {
        const html = fiche(modified);
        expect(html).toContain('poi-official-update');
        expect(html).toContain('id="poi-official-see"');
        expect(html).not.toContain('poi-official-update--stack');
    });
    it('téléphone : bouton sous le texte', () => {
        vi.mocked(isMobileView).mockReturnValue(true);
        expect(fiche(modified).body).toContain('poi-official-update--stack');
    });
    it('officiel inchangé depuis la modification : pas de bandeau', () => {
        expect(fiche({ description: 'Ma version.', _officialBase: { description: 'Texte officiel corrigé.' } })).not.toContain('poi-official-update');
    });
    it('admin : jamais de bandeau', () => {
        state.isAdmin = true;
        expect(fiche(modified)).not.toContain('poi-official-update');
    });
});
